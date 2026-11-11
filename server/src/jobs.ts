// Persistent job queue. Jobs run one at a time: transcription saturates the GPU and
// Remotion renders saturate the CPU, so running them concurrently only slows both down.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEETINGS, MP, ROOT } from "./config";
import { jobsRepo } from "./db";
import { bus } from "./events";
import { renderClip, type RenderArgs } from "./render";
import type { Job, JobKind } from "./types";

export type ProcessArgs = { argv: string[] };

const MAX_LOG = 300;
let current: { id: string; cancel: () => void } | null = null;

export function enqueue(kind: JobKind, label: string, meetingId: string | null, args: ProcessArgs | RenderArgs): Job {
  const job = jobsRepo.create(kind, label, meetingId, args);
  bus.emit({ type: "job", job });
  bus.emit({ type: "meetings" });
  queueMicrotask(pump);
  return job;
}

export function cancel(id: string): boolean {
  const job = jobsRepo.get(id);
  if (!job) return false;
  if (job.status === "queued") {
    jobsRepo.update(id, { status: "canceled", ended_at: Date.now() });
  } else if (job.status === "running" && current?.id === id) {
    current.cancel();
  } else return false;
  bus.emit({ type: "job", job: jobsRepo.get(id)! });
  bus.emit({ type: "meetings" });
  return true;
}

/** Collects updates for a running job and flushes them to sqlite + SSE at most every 250 ms. */
function tracker(job: Job) {
  let state = { ...job };
  let dirty = false;
  let timer: Timer | null = null;
  const flush = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    jobsRepo.update(job.id, {
      step: state.step, progress: state.progress, log: state.log, meeting_id: state.meeting_id, output: state.output,
    });
    bus.emit({ type: "job", job: state });
  };
  return {
    get: () => state,
    set(patch: Partial<Job>) {
      state = { ...state, ...patch };
      dirty = true;
      timer ??= setTimeout(flush, 250);
    },
    log(line: string) {
      state = { ...state, log: [...state.log, line].slice(-MAX_LOG) };
      dirty = true;
      timer ??= setTimeout(flush, 250);
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

async function runProcess(job: Job, t: ReturnType<typeof tracker>) {
  let { argv } = jobsRepo.args<ProcessArgs>(job.id);
  // A job interrupted by a server restart is re-queued. If its upload was already moved into the
  // meeting folder, resume from that folder instead: mp.py skips the steps that already finished.
  if (job.meeting_id && argv[0] && !existsSync(argv[0])) {
    const dir = join(MEETINGS, job.meeting_id);
    if (existsSync(join(dir, "meta.json"))) {
      argv = [dir, ...argv.slice(1).filter((a, i, all) => a !== "--title" && all[i - 1] !== "--title" && a !== "--compress-video")];
      t.log(`resuming in ${job.meeting_id}`);
    }
  }
  const proc = Bun.spawn([MP, ...argv], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MP_EVENTS: "1", PYTHONUNBUFFERED: "1" },
  });
  let canceled = false;
  current = { id: job.id, cancel: () => { canceled = true; proc.kill(); } };

  const consume = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split(/\r|\n/);
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("@@")) {
          try {
            const e = JSON.parse(line.slice(2));
            if (e.meeting) {
              t.set({ meeting_id: e.meeting });
              bus.emit({ type: "meetings" });
            }
            if (e.step) t.set({ step: e.step, progress: e.progress ?? null });
          } catch {}
          continue;
        }
        // tqdm / ffmpeg progress bars are noise in the log
        if (/\d+%\|| it\/s\]|frames\/s\]|^frame=|Fetching \d+ files/.test(line)) continue;
        t.log(line);
      }
    }
  };
  await Promise.all([consume(proc.stdout), consume(proc.stderr)]);
  const code = await proc.exited;
  if (canceled) throw new CanceledError();
  if (code !== 0) throw new Error(`mp.py exited with code ${code}`);
}

class CanceledError extends Error {}

async function runRender(job: Job, t: ReturnType<typeof tracker>) {
  const args = jobsRepo.args<RenderArgs>(job.id);
  const controller = new AbortController();
  current = { id: job.id, cancel: () => controller.abort() };
  const file = await renderClip(args, {
    signal: controller.signal,
    onStep: (step) => { t.set({ step, progress: null }); t.log(step); },
    onProgress: (progress) => t.set({ step: "rendering", progress }),
  });
  if (controller.signal.aborted) throw new CanceledError();
  t.set({ output: file });
  t.log(`rendered ${file}`);
}

let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (let job = jobsRepo.nextQueued(); job; job = jobsRepo.nextQueued()) {
      jobsRepo.update(job.id, { status: "running", started_at: Date.now() });
      job = jobsRepo.get(job.id)!;
      bus.emit({ type: "job", job });
      bus.emit({ type: "meetings" });
      const t = tracker(job);
      let patch: Partial<Job>;
      try {
        if (job.kind === "process") await runProcess(job, t);
        else await runRender(job, t);
        patch = { status: "done", progress: 1 };
      } catch (err) {
        patch = err instanceof CanceledError
          ? { status: "canceled" }
          : { status: "failed", error: err instanceof Error ? err.message : String(err) };
        if (patch.error) t.log(`error: ${patch.error}`);
      }
      current = null;
      t.flush();
      jobsRepo.update(job.id, { ...patch, ended_at: Date.now() });
      bus.emit({ type: "job", job: jobsRepo.get(job.id)! });
      bus.emit({ type: "meetings" });
    }
  } finally {
    pumping = false;
  }
}

export function startQueue() {
  pump();
}
