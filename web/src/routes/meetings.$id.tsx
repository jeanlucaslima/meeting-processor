import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { JobRow } from "@/components/jobs";
import { AskPanel } from "@/components/meeting/ask";
import { ClipsPanel, type ClipDraft } from "@/components/meeting/clips";
import { MeetingHeader } from "@/components/meeting/header";
import { MediaPlayer } from "@/components/meeting/media";
import { TimeLink } from "@/components/meeting/markdown";
import { NotesView } from "@/components/meeting/notes";
import { Timeline, TimelineLegend } from "@/components/meeting/timeline";
import { TranscriptView, type Selection } from "@/components/meeting/transcript";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jobsQuery, meetingQuery } from "@/lib/api";
import { extractMarkers, markerLabel, type Marker } from "@/lib/notes";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

const TABS = ["notes", "transcript", "clips", "ask"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/meetings/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; t?: number } => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
    t: typeof s.t === "number" ? s.t : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(meetingQuery(params.id)).catch(() => null),
  component: MeetingPage,
  pendingComponent: () => (
    <div className="space-y-4 p-6"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>
  ),
});

function MeetingPage() {
  const { id } = Route.useParams();
  const { tab = "notes", t } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: meeting, isError } = useQuery(meetingQuery(id));
  const { data: jobs = [] } = useQuery(jobsQuery);
  const wide = useMediaQuery("(min-width: 1024px)");

  const [selection, setSelection] = useState<Selection>(null);
  const [clips, setClips] = useState<ClipDraft[]>([]);
  const [askDraft, setAskDraft] = useState<string>();
  const consumeDraft = useCallback(() => setAskDraft(undefined), []);

  const markers = useMemo(() => extractMarkers(meeting?.notes ?? null), [meeting?.notes]);
  const setTab = (next: Tab) => navigate({ search: (s) => ({ ...s, tab: next === "notes" ? undefined : next, t: undefined }), replace: true });

  if (isError || meeting === null) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-semibold">This meeting doesn't exist anymore</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been deleted or renamed on disk.</p>
          <Button asChild className="mt-4"><Link to="/">Back to all meetings</Link></Button>
        </div>
      </div>
    );
  }
  if (!meeting) return null;

  const activeJob = jobs.find((j) => j.meeting_id === id && j.kind === "process" && (j.status === "running" || j.status === "queued"));
  const failedJob = !activeJob && meeting.status === "failed" ? jobs.find((j) => j.meeting_id === id && j.status === "failed") : undefined;
  const busy = !!activeJob;
  const segments = meeting.transcript?.segments ?? [];
  const dur = meeting.meta.duration_seconds ?? segments.at(-1)?.end ?? 0;

  const addClip = (c: ClipDraft) => {
    setClips((prev) => [...prev, c]);
    setSelection(null);
    setTab("clips");
  };

  const content = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b px-4 sm:px-6">
        <TabsList variant="line" className="h-11">
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="clips">Clips{clips.length ? <span className="tabular ml-1 text-muted-foreground">{clips.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="ask">Ask</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="notes" className="min-h-0 flex-1"><NotesView meeting={meeting} busy={busy} /></TabsContent>
      <TabsContent value="transcript" className="relative min-h-0 flex-1">
        {segments.length ? (
          <TranscriptView
            segments={segments}
            meetingId={meeting.id}
            fileBase={meeting.id}
            selection={selection}
            onSelectionChange={setSelection}
            onMakeClip={addClip}
            onAsk={(quote) => { setAskDraft(quote); setTab("ask"); }}
          />
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">{busy ? "The transcript appears here when transcription finishes." : "This meeting hasn't been transcribed."}</p>
        )}
      </TabsContent>
      <TabsContent value="clips" className="min-h-0 flex-1"><ClipsPanel meeting={meeting} markers={markers} clips={clips} setClips={setClips} /></TabsContent>
      <TabsContent value="ask" className="min-h-0 flex-1"><AskPanel meeting={meeting} draft={askDraft} onDraftConsumed={consumeDraft} /></TabsContent>
    </Tabs>
  );

  const side = (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <MediaPlayer meeting={meeting} startAt={t} />
      <Moments markers={markers} />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b bg-paper px-4 pt-5 pb-3 sm:px-6">
        <MeetingHeader meeting={meeting} busy={busy} />
        {activeJob && <JobRow job={activeJob} compact />}
        {failedJob && <JobRow job={failedJob} compact />}
        {segments.length > 0 && dur > 0 && (
          <div className="space-y-1.5">
            <Timeline
              segments={segments}
              duration={dur}
              markers={markers}
              ranges={clips}
              onSelectRange={(r) => addClip({ ...r, label: "" })}
            />
            <TimelineLegend markers={markers} />
          </div>
        )}
      </div>

      {/* desktop: resizable split; mobile: stacked. Only one is mounted so there's a single player. */}
      {wide ? (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="36%" minSize="24%" maxSize="55%">{side}</ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel>{content}</ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4"><MediaPlayer meeting={meeting} startAt={t} /></div>
          <div className="h-[80dvh]">{content}</div>
        </div>
      )}
    </div>
  );
}

const ORDER: Marker["kind"][] = ["decision", "action", "question"];

/** The notes' decisions, action items and questions as a jump list beside the player. */
function Moments({ markers }: { markers: Marker[] }) {
  const groups = ORDER.map((k) => ({ kind: k, items: markers.filter((m) => m.kind === k) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div className="mt-8 space-y-6">
      {groups.map((g) => (
        <section key={g.kind}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className={cn("size-2 rounded-full", g.kind === "decision" ? "bg-decision" : g.kind === "action" ? "bg-action" : "bg-question")} />
            {markerLabel[g.kind]}s
          </h3>
          <ul className="space-y-1.5">
            {g.items.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <TimeLink seconds={m.t} className="mx-0 mt-px shrink-0 translate-y-0" />
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
