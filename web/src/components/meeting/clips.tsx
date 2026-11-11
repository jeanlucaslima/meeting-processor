import { Player } from "@remotion/player";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Download, Play, Plus, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Segment } from "@server/types";
import { MeetingClip } from "@video/MeetingClip";
import { FORMATS, FPS, totalFrames, type MeetingClipProps } from "@video/schema";
import { JobRow } from "@/components/jobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jobsQuery, qk, type Meeting } from "@/lib/api";
import { markerLabel, type Marker } from "@/lib/notes";
import { player } from "@/lib/player";
import { bytes, clock, parseClock } from "@/lib/time";
import { cn } from "@/lib/utils";

export type ClipDraft = { start: number; end: number; label: string };
type Format = keyof typeof FORMATS;
type CaptionStyle = MeetingClipProps["captionStyle"];

const ACCENTS = ["#7c9cff", "#51cf66", "#ff922b", "#f06595", "#ffffff"];

export function ClipsPanel({
  meeting, markers, clips, setClips,
}: {
  meeting: Meeting;
  markers: Marker[];
  clips: ClipDraft[];
  setClips: (c: ClipDraft[]) => void;
}) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<Format>("landscape");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("bold");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [name, setName] = useState("");
  const { data: jobs = [] } = useQuery(jobsQuery);
  const renderJobs = jobs.filter((j) => j.kind === "render" && j.meeting_id === meeting.id && (j.status === "queued" || j.status === "running" || (j.status === "failed" && Date.now() - (j.ended_at ?? 0) < 600_000)));

  const segments = meeting.transcript?.segments ?? [];
  const src = meeting.media.video ?? meeting.media.audio;
  const highlights = clips.length > 1;
  const subtitle = meeting.meta.recorded_at
    ? new Date(meeting.meta.recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : undefined;

  const props: MeetingClipProps | null = useMemo(() => {
    if (!src || !clips.length) return null;
    return {
      title: meeting.meta.title,
      subtitle,
      mediaUrl: src,
      isVideo: !!meeting.media.video,
      clips: clips.map((c) => ({ start: c.start, end: Math.max(c.start + 0.5, c.end), label: c.label })),
      segments: segments.filter((s) => clips.some((c) => s.end > c.start && s.start < c.end)),
      format,
      captionStyle,
      titleCards: highlights,
      accent,
    };
  }, [src, clips, segments, format, captionStyle, accent, highlights, meeting.meta.title, meeting.media.video, subtitle]);

  const render = useMutation({
    mutationFn: () =>
      api.render(meeting.id, {
        composition: highlights ? "Highlights" : "CaptionedClip",
        name: name.trim() || (highlights ? `${meeting.meta.title} highlights` : clips[0].label || "clip"),
        clips: clips.map(({ start, end, label }) => ({ start, end, label })),
        format,
        captionStyle,
        accent,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.jobs });
      toast.success("Rendering started", { description: "The video appears below when it's done." });
    },
    onError: (e: Error) => toast.error(`Couldn't start the render: ${e.message}`),
  });

  const suggestions = markers.filter((m) => m.kind === "decision" || m.kind === "action");
  const fromMarkers = (list: Marker[]) => setClips(mergeOverlapping(list.map((m) => clipAround(m, segments))));

  if (!segments.length) {
    return <Empty title="Clips need a transcript" body="Captions come from the transcript. Make clips once transcription has finished." />;
  }
  if (!src) {
    return <Empty title="The recording isn't on this machine" body="Clips are cut from the original recording, so they can't be made without it." />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-8 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ------------------------------------------------ editor */}
        <section className="min-w-0 space-y-6">
          <div>
            <h3 className="font-semibold">{highlights ? "Highlight reel" : "Clip"}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              One moment makes a captioned clip. Several make a highlight reel with a title card before each.
            </p>
          </div>

          {clips.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed p-5 text-sm">
              <p>Pick the moments to include:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Select sentences in the transcript and choose <span className="text-foreground">Make clip</span>.</li>
                <li>Shift-drag across the timeline above.</li>
              </ul>
              {suggestions.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => fromMarkers(suggestions)}>
                  <Wand2 /> Use the decisions and action items from the notes
                </Button>
              )}
            </div>
          ) : (
            <ol className="space-y-2">
              {clips.map((c, i) => (
                <ClipRow
                  key={i}
                  index={i}
                  clip={c}
                  showIndex={highlights}
                  onChange={(next) => setClips(clips.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setClips(clips.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
          )}

          {clips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                const t = player.get().time;
                setClips([...clips, { start: t, end: t + 15, label: "" }]);
              }}>
                <Plus /> Add 15 s from the playhead
              </Button>
              {suggestions.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => fromMarkers(suggestions)}><Wand2 /> Replace with moments from notes</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setClips([])}>Clear all</Button>
            </div>
          )}

          <fieldset className="space-y-4">
            <Choice label="Shape" value={format} onChange={(v) => setFormat(v as Format)} options={[
              { value: "landscape", label: "Landscape", hint: "16:9" },
              { value: "square", label: "Square", hint: "1:1" },
              { value: "vertical", label: "Vertical", hint: "9:16" },
            ]} />
            <Choice label="Captions" value={captionStyle} onChange={(v) => setCaptionStyle(v as CaptionStyle)} options={[
              { value: "bold", label: "Bold", hint: "word pops" },
              { value: "karaoke", label: "Karaoke", hint: "fills in" },
              { value: "minimal", label: "Subtitle", hint: "quiet" },
            ]} />
            <div>
              <p className="mb-1.5 text-sm font-medium">Color</p>
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAccent(a)}
                    aria-label={`Accent ${a}`}
                    aria-pressed={accent === a}
                    className={cn("size-7 rounded-full border ring-offset-2 ring-offset-background", accent === a && "ring-2 ring-foreground")}
                    style={{ background: a }}
                  />
                ))}
              </div>
            </div>
          </fieldset>
        </section>

        {/* ------------------------------------------------ preview + render */}
        <section className="min-w-0 space-y-4">
          {props ? (
            <>
              <div className={cn("mx-auto overflow-hidden rounded-xl border bg-black", format === "vertical" ? "max-w-[300px]" : format === "square" ? "max-w-[460px]" : "")}>
                <Player
                  component={MeetingClip}
                  inputProps={props}
                  durationInFrames={totalFrames(props)}
                  fps={FPS}
                  compositionWidth={FORMATS[format].width}
                  compositionHeight={FORMATS[format].height}
                  style={{ width: "100%" }}
                  controls
                  clickToPlay
                  initialFrame={FPS}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="File name (optional)" className="h-9 min-w-0 flex-1" />
                <Button onClick={() => render.mutate()} disabled={render.isPending}>
                  <Clapperboard /> Render video
                </Button>
              </div>
              <p className="tabular text-xs text-muted-foreground">
                {clock(totalFrames(props) / FPS)} long, {FORMATS[format].width}×{FORMATS[format].height}. Rendering runs on this Mac and takes about as long as the video.
              </p>
            </>
          ) : (
            <div className="grid aspect-video place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
              The preview appears when you add a moment.
            </div>
          )}

          {renderJobs.map((j) => <JobRow key={j.id} job={j} compact />)}
          <Renders meeting={meeting} />
        </section>
      </div>
    </div>
  );
}

function ClipRow({ clip, index, showIndex, onChange, onRemove }: {
  clip: ClipDraft; index: number; showIndex: boolean; onChange: (c: ClipDraft) => void; onRemove: () => void;
}) {
  return (
    <li className="rounded-lg border bg-paper p-2.5">
      <div className="flex items-center gap-2">
        {showIndex && <span className="tabular w-5 text-center text-sm text-muted-foreground">{index + 1}</span>}
        <Input
          value={clip.label}
          onChange={(e) => onChange({ ...clip, label: e.target.value })}
          placeholder={showIndex ? "Title card text" : "Label"}
          className="h-8 min-w-0 flex-1"
          aria-label="Clip label"
        />
        <Button variant="ghost" size="icon-sm" aria-label="Play this moment" onClick={() => player.seek(clip.start)}><Play /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={onRemove}><X /></Button>
      </div>
      <div className={cn("mt-2 flex items-center gap-2 text-sm text-muted-foreground", showIndex && "pl-7")}>
        <TimeInput value={clip.start} onChange={(start) => onChange({ ...clip, start })} label="Start" />
        to
        <TimeInput value={clip.end} onChange={(end) => onChange({ ...clip, end })} label="End" />
        <span className="tabular">{Math.round(clip.end - clip.start)} s</span>
      </div>
    </li>
  );
}

function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(clock(value));
  useEffect(() => setText(clock(value)), [value]);
  const commit = () => {
    const ok = /^\d{1,2}(:\d{1,2}){1,2}$/.test(text.trim());
    if (ok) onChange(parseClock(text.trim()));
    else setText(clock(value));
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label={`${label} time`}
      className="tabular h-7 w-20 rounded-md border bg-background px-2 text-center text-foreground outline-none focus-visible:border-ring"
    />
  );
}

function Choice({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; hint: string }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn("rounded-md px-2 py-1.5 text-sm", value === o.value ? "bg-paper font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label} <span className="text-xs text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Renders({ meeting }: { meeting: Meeting }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (file: string) => api.deleteRender(meeting.id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.meeting(meeting.id) }),
  });
  if (!meeting.renders.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Rendered videos</h3>
      <ul className="space-y-2">
        {meeting.renders.map((r) => (
          <li key={r.file} className="flex items-center gap-3 rounded-lg border bg-paper p-2">
            <video src={r.url} preload="metadata" muted className="h-14 w-24 shrink-0 rounded bg-black object-contain" />
            <div className="min-w-0 flex-1">
              <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">{r.file}</a>
              <p className="text-xs text-muted-foreground">{bytes(r.size)}, {new Date(r.created_at).toLocaleString()}</p>
            </div>
            <Button variant="ghost" size="icon-sm" asChild aria-label="Download">
              <a href={`${r.url}?download=1`}><Download /></a>
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete video" onClick={() => remove.mutate(r.file)}><Trash2 /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/** A clip around a note's timestamp: from the sentence it points at, extended to whole sentences, 8–25 s. */
function clipAround(m: Marker, segments: Segment[]): ClipDraft {
  let i = segments.findIndex((s) => s.end > m.t);
  if (i < 0) i = segments.length - 1;
  const start = Math.max(0, Math.min(m.t, segments[i].start) - 0.3);
  let end = segments[i].end;
  for (let k = i + 1; k < segments.length && end - start < 8; k++) {
    if (segments[k].end - start > 25) break;
    end = segments[k].end;
  }
  return { start, end: end + 0.4, label: cleanLabel(m.text) || markerLabel[m.kind] };
}

/** "Unassigned (unnamed speaker): tell marketing that…" -> "Tell marketing that…" */
function cleanLabel(text: string): string {
  let t = text.replace(/\s*\([^)]*\)/g, "").trim();
  const owner = t.match(/^([^:—–]{1,40})\s*[:—–]\s+(.+)$/);
  if (owner) t = owner[2];
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= 90) return t;
  const cut = t.slice(0, 88);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

/** Overlapping or near-adjacent ranges become one clip, keeping the first label. */
function mergeOverlapping(clips: ClipDraft[]): ClipDraft[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const out: ClipDraft[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.start <= prev.end + 1) prev.end = Math.max(prev.end, c.end);
    else out.push({ ...c });
  }
  return out;
}
