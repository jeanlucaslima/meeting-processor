import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Copy, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, qk, type ChatMessage, type Meeting } from "@/lib/api";
import { copy } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

const STARTERS = [
  "Draft a follow-up email to the attendees",
  "List the action items grouped by person",
  "What was left unresolved?",
  "Write a 5-bullet update for Slack",
  "What were the main disagreements?",
  "What should I prepare for the next meeting?",
];

export function AskPanel({ meeting, draft, onDraftConsumed }: { meeting: Meeting; draft?: string; onDraftConsumed: () => void }) {
  const qc = useQueryClient();
  const { data: history = [] } = useQuery({ queryKey: qk.chat(meeting.id), queryFn: () => api.chat(meeting.id) });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<{ question: string; answer: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // a quote handed over from the transcript selection
  useEffect(() => {
    if (!draft) return;
    setInput(`> ${draft.length > 600 ? draft.slice(0, 600) + "…" : draft}\n\n`);
    onDraftConsumed();
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, [draft, onDraftConsumed]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [history.length, streaming?.answer]);

  const clear = useMutation({
    mutationFn: () => api.clearChat(meeting.id),
    onSuccess: () => qc.setQueryData(qk.chat(meeting.id), []),
  });

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setInput("");
    setStreaming({ question: q, answer: "" });
    abort.current = new AbortController();
    try {
      await api.ask(meeting.id, q, (chunk) => setStreaming((s) => (s ? { ...s, answer: s.answer + chunk } : s)), abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(`Claude couldn't answer: ${(e as Error).message}`);
    } finally {
      await qc.invalidateQueries({ queryKey: qk.chat(meeting.id) });
      setStreaming(null);
    }
  }

  if (!meeting.transcript) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
        Questions are answered from the transcript, which isn't ready yet.
      </div>
    );
  }

  const empty = history.length === 0 && !streaming;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {empty ? (
          <div className="max-w-[68ch]">
            <h3 className="text-lg font-semibold">Ask about this meeting</h3>
            <p className="mt-1 text-muted-foreground">
              Claude has read the whole transcript. Answers point to the moments they come from, and you can ask follow-ups.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border bg-paper px-3 py-1.5 text-sm hover:border-playhead hover:text-playhead">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-[72ch] space-y-6">
            {history.map((m) => <Message key={m.id} m={m} />)}
            {streaming && (
              <>
                <Message m={{ id: -1, role: "user", content: streaming.question, created_at: Date.now() }} />
                <Message m={{ id: -2, role: "assistant", content: streaming.answer || "…", created_at: Date.now() }} pending />
              </>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t bg-paper px-4 py-3 sm:px-6">
        <form
          className="relative max-w-[72ch]"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
            }}
            rows={Math.min(8, Math.max(2, input.split("\n").length))}
            placeholder="Ask anything about this meeting"
            aria-label="Question"
            className="w-full resize-none rounded-xl border bg-background py-2.5 pr-12 pl-3.5 text-[15px] outline-none focus-visible:border-ring"
          />
          {streaming ? (
            <Button type="button" size="icon-sm" className="absolute right-2 bottom-3.5" aria-label="Stop" onClick={() => abort.current?.abort()}><Square /></Button>
          ) : (
            <Button type="submit" size="icon-sm" className="absolute right-2 bottom-3.5" aria-label="Send" disabled={!input.trim()}><ArrowUp /></Button>
          )}
        </form>
        <div className="mt-1.5 flex max-w-[72ch] items-center justify-between text-xs text-muted-foreground">
          <span>Enter sends. Shift+Enter adds a line.</span>
          {history.length > 0 && !streaming && (
            <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => clear.mutate()}>
              <RotateCcw className="size-3" /> Start over
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Message({ m, pending }: { m: ChatMessage; pending?: boolean }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 whitespace-pre-wrap text-accent-foreground">
        {m.content}
      </div>
    );
  }
  return (
    <div className="group">
      <Markdown className={cn("text-[1rem]", pending && "opacity-90")}>{m.content}</Markdown>
      {!pending && (
        <button
          onClick={() => copy(m.content, "answer")}
          className="mt-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <Copy className="size-3" /> Copy
        </button>
      )}
    </div>
  );
}
