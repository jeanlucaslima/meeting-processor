import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, CircleAlert, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api, jobsQuery, type Job } from "@/lib/api";
import { relative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useUpload } from "./upload";

const PROCESS_STEPS = [
  { key: "compress", label: "Shrink video" },
  { key: "audio", label: "Extract audio" },
  { key: "transcribe", label: "Transcribe" },
  { key: "enrich", label: "Write notes" },
];

export function useActiveJobs() {
  const { data = [] } = useQuery(jobsQuery);
  return data.filter((j) => j.status === "queued" || j.status === "running");
}

export function JobsButton() {
  const { data: jobs = [] } = useQuery(jobsQuery);
  const { uploads } = useUpload();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length + uploads.filter((u) => !u.error).length;
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" className={cn(active ? "text-foreground" : "text-muted-foreground")}>
          {active ? <Loader2 className="animate-spin text-playhead" /> : <Check />}
          <span className={cn(!active && "hidden sm:inline")}>{active ? `Processing ${active}` : "Jobs"}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Processing</SheetTitle>
          <SheetDescription>Jobs run one at a time, in the order they were added.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {uploads.map((u) => (
            <div key={u.id} className="rounded-lg border bg-paper p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{u.name}</span>
                <span className="tabular shrink-0 text-muted-foreground">{u.error ? "Failed" : `Uploading ${Math.round(u.progress * 100)}%`}</span>
              </div>
              {u.error ? <p className="mt-1 text-sm text-destructive">{u.error}</p> : <Progress value={u.progress * 100} className="mt-2 h-1.5" />}
            </div>
          ))}
          {jobs.length === 0 && uploads.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing has been processed yet. Upload a recording to start.</p>
          )}
          {jobs.map((j) => <JobRow key={j.id} job={j} onNavigate={() => setOpen(false)} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function JobRow({ job, onNavigate, compact }: { job: Job; onNavigate?: () => void; compact?: boolean }) {
  const [showLog, setShowLog] = useState(job.status === "failed");
  const cancel = useMutation({ mutationFn: () => api.cancelJob(job.id) });
  const live = job.status === "running" || job.status === "queued";

  return (
    <div className={cn("rounded-lg border bg-paper p-3", job.status === "failed" && "border-destructive/40")}>
      <div className="flex items-start gap-2">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {job.meeting_id && !compact ? (
              <Link to="/meetings/$id" params={{ id: job.meeting_id }} onClick={onNavigate} className="truncate text-sm font-medium hover:underline">
                {job.label}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">{job.label}</span>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{relative(job.ended_at ?? job.started_at ?? job.created_at)}</span>
          </div>
          {live && <JobProgress job={job} />}
          {job.status === "failed" && <p className="mt-1 text-sm text-destructive">{job.error}</p>}
          {job.log.length > 0 && (
            <button className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowLog((s) => !s)}>
              <ChevronRight className={cn("size-3 transition-transform", showLog && "rotate-90")} /> Log
            </button>
          )}
          {showLog && (
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {job.log.join("\n")}
            </pre>
          )}
        </div>
        {live && (
          <Button variant="ghost" size="icon-sm" aria-label="Cancel job" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}

function JobProgress({ job }: { job: Job }) {
  if (job.status === "queued") return <p className="mt-1 text-xs text-muted-foreground">Waiting for the current job to finish</p>;
  if (job.kind === "render") {
    return (
      <div className="mt-2">
        <p className="text-xs text-muted-foreground">{job.step === "rendering" ? `Rendering ${Math.round((job.progress ?? 0) * 100)}%` : (job.log.at(-1) ?? "Starting")}</p>
        <Progress value={(job.progress ?? 0) * 100} className="mt-1.5 h-1.5" />
      </div>
    );
  }
  const idx = PROCESS_STEPS.findIndex((s) => s.key === job.step);
  return (
    <div className="mt-2">
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {PROCESS_STEPS.filter((s) => s.key !== "compress" || job.step === "compress").map((s) => {
          const i = PROCESS_STEPS.indexOf(s);
          return (
            <li key={s.key} className={cn(i < idx ? "text-muted-foreground line-through decoration-muted-foreground/40" : i === idx ? "font-medium text-foreground" : "text-muted-foreground/70")}>
              {s.label}
              {i === idx && s.key === "transcribe" && job.progress != null ? ` ${Math.round(job.progress * 100)}%` : ""}
            </li>
          );
        })}
      </ol>
      {job.step === "transcribe" && job.progress != null ? (
        <Progress value={job.progress * 100} className="mt-1.5 h-1.5" />
      ) : (
        <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-playhead" />
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "running") return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-playhead" />;
  if (status === "done") return <Check className="mt-0.5 size-4 shrink-0 text-decision" />;
  if (status === "failed") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-muted-foreground/50" />;
}
