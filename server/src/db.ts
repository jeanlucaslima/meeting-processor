import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import type { ChatMessage, Job, JobKind } from "./types";

mkdirSync(DATA, { recursive: true });
export const db = new Database(join(DATA, "app.sqlite"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  meeting_id TEXT,
  args TEXT NOT NULL,            -- JSON, interpreted per kind
  status TEXT NOT NULL,
  step TEXT,
  progress REAL,
  log TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  output TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS chats (
  meeting_id TEXT PRIMARY KEY,
  session_id TEXT
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Jobs that were running when the server stopped are re-queued.
db.exec(`UPDATE jobs SET status = 'queued', step = NULL, progress = NULL WHERE status = 'running'`);

type JobRow = Omit<Job, "log"> & { log: string; args: string };

const toJob = (r: JobRow): Job => {
  const { args: _args, ...rest } = r;
  return { ...rest, log: JSON.parse(r.log) };
};

export const jobsRepo = {
  create(kind: JobKind, label: string, meetingId: string | null, args: unknown): Job {
    const id = crypto.randomUUID().slice(0, 8);
    db.query(
      `INSERT INTO jobs (id, kind, label, meeting_id, args, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(id, kind, label, meetingId, JSON.stringify(args), Date.now());
    return this.get(id)!;
  },
  get(id: string): Job | null {
    const r = db.query<JobRow, [string]>(`SELECT * FROM jobs WHERE id = ?`).get(id);
    return r ? toJob(r) : null;
  },
  args<T>(id: string): T {
    return JSON.parse(db.query<{ args: string }, [string]>(`SELECT args FROM jobs WHERE id = ?`).get(id)!.args);
  },
  nextQueued(): Job | null {
    const r = db.query<JobRow, []>(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`).get();
    return r ? toJob(r) : null;
  },
  list(limit = 50): Job[] {
    return db.query<JobRow, [number]>(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`).all(limit).map(toJob);
  },
  active(): Job[] {
    return db
      .query<JobRow, []>(`SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at`)
      .all()
      .map(toJob);
  },
  update(id: string, patch: Partial<Omit<Job, "id">>) {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    const vals = cols.map((c) => {
      const v = (patch as Record<string, unknown>)[c];
      return c === "log" ? JSON.stringify(v) : (v as string | number | null);
    });
    db.query(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
  },
  deleteForMeeting(meetingId: string) {
    db.query(`DELETE FROM jobs WHERE meeting_id = ? AND status NOT IN ('queued','running')`).run(meetingId);
  },
};

export const chatRepo = {
  session(meetingId: string): string | null {
    return db.query<{ session_id: string | null }, [string]>(`SELECT session_id FROM chats WHERE meeting_id = ?`).get(meetingId)?.session_id ?? null;
  },
  setSession(meetingId: string, sessionId: string) {
    db.query(`INSERT INTO chats (meeting_id, session_id) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET session_id = excluded.session_id`).run(meetingId, sessionId);
  },
  messages(meetingId: string): ChatMessage[] {
    return db
      .query<ChatMessage, [string]>(`SELECT id, role, content, created_at FROM chat_messages WHERE meeting_id = ? ORDER BY id`)
      .all(meetingId);
  },
  add(meetingId: string, role: ChatMessage["role"], content: string) {
    db.query(`INSERT INTO chat_messages (meeting_id, role, content, created_at) VALUES (?, ?, ?, ?)`).run(meetingId, role, content, Date.now());
  },
  clear(meetingId: string) {
    db.query(`DELETE FROM chat_messages WHERE meeting_id = ?`).run(meetingId);
    db.query(`DELETE FROM chats WHERE meeting_id = ?`).run(meetingId);
  },
};
