import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

import { getFfmpegBinaryPath } from "@/lib/ffmpeg-bin";
import { getAudioPcmPath } from "@/lib/storage";
import { TranscriptSegment, YouTubeVideoMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

interface EnergyBucket {
  startSec: number;
  endSec: number;
  energy: number;
}

interface ParsedVttCue {
  startSec: number;
  endSec: number;
  text: string;
}

const TAG_RULES: Array<{ tag: string; regex: RegExp }> = [
  { tag: "hook", regex: /agora|urgente|olha|aten[çc][aã]o|n[ãa]o acredita|chocante/i },
  { tag: "curiosidade", regex: /como|por que|segredo|detalhe|curiosidade|descobri/i },
  { tag: "pol[eê]mica", regex: /pol[eê]mica|discordo|absurdo|treta|discuss[aã]o/i },
  { tag: "humor", regex: /risos|engra[çc]ado|meme|zoeira|kkk|haha/i },
  { tag: "storytelling", regex: /aconteceu|quando|depois|hist[oó]ria|ent[aã]o/i },
  { tag: "valor", regex: /dica|estrat[eé]gia|resultado|li[çc][aã]o|aprendi/i },
];

const STOPWORDS = new Set([
  "para",
  "com",
  "sem",
  "sobre",
  "porque",
  "quando",
  "onde",
  "depois",
  "antes",
  "entre",
  "muito",
  "pouco",
  "essa",
  "esse",
  "isso",
  "como",
  "mais",
  "menos",
  "ainda",
  "tambem",
  "voces",
  "você",
  "voce",
  "aqui",
  "ali",
  "seu",
  "sua",
  "das",
  "dos",
  "uma",
  "uns",
  "umas",
  "que",
  "pra",
]);

function cleanText(text: string): string {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimestamp(raw: string): number {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":").map(Number);

  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    return hh * 3600 + mm * 60 + ss;
  }

  if (parts.length === 2) {
    const [mm, ss] = parts;
    return mm * 60 + ss;
  }

  return Number(clean) || 0;
}

function parseVtt(content: string): ParsedVttCue[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cues: ParsedVttCue[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line.includes("-->")) {
      index += 1;
      continue;
    }

    const [startRaw, endRawWithSettings] = line.split("-->");
    const endRaw = endRawWithSettings.trim().split(/\s+/)[0];

    const startSec = parseTimestamp(startRaw);
    const endSec = parseTimestamp(endRaw);

    index += 1;

    const textLines: string[] = [];
    while (index < lines.length && lines[index].trim() !== "") {
      textLines.push(lines[index]);
      index += 1;
    }

    const text = cleanText(textLines.join(" "));

    if (text && endSec > startSec) {
      cues.push({ startSec, endSec, text });
    }

    while (index < lines.length && lines[index].trim() === "") {
      index += 1;
    }
  }

  return cues;
}

function findTags(text: string, energy: number): string[] {
  const matched = TAG_RULES.filter((rule) => rule.regex.test(text)).map((rule) => rule.tag);

  if (energy >= 0.75 && !matched.includes("hook")) {
    matched.push("hook");
  }

  if (energy <= 0.2 && !matched.includes("storytelling")) {
    matched.push("storytelling");
  }

  if (matched.length === 0) {
    matched.push("valor");
  }

  return matched;
}

function estimateEmotion(text: string, energy: number): number {
  const punctuationBoost = (text.match(/[!?]/g) ?? []).length * 0.06;
  const uppercaseBoost = /[A-ZÁÉÍÓÚÇ]{4,}/.test(text) ? 0.1 : 0;
  return Math.max(0.1, Math.min(1, energy * 0.7 + punctuationBoost + uppercaseBoost + 0.16));
}

async function extractEnergyBuckets(params: {
  sourceVideoPath: string;
  audioPcmPath: string;
  durationSec: number;
}): Promise<EnergyBucket[]> {
  const { sourceVideoPath, audioPcmPath, durationSec } = params;

  const ffmpegBin = getFfmpegBinaryPath();

  await execFileAsync(ffmpegBin, [
    "-y",
    "-i",
    sourceVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "s16le",
    audioPcmPath,
  ]);

  const pcm = await fs.readFile(audioPcmPath);

  if (pcm.length < 2) {
    return [{ startSec: 0, endSec: Math.max(1, durationSec), energy: 0.45 }];
  }

  const sampleRate = 16000;
  const samplesPerWindow = sampleRate;
  const totalSamples = Math.floor(pcm.length / 2);

  const buckets: EnergyBucket[] = [];

  let maxRms = 0;

  for (let offset = 0; offset < totalSamples; offset += samplesPerWindow) {
    const end = Math.min(totalSamples, offset + samplesPerWindow);
    const count = end - offset;

    if (count <= 0) continue;

    let sumSquares = 0;
    for (let sample = offset; sample < end; sample += 1) {
      const int16 = pcm.readInt16LE(sample * 2);
      const normalized = int16 / 32768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / count);
    if (rms > maxRms) maxRms = rms;

    buckets.push({
      startSec: offset / sampleRate,
      endSec: end / sampleRate,
      energy: rms,
    });
  }

  const normalizer = maxRms > 0 ? maxRms : 1;

  return buckets.map((bucket) => ({
    ...bucket,
    energy: Math.max(0.01, Math.min(1, bucket.energy / normalizer)),
  }));
}

function energyForRange(buckets: EnergyBucket[], startSec: number, endSec: number): number {
  const matching = buckets.filter((bucket) => bucket.startSec < endSec && bucket.endSec > startSec);
  if (matching.length === 0) {
    const nearest = buckets.find((bucket) => bucket.startSec <= startSec && bucket.endSec >= startSec);
    return nearest?.energy ?? 0.45;
  }

  const sum = matching.reduce((acc, bucket) => acc + bucket.energy, 0);
  return sum / matching.length;
}

function extractKeywords(video: YouTubeVideoMeta, keywordHints: string[], descriptionHint: string): string[] {
  const base = [video.title, ...keywordHints, descriptionHint].join(" ");

  const freq = new Map<string, number>();

  for (const token of base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 4 && !STOPWORDS.has(part))) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function fallbackSegmentsFromEnergy(params: {
  video: YouTubeVideoMeta;
  buckets: EnergyBucket[];
  keywords: string[];
}): TranscriptSegment[] {
  const { video, buckets, keywords } = params;

  const segments: TranscriptSegment[] = [];

  const windowSec = 8;
  for (let start = 0; start < video.durationSec; start += windowSec) {
    const end = Math.min(video.durationSec, start + windowSec);
    const energy = energyForRange(buckets, start, end);

    const focus = keywords[segments.length % Math.max(1, keywords.length)] || "momento";
    const text =
      energy >= 0.7
        ? `Pico de energia com foco em ${focus}. Reação forte da audiência nesse trecho.`
        : energy <= 0.25
        ? `Pausa dramática e construção de contexto sobre ${focus}.`
        : `Trecho com narrativa contínua sobre ${focus}, bom para retenção.`;

    segments.push({
      id: `${video.videoId}-energy-${segments.length + 1}`,
      startSec: start,
      endSec: end,
      text,
      energy,
      emotion: estimateEmotion(text, energy),
      tags: findTags(text, energy),
    });
  }

  return segments;
}

export async function transcribeYouTubeVideo(params: {
  jobId: string;
  video: YouTubeVideoMeta;
  sourceVideoPath: string;
  subtitleVttPath: string | null;
  keywordHints: string[];
  descriptionHint: string;
  log?: (message: string) => void;
}): Promise<TranscriptSegment[]> {
  const { jobId, video, sourceVideoPath, subtitleVttPath, keywordHints, descriptionHint, log } = params;

  log?.("Extraindo energia de áudio para detectar picos e pausas dramáticas");
  const buckets = await extractEnergyBuckets({
    sourceVideoPath,
    audioPcmPath: getAudioPcmPath(jobId),
    durationSec: video.durationSec,
  });

  const keywords = extractKeywords(video, keywordHints, descriptionHint);

  if (!subtitleVttPath) {
    log?.("Legendas automáticas não disponíveis; usando transcrição temporal por energia");
    return fallbackSegmentsFromEnergy({ video, buckets, keywords });
  }

  let vtt = "";
  try {
    vtt = await fs.readFile(subtitleVttPath, "utf8");
  } catch {
    log?.("Falha ao ler arquivo de legenda VTT; aplicando fallback por energia");
    return fallbackSegmentsFromEnergy({ video, buckets, keywords });
  }

  const cues = parseVtt(vtt);

  if (cues.length < 5) {
    log?.("Legenda automática insuficiente; aplicando fallback por energia");
    return fallbackSegmentsFromEnergy({ video, buckets, keywords });
  }

  const segments: TranscriptSegment[] = cues.map((cue, index) => {
    const energy = energyForRange(buckets, cue.startSec, cue.endSec);
    const text = cue.text;

    return {
      id: `${video.videoId}-${index + 1}`,
      startSec: cue.startSec,
      endSec: cue.endSec,
      text,
      energy,
      emotion: estimateEmotion(text, energy),
      tags: findTags(text, energy),
    };
  });

  log?.(`Transcrição pronta com ${segments.length} segmentos`);
  return segments;
}
