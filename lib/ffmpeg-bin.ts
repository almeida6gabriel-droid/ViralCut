import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import ffmpegStatic from "ffmpeg-static";

let cachedPath: string | null = null;

function isExecutablePath(candidate: string): boolean {
  if (!candidate) return false;
  if (candidate.includes(path.sep)) {
    return existsSync(candidate);
  }

  try {
    execFileSync(candidate, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getFfmpegBinaryPath(): string {
  if (cachedPath) {
    return cachedPath;
  }

  const platformExecutable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  const candidates = [
    process.env.FFMPEG_BIN?.trim() || "",
    ffmpegStatic || "",
    path.join(process.cwd(), "node_modules", "ffmpeg-static", platformExecutable),
    "ffmpeg",
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isExecutablePath(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
  }

  throw new Error(
    "FFmpeg não encontrado. Configure FFMPEG_BIN ou instale ffmpeg no sistema para habilitar cortes reais."
  );
}
