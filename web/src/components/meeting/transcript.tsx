import { ChevronDown, ChevronUp, Clapperboard, Copy, Download, LocateFixed, MessageSquare, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "@server/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { copy, download, paragraphs, transcriptFormats } from "@/lib/clipboard";
import { player, usePlayer } from "@/lib/player";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { FixSpelling } from "./fix-spelling";

export type Selection = { from: number; to: number } | null;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Index of the segment playing at time t (binary search). */
function activeIndex(segs: Segment[], t: number): number {
  let lo = 0, hi = segs.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && t <= segs[found].end + 1.5 ? found : -1;
}

export function TranscriptView({
  segments, meetingId, fileBase, selection, onSelectionChange, onMakeClip, onAsk,
}: {
  segments: Segment[];
  meetingId: string;
  fileBase: string;
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  onMakeClip: (s: { start: number; end: number; label: string }) => void;
  onAsk: (quote: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [matchIdx, setMatchIdx] = useState(0);
  const anchor = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const active = usePlayer((s) => activeIndex(segments, s.time));
  const playing = usePlayer((s) => s.playing);

  const paras = useMemo(() => {
    let i = 0;
    return paragraphs(segments).map((p) => p.map((s) => ({ s, i: i++ })));
  }, [segments]);

  const matches = useMemo(() => {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return segments.flatMap((s, i) => (terms.every((t) => fold(s.text).includes(t)) ? [i] : []));
  }, [segments, query]);
  const terms = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => setMatchIdx(0), [query]);
  useEffect(() => {
    if (matches.length) scrollTo(matches[Math.min(matchIdx, matches.length - 1)]);
  }, [matches, matchIdx]);

  // follow playback, but never fight the user while they read elsewhere
  useEffect(() => {
    if (follow && playing && active >= 0 && !query) scrollTo(active, "smooth");
  }, [active, follow, playing, query]);

  function scrollTo(i: number, behavior: ScrollBehavior = "auto") {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-seg="${i}"]`);
    if (!el || !scroller.current) return;
    const box = scroller.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (behavior === "smooth" && r.top > box.top + 60 && r.bottom < box.bottom - 120) return;
    scroller.current.scrollTo({ top: scroller.current.scrollTop + r.top - box.top - box.height / 3, behavior });
  }

  // stable callback so memoized sentences don't all re-render when the playhead moves
  const clickRef = useRef<(i: number, e: React.MouseEvent) => void>(() => {});
  const onSegmentClick = useCallback((i: number, e: React.MouseEvent) => clickRef.current(i, e), []);
  clickRef.current = (i: number, e: React.MouseEvent) => {
    if (window.getSelection()?.toString()) return; // the user is selecting text to copy
    if (e.shiftKey) {
      const a = anchor.current ?? active ?? i;
      onSelectionChange({ from: Math.min(a, i), to: Math.max(a, i) });
      return;
    }
    anchor.current = i;
    onSelectionChange(null);
    player.seek(segments[i].start);
  };

  const selected = selection ? segments.slice(selection.from, selection.to + 1) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length) setMatchIdx((m) => (m + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Find in transcript"
            aria-label="Find in transcript"
            className="h-8 w-full rounded-md border bg-paper pr-20 pl-8 text-sm outline-none focus-visible:border-ring"
          />
          {query && (
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 text-xs text-muted-foreground">
              <span className="tabular px-1">{matches.length ? `${matchIdx + 1}/${matches.length}` : "0"}</span>
              <button className="rounded p-0.5 hover:text-foreground" aria-label="Previous match" onClick={() => setMatchIdx((m) => (m + matches.length - 1) % Math.max(1, matches.length))}><ChevronUp className="size-3.5" /></button>
              <button className="rounded p-0.5 hover:text-foreground" aria-label="Next match" onClick={() => setMatchIdx((m) => (m + 1) % Math.max(1, matches.length))}><ChevronDown className="size-3.5" /></button>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={follow} onCheckedChange={setFollow} size="sm" />
          Follow playback
        </label>
        {active >= 0 && (
          <Button variant="ghost" size="sm" onClick={() => scrollTo(active, "smooth")}>
            <LocateFixed /> Now playing
          </Button>
        )}
        <div className="flex-1" />
        <FixSpelling meetingId={meetingId} segments={segments} />
        <Button variant="outline" size="sm" onClick={() => copy(transcriptFormats.plain(segments), "transcript")}>
          <Copy /> Copy
        </Button>
        <TranscriptMenu segments={segments} fileBase={fileBase} />
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="max-w-[72ch] space-y-5">
          {paras.map((p) => (
            <div key={p[0].i} className="grid grid-cols-[3.5rem_1fr] gap-3">
              <button
                onClick={() => player.seek(p[0].s.start)}
                className="tabular h-fit pt-1 text-left text-xs text-muted-foreground hover:text-playhead"
                aria-label={`Play from ${clock(p[0].s.start)}`}
              >
                {clock(p[0].s.start)}
              </button>
              <p className="font-serif text-[1.0625rem] leading-[1.75]">
                {p.map(({ s, i }) => (
                  <SegmentSpan
                    key={i}
                    i={i}
                    seg={s}
                    active={i === active}
                    selected={!!selection && i >= selection.from && i <= selection.to}
                    matched={matchSet.has(i)}
                    current={matches[matchIdx] === i}
                    terms={terms}
                    onClick={onSegmentClick}
                  />
                ))}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-[72ch] pl-[4.25rem] text-xs text-muted-foreground">
          Click a sentence to play it. Shift-click another to select everything in between.
        </p>
      </div>

      {selection && (
        <SelectionBar
          count={selected.length}
          start={selected[0].start}
          end={selected[selected.length - 1].end}
          onCopy={() => copy(transcriptFormats.plain(selected), "selection")}
          onCopyStamped={() => copy(transcriptFormats.stamped(selected), "selection with timestamps")}
          onClip={() => onMakeClip({ start: selected[0].start, end: selected[selected.length - 1].end, label: selected[0].text.slice(0, 60) })}
          onAsk={() => onAsk(selected.map((s) => s.text).join(" "))}
          onClear={() => onSelectionChange(null)}
        />
      )}
    </div>
  );
}

const SegmentSpan = memo(function SegmentSpan({
  seg, i, active, selected, matched, current, terms, onClick,
}: {
  seg: Segment; i: number; active: boolean; selected: boolean; matched: boolean; current: boolean; terms: string[];
  onClick: (i: number, e: React.MouseEvent) => void;
}) {
  return (
    <span
      data-seg={i}
      onClick={(e) => onClick(i, e)}
      className={cn(
        "cursor-pointer rounded-[3px] box-decoration-clone px-px transition-colors hover:bg-muted",
        active && "bg-accent text-accent-foreground hover:bg-accent",
        selected && "bg-playhead/20 hover:bg-playhead/25",
        current && "ring-2 ring-playhead",
      )}
    >
      {active && seg.words?.length ? <ActiveWords seg={seg} /> : matched ? <Marked text={seg.text} terms={terms} /> : seg.text}{" "}
    </span>
  );
});

/** Underlines the word being spoken inside the active sentence. */
function ActiveWords({ seg }: { seg: Segment }) {
  const t = usePlayer((s) => s.time);
  return (
    <>
      {seg.words!.map(([ws, we, w], k) => (
        <span key={k} className={cn(t >= ws && t < we + 0.1 && "underline decoration-playhead decoration-2 underline-offset-4")}>{w}</span>
      ))}
    </>
  );
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  const f = fold(text);
  const marks = new Array(text.length).fill(false);
  for (const t of terms) for (let i = f.indexOf(t); i >= 0; i = f.indexOf(t, i + 1)) for (let k = i; k < i + t.length; k++) marks[k] = true;
  const out: React.ReactNode[] = [];
  let k = 0;
  while (k < text.length) {
    const on = marks[k];
    let e = k;
    while (e < text.length && marks[e] === on) e++;
    out.push(on ? <mark key={k} className="rounded-sm bg-action/25 text-inherit">{text.slice(k, e)}</mark> : text.slice(k, e));
    k = e;
  }
  return <>{out}</>;
}

function SelectionBar(p: {
  count: number; start: number; end: number;
  onCopy: () => void; onCopyStamped: () => void; onClip: () => void; onAsk: () => void; onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 shadow-lg">
        <span className="tabular px-2 text-sm text-muted-foreground">
          {p.count} {p.count === 1 ? "sentence" : "sentences"}, {clock(p.start)} to {clock(p.end)}
        </span>
        <Button size="sm" variant="ghost" onClick={p.onCopy}><Copy /> Copy</Button>
        <Button size="sm" variant="ghost" onClick={p.onCopyStamped}>With timestamps</Button>
        <Button size="sm" variant="ghost" onClick={p.onClip}><Clapperboard /> Make clip</Button>
        <Button size="sm" variant="ghost" onClick={p.onAsk}><MessageSquare /> Ask about this</Button>
        <Button size="icon-sm" variant="ghost" onClick={p.onClear} aria-label="Clear selection"><X /></Button>
      </div>
    </div>
  );
}

function TranscriptMenu({ segments, fileBase }: { segments: Segment[]; fileBase: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="More copy and download options"><Download /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Copy</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => copy(transcriptFormats.plain(segments), "transcript")}>Plain text</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(transcriptFormats.stamped(segments), "transcript with timestamps")}>With timestamps</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Download</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => download(`${fileBase}-transcript.txt`, transcriptFormats.stamped(segments))}>Text file (.txt)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download(`${fileBase}.srt`, transcriptFormats.srt(segments))}>Subtitles (.srt)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download(`${fileBase}.vtt`, transcriptFormats.vtt(segments), "text/vtt")}>Web subtitles (.vtt)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
