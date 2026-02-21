export type JobStage =
  | "queued"
  | "collecting"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed";

export interface YouTubeVideoMeta {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channelName: string;
  durationSec: number;
  thumbnailUrl: string;
  publishedAt?: string;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  energy: number;
  emotion: number;
  tags: string[];
}

export interface ViralSignal {
  hook: number;
  emotion: number;
  curiosity: number;
  controversy: number;
  humor: number;
  storytelling: number;
  value: number;
}

export interface SubtitleToken {
  time: number;
  text: string;
  highlight: boolean;
  emoji?: string;
}

export interface ViralClip {
  id: string;
  title: string;
  score: number;
  angle: "hook" | "curiosity" | "controversy" | "humor" | "storytelling" | "value";
  startSec: number;
  endSec: number;
  durationSec: number;
  hookLine: string;
  transcriptSnippet: string;
  hashtags: string[];
  suggestedDescription: string;
  subtitles: SubtitleToken[];
  ffmpegPlan: string[];
  previewUrl: string;
  downloadUrl: string;
  render: {
    aspectRatio: "9:16";
    zoomMode: "face-smart";
    cameraStyle: "dynamic-cut";
    captionsStyle: "reels-bold";
    headline?: string;
    showProgressBar: boolean;
  };
  signals: ViralSignal;
}

export interface JobLog {
  at: string;
  stage: JobStage;
  message: string;
}

export interface ProcessingJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: {
    youtubeUrl: string;
    videoId: string;
  };
  stage: JobStage;
  progress: number;
  error?: string;
  logs: JobLog[];
  video?: YouTubeVideoMeta;
  transcript: TranscriptSegment[];
  clips: ViralClip[];
}

export interface CreateJobInput {
  youtubeUrl: string;
}

export interface GenerateSeoInput {
  sourceText: string;
  contextTitle?: string;
}
