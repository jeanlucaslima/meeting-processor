import { useMemo, useRef, useState } from "react";
import type { Segment } from "@server/types";
import { markerLabel, type Marker } from "@/lib/notes";
import { player, usePlayer } from "@/lib/player";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Range = { start: number; end: number };

const MARKER_COLOR: Record<Marker["kind"], string> = {
  decision: "var(--decision)",
  action: "var(--action)",
  question: "var(--question)",
  point: "var(--muted-foreground)",
};

/**
 * The meeting at a glance: speech density, moments from the notes, clip ranges and the playhead.
 * Click or drag to scrub. Shift-drag to select a range for a clip.
 */
export function Timeline({
  segments, duration, markers, ranges, onSelectRange,
}: {
  segments: Segment[];
  duration: number;
  markers: Marker[];
  ranges: Range[];
  onSelectRange?: (r: Range) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const time = usePlayer((s) => s.time);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Range | null>(null);
  const [focusMarker, setFocusMarker] = useState<Marker | null>(null);
  const BUCKETS = 240;

  // share of each bucket covered by speech
  const density = useMemo(() => {
    const d = new Float32Array(BUCKETS);
    if (!duration) return d;
    const size = duration / BUCKETS;
    for (const s of segments) {
      for (let b = Math.floor(s.start / size); b <= Math.min(BUCKETS - 1, Math.floor(s.end / size)); b++) {
        const lo = Math.max(s.start, b * size), hi = Math.min(s.end, (b + 1) * size);
        if (hi > lo) d[b] += (hi - lo) / size;
      }
    }
    return d.map((v) => Math.min(1, v));
  }, [segments, duration]);

  if (!duration) return null;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-marker]")) return;
    ref.current!.setPointerCapture(e.pointerId);
    const t0 = timeAt(e.clientX);
    if (e.shiftKey && onSelectRange) setDrag({ start: t0, end: t0 });
    else player.seek(t0, !player.get().playing ? false : true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover(t);
    if (drag) setDrag({ ...drag, end: t });
    else if (e.buttons === 1) player.seek(t, player.get().playing);
  };
  const onPointerUp = () => {
    if (drag && onSelectRange && Math.abs(drag.end - drag.start) > 1) {
      onSelectRange({ start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) });
    }
    setDrag(null);
  };

  const ticks = tickMarks(duration);

  return (
    <div className="select-none">
      <div
        ref={ref}
        role="slider"
        aria-label="Meeting timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={clock(time)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); player.nudge(-5); }
          if (e.key === "ArrowRight") { e.preventDefault(); player.nudge(5); }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        className="relative h-16 cursor-pointer touch-none rounded-lg"
      >
        {/* speech density */}
        <svg className="absolute inset-x-0 bottom-0 h-11 w-full" viewBox={`0 0 ${BUCKETS} 100`} preserveAspectRatio="none" aria-hidden>
          {Array.from(density, (v, i) => {
            const played = ((i + 0.5) / BUCKETS) * duration <= time;
            const h = v > 0 ? 8 + v * 92 : 3;
            return (
              <rect
                key={i}
                x={i + 0.18}
                y={100 - h}
                width={0.64}
                height={h}
                fill={played ? "var(--foreground)" : "var(--muted-foreground)"}
                opacity={played ? 0.85 : v > 0 ? 0.32 : 0.18}
              />
            );
          })}
        </svg>

        {/* clip ranges */}
        {[...ranges, ...(drag ? [{ start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) }] : [])].map((r, i) => (
          <div
            key={i}
            className="pointer-events-none absolute bottom-0 h-11 rounded-sm border-x-2 border-playhead bg-playhead/15"
            style={{ left: pct(r.start), width: `calc(${pct(r.end)} - ${pct(r.start)})` }}
          />
        ))}

        {/* moments from the notes */}
        {markers.map((m, i) => (
          <button
            key={i}
            data-marker
            onClick={() => player.seek(m.t)}
            onMouseEnter={() => setFocusMarker(m)}
            onMouseLeave={() => setFocusMarker(null)}
            onFocus={() => setFocusMarker(m)}
            onBlur={() => setFocusMarker(null)}
            aria-label={`${markerLabel[m.kind]} at ${clock(m.t)}: ${m.text}`}
            className="absolute top-0 z-10 -translate-x-1/2 p-1"
            style={{ left: pct(m.t) }}
          >
            <span
              className={cn("block rounded-full ring-2 ring-paper", m.kind === "point" ? "mt-0.5 size-1.5 opacity-60" : "size-2.5")}
              style={{ background: MARKER_COLOR[m.kind] }}
            />
          </button>
        ))}

        {/* playhead */}
        <div className="pointer-events-none absolute top-3 bottom-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-playhead" style={{ left: pct(time) }}>
          <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-playhead" />
        </div>

        {/* hover ghost */}
        {hover != null && (
          <div className="pointer-events-none absolute top-3 bottom-0 z-10 w-px bg-foreground/30" style={{ left: pct(hover) }}>
            <span className="tabular absolute -top-0.5 left-1.5 rounded bg-foreground px-1 text-[11px] leading-4 whitespace-nowrap text-background">{clock(hover)}</span>
          </div>
        )}

        {focusMarker && (
          <div
            className="pointer-events-none absolute top-6 z-30 w-max max-w-72 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `clamp(9rem, ${pct(focusMarker.t)}, calc(100% - 9rem))` }}
          >
            <span className="font-semibold" style={{ color: MARKER_COLOR[focusMarker.kind] }}>{markerLabel[focusMarker.kind]}</span>
            <span className="tabular text-muted-foreground"> at {clock(focusMarker.t)}</span>
            <p className="mt-0.5 text-foreground">{focusMarker.text}</p>
          </div>
        )}
      </div>

      <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className={cn("tabular absolute", t === 0 ? "" : t >= duration ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(t) }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function tickMarks(duration: number): number[] {
  const steps = [30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => duration / s <= 8) ?? 3600;
  const out: number[] = [0];
  for (let t = step; t < duration - step * 0.4; t += step) out.push(t);
  out.push(duration);
  return out;
}

export function TimelineLegend({ markers }: { markers: Marker[] }) {
  const kinds = (["decision", "action", "question"] as const).filter((k) => markers.some((m) => m.kind === k));
  if (!kinds.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: MARKER_COLOR[k] }} />
          {markerLabel[k]}s
        </span>
      ))}
      <span className="hidden sm:inline">Shift-drag on the timeline to select a clip</span>
    </div>
  );
}
