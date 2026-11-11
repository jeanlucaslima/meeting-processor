// "Ask this meeting": a multi-turn conversation with Claude grounded in one meeting's transcript.
// Uses the local `claude` CLI; follow-ups resume the same Claude session so context is kept.
import { join } from "node:path";
import { chatRepo } from "./db";
import { getMeeting, meetingDir } from "./meetings";

const SYSTEM = `You are an assistant answering questions about a single recorded meeting.
The first user message contains the full transcript (timestamps in [HH:MM:SS]) and, if available, the generated notes.
Ground every answer in the transcript. Cite moments with timestamps like [00:12:30] so the user can jump to them.
If something was not discussed, say so instead of guessing. Answer in the language the user writes in.
Use concise Markdown. When asked to draft something (email, Slack message, ticket), output it ready to paste.`;

/** Streams the assistant's reply as text chunks; persists both turns when done. */
export async function* ask(meetingId: string, message: string, signal: AbortSignal): AsyncGenerator<string> {
  const session = chatRepo.session(meetingId);
  const args = [
    "claude", "-p", message,
    "--tools", "", "--strict-mcp-config",
    "--append-system-prompt", SYSTEM,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
  ];
  let stdin: string | undefined;
  if (session) {
    args.push("--resume", session);
  } else {
    const m = await getMeeting(meetingId);
    const transcript = await Bun.file(join(meetingDir(meetingId), "transcript.md")).text().catch(() => "");
    stdin = `<transcript title="${m.meta.title}" recorded="${m.meta.recorded_at ?? ""}">\n${transcript}\n</transcript>\n`
      + (m.notes ? `\n<notes>\n${m.notes}\n</notes>\n` : "");
  }

  chatRepo.add(meetingId, "user", message);
  const proc = Bun.spawn(args, {
    cwd: meetingDir(meetingId), // sessions are scoped by cwd, so keep it stable per meeting
    stdin: stdin ? new Blob([stdin]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  signal.addEventListener("abort", () => proc.kill());

  let answer = "";
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.session_id && !session) chatRepo.setSession(meetingId, e.session_id);
      const d = e.type === "stream_event" && e.event?.type === "content_block_delta" ? e.event.delta : null;
      if (d?.type === "text_delta") {
        answer += d.text;
        yield d.text;
      }
    }
  }
  const code = await proc.exited;
  if (code !== 0 && !answer) {
    const err = (await new Response(proc.stderr).text()).trim();
    answer = `⚠️ Claude failed (exit ${code})${err ? `: ${err.slice(0, 500)}` : ""}`;
    yield answer;
  }
  if (answer) chatRepo.add(meetingId, "assistant", answer);
}
