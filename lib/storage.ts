import { promises as fs } from "node:fs";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

export const JOB_STORAGE_ROOT = path.join(process.cwd(), "storage", "jobs");

export interface JobStoragePaths {
  jobDir: string;
  clipsDir: string;
  workDir: string;
  sourceTemplate: string;
  sourcePrefix: string;
}

export function getJobStoragePaths(jobId: string): JobStoragePaths {
  const jobDir = path.join(JOB_STORAGE_ROOT, jobId);
  return {
    jobDir,
    clipsDir: path.join(jobDir, "clips"),
    workDir: path.join(jobDir, "work"),
    sourceTemplate: path.join(jobDir, "source.%(ext)s"),
    sourcePrefix: path.join(jobDir, "source"),
  };
}

export async function ensureJobStorage(jobId: string): Promise<JobStoragePaths> {
  const paths = getJobStoragePaths(jobId);
  await fs.mkdir(paths.clipsDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });
  return paths;
}

export async function findDownloadedSourceVideo(jobId: string): Promise<string | null> {
  const paths = getJobStoragePaths(jobId);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(paths.jobDir);
  } catch {
    return null;
  }

  const candidate = entries
    .filter((entry) => entry.startsWith("source."))
    .find((entry) => VIDEO_EXTENSIONS.has(path.extname(entry).toLowerCase()));

  if (!candidate) {
    return null;
  }

  return path.join(paths.jobDir, candidate);
}

export function getClipOutputPath(jobId: string, clipId: string): string {
  const { clipsDir } = getJobStoragePaths(jobId);
  return path.join(clipsDir, `${clipId}.mp4`);
}

export function getClipSubtitlePath(jobId: string, clipId: string): string {
  const { workDir } = getJobStoragePaths(jobId);
  return path.join(workDir, `${clipId}.ass`);
}

export function getAudioPcmPath(jobId: string): string {
  const { workDir } = getJobStoragePaths(jobId);
  return path.join(workDir, "audio-16k-mono.pcm");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
