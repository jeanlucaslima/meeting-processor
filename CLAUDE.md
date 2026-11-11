# CLAUDE.md

Local meeting processor: recordings → transcript (mlx-whisper) → notes (`claude -p`) → web app with search, chat and Remotion clips. See README.md for the feature list.

## Commands

- `bun dev`: API (:4321, `bun --watch`) + Vite (:5173, proxies `/api` and `/media`)
- `bun run typecheck`: server, web and video
- `./mp.py --help`: the processing pipeline (a uv script with inline deps, Python 3.11–3.13)
- `bun run studio`: Remotion Studio for `video/`

## Architecture

- **`mp.py` is the engine.** The server runs it as a subprocess with `MP_EVENTS=1`, which makes it print `@@{json}` progress lines (`{meeting}`, `{step, progress}`). Each step is skipped when its output exists, unless `--force <step>`.
- **The files in `meetings/<id>/` are the source of truth.** The server reads them on every request. `transcript.json` holds one segment per line with `words: [start, end, word]`, and words keep Whisper's leading space. `transcript.md` has one `[HH:MM:SS]` line per sentence, and notes and chat cite those timestamps. Keep `server/src/meetings.ts#writeDerivedTranscripts` in sync with `mp.py`'s writer.
- **The server** (`server/src`) is Hono on Bun. `jobs.ts` is a SQLite-backed queue that runs one job at a time, because the GPU and CPU are the bottleneck. Running jobs are re-queued on restart and resume from the meeting folder. `events.ts` drives SSE on `/api/events`. `chat.ts` runs `claude -p --resume <session>` per meeting with cwd set to the meeting dir. `render.ts` bundles `video/` and calls `renderMedia`.
- **Web** (`web/src`): routes live in `routes/` (TanStack file routing; `routeTree.gen.ts` is generated). `lib/player.ts` is the single media-element store that the timeline, transcript, notes and chat all seek through. Only one `<MediaPlayer>` may be mounted. `lib/events.ts` keeps the React Query cache live from SSE.
- **Video** (`video/src`): `MeetingClip` is used by both the browser preview (`@remotion/player`) and the server render. Props are defined in `schema.ts`, so keep preview and render props identical.
- Shared API types live in `server/src/types.ts`. Web imports them type-only through `@server/*`. Never import server runtime code into web.

## Conventions

- UI copy is sentence case and plain verbs, and actions keep the same name everywhere ("Rewrite notes" → toast "Writing new notes").
- Design tokens are defined in `web/src/index.css`: cool paper/ink, indigo `--playhead`, and semantic `--decision`/`--action`/`--question`. Instrument Sans is the UI font and Source Serif 4 is for reading text (`.prose-read`).
- Media is never committed. Transcripts and notes are.
