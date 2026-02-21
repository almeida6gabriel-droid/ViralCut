import { SubtitleToken, TranscriptSegment, ViralClip, ViralSignal } from "@/lib/types";

interface ViralCandidate {
  segment: TranscriptSegment;
  score: number;
  signals: ViralSignal;
}

const HOOK_TERMS = ["agora", "ninguem", "virada", "erro", "absurdo", "detalhe", "chocante"];
const CURIOSITY_TERMS = ["como", "por que", "segredo", "quase", "detalhe", "numero", "curiosidade"];
const CONTROVERSY_TERMS = ["pol", "controvers", "discorda", "treta", "debate", "absurdo"];
const HUMOR_TERMS = ["meme", "engracado", "rir", "zoeira", "risos", "haha"];
const STORY_TERMS = ["historia", "aconteceu", "virada", "quando", "entao", "depois"];
const VALUE_TERMS = ["estrategia", "reten", "resultado", "explicacao", "aplicar", "dica", "aprendi"];

const HIGHLIGHT_TERMS = [
  "viral",
  "reten",
  "gancho",
  "meme",
  "controversa",
  "detalhe",
  "resultado",
  "agora",
  "chocante",
  "absurdo",
];

const EMOJIS = ["🔥", "😮", "👀", "⚡", "💥", "🎯", "🤯"];

const HASHTAG_BANK = {
  hook: ["#HookPerfeito", "#RetencaoAlta", "#AberturaForte"],
  curiosity: ["#Curiosidade", "#VejaIsso", "#NaoPule"],
  controversy: ["#OpiniaoForte", "#Debate", "#Polêmica"],
  humor: ["#Humor", "#Meme", "#CorteEngracado"],
  storytelling: ["#Storytelling", "#PlotTwist", "#HistoriaReal"],
  value: ["#DicaRapida", "#CriadorDeConteudo", "#MarketingDigital"],
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function countTerms(text: string, terms: string[]): number {
  return terms.reduce((acc, term) => {
    return acc + (text.includes(term) ? 1 : 0);
  }, 0);
}

function scoreSegment(segment: TranscriptSegment, totalDuration: number): ViralCandidate {
  const normalized = normalize(segment.text);
  const isEarlyHookWindow = segment.startSec < 30;
  const timeFactor = 1 - segment.startSec / Math.max(totalDuration, 1);

  const signals: ViralSignal = {
    hook: Math.min(100, countTerms(normalized, HOOK_TERMS) * 20 + (isEarlyHookWindow ? 20 : 0) + segment.energy * 20),
    curiosity: Math.min(100, countTerms(normalized, CURIOSITY_TERMS) * 20 + 12),
    controversy: Math.min(100, countTerms(normalized, CONTROVERSY_TERMS) * 34),
    humor: Math.min(100, countTerms(normalized, HUMOR_TERMS) * 36),
    storytelling: Math.min(100, countTerms(normalized, STORY_TERMS) * 16 + 8),
    value: Math.min(100, countTerms(normalized, VALUE_TERMS) * 20 + 10),
    emotion: Math.round(segment.emotion * 100),
  };

  const weighted =
    signals.hook * 0.21 +
    signals.curiosity * 0.17 +
    signals.controversy * 0.14 +
    signals.humor * 0.14 +
    signals.storytelling * 0.12 +
    signals.value * 0.1 +
    signals.emotion * 0.07 +
    segment.energy * 100 * 0.05;

  const score = Math.round(Math.min(100, weighted + timeFactor * 7));

  return { segment, score, signals };
}

function angleFromSignals(signals: ViralSignal): ViralClip["angle"] {
  const pairs: Array<[ViralClip["angle"], number]> = [
    ["hook", signals.hook],
    ["curiosity", signals.curiosity],
    ["controversy", signals.controversy],
    ["humor", signals.humor],
    ["storytelling", signals.storytelling],
    ["value", signals.value],
  ];

  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
}

function clipTitle(angle: ViralClip["angle"], baseText: string, index: number): string {
  const sentence = baseText.replace(/\.$/, "");
  const templates: Record<ViralClip["angle"], string[]> = {
    hook: [
      `Gancho forte para segurar audiência (${index + 1})`,
      `Abertura com alto potencial de retenção`,
    ],
    curiosity: [
      `Trecho que gera curiosidade instantânea`,
      `Esse detalhe prende até o final`,
    ],
    controversy: [
      `Momento polêmico para aumentar comentários`,
      `Trecho que divide opiniões e gera debate`,
    ],
    humor: [
      `Corte com humor e replay alto`,
      `Timing engraçado para Shorts e Reels`,
    ],
    storytelling: [
      `Virada de narrativa em menos de 1 minuto`,
      `Storytelling com ritmo de retenção`,
    ],
    value: [
      `Dica rápida com valor imediato`,
      `Explicação prática com potencial viral`,
    ],
  };

  const fallback = sentence.length > 45 ? `${sentence.slice(0, 45)}...` : sentence;
  return templates[angle][index % templates[angle].length] || fallback;
}

function buildSubtitlesFromSegments(windowSegments: TranscriptSegment[]): SubtitleToken[] {
  const tokens: SubtitleToken[] = [];

  for (const segment of windowSegments) {
    const words = segment.text.split(/\s+/).filter(Boolean).slice(0, 20);
    if (words.length === 0) continue;

    const segmentDuration = Math.max(0.7, segment.endSec - segment.startSec);
    const step = segmentDuration / words.length;

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index].replace(/[.,!?]/g, "");
      if (!word) continue;

      const normalized = normalize(word);
      const highlight = HIGHLIGHT_TERMS.some((term) => normalized.includes(term));
      const emoji = highlight && (tokens.length + index) % 5 === 0 ? EMOJIS[(tokens.length + index) % EMOJIS.length] : undefined;

      tokens.push({
        time: Number((segment.startSec + step * index).toFixed(2)),
        text: word,
        highlight,
        emoji,
      });
    }
  }

  return tokens.slice(0, 90);
}

function buildFallbackSubtitles(text: string, startSec: number): SubtitleToken[] {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 18);
  return words.map((word, index) => ({
    time: Number((startSec + index * 0.45).toFixed(2)),
    text: word,
    highlight: index % 4 === 0,
    emoji: index % 6 === 0 ? EMOJIS[index % EMOJIS.length] : undefined,
  }));
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function chooseHashtags(angle: ViralClip["angle"], extraTags: string[]): string[] {
  const fromAngle = HASHTAG_BANK[angle];
  const always = ["#TikTokBrasil", "#YouTubeShorts", "#CortesVirais"];
  const dynamic = extraTags.map((tag) => `#${tag.replace(/[^a-z0-9]/gi, "")}`).slice(0, 2);

  return Array.from(new Set([...fromAngle, ...always, ...dynamic]));
}

export function generateViralCuts(params: {
  videoTitle: string;
  segments: TranscriptSegment[];
  durationSec: number;
  requestedCuts?: number;
}): ViralClip[] {
  const { videoTitle, segments, durationSec } = params;
  const requestedCuts = Math.min(10, Math.max(3, params.requestedCuts ?? 5));

  const scored = segments.map((segment) => scoreSegment(segment, durationSec));
  scored.sort((a, b) => b.score - a.score);

  const selected: ViralClip[] = [];

  for (const candidate of scored) {
    if (selected.length >= requestedCuts) break;

    const targetDuration = Math.max(30, Math.min(75, 30 + Math.round(candidate.score * 0.32)));
    const startSec = Math.max(0, candidate.segment.startSec - 5);
    const endSec = Math.min(durationSec, startSec + targetDuration);
    const duration = Math.round(endSec - startSec);

    if (duration < 30) continue;

    const overlap = selected.some((clip) => {
      const amount = rangeOverlap(startSec, endSec, clip.startSec, clip.endSec);
      return amount > 14;
    });

    if (overlap) continue;

    const windowSegments = segments.filter(
      (segment) => segment.startSec < endSec && segment.endSec > startSec
    );

    const snippet = windowSegments
      .slice(0, 4)
      .map((segment) => segment.text)
      .join(" ")
      .slice(0, 420)
      .trim();

    const angle = angleFromSignals(candidate.signals);
    const hashtags = chooseHashtags(angle, candidate.segment.tags);
    const title = clipTitle(angle, candidate.segment.text, selected.length);

    const subtitles =
      windowSegments.length > 0
        ? buildSubtitlesFromSegments(windowSegments)
        : buildFallbackSubtitles(candidate.segment.text, startSec);

    selected.push({
      id: `clip-${selected.length + 1}-${candidate.segment.id.slice(-8)}`,
      title,
      score: candidate.score,
      angle,
      startSec,
      endSec,
      durationSec: duration,
      hookLine: candidate.segment.text,
      transcriptSnippet: snippet || candidate.segment.text,
      hashtags,
      suggestedDescription: `Recorte de ${videoTitle} com foco em ${angle}. Corte otimizado para retenção e compartilhamento rápido.`,
      subtitles,
      ffmpegPlan: [],
      previewUrl: "",
      downloadUrl: "",
      render: {
        aspectRatio: "9:16",
        zoomMode: "face-smart",
        cameraStyle: "dynamic-cut",
        captionsStyle: "reels-bold",
        headline: title,
        showProgressBar: true,
      },
      signals: candidate.signals,
    });
  }

  if (selected.length === 0) {
    const fallbackStart = 0;
    const fallbackEnd = Math.min(durationSec, 35);

    selected.push({
      id: "clip-1-fallback",
      title: "Trecho inicial com potencial de retenção",
      score: 45,
      angle: "hook",
      startSec: fallbackStart,
      endSec: fallbackEnd,
      durationSec: Math.round(fallbackEnd - fallbackStart),
      hookLine: segments[0]?.text ?? "Início do vídeo",
      transcriptSnippet: segments.slice(0, 4).map((segment) => segment.text).join(" "),
      hashtags: ["#CortesVirais", "#Shorts", "#TikTokBrasil"],
      suggestedDescription: "Trecho inicial otimizado para retenção.",
      subtitles: buildFallbackSubtitles(segments[0]?.text ?? "Trecho inicial", fallbackStart),
      ffmpegPlan: [],
      previewUrl: "",
      downloadUrl: "",
      render: {
        aspectRatio: "9:16",
        zoomMode: "face-smart",
        cameraStyle: "dynamic-cut",
        captionsStyle: "reels-bold",
        headline: "Corte sugerido",
        showProgressBar: true,
      },
      signals: {
        hook: 55,
        curiosity: 35,
        controversy: 10,
        humor: 10,
        storytelling: 30,
        value: 35,
        emotion: 40,
      },
    });
  }

  return selected.slice(0, requestedCuts);
}

export function generateSeoPack(sourceText: string, contextTitle?: string) {
  const normalized = sourceText.trim().slice(0, 240);
  const base = contextTitle?.trim() || "corte viral";

  const titles = [
    `${base}: o trecho que prendeu geral`,
    `Esse momento de ${base.toLowerCase()} está absurdo`,
    `Poucos segundos de ${base.toLowerCase()} que geram replay`,
    `O melhor corte de ${base.toLowerCase()} para Shorts`,
    `Se liga nesse recorte de ${base.toLowerCase()}!`,
  ];

  const description = `🎬 ${normalized}\n\nEsse corte foi otimizado para retenção, impacto e compartilhamento.\n\n#CortesVirais #YouTubeShorts #TikTokBrasil #ReelsBrasil #CreatorEconomy`;

  return {
    titles,
    description,
    hashtags: [
      "#CortesVirais",
      "#YouTubeShorts",
      "#TikTokBrasil",
      "#ReelsBrasil",
      "#ConteudoDigital",
    ],
  };
}
