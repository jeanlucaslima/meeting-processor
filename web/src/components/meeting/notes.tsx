import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Pencil, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, qk, type Meeting } from "@/lib/api";
import { copy, download } from "@/lib/clipboard";
import { stripTimestamps } from "@/lib/notes";
import { Markdown } from "./markdown";

export function NotesView({ meeting, busy }: { meeting: Meeting; busy: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.notes ?? "");
  const rendered = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: (notes: string) => api.update(meeting.id, { notes }),
    onSuccess: (m) => {
      qc.setQueryData(qk.meeting(meeting.id), m);
      qc.invalidateQueries({ queryKey: qk.meetings });
      setEditing(false);
      toast.success("Notes saved");
    },
    onError: (e: Error) => toast.error(`Couldn't save notes: ${e.message}`),
  });
  const regenerate = useMutation({
    mutationFn: () => api.rerun(meeting.id, { step: "enrich" }),
    onSuccess: () => toast.success("Writing new notes", { description: "This takes about a minute. The page updates when they're ready." }),
  });

  useEffect(() => { if (!editing) setDraft(meeting.notes ?? ""); }, [meeting.notes, editing]);

  if (!meeting.notes && !editing) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm">
          <p className="font-semibold">{busy ? "Notes are being written" : "This meeting has no notes yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {busy
              ? "They appear here as soon as processing finishes."
              : meeting.transcript
                ? "Claude can read the transcript and write a summary, decisions and action items."
                : "Notes are written from the transcript, which isn't ready yet."}
          </p>
          {!busy && meeting.transcript && (
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => regenerate.mutate()} disabled={regenerate.isPending}><Sparkles /> Write notes</Button>
              <Button variant="ghost" onClick={() => setEditing(true)}>Write my own</Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const notes = meeting.notes ?? "";
  const copyRich = () => {
    // seek buttons become plain "(12:30)" text so they paste cleanly into other apps
    const clone = rendered.current?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll("button").forEach((b) => b.replaceWith(`(${b.textContent})`));
    copy(notes, "notes", clone?.innerHTML);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        {editing ? (
          <>
            <span className="text-sm text-muted-foreground">Editing Markdown. <kbd className="rounded border px-1 text-xs">⌘S</kbd> saves.</span>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(notes); }}>Cancel</Button>
            <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>Save notes</Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={copyRich}><Copy /> Copy notes</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More copy and download options"><Download /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Copy</DropdownMenuLabel>
                <DropdownMenuItem onSelect={copyRich}>Formatted, for Docs, Slack or email</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copy(notes, "notes as Markdown")}>Markdown</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copy(stripTimestamps(notes), "notes without timestamps")}>Markdown without timestamps</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => download(`${meeting.id}-notes.md`, notes, "text/markdown")}>Download .md</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => regenerate.mutate()} disabled={busy || regenerate.isPending}>
              <Sparkles /> Rewrite
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save.mutate(draft); }
              if (e.key === "Escape") { setEditing(false); setDraft(notes); }
            }}
            className="h-full min-h-[60vh] w-full max-w-[80ch] resize-none rounded-lg border bg-paper p-4 text-sm leading-relaxed outline-none focus-visible:border-ring"
            spellCheck
            aria-label="Notes in Markdown"
          />
        ) : (
          // the page header already shows the title, so the notes' own H1 is hidden here (kept when copying)
          <div ref={rendered}><Markdown className="[&_h1:first-child]:hidden [&_h1:first-child+h2]:mt-0">{notes}</Markdown></div>
        )}
      </div>
    </div>
  );
}
