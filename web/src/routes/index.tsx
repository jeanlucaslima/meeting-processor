import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JobRow, useActiveJobs } from "@/components/jobs";
import { Highlight } from "@/components/highlight";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpload } from "@/components/upload";
import { api, meetingsQuery, qk, type MeetingSummary, type SearchResult } from "@/lib/api";
import { clock, duration } from "@/lib/time";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q ? { q: s.q } : {}),
  loader: ({ context }) => context.queryClient.ensureQueryData(meetingsQuery),
  component: Library,
});

function Library() {
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [text, setText] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useActiveJobs();

  // debounce typing into the URL
  useEffect(() => {
    const t = setTimeout(() => navigate({ search: text.trim() ? { q: text.trim() } : {}, replace: true }), 200);
    return () => clearTimeout(t);
  }, [text, navigate]);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pt-8 pb-24 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setText("")}
            placeholder="Search everything that was said"
            className="h-14 w-full rounded-xl border bg-paper pr-12 pl-12 text-lg shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
            aria-label="Search meetings and transcripts"
          />
          {text ? (
            <button onClick={() => setText("")} className="absolute top-1/2 right-4 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="absolute top-1/2 right-4 -translate-y-1/2 rounded border bg-muted px-1.5 text-xs text-muted-foreground">/</kbd>
          )}
        </div>

        {active.length > 0 && !q && (
          <section className="mt-8 space-y-2" aria-label="Processing now">
            {active.map((j) => <JobRow key={j.id} job={j} />)}
          </section>
        )}

        {q ? <SearchResults q={q} /> : <MeetingList />}
      </div>
    </main>
  );
}

function MeetingList() {
  const { data: meetings, isPending } = useQuery(meetingsQuery);
  const { pickFiles } = useUpload();

  const groups = useMemo(() => {
    const map = new Map<string, MeetingSummary[]>();
    for (const m of meetings ?? []) {
      const key = m.recorded_at ? new Date(m.recorded_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Undated";
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()];
  }, [meetings]);

  if (isPending) return <div className="mt-10 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  if (!meetings?.length) {
    return (
      <button onClick={pickFiles} className="mt-10 flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors hover:border-playhead hover:bg-accent/40">
        <Upload className="size-6 text-muted-foreground" />
        <p className="mt-4 text-lg font-semibold">Add your first meeting</p>
        <p className="mt-1 max-w-sm text-muted-foreground">
          Drop a video or audio recording anywhere on this page, or click to choose one. You'll get a transcript and notes.
        </p>
      </button>
    );
  }

  return (
    <div className="mt-8 space-y-10">
      {groups.map(([month, items]) => (
        <section key={month}>
          <h2 className="mb-2 px-3 text-sm font-semibold text-muted-foreground">{month}</h2>
          <ul className="divide-y rounded-xl border bg-paper">
            {items.map((m) => <MeetingRow key={m.id} m={m} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MeetingRow({ m }: { m: MeetingSummary }) {
  const d = m.recorded_at ? new Date(m.recorded_at) : null;
  return (
    <li>
      <Link to="/meetings/$id" params={{ id: m.id }} className="group flex gap-4 px-3 py-4 first:rounded-t-xl last:rounded-b-xl hover:bg-accent/50 sm:gap-5 sm:px-4">
        <div className="w-11 shrink-0 text-center leading-tight">
          <div className="text-xs text-muted-foreground">{d?.toLocaleDateString(undefined, { weekday: "short" }) ?? ""}</div>
          <div className="tabular text-xl font-semibold">{d?.getDate() ?? "?"}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold group-hover:underline">{m.title}</h3>
            <StatusBadge status={m.status} />
          </div>
          {m.tldr ? (
            <p className="mt-1 line-clamp-2 font-serif text-[15px] leading-relaxed text-muted-foreground">{m.tldr}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{m.has_transcript ? "Transcript ready, no notes yet." : "Not transcribed yet."}</p>
          )}
        </div>
        <div className="hidden shrink-0 text-right text-sm text-muted-foreground sm:block">
          <div className="tabular">{duration(m.duration_seconds)}</div>
          {m.language && <div className="uppercase">{m.language}</div>}
        </div>
      </Link>
    </li>
  );
}

function SearchResults({ q }: { q: string }) {
  const { data, isFetching } = useQuery({ queryKey: qk.search(q), queryFn: () => api.search(q), placeholderData: keepPreviousData });
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  if (!data) return <div className="mt-10 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!data.length) {
    return <p className="mt-12 text-center text-muted-foreground">Nothing matches “{q}”. Try fewer or different words.</p>;
  }
  const total = data.reduce((n, r) => n + r.total_hits, 0);
  return (
    <div className={isFetching ? "opacity-70 transition-opacity" : ""}>
      <p className="mt-6 px-1 text-sm text-muted-foreground">
        {total} {total === 1 ? "moment" : "moments"} in {data.length} {data.length === 1 ? "meeting" : "meetings"}
      </p>
      <ul className="mt-3 space-y-4">
        {data.map((r) => <SearchRow key={r.id} r={r} terms={terms} />)}
      </ul>
    </div>
  );
}

function SearchRow({ r, terms }: { r: SearchResult; terms: string[] }) {
  return (
    <li className="rounded-xl border bg-paper">
      <Link to="/meetings/$id" params={{ id: r.id }} className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2 hover:underline">
        <span className="font-semibold"><Highlight text={r.title} terms={terms} /></span>
        <span className="shrink-0 text-sm text-muted-foreground">{r.recorded_at ? new Date(r.recorded_at).toLocaleDateString() : ""}</span>
      </Link>
      {r.hits.length > 0 && (
        <ul className="pb-2">
          {r.hits.map((h, i) => (
            <li key={i}>
              <Link
                to="/meetings/$id"
                params={{ id: r.id }}
                search={{ t: Math.floor(h.start), tab: "transcript" }}
                className="flex gap-3 px-4 py-1.5 hover:bg-accent/50"
              >
                <span className="tabular w-14 shrink-0 pt-0.5 text-sm text-playhead">{clock(h.start)}</span>
                <span className="font-serif leading-relaxed"><Highlight text={h.text} terms={terms} /></span>
              </Link>
            </li>
          ))}
          {r.total_hits > r.hits.length && (
            <li className="px-4 pt-1 text-sm text-muted-foreground">and {r.total_hits - r.hits.length} more in this meeting</li>
          )}
        </ul>
      )}
      {r.hits.length === 0 && r.notes_match && <p className="px-4 pb-3 text-sm text-muted-foreground">Mentioned in the notes</p>}
    </li>
  );
}
