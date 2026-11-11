import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { MEETINGS } from "./config";
import { jobsRepo } from "./db";
import type { Meeting, MeetingMeta, MeetingStatus, MeetingSummary, RenderInfo, SearchResult, Segment } from "./types";

const ID_RE = /^[\w.-]+$/;
const BROWSER_VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const BROWSER_AUDIO = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"]);

/** Returns the id if it names an existing meeting directory, otherwise null (guards path traversal). */
export function resolveId(id: string): string | null {
  return ID_RE.test(id) && !id.startsWith(".") && existsSync(join(MEETINGS, id, "meta.json")) ? id : null;
}

export const meetingDir = (id: string) => join(MEETINGS, id);

async function readJson<T>(path: string): Promise<T | null> {
  const f = Bun.file(path);
  return (await f.exists()) ? ((await f.json()) as T) : null;
}
async function readText(path: string): Promise<string | null> {
  const f = Bun.file(path);
  return (await f.exists()) ? f.text() : null;
}

export async function readMeta(id: string): Promise<MeetingMeta> {
  return (await readJson<MeetingMeta>(join(meetingDir(id), "meta.json"))) ?? { title: id };
}

export async function writeMeta(id: string, patch: Partial<MeetingMeta>) {
  const meta = { ...(await readMeta(id)), ...patch };
  await Bun.write(join(meetingDir(id), "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

export async function writeNotes(id: string, notes: string) {
  await Bun.write(join(meetingDir(id), "notes.md"), notes.trimEnd() + "\n");
}

function statusFor(id: string, hasTranscript: boolean, hasNotes: boolean, allJobs = jobsRepo.list(200)): MeetingStatus {
  const jobs = allJobs.filter((j) => j.meeting_id === id && j.kind === "process");
  if (jobs.some((j) => j.status === "running")) return "processing";
  if (jobs.some((j) => j.status === "queued")) return "queued";
  if (jobs[0]?.status === "failed") return "failed";
  if (hasNotes) return "ready";
  if (hasTranscript) return "transcribed";
  return "incomplete";
}

/** First paragraph under the first `##` heading of the notes (the TL;DR in the default prompt). */
function extractTldr(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/^##[^\n]*\n+([\s\S]*?)(?=\n##|\n*$)/m);
  return m ? m[1].trim().split(/\n\n/)[0].slice(0, 400) : null;
}

async function listRenders(id: string): Promise<RenderInfo[]> {
  const dir = join(meetingDir(id), "renders");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mp4"));
  const infos = await Promise.all(
    files.map(async (file) => {
      const s = await stat(join(dir, file));
      return { file, url: `/media/${id}/renders/${encodeURIComponent(file)}`, size: s.size, created_at: s.mtime.toISOString() };
    }),
  );
  return infos.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  if (!existsSync(MEETINGS)) return [];
  const ids = (await readdir(MEETINGS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && resolveId(d.name))
    .map((d) => d.name);

  const allJobs = jobsRepo.list(200);
  const items = await Promise.all(
    ids.map(async (id): Promise<MeetingSummary> => {
      const dir = meetingDir(id);
      const meta = await readMeta(id);
      const transcript = await readJson<{ segments: Segment[] }>(join(dir, "transcript.json"));
      const notes = await readText(join(dir, "notes.md"));
      return {
        ...meta,
        id,
        status: statusFor(id, !!transcript, !!notes, allJobs),
        has_transcript: !!transcript,
        has_notes: !!notes,
        word_count: transcript?.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0) ?? 0,
        tldr: extractTldr(notes),
        renders: (await listRenders(id)).length,
      };
    }),
  );
  return items.sort((a, b) => (b.recorded_at ?? b.id).localeCompare(a.recorded_at ?? a.id));
}

export async function getMeeting(id: string): Promise<Meeting> {
  const dir = meetingDir(id);
  const meta = await readMeta(id);
  const transcript = await readJson<Meeting["transcript"]>(join(dir, "transcript.json"));
  const notes = await readText(join(dir, "notes.md"));
  const mediaDir = join(dir, "media");
  const files = existsSync(mediaDir) ? await readdir(mediaDir) : [];
  const ext = meta.original?.slice(meta.original.lastIndexOf(".")).toLowerCase() ?? "";
  const hasOriginal = !!meta.original && files.includes(meta.original);
  const playableVideo = hasOriginal && !!meta.has_video && BROWSER_VIDEO.has(ext);
  const playableAudio = hasOriginal && !meta.has_video && BROWSER_AUDIO.has(ext);
  let size = 0;
  for (const f of files) size += (await stat(join(mediaDir, f))).size;

  return {
    id,
    meta,
    status: statusFor(id, !!transcript, !!notes),
    transcript,
    notes,
    media: {
      video: playableVideo ? `/media/${id}/media/${meta.original}` : null,
      // prefer the original audio (full quality) when the browser can play it
      audio: playableAudio ? `/media/${id}/media/${meta.original}` : files.includes("audio.m4a") ? `/media/${id}/media/audio.m4a` : null,
      size_bytes: size,
    },
    renders: await listRenders(id),
  };
}

export async function deleteMeeting(id: string) {
  await rm(meetingDir(id), { recursive: true, force: true });
  jobsRepo.deleteForMeeting(id);
}

export async function deleteRender(id: string, file: string) {
  if (!/^[\w.-]+\.mp4$/.test(file)) return false;
  const p = join(meetingDir(id), "renders", file);
  if (!existsSync(p)) return false;
  await rm(p);
  return true;
}

// ---------------------------------------------------------------- full-text search across transcripts and notes

type Indexed = { mtime: number; title: string; recorded_at?: string; segments: Segment[]; notes: string };
const index = new Map<string, Indexed>();

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function indexed(id: string): Promise<Indexed> {
  const dir = meetingDir(id);
  const files = ["meta.json", "transcript.json", "notes.md"].map((f) => join(dir, f));
  let mtime = 0;
  for (const f of files) if (existsSync(f)) mtime = Math.max(mtime, (await stat(f)).mtimeMs);
  const hit = index.get(id);
  if (hit && hit.mtime === mtime) return hit;
  const meta = await readMeta(id);
  const transcript = await readJson<{ segments: Segment[] }>(files[1]);
  const entry = { mtime, title: meta.title, recorded_at: meta.recorded_at, segments: transcript?.segments ?? [], notes: (await readText(files[2])) ?? "" };
  index.set(id, entry);
  return entry;
}

/** Accent- and case-insensitive search; every query word must appear in the segment. */
export async function search(q: string): Promise<SearchResult[]> {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length || !existsSync(MEETINGS)) return [];
  const ids = (await readdir(MEETINGS)).filter((id) => resolveId(id));
  const out: SearchResult[] = [];
  for (const id of ids) {
    const m = await indexed(id);
    const matches = (s: string) => { const f = fold(s); return terms.every((t) => f.includes(t)); };
    const hits = m.segments.filter((s) => matches(s.text));
    const title_match = matches(m.title);
    const notes_match = matches(m.notes);
    if (!hits.length && !title_match && !notes_match) continue;
    out.push({
      id, title: m.title, recorded_at: m.recorded_at, title_match, notes_match,
      hits: hits.slice(0, 6).map((s) => ({ start: s.start, text: s.text })), total_hits: hits.length,
    });
  }
  return out.sort((a, b) => Number(b.title_match) - Number(a.title_match) || b.total_hits - a.total_hits);
}

// ---------------------------------------------------------------- transcript corrections

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
const hms = (s: number) => `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
const srt = (s: number) => `${hms(s)},${pad(Math.round((s % 1) * 1000), 3)}`;

/** Rewrites transcript.md and transcript.srt from transcript.json (same layout mp.py writes). */
async function writeDerivedTranscripts(id: string, segments: Segment[]) {
  const dir = meetingDir(id);
  const meta = await readMeta(id);
  const blocks: string[][] = [];
  let lastEnd = -99, paraStart = -99;
  for (const s of segments) {
    if (!blocks.length || s.start - lastEnd > 2 || s.start - paraStart > 60) { blocks.push([]); paraStart = s.start; }
    blocks[blocks.length - 1].push(`[${hms(s.start)}] ${s.text}`);
    lastEnd = s.end;
  }
  await Bun.write(join(dir, "transcript.md"),
    `# ${meta.title} — transcript\n\n- Recorded: ${meta.recorded_at}\n- Duration: ${hms(meta.duration_seconds ?? 0)}\n- Language: ${meta.language}\n\n`
    + blocks.map((b) => b.join("  \n")).join("\n\n") + "\n");
  await Bun.write(join(dir, "transcript.srt"),
    segments.map((s, i) => `${i + 1}\n${srt(s.start)} --> ${srt(s.end)}\n${s.text}\n`).join("\n"));
}

/** Whole-word, case-insensitive find & replace across the transcript. Returns the number of replacements. */
export async function replaceInTranscript(id: string, find: string, replacement: string): Promise<number> {
  const path = join(meetingDir(id), "transcript.json");
  const data = await readJson<{ language: string; model: string; segments: Segment[] }>(path);
  if (!data) return 0;
  const escaped = find.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
  let count = 0;
  for (const s of data.segments) {
    const next = s.text.replace(re, () => { count++; return replacement; });
    if (next === s.text) continue;
    s.text = next;
    // keep word timings; fix single-word matches in place (multi-word phrases keep their timings as-is)
    if (s.words) for (const w of s.words) w[2] = w[2].replace(re, replacement);
  }
  if (!count) return 0;
  const head = JSON.stringify({ language: data.language, model: data.model }).slice(0, -1);
  await Bun.write(path, `${head}, "segments": [\n  ${data.segments.map((s) => JSON.stringify(s)).join(",\n  ")}\n]}\n`);
  await writeDerivedTranscripts(id, data.segments);
  index.delete(id);
  return count;
}
