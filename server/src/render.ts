// Server-side Remotion rendering of captioned clips / highlight reels.
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MeetingClipProps } from "../../video/src/schema";
import { DATA, ORIGIN, VIDEO_ENTRY } from "./config";
import { getMeeting, meetingDir } from "./meetings";
import type { ClipRenderRequest } from "./types";

export type RenderArgs = { meetingId: string; request: ClipRenderRequest };

let cached: { key: string; serveUrl: string } | null = null;

/** Fingerprint of the video sources so the webpack bundle is rebuilt only when they change. */
async function sourceKey(dir: string): Promise<string> {
  const parts: string[] = [];
  for (const f of await readdir(dir, { recursive: true })) {
    const s = await stat(join(dir, f));
    if (s.isFile()) parts.push(`${f}:${s.mtimeMs}`);
  }
  return parts.sort().join("|");
}

async function getBundle(onStep: (s: string) => void): Promise<string> {
  const key = await sourceKey(join(VIDEO_ENTRY, ".."));
  if (cached?.key === key) return cached.serveUrl;
  onStep("bundling compositions");
  const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY, outDir: join(DATA, "remotion-bundle") });
  cached = { key, serveUrl };
  return serveUrl;
}

export async function buildInputProps(meetingId: string, req: ClipRenderRequest): Promise<MeetingClipProps> {
  const m = await getMeeting(meetingId);
  const src = m.media.video ?? m.media.audio;
  if (!src) throw new Error("meeting has no playable media");
  const clips = req.clips.map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.max(c.start + 0.5, c.end) }));
  const segments = (m.transcript?.segments ?? []).filter((s) => clips.some((c) => s.end > c.start && s.start < c.end));
  const date = m.meta.recorded_at ? new Date(m.meta.recorded_at) : null;
  return {
    title: m.meta.title,
    subtitle: date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : undefined,
    mediaUrl: ORIGIN + src,
    isVideo: !!m.media.video,
    clips,
    segments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words })),
    format: req.format ?? "landscape",
    captionStyle: req.captionStyle ?? "bold",
    titleCards: req.composition === "Highlights",
    accent: req.accent ?? "#7c9cff",
  };
}

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "clip";

export async function renderClip(
  { meetingId, request }: RenderArgs,
  { signal, onStep, onProgress }: { signal: AbortSignal; onStep: (s: string) => void; onProgress: (p: number) => void },
): Promise<string> {
  onStep("preparing browser");
  await ensureBrowser();
  const serveUrl = await getBundle(onStep);
  const inputProps = await buildInputProps(meetingId, request);
  const composition = await selectComposition({ serveUrl, id: request.composition, inputProps });

  const dir = join(meetingDir(meetingId), "renders");
  await mkdir(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  const file = `${slug(request.name || request.composition)}-${request.format ?? "landscape"}-${stamp}.mp4`;

  const { cancelSignal, cancel } = makeCancelSignal();
  signal.addEventListener("abort", () => cancel());
  onStep(`rendering ${composition.durationInFrames} frames (${composition.width}×${composition.height})`);
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 23,
    outputLocation: join(dir, file),
    cancelSignal,
    onProgress: ({ progress }) => onProgress(progress),
  });
  return file;
}
