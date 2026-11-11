import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, FileAudio, Languages, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { LANGUAGES } from "@/components/upload";
import { api, qk, type Meeting } from "@/lib/api";
import { bytes, dateLong, duration } from "@/lib/time";

export function MeetingHeader({ meeting, busy }: { meeting: Meeting; busy: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(meeting.meta.title);
  const [retranscribe, setRetranscribe] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setTitle(meeting.meta.title), [meeting.meta.title]);

  const rename = useMutation({
    mutationFn: (t: string) => api.update(meeting.id, { title: t }),
    onSuccess: (m) => { qc.setQueryData(qk.meeting(meeting.id), m); qc.invalidateQueries({ queryKey: qk.meetings }); },
    onError: (e: Error) => { setTitle(meeting.meta.title); toast.error(`Couldn't rename: ${e.message}`); },
  });
  const rerunNotes = useMutation({
    mutationFn: () => api.rerun(meeting.id, { step: "enrich" }),
    onSuccess: () => toast.success("Writing new notes"),
  });
  const remove = useMutation({
    mutationFn: () => api.remove(meeting.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.meetings });
      toast.success(`Deleted “${meeting.meta.title}”`);
      navigate({ to: "/" });
    },
  });

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== meeting.meta.title) rename.mutate(t);
    else setTitle(meeting.meta.title);
  };

  const original = meeting.meta.original ? `/media/${meeting.id}/media/${meeting.meta.original}?download=1` : null;

  return (
    <div className="flex items-start gap-3">
      <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0" aria-label="All meetings">
        <Link to="/"><ArrowLeft /></Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setTitle(meeting.meta.title); (e.target as HTMLInputElement).blur(); }
            }}
            aria-label="Meeting title"
            className="-ml-1.5 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-0.5 text-2xl font-semibold tracking-tight outline-none hover:bg-muted focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-ring"
          />
          <StatusBadge status={meeting.status} />
        </div>
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <div><dt className="sr-only">Recorded</dt><dd>{dateLong(meeting.meta.recorded_at)}</dd></div>
          <div><dt className="sr-only">Length</dt><dd className="tabular">{duration(meeting.meta.duration_seconds)}</dd></div>
          {meeting.meta.language && <div><dt className="sr-only">Language</dt><dd>{new Intl.DisplayNames(undefined, { type: "language" }).of(meeting.meta.language) ?? meeting.meta.language}</dd></div>}
          {meeting.transcript && <div><dt className="sr-only">Words</dt><dd className="tabular">{meeting.transcript.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0).toLocaleString()} words</dd></div>}
          {meeting.media.size_bytes > 0 && <div><dt className="sr-only">Size on disk</dt><dd className="tabular">{bytes(meeting.media.size_bytes)} on disk</dd></div>}
        </dl>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Process again</DropdownMenuLabel>
          <DropdownMenuItem disabled={busy} onSelect={() => setRetranscribe(true)}><Languages /> Transcribe again…</DropdownMenuItem>
          <DropdownMenuItem disabled={busy || !meeting.transcript} onSelect={() => rerunNotes.mutate()}><Sparkles /> Rewrite notes</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Download</DropdownMenuLabel>
          {original && <DropdownMenuItem asChild><a href={original}><Download /> Original recording</a></DropdownMenuItem>}
          {meeting.media.audio && <DropdownMenuItem asChild><a href={`/media/${meeting.id}/media/audio.m4a?download=1`}><FileAudio /> Audio only (small)</a></DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 /> Delete meeting…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RetranscribeDialog meeting={meeting} open={retranscribe} onOpenChange={setRetranscribe} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{meeting.meta.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The recording, transcript, notes and rendered clips are removed from this Mac. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>Delete meeting</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RetranscribeDialog({ meeting, open, onOpenChange }: { meeting: Meeting; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [language, setLanguage] = useState(meeting.meta.language ?? "auto");
  const [vocab, setVocab] = useState("");
  const run = useMutation({
    mutationFn: () => api.rerun(meeting.id, { step: "transcribe", language: language === "auto" ? undefined : language, vocab: vocab.trim() || undefined }),
    onSuccess: () => { onOpenChange(false); toast.success("Transcribing again", { description: "Notes are rewritten afterwards." }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const known = LANGUAGES.some((l) => l.value === language);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transcribe again</DialogTitle>
          <DialogDescription>
            Use this when the language was detected wrong or names came out misspelled. The transcript and notes are replaced; your edits to the notes are lost.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Spoken language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!known && <SelectItem value={language}>{language}</SelectItem>}
                {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rt-vocab">Names and terms</Label>
            <Input id="rt-vocab" value={vocab} onChange={(e) => setVocab(e.target.value)} placeholder="Jumpad, Kubernetes, Ana Souza" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>Transcribe again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
