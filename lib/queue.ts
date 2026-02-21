import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { renderViralClips } from "@/lib/render";
import { findDownloadedSourceVideo, getClipOutputPath, ensureJobStorage } from "@/lib/storage";
import { transcribeYouTubeVideo } from "@/lib/transcription";
import { ProcessingJob, ViralClip } from "@/lib/types";
import { generateViralCuts } from "@/lib/viral";
import { parseYouTubeUrl } from "@/lib/youtube";
import { downloadAutoSubtitlesVtt, downloadVideoFromYoutube } from "@/lib/ytdlp";

interface QueueTask {
  type: "initial";
  jobId: string;
}

interface RuntimeState {
  jobs: Map<string, ProcessingJob>;
  queue: QueueTask[];
  active: Set<string>;
  concurrency: number;
  pumpScheduled: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __viralCutRuntime: RuntimeState | undefined;
}

function getRuntime(): RuntimeState {
  if (!globalThis.__viralCutRuntime) {
    globalThis.__viralCutRuntime = {
      jobs: new Map<string, ProcessingJob>(),
      queue: [],
      active: new Set<string>(),
      concurrency: 2,
      pumpScheduled: false,
    };
  }

  return globalThis.__viralCutRuntime;
}

function nowIso() {
  return new Date().toISOString();
}

function pushLog(job: ProcessingJob, stage: ProcessingJob["stage"], message: string) {
  const timestamp = nowIso();
  job.logs.unshift({ at: timestamp, stage, message });
  job.updatedAt = timestamp;
  console.info(`[job:${job.id}] [${stage}] ${message}`);
}

function updateStage(
  job: ProcessingJob,
  stage: ProcessingJob["stage"],
  progress: number,
  message: string
) {
  job.stage = stage;
  job.progress = progress;
  pushLog(job, stage, message);
}

function schedulePump() {
  const runtime = getRuntime();
  if (runtime.pumpScheduled) return;
  runtime.pumpScheduled = true;

  setTimeout(() => {
    runtime.pumpScheduled = false;
    void pumpQueue();
  }, 0);
}

async function pumpQueue() {
  const runtime = getRuntime();

  while (runtime.active.size < runtime.concurrency && runtime.queue.length > 0) {
    const next = runtime.queue.shift();
    if (!next) break;

    runtime.active.add(next.jobId);

    void processJob(next.jobId)
      .catch(() => {
        // processJob already updates state with error.
      })
      .finally(() => {
        runtime.active.delete(next.jobId);
        schedulePump();
      });
  }
}

async function processJob(jobId: string) {
  const runtime = getRuntime();
  const job = runtime.jobs.get(jobId);

  if (!job) return;

  const log = (message: string) => pushLog(job, job.stage, message);

  try {
    updateStage(job, "collecting", 6, `URL recebida: ${job.input.youtubeUrl}`);

    const parsed = parseYouTubeUrl(job.input.youtubeUrl);
    if (!parsed) {
      throw new Error("Link de YouTube inválido. Envie uma URL pública válida.");
    }

    if (parsed.videoId !== job.input.videoId) {
      pushLog(
        job,
        "collecting",
        `videoId divergente detectado (input=${job.input.videoId}, parsed=${parsed.videoId})`
      );
    }

    updateStage(job, "collecting", 10, `videoId extraído: ${parsed.videoId}`);

    await ensureJobStorage(jobId);

    updateStage(job, "collecting", 16, "Iniciando download do vídeo original");
    const downloaded = await downloadVideoFromYoutube({
      jobId,
      url: parsed.canonicalUrl,
      videoId: parsed.videoId,
      log,
    });

    job.video = downloaded.video;

    updateStage(job, "collecting", 44, "Download concluído. Verificando legendas automáticas do vídeo");
    const subtitleVttPath = await downloadAutoSubtitlesVtt({
      jobId,
      url: parsed.canonicalUrl,
      log,
    });

    updateStage(job, "collecting", 58, "Extraindo sinais de áudio e gerando transcrição temporal");
    job.transcript = await transcribeYouTubeVideo({
      jobId,
      video: downloaded.video,
      sourceVideoPath: downloaded.sourceVideoPath,
      subtitleVttPath,
      keywordHints: downloaded.keywords,
      descriptionHint: downloaded.description,
      log,
    });

    if (job.transcript.length === 0) {
      throw new Error("Não foi possível gerar segmentos de transcrição para este vídeo.");
    }

    updateStage(job, "analyzing", 74, "IA detectando momentos virais e calculando score");
    const suggested = generateViralCuts({
      videoTitle: downloaded.video.title,
      segments: job.transcript,
      durationSec: downloaded.video.durationSec,
      requestedCuts: 6,
    });

    if (suggested.length === 0) {
      throw new Error("A IA não conseguiu sugerir cortes para este vídeo.");
    }

    updateStage(job, "rendering", 84, `Gerando ${suggested.length} cortes reais em formato 9:16`);
    job.clips = await renderViralClips({
      jobId,
      video: downloaded.video,
      sourceVideoPath: downloaded.sourceVideoPath,
      clips: suggested,
      log,
    });

    updateStage(job, "completed", 100, "Cortes gerados com sucesso a partir do vídeo enviado");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada no pipeline.";
    job.error = message;
    updateStage(job, "failed", job.progress || 0, `Processamento interrompido: ${message}`);
  }
}

export function createProcessingJob(youtubeUrl: string, videoId: string): ProcessingJob {
  const runtime = getRuntime();
  const timestamp = nowIso();
  const id = randomUUID();

  const job: ProcessingJob = {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    input: {
      youtubeUrl,
      videoId,
    },
    stage: "queued",
    progress: 2,
    logs: [
      {
        at: timestamp,
        stage: "queued",
        message: `Job criado para ${youtubeUrl}`,
      },
    ],
    transcript: [],
    clips: [],
  };

  runtime.jobs.set(id, job);
  runtime.queue.push({ type: "initial", jobId: id });

  schedulePump();

  return job;
}

export function listJobs(): ProcessingJob[] {
  return Array.from(getRuntime().jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(jobId: string): ProcessingJob | undefined {
  return getRuntime().jobs.get(jobId);
}

export function updateClipCopy(
  jobId: string,
  clipId: string,
  payload: {
    title?: string;
    transcriptSnippet?: string;
  }
): ViralClip | null {
  const job = getJob(jobId);
  if (!job) return null;

  const clipIndex = job.clips.findIndex((clip) => clip.id === clipId);
  if (clipIndex < 0) return null;

  const current = job.clips[clipIndex];
  const updated: ViralClip = {
    ...current,
    title: payload.title ?? current.title,
    transcriptSnippet: payload.transcriptSnippet ?? current.transcriptSnippet,
  };

  job.clips[clipIndex] = updated;
  pushLog(job, job.stage, `Corte ${clipId} atualizado no editor.`);

  return updated;
}

export async function regenerateMoreCuts(jobId: string): Promise<ProcessingJob> {
  const job = getJob(jobId);
  if (!job) {
    throw new Error("Job não encontrado.");
  }

  if (!job.video || job.transcript.length === 0) {
    throw new Error("Este job ainda não possui transcrição para regenerar cortes.");
  }

  if (job.clips.length >= 10) {
    throw new Error("Limite máximo de 10 cortes já atingido.");
  }

  const sourceVideoPath = await findDownloadedSourceVideo(jobId);
  if (!sourceVideoPath) {
    throw new Error("Arquivo fonte do vídeo não encontrado para gerar novos cortes.");
  }

  updateStage(job, "analyzing", 64, "Gerando novas sugestões virais");

  const desired = Math.min(10, Math.max(job.clips.length + 3, 6));
  const generated = generateViralCuts({
    videoTitle: job.video.title,
    segments: job.transcript,
    durationSec: job.video.durationSec,
    requestedCuts: desired,
  });

  const existingStarts = new Set(job.clips.map((clip) => Math.round(clip.startSec)));
  const additions = generated
    .filter((clip) => !existingStarts.has(Math.round(clip.startSec)))
    .slice(0, 10 - job.clips.length)
    .map((clip, index) => ({
      ...clip,
      id: `${clip.id}-extra-${job.clips.length + index + 1}`,
    }));

  if (additions.length === 0) {
    throw new Error("Não há novos cortes relevantes para adicionar neste vídeo.");
  }

  updateStage(job, "rendering", 86, "Renderizando novos cortes reais");

  const rendered = await renderViralClips({
    jobId,
    video: job.video,
    sourceVideoPath,
    clips: additions,
    log: (message) => pushLog(job, "rendering", message),
  });

  job.clips = [...job.clips, ...rendered].slice(0, 10);

  updateStage(job, "completed", 100, "Novos cortes adicionados com sucesso");
  return job;
}

export interface ClipFileAsset {
  filePath: string;
  filename: string;
  contentType: "video/mp4";
}

export function getClipFileAsset(jobId: string, clipId: string): ClipFileAsset | null {
  const job = getJob(jobId);
  if (!job?.video) return null;

  const clip = job.clips.find((item) => item.id === clipId);
  if (!clip) return null;

  const filePath = getClipOutputPath(jobId, clipId);

  if (!existsSync(filePath)) {
    return null;
  }

  return {
    filePath,
    filename: `${job.video.videoId}-${clip.id}.mp4`,
    contentType: "video/mp4",
  };
}
