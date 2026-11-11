import { Hono } from "hono";
import { streamSSE, streamText } from "hono/streaming";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { ask } from "./chat";
import { INBOX, MEDIA_EXTS, PORT, STEPS, WEB_DIST } from "./config";
import { chatRepo, jobsRepo } from "./db";
import { bus } from "./events";
import { cancel, enqueue, startQueue } from "./jobs";
import { deleteMeeting, deleteRender, getMeeting, listMeetings, meetingDir, replaceInTranscript, resolveId, search, writeMeta, writeNotes } from "./meetings";
import type { ServerEvent } from "./types";

const app = new Hono();
const api = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// ---------------------------------------------------------------- meetings

api.get("/meetings", async (c) => c.json(await listMeetings()));
api.get("/search", async (c) => c.json(await search(c.req.query("q") ?? "")));

api.get("/meetings/:id", async (c) => {
  const id = resolveId(c.req.param("id"));
  return id ? c.json(await getMeeting(id)) : c.json({ error: "not found" }, 404);
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
api.patch("/meetings/:id", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  const body = patchSchema.parse(await c.req.json());
  if (body.notes !== undefined) await writeNotes(id, body.notes);
  if (body.title !== undefined || body.tags !== undefined) await writeMeta(id, { title: body.title, tags: body.tags });
  bus.emit({ type: "meetings" });
  return c.json(await getMeeting(id));
});

api.delete("/meetings/:id", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  await deleteMeeting(id);
  chatRepo.clear(id);
  bus.emit({ type: "meetings" });
  return c.json({ ok: true });
});

api.post("/meetings/:id/transcript/replace", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  const { find, replace } = z.object({ find: z.string().trim().min(1).max(200), replace: z.string().max(200) }).parse(await c.req.json());
  const count = await replaceInTranscript(id, find, replace);
  bus.emit({ type: "meetings" });
  return c.json({ count });
});

const rerunSchema = z.object({
  step: z.enum(STEPS),
  language: z.string().max(5).optional(),
  vocab: z.string().max(500).optional(),
});
api.post("/meetings/:id/rerun", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  const { step, language, vocab } = rerunSchema.parse(await c.req.json());
  // re-running a step also refreshes everything downstream of it
  const argv = [meetingDir(id), "--force", ...STEPS.slice(STEPS.indexOf(step))];
  if (language) argv.push("--language", language);
  if (vocab) argv.push("--vocab", vocab);
  return c.json(enqueue("process", `Re-run ${step}`, id, { argv }));
});

// ---------------------------------------------------------------- upload (raw streamed body, no multipart buffering)

api.put("/upload", async (c) => {
  const q = c.req.query();
  const name = basename(q.filename ?? "").replace(/[^\w .()+-]/g, "_");
  if (!name || !MEDIA_EXTS.has(extname(name).toLowerCase())) return c.json({ error: "unsupported file type" }, 400);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty body" }, 400);

  await mkdir(INBOX, { recursive: true });
  let dest = join(INBOX, name);
  for (let n = 2; existsSync(dest); n++) dest = join(INBOX, `${basename(name, extname(name))}-${n}${extname(name)}`);
  const writer = Bun.file(dest).writer({ highWaterMark: 4 * 1024 * 1024 });
  try {
    const reader = body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) writer.write(r.value);
    await writer.end();
  } catch (err) {
    await writer.end();
    await Bun.file(dest).delete().catch(() => {});
    throw err;
  }

  const argv = [dest];
  if (q.title?.trim()) argv.push("--title", q.title.trim());
  if (q.language?.trim()) argv.push("--language", q.language.trim());
  if (q.vocab?.trim()) argv.push("--vocab", q.vocab.trim());
  if (q.compress === "1") argv.push("--compress-video");
  const label = q.title?.trim() || basename(name, extname(name)).replace(/^\s*20\d\d[-_.]?\d\d[-_.]?\d\d[\s_-]*/, "") || name;
  return c.json(enqueue("process", label, null, { argv }));
});

// ---------------------------------------------------------------- jobs + live events

api.get("/jobs", (c) => c.json(jobsRepo.list(50)));
api.post("/jobs/:id/cancel", (c) => c.json({ ok: cancel(c.req.param("id")) }));

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const queue: ServerEvent[] = [];
    let wake: (() => void) | null = null;
    const off = bus.on((e) => { queue.push(e); wake?.(); });
    stream.onAbort(() => { off(); wake?.(); });
    await stream.writeSSE({ event: "hello", data: "{}" });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), Bun.sleep(20_000)]);
        wake = null;
        if (!queue.length) { await stream.writeSSE({ event: "ping", data: "{}" }); continue; }
      }
      // coalesce bursts of "meetings" invalidations
      const batch = queue.splice(0);
      let sentMeetings = false;
      for (const e of batch) {
        if (e.type === "meetings") { if (sentMeetings) continue; sentMeetings = true; }
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      }
    }
  }),
);

// ---------------------------------------------------------------- ask (chat with a meeting)

api.get("/meetings/:id/chat", (c) => {
  const id = resolveId(c.req.param("id"));
  return id ? c.json(chatRepo.messages(id)) : c.json({ error: "not found" }, 404);
});
api.delete("/meetings/:id/chat", (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  chatRepo.clear(id);
  return c.json({ ok: true });
});
api.post("/meetings/:id/chat", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  const { message } = z.object({ message: z.string().min(1).max(10_000) }).parse(await c.req.json());
  const ctrl = new AbortController();
  return streamText(c, async (stream) => {
    stream.onAbort(() => ctrl.abort());
    for await (const chunk of ask(id, message, ctrl.signal)) await stream.write(chunk);
  });
});

// ---------------------------------------------------------------- renders (Remotion)

const renderSchema = z.object({
  composition: z.enum(["CaptionedClip", "Highlights"]),
  name: z.string().max(80).optional(),
  clips: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), label: z.string().max(200).optional() })).min(1).max(30),
  format: z.enum(["landscape", "square", "vertical"]).optional(),
  captionStyle: z.enum(["bold", "minimal", "karaoke"]).optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});
api.post("/meetings/:id/renders", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id) return c.json({ error: "not found" }, 404);
  const request = renderSchema.parse(await c.req.json());
  const label = request.name || (request.composition === "Highlights" ? "Highlight reel" : "Clip");
  return c.json(enqueue("render", `Render: ${label}`, id, { meetingId: id, request }));
});
api.delete("/meetings/:id/renders/:file", async (c) => {
  const id = resolveId(c.req.param("id"));
  if (!id || !(await deleteRender(id, c.req.param("file")))) return c.json({ error: "not found" }, 404);
  bus.emit({ type: "meetings" });
  return c.json({ ok: true });
});

app.route("/api", api);

// ---------------------------------------------------------------- media with HTTP Range (seekable players + Remotion)

app.get("/media/:id/:sub/:file", async (c) => {
  const id = resolveId(c.req.param("id"));
  const sub = c.req.param("sub");
  const file = decodeURIComponent(c.req.param("file"));
  if (!id || !["media", "renders"].includes(sub) || !/^[\w.() -]+$/.test(file) || file.startsWith(".")) return c.notFound();
  const f = Bun.file(join(meetingDir(id), sub, file));
  if (!(await f.exists())) return c.notFound();

  const headers: Record<string, string> = { "Accept-Ranges": "bytes", "Content-Type": f.type };
  if (c.req.query("download") === "1") headers["Content-Disposition"] = `attachment; filename="${file}"`;
  const m = c.req.header("range")?.match(/bytes=(\d*)-(\d*)/);
  if (!m) return new Response(f, { headers });
  const start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
  if (start >= f.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  return new Response(f.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${f.size}`, "Content-Length": String(end - start + 1) },
  });
});

// ---------------------------------------------------------------- production: serve the built web app

if (existsSync(WEB_DIST)) {
  app.get("*", async (c) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    const f = Bun.file(join(WEB_DIST, path.replace(/\.\.+/g, "")));
    return (await f.exists()) ? new Response(f) : new Response(Bun.file(join(WEB_DIST, "index.html")));
  });
}

startQueue();

Bun.serve({
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 0, // SSE + long uploads
  maxRequestBodySize: 20 * 1024 ** 3,
});
console.log(`meeting-processor API on http://localhost:${PORT}`);
