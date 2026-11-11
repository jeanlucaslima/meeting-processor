import { parseClock } from "./time";

export type MarkerKind = "decision" | "action" | "question" | "point";
export type Marker = { t: number; kind: MarkerKind; text: string };

const TS = /\[?(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\]?/g;

// Section headings in English, Portuguese and Spanish (the notes follow the meeting's language).
const KINDS: [MarkerKind, RegExp][] = [
  ["decision", /decis|decid|acordad|agreed/i],
  ["action", /action|a[cç][aã]o|a[cç][oõ]es|tarefa|pr[oó]ximos passos|next steps|to-?do|acci[oó]n/i],
  ["question", /question|pergunta|d[uú]vida|risk|risco|riesgo|open|aberto|pendente|pendiente|blocker/i],
];

/** Pulls every timestamped line out of the notes, classified by the section it sits in. */
export function extractMarkers(notes: string | null): Marker[] {
  if (!notes) return [];
  const out: Marker[] = [];
  let kind: MarkerKind = "point";
  for (const line of notes.split("\n")) {
    const heading = line.match(/^#{2,3}\s+(.*)/);
    if (heading) {
      kind = KINDS.find(([, re]) => re.test(heading[1]))?.[0] ?? "point";
      continue;
    }
    const stamps = [...line.matchAll(TS)];
    if (!stamps.length) continue;
    const text = line
      .replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/i, "")
      .replace(/`?\[?\d{1,2}:\d{2}(:\d{2})?\]?`?/g, "")
      .replace(/\*\*/g, "")
      .replace(/\s+[—-]\s*$/, "")
      .trim();
    // one marker per line, at its first timestamp
    out.push({ t: parseClock(stamps[0][1]), kind, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Turns `[00:12:30]` / [00:12:30] in markdown into `#t=750` links the renderer makes seekable. */
export function linkifyTimestamps(md: string): string {
  return md.replace(/`?\[(\d{1,2}:\d{2}(?::\d{2})?)\]`?(?!\()/g, (_m, ts: string) => `[${ts}](#t=${parseClock(ts)})`);
}

/** Markdown without timestamps, for pasting into places where they are noise. */
export function stripTimestamps(md: string): string {
  return md.replace(/\s*`?\[\d{1,2}:\d{2}(:\d{2})?\]`?/g, "");
}

export const markerLabel: Record<MarkerKind, string> = {
  decision: "Decision",
  action: "Action item",
  question: "Open question",
  point: "Key point",
};
