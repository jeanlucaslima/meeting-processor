import { toast } from "sonner";
import type { Segment } from "@server/types";
import { hms, srtTime } from "./time";

/** Copies plain text, plus rich HTML when given, so pasting into Docs/Slack/Notion keeps formatting. */
export async function copy(text: string, what: string, html?: string) {
  try {
    if (html && "ClipboardItem" in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast.success(`Copied ${what}`);
  } catch {
    toast.error("The browser blocked clipboard access. Click the page and try again.");
  }
}

export function download(filename: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const transcriptFormats = {
  plain: (segs: Segment[]) => paragraphs(segs).map((p) => p.map((s) => s.text).join(" ")).join("\n\n"),
  stamped: (segs: Segment[]) => segs.map((s) => `[${hms(s.start)}] ${s.text}`).join("\n"),
  srt: (segs: Segment[]) => segs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join("\n"),
  vtt: (segs: Segment[]) => "WEBVTT\n\n" + segs.map((s) => `${srtTime(s.start).replace(",", ".")} --> ${srtTime(s.end).replace(",", ".")}\n${s.text}\n`).join("\n"),
};

/** Groups segments into paragraphs on pauses longer than 2 s or every ~60 s. */
export function paragraphs(segs: Segment[]): Segment[][] {
  const out: Segment[][] = [];
  let last = -Infinity;
  for (const s of segs) {
    const cur = out[out.length - 1];
    if (!cur || s.start - last > 2 || s.start - cur[0].start > 60) out.push([s]);
    else cur.push(s);
    last = s.end;
  }
  return out;
}
