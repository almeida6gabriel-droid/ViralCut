import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { findDownloadedSourceVideo, getJobStoragePaths } from "@/lib/storage";
import { YouTubeVideoMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

const PYTHON_ARGS_PREFIX = ["-W", "ignore", "-m", "yt_dlp"];
const YOUTUBE_EXTRACTOR_ARGS = ["--extractor-args", "youtube:player_client=android"];
const PYTHON_PROBE_SCRIPT =
  "import importlib.util, json, sys; print(json.dumps({'executable': sys.executable, 'has_ytdlp': bool(importlib.util.find_spec('yt_dlp'))}))";

type ExecFailure = NodeJS.ErrnoException & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

interface PythonProbeInfo {
  executable: string;
  has_ytdlp: boolean;
}

interface PythonCandidate {
  command: string;
  args: string[];
  source: string;
}

interface YtDlpRunner {
  command: string;
  argsPrefix: string[];
}

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

let ytDlpRunnerPromise: Promise<YtDlpRunner> | null = null;

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function parseJsonFromOutput<T>(raw: string): T {
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("Nao foi possivel ler os metadados retornados pelo yt-dlp.");
  }

  try {
    return JSON.parse(raw.slice(firstBrace)) as T;
  } catch {
    throw new Error("Falha ao interpretar metadados JSON do yt-dlp.");
  }
}

function parseProbeOutput(raw: string): PythonProbeInfo | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as Partial<PythonProbeInfo>;
      if (typeof parsed.executable === "string" && typeof parsed.has_ytdlp === "boolean") {
        return {
          executable: parsed.executable,
          has_ytdlp: parsed.has_ytdlp,
        };
      }
    } catch {
      // Ignore lines that are not JSON payloads from the probe.
    }
  }

  return null;
}

function isWindowsStorePython(executablePath: string): boolean {
  if (process.platform !== "win32") return false;
  return executablePath.toLowerCase().includes("\\windowsapps\\");
}

function getVenvPythonPath(venvDir: string): string {
  if (process.platform === "win32") {
    return path.join(venvDir, "Scripts", "python.exe");
  }
  return path.join(venvDir, "bin", "python");
}

function getInstallInstructions(): string {
  if (process.platform === "win32") {
    return [
      "No Windows (PowerShell), execute:",
      "  py -3 -m venv .venv",
      "  .\\.venv\\Scripts\\Activate.ps1",
      "  python -m pip install --upgrade pip",
      "  python -m pip install yt-dlp",
      "Opcional: setx YTDLP_PYTHON \"C:\\caminho\\do\\projeto\\.venv\\Scripts\\python.exe\"",
    ].join("\n");
  }

  return [
    "No Linux/macOS, execute:",
    "  python3 -m venv .venv",
    "  source .venv/bin/activate",
    "  python -m pip install --upgrade pip",
    "  python -m pip install yt-dlp",
  ].join("\n");
}

function formatCandidate(candidate: PythonCandidate): string {
  const argsSuffix = candidate.args.length > 0 ? ` ${candidate.args.join(" ")}` : "";
  return `${candidate.command}${argsSuffix} (${candidate.source})`;
}

function buildMissingYtDlpError(details: {
  attemptedCandidates: string[];
  pythonWithoutModule: string[];
  skippedWindowsStore: string[];
}): Error {
  const lines: string[] = ["yt-dlp nao esta disponivel no ambiente Python atual."];

  if (details.attemptedCandidates.length > 0) {
    lines.push(`Interpretadores testados: ${details.attemptedCandidates.join(" | ")}`);
  }

  if (details.pythonWithoutModule.length > 0) {
    lines.push(`Python sem modulo yt_dlp: ${details.pythonWithoutModule.join(", ")}`);
  }

  if (details.skippedWindowsStore.length > 0) {
    lines.push(
      `Python da Microsoft Store ignorado (WindowsApps): ${details.skippedWindowsStore.join(", ")}`
    );
  }

  lines.push(getInstallInstructions());
  return new Error(lines.join("\n"));
}

function buildPythonCandidates(): PythonCandidate[] {
  const candidates: PythonCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: PythonCandidate, onlyIfExists = false) => {
    if (!candidate.command.trim()) return;
    if (onlyIfExists && !existsSync(candidate.command)) return;

    const key = `${candidate.command}\u0000${candidate.args.join("\u0000")}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const configuredPython = process.env.YTDLP_PYTHON?.trim();
  if (configuredPython) {
    addCandidate(
      {
        command: configuredPython,
        args: [],
        source: "YTDLP_PYTHON",
      },
      true
    );
  }

  const projectVenvDirs = [".venv", "venv"].map((dir) => path.resolve(process.cwd(), dir));
  for (const venvDir of projectVenvDirs) {
    const pythonPath = getVenvPythonPath(venvDir);
    addCandidate(
      {
        command: pythonPath,
        args: [],
        source: `project ${path.basename(venvDir)}`,
      },
      true
    );
  }

  const activeVenv = process.env.VIRTUAL_ENV?.trim();
  if (activeVenv) {
    addCandidate(
      {
        command: getVenvPythonPath(activeVenv),
        args: [],
        source: "VIRTUAL_ENV",
      },
      true
    );
  }

  if (process.platform === "win32") {
    addCandidate({
      command: "py",
      args: ["-3"],
      source: "py launcher",
    });
  }

  addCandidate({
    command: "python",
    args: [],
    source: "PATH python",
  });

  if (process.platform !== "win32") {
    addCandidate({
      command: "python3",
      args: [],
      source: "PATH python3",
    });
  }

  return candidates;
}

async function probePythonCandidate(
  candidate: PythonCandidate,
  workingDirectory: string
): Promise<PythonProbeInfo | null> {
  try {
    const result = await execFileAsync(
      candidate.command,
      [...candidate.args, "-c", PYTHON_PROBE_SCRIPT],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );

    return parseProbeOutput(`${result.stdout}\n${result.stderr}`);
  } catch {
    return null;
  }
}

async function resolveFromPythonCandidates(workingDirectory: string): Promise<YtDlpRunner | null> {
  const attemptedCandidates: string[] = [];
  const pythonWithoutModule = new Set<string>();
  const skippedWindowsStore = new Set<string>();

  for (const candidate of buildPythonCandidates()) {
    attemptedCandidates.push(formatCandidate(candidate));
    const probe = await probePythonCandidate(candidate, workingDirectory);
    if (!probe) {
      continue;
    }

    if (isWindowsStorePython(probe.executable)) {
      skippedWindowsStore.add(probe.executable);
      continue;
    }

    if (!probe.has_ytdlp) {
      pythonWithoutModule.add(probe.executable);
      continue;
    }

    return {
      command: probe.executable,
      argsPrefix: [...PYTHON_ARGS_PREFIX, ...YOUTUBE_EXTRACTOR_ARGS],
    };
  }

  if (pythonWithoutModule.size > 0 || skippedWindowsStore.size > 0) {
    throw buildMissingYtDlpError({
      attemptedCandidates,
      pythonWithoutModule: Array.from(pythonWithoutModule),
      skippedWindowsStore: Array.from(skippedWindowsStore),
    });
  }

  return null;
}

async function resolveFromBinary(workingDirectory: string): Promise<YtDlpRunner | null> {
  try {
    await execFileAsync("yt-dlp", ["--version"], {
      cwd: workingDirectory,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return {
      command: "yt-dlp",
      argsPrefix: [...YOUTUBE_EXTRACTOR_ARGS],
    };
  } catch {
    return null;
  }
}

async function resolveYtDlpRunner(workingDirectory: string): Promise<YtDlpRunner> {
  const pythonRunner = await resolveFromPythonCandidates(workingDirectory);
  if (pythonRunner) return pythonRunner;

  const binaryRunner = await resolveFromBinary(workingDirectory);
  if (binaryRunner) return binaryRunner;

  throw new Error(`Nao foi possivel encontrar um executavel do yt-dlp.\n${getInstallInstructions()}`);
}

async function getYtDlpRunner(workingDirectory: string): Promise<YtDlpRunner> {
  if (!ytDlpRunnerPromise) {
    ytDlpRunnerPromise = resolveYtDlpRunner(workingDirectory).catch((error) => {
      ytDlpRunnerPromise = null;
      throw error;
    });
  }

  return ytDlpRunnerPromise;
}

function isMissingYtDlpModuleError(raw: string): boolean {
  return /No module named yt_dlp/i.test(raw) || /ModuleNotFoundError/i.test(raw);
}

async function runYtDlp(args: string[], workingDirectory: string): Promise<{ stdout: string; stderr: string }> {
  const runner = await getYtDlpRunner(workingDirectory);

  try {
    const result = await execFileAsync(runner.command, [...runner.argsPrefix, ...args], {
      cwd: workingDirectory,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as ExecFailure;
    const detail = [failure.message, toText(failure.stderr), toText(failure.stdout)]
      .filter(Boolean)
      .join("\n");

    if (isMissingYtDlpModuleError(detail)) {
      throw new Error(`Modulo yt_dlp nao encontrado no Python selecionado.\n${getInstallInstructions()}`);
    }

    throw new Error(`yt-dlp falhou: ${detail || "erro desconhecido"}`);
  }
}

export async function fetchVideoInfo(url: string, jobId: string): Promise<YtDlpInfo> {
  const { jobDir } = getJobStoragePaths(jobId);
  const { stdout } = await runYtDlp(
    ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", url],
    jobDir
  );

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

  log?.(`Iniciando download do video ${videoId} com yt-dlp`);

  const info = await fetchVideoInfo(url, jobId);

  const downloadArgs = [
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

  const { stdout } = await runYtDlp(downloadArgs, paths.jobDir);

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
    throw new Error("O video foi solicitado ao yt-dlp, mas nenhum arquivo local foi encontrado.");
  }

  log?.(`Download concluido em ${sourceVideoPath}`);

  const durationSec = Number(info.duration ?? 0);
  const title = info.title?.trim() || `Video ${videoId}`;
  const channelName = info.uploader?.trim() || "Canal YouTube";
  const thumbnailUrl = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const canonicalUrl = info.webpage_url || `https://www.youtube.com/watch?v=${videoId}`;

  if (!Number.isFinite(durationSec) || durationSec < 5) {
    throw new Error("Nao foi possivel identificar a duracao do video para gerar cortes.");
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
    await runYtDlp(args, paths.jobDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao baixar legenda.";
    log?.(`Legendas automaticas indisponiveis no momento (${message}). Seguindo com fallback por energia.`);
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
    log?.("Nenhuma legenda automatica disponivel no YouTube para este video");
    return null;
  }

  const subtitlePath = path.join(paths.jobDir, subtitleCandidates[0]);
  log?.(`Legenda automatica encontrada: ${subtitleCandidates[0]}`);

  return subtitlePath;
}
