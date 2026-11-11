import { Loader2 } from "lucide-react";
import type { MeetingStatus } from "@server/types";
import { cn } from "@/lib/utils";

const LABEL: Record<MeetingStatus, string | null> = {
  ready: null, // the normal state needs no badge
  processing: "Processing",
  queued: "Waiting",
  failed: "Failed",
  transcribed: "No notes",
  incomplete: "Not transcribed",
};

export function StatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  const label = LABEL[status];
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        status === "failed" ? "bg-destructive/10 text-destructive" : status === "processing" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {status === "processing" && <Loader2 className="size-3 animate-spin" />}
      {label}
    </span>
  );
}
