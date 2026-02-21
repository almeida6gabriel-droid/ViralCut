import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { groupCaptionTokens, GroupedCaptionToken, normalizeSubtitleTimeline } from "@/lib/captions";
import { getFfmpegBinaryPath } from "@/lib/ffmpeg-bin";
import { ensureJobStorage, getClipOutputPath, getClipSubtitlePath, getJobStoragePaths } from "@/lib/storage";
import { ViralClip, YouTubeVideoMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const TOP_HEIGHT = 840;
const TITLE_HEIGHT = 240;
const BOTTOM_HEIGHT = 840;
const TITLE_Y = TOP_HEIGHT;
const BOTTOM_Y = TOP_HEIGHT + TITLE_HEIGHT;

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

function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/'/g, "\\'");
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

function resolvePoppinsFontFile(): string | null {
  const explicit = process.env.POPPINS_FONT_FILE?.trim();
  const candidates = [
    explicit,
    path.resolve(process.cwd(), "assets/fonts/Poppins-ExtraBold.ttf"),
    "/Library/Fonts/Poppins-ExtraBold.ttf",
    "/System/Library/Fonts/Supplemental/Poppins-ExtraBold.ttf",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  return null;
}

function buildAssFilter(subtitlePath: string, fontsDir?: string): string {
  const escapedSubtitlePath = escapeFilterPath(path.resolve(subtitlePath));

  if (!fontsDir) {
    return `ass=filename='${escapedSubtitlePath}'`;
  }

  const escapedFontsDir = escapeFilterPath(path.resolve(fontsDir));
  return `ass=filename='${escapedSubtitlePath}':fontsdir='${escapedFontsDir}'`;
}

function wrapTitleText(text: string): string {
  const source = text.trim().replace(/\s+/g, " ");
  if (!source) return "Corte viral";

  const words = source.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= 28) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
      if (lines.length === 1) {
        break;
      }
    }
  }

  if (current && lines.length < 2) {
    lines.push(current);
  }

  const capped = lines.slice(0, 2);
  if (capped.length === 0) return "Corte viral";

  const joined = capped.join("\n");
  return joined.length > 64 ? `${joined.slice(0, 61)}...` : joined;
}

function selectTitleText(clip: ViralClip): string {
  const source = clip.hookLine?.trim() || clip.transcriptSnippet?.trim() || clip.title;
  const firstSentence = source.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? source;
  return wrapTitleText(firstSentence);
}

function selectFreezeFrameOffsetSec(clip: ViralClip): number {
  const normalized = normalizeSubtitleTimeline({
    subtitles: clip.subtitles,
    clipStartSec: clip.startSec,
    clipDurationSec: clip.durationSec,
  });

  const strong = normalized.find((token) => token.strong && token.startSec <= clip.durationSec * 0.8);
  if (strong) return strong.startSec;

  const highlighted = normalized.find((token) => token.highlight && token.startSec <= clip.durationSec * 0.8);
  if (highlighted) return highlighted.startSec;

  return Math.max(0.1, Math.min(clip.durationSec - 0.1, clip.durationSec * 0.35));
}

function composeKaraokeLine(group: GroupedCaptionToken[], activeIndex: number, outline: number, shadow: number): string {
  const nonActiveAlpha = "1A";

  return group
    .map((word, wordIndex) => {
      const escaped = escapeAssText(word.text);

      if (wordIndex === activeIndex) {
        const activeColor = word.strong ? "&H007CFF&" : "&H00D6FF&";
        const activeScale = word.strong ? 112 : 108;
        return `{\\1c${activeColor}\\bord${outline + 1}\\shad${shadow + 1}\\fscx${activeScale}\\fscy${activeScale}\\t(0,100,\\fscx100\\fscy100)}${escaped}{\\rCaptionBase}`;
      }

      const inactiveColor = word.highlight || word.strong ? "&H00D6FF&" : "&HFFFFFF&";
      return `{\\1c${inactiveColor}\\1a&H${nonActiveAlpha}&}${escaped}{\\rCaptionBase}`;
    })
    .map((part, idx) => {
      const breakAt = (group.length === 4 && idx === 1) || (group.length === 5 && idx === 2);
      return breakAt ? `${part}\\N` : part;
    })
    .join(" ");
}

async function writeAssSubtitle(params: {
  clip: ViralClip;
  subtitlePath: string;
  fontName: string;
}) {
  const { clip, subtitlePath, fontName } = params;

  const fontSize = Math.round(Math.min(132, Math.max(56, CANVAS_HEIGHT * 0.065)));
  const outline = Math.max(2, Math.round(fontSize * 0.07));
  const shadow = Math.max(3, Math.round(fontSize * 0.09));
  const marginLateral = Math.round(CANVAS_WIDTH * 0.08);
  const marginVertical = Math.round(BOTTOM_HEIGHT * 0.12);

  const normalizedTokens = normalizeSubtitleTimeline({
    subtitles: clip.subtitles,
    clipStartSec: clip.startSec,
    clipDurationSec: clip.durationSec,
  });
  const groupedTokens = groupCaptionTokens(normalizedTokens);

  const groupsMap = new Map<number, GroupedCaptionToken[]>();
  for (const token of groupedTokens) {
    const bucket = groupsMap.get(token.groupId) ?? [];
    bucket.push(token);
    groupsMap.set(token.groupId, bucket);
  }

  const groups = Array.from(groupsMap.values());
  const lines: string[] = [];

  if (groups.length === 0) {
    const fallbackText = clip.hookLine || clip.title;
    lines.push(
      `Dialogue: 0,${formatAssTimestamp(0)},${formatAssTimestamp(Math.max(1.8, clip.durationSec))},CaptionBase,,0,0,0,,{\\fad(120,0)\\fscx95\\fscy95\\t(0,120,\\fscx100\\fscy100)}${escapeAssText(
        fallbackText
      )}`
    );
  } else {
    for (const group of groups) {
      for (let activeIndex = 0; activeIndex < group.length; activeIndex += 1) {
        const activeWord = group[activeIndex];
        const inTime = formatAssTimestamp(activeWord.startSec);
        const outTime = formatAssTimestamp(activeWord.endSec);
        const intro = activeIndex === 0 ? "{\\fad(120,0)\\fscx95\\fscy95\\t(0,120,\\fscx100\\fscy100)}" : "";
        const lineText = composeKaraokeLine(group, activeIndex, outline, shadow);

        lines.push(`Dialogue: 0,${inTime},${outTime},CaptionBase,,0,0,0,,${intro}${lineText}`);
      }
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
Style: CaptionBase,${fontName},${fontSize},&H00FFFFFF,&H00D6FF,&H00000000,&H40000000,-1,0,0,0,100,100,0,0,3,${outline},${shadow},2,${marginLateral},${marginLateral},${marginVertical},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;

  await fs.writeFile(subtitlePath, ass, "utf8");
}

async function extractFreezeFrame(params: {
  sourceVideoPath: string;
  framePath: string;
  freezeTimeSecAbsolute: number;
}) {
  const { sourceVideoPath, framePath, freezeTimeSecAbsolute } = params;
  const ffmpegBin = getFfmpegBinaryPath();

  await execFileAsync(ffmpegBin, [
    "-y",
    "-ss",
    freezeTimeSecAbsolute.toFixed(3),
    "-i",
    sourceVideoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-an",
    framePath,
  ]);
}

function buildCompositionFilter(params: {
  subtitlePath: string;
  clipDurationSec: number;
  titleText: string;
  fontFile?: string;
  fontsDir?: string;
}): string {
  const { subtitlePath, clipDurationSec, titleText, fontFile, fontsDir } = params;
  const assFilter = buildAssFilter(subtitlePath, fontsDir);

  const titleFontSize = Math.round(CANVAS_HEIGHT * 0.045);
  const escapedTitle = escapeDrawtextText(titleText);
  const fontOption = fontFile
    ? `fontfile='${escapeFilterPath(fontFile)}'`
    : "font='Sans'";

  const titleDrawtext = `drawtext=${fontOption}:text='${escapedTitle}':fontsize=${titleFontSize}:fontcolor=white:x=(w-text_w)/2:y=${TITLE_Y}+(${TITLE_HEIGHT}-text_h)/2:line_spacing=10:shadowcolor=black@0.45:shadowx=0:shadowy=4`;

  return [
    `[0:v]scale=${CANVAS_WIDTH}:${TOP_HEIGHT}:force_original_aspect_ratio=increase,crop=${CANVAS_WIDTH}:${TOP_HEIGHT},eq=contrast=1.08:saturation=1.05,unsharp=5:5:0.8,scale=1134:882,crop=${CANVAS_WIDTH}:${TOP_HEIGHT}[top]`,
    `[1:v]scale=${CANVAS_WIDTH}:${BOTTOM_HEIGHT}:force_original_aspect_ratio=increase,crop=${CANVAS_WIDTH}:${BOTTOM_HEIGHT},${assFilter}[bottom]`,
    `color=c=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:d=${clipDurationSec.toFixed(3)}[base]`,
    `[base][top]overlay=0:0[stage1]`,
    `[stage1]drawbox=x=60:y=872:w=960:h=176:color=black@0.35:t=fill[stage2]`,
    `[stage2]drawbox=x=56:y=866:w=968:h=188:color=#E53935@0.96:t=fill[stage3]`,
    `[stage3]${titleDrawtext}[stage4]`,
    `[stage4][bottom]overlay=0:${BOTTOM_Y}:shortest=1[vout]`,
  ].join(";");
}

async function runFfmpegComposition(params: {
  sourceVideoPath: string;
  framePath: string;
  subtitlePath: string;
  clip: ViralClip;
  outputPath: string;
  workDir: string;
  fontFile?: string;
  fontsDir?: string;
  titleText: string;
}) {
  const { sourceVideoPath, framePath, subtitlePath, clip, outputPath, workDir, fontFile, fontsDir, titleText } = params;
  const ffmpegBin = getFfmpegBinaryPath();

  const filterComplex = buildCompositionFilter({
    subtitlePath,
    clipDurationSec: clip.durationSec,
    titleText,
    fontFile,
    fontsDir,
  });

  await execFileAsync(
    ffmpegBin,
    [
      "-y",
      "-loop",
      "1",
      "-i",
      framePath,
      "-ss",
      clip.startSec.toFixed(3),
      "-to",
      clip.endSec.toFixed(3),
      "-i",
      sourceVideoPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "1:a?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { cwd: workDir, maxBuffer: 32 * 1024 * 1024 }
  );
}

function buildFfmpegPlan(params: {
  sourceVideoPath: string;
  subtitlePath: string;
  framePath: string;
  outputPath: string;
  clip: ViralClip;
  freezeTimeSecAbsolute: number;
  titleText: string;
  fontFile?: string;
  fontsDir?: string;
}): string[] {
  const { sourceVideoPath, subtitlePath, framePath, outputPath, clip, freezeTimeSecAbsolute, titleText, fontFile, fontsDir } = params;

  const filterComplex = buildCompositionFilter({
    subtitlePath,
    clipDurationSec: clip.durationSec,
    titleText,
    fontFile,
    fontsDir,
  });

  return [
    `ffmpeg -y -ss ${freezeTimeSecAbsolute.toFixed(3)} -i ${sourceVideoPath} -frames:v 1 -q:v 2 -an ${framePath}`,
    `ffmpeg -y -loop 1 -i ${framePath} -ss ${clip.startSec.toFixed(3)} -to ${clip.endSec.toFixed(3)} -i ${sourceVideoPath} -filter_complex "${filterComplex}" -map "[vout]" -map 1:a? -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 22 -c:a aac -b:a 128k -shortest -movflags +faststart ${outputPath}`,
  ];
}

export async function renderViralClips(params: {
  jobId: string;
  video: YouTubeVideoMeta;
  sourceVideoPath: string;
  clips: ViralClip[];
  log?: (message: string) => void;
}): Promise<ViralClip[]> {
  const { jobId, sourceVideoPath, clips, log } = params;

  await ensureJobStorage(jobId);
  const { workDir } = getJobStoragePaths(jobId);

  const poppinsFontFile = resolvePoppinsFontFile();
  const poppinsFontsDir = poppinsFontFile ? path.dirname(poppinsFontFile) : undefined;
  const fontName = "Poppins";

  if (poppinsFontFile) {
    log?.(`Fonte Poppins carregada para render: ${poppinsFontFile}`);
  } else {
    log?.("POPPINS_FONT_FILE não encontrado. FFmpeg usará fallback de fonte do sistema.");
  }

  const rendered: ViralClip[] = [];

  for (const clip of clips) {
    const outputPath = getClipOutputPath(jobId, clip.id);
    const subtitlePath = getClipSubtitlePath(jobId, clip.id);
    const framePath = path.join(workDir, `${clip.id}-freeze.jpg`);

    const freezeOffset = selectFreezeFrameOffsetSec(clip);
    const freezeTimeSecAbsolute = clip.startSec + freezeOffset;
    const titleText = selectTitleText(clip);

    log?.(
      `Renderizando corte ${clip.id} com composição 3-blocos (freeze=${freezeTimeSecAbsolute.toFixed(2)}s, title="${titleText.replace(/\n/g, " / ")}")`
    );

    await writeAssSubtitle({
      clip,
      subtitlePath,
      fontName,
    });
    log?.(`Legenda ASS escrita em ${subtitlePath}`);

    await extractFreezeFrame({
      sourceVideoPath,
      framePath,
      freezeTimeSecAbsolute,
    });

    await runFfmpegComposition({
      sourceVideoPath,
      framePath,
      subtitlePath,
      clip,
      outputPath,
      workDir,
      fontFile: poppinsFontFile ?? undefined,
      fontsDir: poppinsFontsDir,
      titleText,
    });

    const ffmpegPlan = buildFfmpegPlan({
      sourceVideoPath,
      subtitlePath,
      framePath,
      outputPath,
      clip,
      freezeTimeSecAbsolute,
      titleText,
      fontFile: poppinsFontFile ?? undefined,
      fontsDir: poppinsFontsDir,
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
