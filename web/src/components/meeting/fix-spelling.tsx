import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SpellCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { Segment } from "@server/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, qk } from "@/lib/api";

/** Find & replace for misheard names and jargon. Matches whole words, ignoring case. */
export function FixSpelling({ meetingId, segments, initialFind = "" }: { meetingId: string; segments: Segment[]; initialFind?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState(initialFind);
  const [replace, setReplace] = useState("");

  const matches = useMemo(() => {
    const f = find.trim();
    if (!f) return 0;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    return segments.reduce((n, s) => n + (s.text.match(re)?.length ?? 0), 0);
  }, [find, segments]);

  const run = useMutation({
    mutationFn: () => api.replaceInTranscript(meetingId, find, replace),
    onSuccess: ({ count }) => {
      qc.invalidateQueries({ queryKey: qk.meeting(meetingId) });
      toast.success(`Replaced ${count} ${count === 1 ? "occurrence" : "occurrences"}`, {
        description: "Notes still use the old spelling. Rewrite them from the Notes tab if needed.",
      });
      setFind("");
      setReplace("");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><SpellCheck /> Fix spelling</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix a misheard word</DialogTitle>
          <DialogDescription>Replaces every whole-word match in the transcript, ignoring case. Use it for names, products and jargon.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); if (matches && replace.trim()) run.mutate(); }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="fs-find">Transcript says</Label>
            <Input id="fs-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Adin" autoFocus />
            <p className="tabular text-xs text-muted-foreground">
              {find.trim() ? `${matches} ${matches === 1 ? "match" : "matches"}` : "Type the wrong spelling as it appears"}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fs-replace">Should be</Label>
            <Input id="fs-replace" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Adyen" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!matches || !replace.trim() || run.isPending}>
              Replace {matches || ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
