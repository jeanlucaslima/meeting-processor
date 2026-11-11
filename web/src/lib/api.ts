import { queryOptions } from "@tanstack/react-query";
import type { ChatMessage, ClipRenderRequest, Job, Meeting, MeetingSummary, SearchResult } from "@server/types";

export type { ChatMessage, ClipRenderRequest, Job, Meeting, MeetingSummary, SearchResult };
export type Step = "audio" | "transcribe" | "enrich";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body && typeof init.body === "string" ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  meetings: () => request<MeetingSummary[]>("/api/meetings"),
  meeting: (id: string) => request<Meeting>(`/api/meetings/${enc(id)}`),
  search: (q: string) => request<SearchResult[]>(`/api/search?q=${enc(q)}`),
  update: (id: string, patch: { title?: string; notes?: string; tags?: string[] }) =>
    request<Meeting>(`/api/meetings/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => request<{ ok: true }>(`/api/meetings/${enc(id)}`, { method: "DELETE" }),
  replaceInTranscript: (id: string, find: string, replace: string) =>
    request<{ count: number }>(`/api/meetings/${enc(id)}/transcript/replace`, { method: "POST", body: JSON.stringify({ find, replace }) }),
  rerun: (id: string, body: { step: Step; language?: string; vocab?: string }) =>
    request<Job>(`/api/meetings/${enc(id)}/rerun`, { method: "POST", body: JSON.stringify(body) }),

  jobs: () => request<Job[]>("/api/jobs"),
  cancelJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${enc(id)}/cancel`, { method: "POST" }),

  render: (id: string, body: ClipRenderRequest) =>
    request<Job>(`/api/meetings/${enc(id)}/renders`, { method: "POST", body: JSON.stringify(body) }),
  deleteRender: (id: string, file: string) =>
    request<{ ok: true }>(`/api/meetings/${enc(id)}/renders/${enc(file)}`, { method: "DELETE" }),

  chat: (id: string) => request<ChatMessage[]>(`/api/meetings/${enc(id)}/chat`),
  clearChat: (id: string) => request<{ ok: true }>(`/api/meetings/${enc(id)}/chat`, { method: "DELETE" }),
  /** Streams the assistant reply; calls onChunk with each text delta. */
  async ask(id: string, message: string, onChunk: (text: string) => void, signal?: AbortSignal) {
    const res = await fetch(`/api/meetings/${enc(id)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Ask failed (${res.status})`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (let r = await reader.read(); !r.done; r = await reader.read()) onChunk(dec.decode(r.value, { stream: true }));
  },
};

export type UploadOptions = { title?: string; language?: string; vocab?: string; compress?: boolean };

/** Streams the raw file to the server (no multipart buffering), reporting progress 0..1. */
export function uploadFile(file: File, opts: UploadOptions, onProgress: (p: number) => void): Promise<Job> {
  const params = new URLSearchParams({ filename: file.name });
  if (opts.title) params.set("title", opts.title);
  if (opts.language) params.set("language", opts.language);
  if (opts.vocab) params.set("vocab", opts.vocab);
  if (opts.compress) params.set("compress", "1");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/upload?${params}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "{}");
      xhr.status < 300 ? resolve(body) : reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: the server is not reachable"));
    xhr.send(file);
  });
}

export const qk = {
  meetings: ["meetings"] as const,
  meeting: (id: string) => ["meeting", id] as const,
  jobs: ["jobs"] as const,
  chat: (id: string) => ["chat", id] as const,
  search: (q: string) => ["search", q] as const,
};

export const meetingsQuery = queryOptions({ queryKey: qk.meetings, queryFn: api.meetings });
export const meetingQuery = (id: string) => queryOptions({ queryKey: qk.meeting(id), queryFn: () => api.meeting(id) });
export const jobsQuery = queryOptions({ queryKey: qk.jobs, queryFn: api.jobs });
