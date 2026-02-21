import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getFfmpegBinaryPath } from "@/lib/ffmpeg-bin";
import { ensureJobStorage, getClipOutputPath, getClipSubtitlePath, getJobStoragePaths } from "@/lib/storage";
import { ViralClip, YouTubeVideoMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatAssTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\n/g, "\\N");
}

function buildFfmpegPlan(params: {
  sourceVideoPath: string;
  subtitlePath: string;
  outputPath: string;
  clip: ViralClip;
}): string[] {
  const { sourceVideoPath, subtitlePath, outputPath, clip } = params;

  const videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass=${subtitlePath}`;

  return [
    `ffmpeg -y -ss ${formatTimestamp(clip.startSec)} -to ${formatTimestamp(clip.endSec)} -i ${sourceVideoPath} -vf "${videoFilter}" -c:v libx264 -preset veryfast -crf 22 -c:a aac -movflags +faststart ${outputPath}`,
  ];
}

async function writeAssSubtitle(params: { clip: ViralClip; subtitlePath: string }) {
  const { clip, subtitlePath } = params;

  const tokens = clip.subtitles
    .filter((token) => token.time >= clip.startSec && token.time <= clip.endSec + 0.8)
    .sort((a, b) => a.time - b.time);

  const lines: string[] = [];

  if (tokens.length === 0) {
    const fallbackText = clip.hookLine || clip.title;
    lines.push(
      `Dialogue: 0,${formatAssTimestamp(0)},${formatAssTimestamp(Math.max(1.8, clip.durationSec - 0.2))},Caption,,0,0,80,,{\\b1}${escapeAssText(
        fallbackText
      )}`
    );
  } else {
    const groupSize = 4;

    for (let index = 0; index < tokens.length; index += groupSize) {
      const group = tokens.slice(index, index + groupSize);
      const next = tokens[index + groupSize];

      const start = Math.max(0, group[0].time - clip.startSec);
      const fallbackEnd = group[group.length - 1].time - clip.startSec + 0.9;
      const end = Math.min(
        clip.durationSec,
        Math.max(start + 0.45, next ? next.time - clip.startSec : fallbackEnd)
      );

      const text = group
        .map((token) => (token.highlight ? `{\\c&H66FFFF&}${token.text}{\\c&HFFFFFF&}` : token.text))
        .join(" ");

      lines.push(
        `Dialogue: 0,${formatAssTimestamp(start)},${formatAssTimestamp(end)},Caption,,0,0,80,,{\\b1}${escapeAssText(
          text
        )}`
      );
    }
  }

  const ass = `[Script Info]
Title: ViralCut Caption
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H40000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,110,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;

  await fs.writeFile(subtitlePath, ass, "utf8");
}

async function runFfmpeg(params: {
  sourceVideoPath: string;
  clip: ViralClip;
  subtitleFileName: string;
  outputPath: string;
  workDir: string;
}) {
  const { sourceVideoPath, clip, subtitleFileName, outputPath, workDir } = params;

  const ffmpegBin = getFfmpegBinaryPath();

  const filters = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass=${subtitleFileName}`;

  await execFileAsync(
    ffmpegBin,
    [
      "-y",
      "-ss",
      clip.startSec.toFixed(3),
      "-to",
      clip.endSec.toFixed(3),
      "-i",
      sourceVideoPath,
      "-vf",
      filters,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { cwd: workDir, maxBuffer: 16 * 1024 * 1024 }
  );
}

export async function renderViralClips(params: {
  jobId: string;
  video: YouTubeVideoMeta;
  sourceVideoPath: string;
  clips: ViralClip[];
  log?: (message: string) => void;
}): Promise<ViralClip[]> {
  const { jobId, video, sourceVideoPath, clips, log } = params;

  await ensureJobStorage(jobId);
  const { workDir } = getJobStoragePaths(jobId);

  const rendered: ViralClip[] = [];

  for (const clip of clips) {
    const outputPath = getClipOutputPath(jobId, clip.id);
    const subtitlePath = getClipSubtitlePath(jobId, clip.id);
    const subtitleFileName = path.basename(subtitlePath);

    log?.(`Renderizando corte ${clip.id} (${clip.durationSec}s)`);

    await writeAssSubtitle({ clip, subtitlePath });

    await runFfmpeg({
      sourceVideoPath,
      clip,
      subtitleFileName,
      outputPath,
      workDir,
    });

    const ffmpegPlan = buildFfmpegPlan({
      sourceVideoPath,
      subtitlePath,
      outputPath,
      clip,
    });

    rendered.push({
      ...clip,
      ffmpegPlan,
      previewUrl: `/api/jobs/${jobId}/clips/${clip.id}/stream`,
      downloadUrl: `/api/jobs/${jobId}/clips/${clip.id}/download`,
    });
  }

  log?.(`Renderização finalizada: ${rendered.length} cortes reais`);

  return rendered;
}
