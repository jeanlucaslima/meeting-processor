import { resolve, join } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
export const MEETINGS = join(ROOT, "meetings");
export const INBOX = join(ROOT, "inbox");
export const DATA = join(ROOT, ".data"); // sqlite + remotion bundle cache (gitignored)
export const WEB_DIST = join(ROOT, "web", "dist");
export const VIDEO_ENTRY = join(ROOT, "video", "src", "index.ts");
export const MP = join(ROOT, "mp.py");

export const PORT = Number(process.env.PORT ?? 4321);
export const ORIGIN = `http://localhost:${PORT}`;

export const MEDIA_EXTS = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
  ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".opus", ".flac", ".wma", ".amr",
]);

export const STEPS = ["audio", "transcribe", "enrich"] as const;
export type Step = (typeof STEPS)[number];
