// Shared API types. The web app imports these (type-only) via the `@server/*` alias.

export type Segment = { start: number; end: number; text: string; words?: [number, number, string][] };

export type MeetingMeta = {
  title: string;
  source_file?: string;
  recorded_at?: string;
  duration_seconds?: number;
  has_video?: boolean;
  original?: string;
  language?: string | null;
  tags?: string[];
};

export type MeetingSummary = MeetingMeta & {
  id: string;
  status: MeetingStatus;
  has_transcript: boolean;
  has_notes: boolean;
  word_count: number;
  tldr: string | null;
  renders: number;
};

export type MeetingStatus = "processing" | "queued" | "failed" | "ready" | "transcribed" | "incomplete";

export type RenderInfo = {
  file: string;
  url: string;
  size: number;
  created_at: string;
};

export type Meeting = {
  id: string;
  meta: MeetingMeta;
  status: MeetingStatus;
  transcript: { language: string | null; model: string; segments: Segment[] } | null;
  notes: string | null;
  media: { video: string | null; audio: string | null; size_bytes: number };
  renders: RenderInfo[];
};

export type JobKind = "process" | "render";
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export type Job = {
  id: string;
  kind: JobKind;
  label: string;
  meeting_id: string | null;
  status: JobStatus;
  step: string | null;
  progress: number | null;
  log: string[];
  error: string | null;
  output: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

export type ClipRenderRequest = {
  composition: "CaptionedClip" | "Highlights";
  name?: string;
  clips: { start: number; end: number; label?: string }[];
  format?: "landscape" | "square" | "vertical";
  captionStyle?: "bold" | "minimal" | "karaoke";
  accent?: string;
};

export type SearchResult = {
  id: string;
  title: string;
  recorded_at?: string;
  title_match: boolean;
  notes_match: boolean;
  hits: { start: number; text: string }[];
  total_hits: number;
};

/** Server-sent events streamed on /api/events */
export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "meetings" };
