import type { ClipRange, SegmentInput } from "./schema";

export type Word = { start: number; end: number; text: string };
export type CaptionPage = { start: number; end: number; words: Word[] };

/** Words inside a clip, with times relative to the clip start. Synthesizes word timings when the
 *  transcript has none (older transcripts) by spreading the segment duration over its characters. */
export function wordsInClip(segments: SegmentInput[], clip: ClipRange): Word[] {
  const out: Word[] = [];
  for (const s of segments) {
    if (s.end <= clip.start || s.start >= clip.end) continue;
    const words: Word[] = s.words?.length
      ? s.words.map(([start, end, text]) => ({ start, end, text: text.trim() }))
      : synthesize(s);
    for (const w of words) {
      if (w.end <= clip.start || w.start >= clip.end || !w.text) continue;
      out.push({ start: Math.max(0, w.start - clip.start), end: Math.min(clip.end, w.end) - clip.start, text: w.text });
    }
  }
  return out;
}

function synthesize(s: SegmentInput): Word[] {
  const tokens = s.text.split(/\s+/).filter(Boolean);
  const chars = tokens.reduce((n, t) => n + t.length + 1, 0) || 1;
  const span = s.end - s.start;
  let t = s.start;
  return tokens.map((text) => {
    const d = (span * (text.length + 1)) / chars;
    const w = { start: t, end: t + d, text };
    t += d;
    return w;
  });
}

/** Groups words into short readable caption pages. */
export function paginate(words: Word[], maxWords: number): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: Word[] = [];
  const push = () => {
    if (cur.length) pages.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.8 || cur.length >= maxWords || (/[.?!]$/.test(prev.text) && cur.length >= 3))) push();
    cur.push(w);
  }
  push();
  return pages;
}

/** The page to show at time t: the latest page that started, hidden after a long pause. */
export function pageAt(pages: CaptionPage[], t: number): CaptionPage | null {
  let lo = 0, hi = pages.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return null;
  const p = pages[found];
  return t <= p.end + 1.2 ? p : null;
}

export const fmtTime = (sec: number) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
};
