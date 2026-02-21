import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { findDownloadedSourceVideo, getJobStoragePaths } from "@/lib/storage";
import { YouTubeVideoMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.YTDLP_PYTHON_BIN?.trim() || "python3.11";
const PYTHON_ARGS_PREFIX = ["-W", "ignore", "-m", "yt_dlp"];
const DEFAULT_COOKIES_FILE = "lib/ytdlp/cookies.txt";
const YTDLP_RETRIES = 3;

type ExecFileError = NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
};

interface YtDlpInfo {
  id: string;
  title?: string;
  duration?: number;
  uploader?: string;
  thumbnail?: string;
  webpage_url?: string;
  description?: string;
  tags?: string[];
}

export interface DownloadedVideoSource {
  video: YouTubeVideoMeta;
  sourceVideoPath: string;
  keywords: string[];
  description: string;
}

function parseJsonFromOutput<T>(raw: string): T {
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("Não foi possível ler os metadados retornados pelo yt-dlp.");
  }

  try {
    return JSON.parse(raw.slice(firstBrace)) as T;
  } catch {
    throw new Error("Falha ao interpretar metadados JSON do yt-dlp.");
  }
}

function resolveCookiesPath(): string {
  const configured = process.env.YTDLP_COOKIES_FILE?.trim() || DEFAULT_COOKIES_FILE;
  const absolutePath = path.resolve(process.cwd(), configured);

  if (!existsSync(absolutePath)) {
    throw new Error(
      `Arquivo de cookies do yt-dlp não encontrado em ${absolutePath}. Defina YTDLP_COOKIES_FILE para o caminho correto.`
    );
  }

  return absolutePath;
}

function normalizeYtDlpError(error: unknown): Error {
  if (error && typeof error === "object") {
    const execError = error as ExecFileError;
    const stderr = typeof execError.stderr === "string" ? execError.stderr.trim() : "";
    const stdout = typeof execError.stdout === "string" ? execError.stdout.trim() : "";
    const realOutput = stderr || stdout;

    if (realOutput) {
      return new Error(realOutput);
    }

    if (execError.message) {
      return new Error(execError.message);
    }
  }

  return new Error("Falha desconhecida no yt-dlp.");
}

async function runYtDlpOnce(
  args: string[],
  workingDirectory: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(PYTHON_BIN, [...PYTHON_ARGS_PREFIX, ...args], {
      cwd: workingDirectory,
      maxBuffer: 32 * 1024 * 1024,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    throw normalizeYtDlpError(error);
  }
}

async function runYtDlp(
  args: string[],
  workingDirectory: string,
  log?: (message: string) => void
): Promise<{ stdout: string; stderr: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= YTDLP_RETRIES; attempt += 1) {
    try {
      return await runYtDlpOnce(args, workingDirectory);
    } catch (error) {
      const normalized = normalizeYtDlpError(error);
      lastError = normalized;

      if (attempt < YTDLP_RETRIES) {
        log?.(
          `yt-dlp falhou na tentativa ${attempt}/${YTDLP_RETRIES}. Nova tentativa em andamento. Motivo: ${normalized.message}`
        );
      }
    }
  }

  throw lastError ?? new Error("Falha desconhecida no yt-dlp.");
}

function getBaseMetadataArgs(): string[] {
  const cookiesPath = resolveCookiesPath();

  return [
    "--ignore-config",
    "--cookies",
    cookiesPath,
    "--dump-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--no-check-formats",
  ];
}

function getBaseAuthenticatedArgs(): string[] {
  const cookiesPath = resolveCookiesPath();
  return ["--ignore-config", "--cookies", cookiesPath];
}

export async function fetchVideoInfo(
  url: string,
  jobId: string,
  log?: (message: string) => void
): Promise<YtDlpInfo> {
  const { jobDir } = getJobStoragePaths(jobId);
  const { stdout } = await runYtDlp([...getBaseMetadataArgs(), url], jobDir, log);

  return parseJsonFromOutput<YtDlpInfo>(stdout);
}

export async function downloadVideoFromYoutube(params: {
  jobId: string;
  url: string;
  videoId: string;
  log?: (message: string) => void;
}): Promise<DownloadedVideoSource> {
  const { jobId, url, videoId, log } = params;
  const paths = getJobStoragePaths(jobId);

  log?.(`Iniciando download do vídeo ${videoId} com yt-dlp`);

  const info = await fetchVideoInfo(url, jobId, log);

  const downloadArgs = [
    ...getBaseAuthenticatedArgs(),
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "-f",
    "18/best[ext=mp4]/best",
    "--output",
    paths.sourceTemplate,
    "--print",
    "after_move:filepath",
    url,
  ];

  const { stdout } = await runYtDlp(downloadArgs, paths.jobDir, log);

  let sourceVideoPath: string | null =
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => line.includes(`${path.sep}source.`)) ?? null;

  if (!sourceVideoPath) {
    sourceVideoPath = await findDownloadedSourceVideo(jobId);
  }

  if (!sourceVideoPath) {
    throw new Error("O vídeo foi solicitado ao yt-dlp, mas nenhum arquivo local foi encontrado.");
  }

  log?.(`Download concluído em ${sourceVideoPath}`);

  const durationSec = Number(info.duration ?? 0);
  const title = info.title?.trim() || `Vídeo ${videoId}`;
  const channelName = info.uploader?.trim() || "Canal YouTube";
  const thumbnailUrl = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const canonicalUrl = info.webpage_url || `https://www.youtube.com/watch?v=${videoId}`;

  if (!Number.isFinite(durationSec) || durationSec < 5) {
    throw new Error("Não foi possível identificar a duração do vídeo para gerar cortes.");
  }

  return {
    sourceVideoPath,
    video: {
      videoId,
      canonicalUrl,
      title,
      channelName,
      durationSec,
      thumbnailUrl,
    },
    keywords: Array.isArray(info.tags) ? info.tags.slice(0, 20) : [],
    description: info.description?.slice(0, 2000) || "",
  };
}

export async function downloadAutoSubtitlesVtt(params: {
  jobId: string;
  url: string;
  log?: (message: string) => void;
}): Promise<string | null> {
  const { jobId, url, log } = params;
  const paths = getJobStoragePaths(jobId);

  const args = [
    ...getBaseAuthenticatedArgs(),
    "--skip-download",
    "--no-warnings",
    "--ignore-errors",
    "--no-playlist",
    "--write-auto-subs",
    "--sub-langs",
    "pt.*,en.*,es.*",
    "--sub-format",
    "vtt",
    "--output",
    paths.sourceTemplate,
    url,
  ];

  try {
    await runYtDlp(args, paths.jobDir, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao baixar legenda.";
    log?.(`Legendas automáticas indisponíveis no momento (${message}). Seguindo com fallback por energia.`);
    return null;
  }

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(paths.jobDir);

  const subtitleCandidates = entries
    .filter((entry) => entry.startsWith("source.") && entry.endsWith(".vtt"))
    .sort((a, b) => {
      const rank = (name: string) => {
        if (name.includes(".pt")) return 0;
        if (name.includes(".en")) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });

  if (subtitleCandidates.length === 0) {
    log?.("Nenhuma legenda automática disponível no YouTube para este vídeo");
    return null;
  }

  const subtitlePath = path.join(paths.jobDir, subtitleCandidates[0]);
  log?.(`Legenda automática encontrada: ${subtitleCandidates[0]}`);

  return subtitlePath;
}
