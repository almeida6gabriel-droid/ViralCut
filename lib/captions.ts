import { SubtitleToken } from "@/lib/types";

export interface NormalizedCaptionToken {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  highlight: boolean;
  strong: boolean;
  emoji?: string;
}

export interface GroupedCaptionToken extends NormalizedCaptionToken {
  groupId: number;
}

const STRONG_WORDS = new Set([
  "dinheiro",
  "segredo",
  "errado",
  "nunca",
  "sempre",
  "verdade",
  "milionario",
  "falha",
  "sucesso",
]);

const MIN_WORD_SEC = 0.1;
const TRANSITION_SEC = 0.1;

function normalizeWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectUnitAndOffset(params: {
  rawTimes: number[];
  clipStartSec: number;
  clipDurationSec: number;
}): {
  isMilliseconds: boolean;
  hasClipOffset: boolean;
} {
  const { rawTimes, clipDurationSec } = params;
  const maxRaw = Math.max(...rawTimes);
  const isMilliseconds = maxRaw > Math.max(clipDurationSec * 20, 240);
  const normalizedTimes = rawTimes.map((value) => (isMilliseconds ? value / 1000 : value));
  const hasClipOffset = Math.max(...normalizedTimes) > clipDurationSec + 1;
  return { isMilliseconds, hasClipOffset };
}

export function normalizeSubtitleTimeline(params: {
  subtitles: SubtitleToken[];
  clipStartSec: number;
  clipDurationSec: number;
}): NormalizedCaptionToken[] {
  const { subtitles, clipStartSec, clipDurationSec } = params;
  const sorted = [...subtitles].sort((a, b) => a.time - b.time);

  if (sorted.length === 0) return [];

  const rawTimes = sorted.map((token) => token.time).filter((value) => Number.isFinite(value));
  if (rawTimes.length === 0) return [];

  const { isMilliseconds, hasClipOffset } = detectUnitAndOffset({
    rawTimes,
    clipStartSec,
    clipDurationSec,
  });

  const normalized = sorted
    .map((token, index) => {
      const baseTime = isMilliseconds ? token.time / 1000 : token.time;
      const relativeStart = hasClipOffset ? baseTime - clipStartSec : baseTime;
      const startSec = Math.max(0, Number(relativeStart.toFixed(3)));

      if (startSec >= clipDurationSec) {
        return null;
      }

      const nextToken = sorted[index + 1];
      const nextBase = nextToken ? (isMilliseconds ? nextToken.time / 1000 : nextToken.time) : clipDurationSec;
      const nextRelative = nextToken ? (hasClipOffset ? nextBase - clipStartSec : nextBase) : clipDurationSec;
      const inferredEnd = nextToken ? Number(nextRelative.toFixed(3)) : clipDurationSec;
      const endSec = Math.min(
        clipDurationSec,
        Math.max(startSec + MIN_WORD_SEC, inferredEnd + TRANSITION_SEC)
      );

      const text = token.text.trim();
      if (!text) return null;

      return {
        id: `cap-${index}-${startSec.toFixed(3)}`,
        text,
        startSec,
        endSec,
        highlight: token.highlight,
        strong: STRONG_WORDS.has(normalizeWord(text)),
        emoji: token.emoji,
      };
    })
    .filter(
      (
        token
      ): token is {
        id: string;
        text: string;
        startSec: number;
        endSec: number;
        highlight: boolean;
        strong: boolean;
        emoji: string | undefined;
      } => token !== null
    );

  if (normalized.length > 0) {
    normalized[normalized.length - 1].endSec = clipDurationSec;
  }

  return normalized;
}

export function groupCaptionTokens(tokens: NormalizedCaptionToken[]): GroupedCaptionToken[] {
  if (tokens.length === 0) return [];

  const grouped: GroupedCaptionToken[] = [];
  let cursor = 0;
  let groupId = 0;

  while (cursor < tokens.length) {
    const remaining = tokens.length - cursor;
    let groupSize = Math.min(4, remaining);

    if (remaining >= 6 && remaining <= 7) {
      groupSize = 3;
    }

    if (remaining <= 5) {
      groupSize = remaining;
    }

    const slice = tokens.slice(cursor, cursor + groupSize).map((token) => ({
      ...token,
      groupId,
    }));

    grouped.push(...slice);
    cursor += groupSize;
    groupId += 1;
  }

  return grouped;
}
