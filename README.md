# Meeting processor

Drop in a meeting recording (video or audio). You get a compressed copy, a word-timed transcript, Claude-written notes with decisions and action items, a chat to ask questions about the meeting, and captioned clips rendered with Remotion. Everything runs on your Mac.

## Run it

```sh
bun install
bun dev            # API on :4321, web app on http://localhost:5173
```

The first transcription downloads the Whisper model (about 1.6 GB). The first clip render downloads a headless Chrome for Remotion.

`bun run start` builds the web app and serves everything from http://localhost:4321.

### Requirements

- Apple Silicon Mac (transcription uses [mlx-whisper](https://github.com/ml-explore/mlx-examples) on the GPU)
- `ffmpeg`, [`uv`](https://docs.astral.sh/uv/), [`bun`](https://bun.sh)
- [Claude Code](https://claude.com/claude-code) signed in. Notes and Ask call `claude -p` and use your existing login.

## What the app does

| Where | What you can do |
| --- | --- |
| **Library** | Drop files anywhere to upload. Search everything that was said across all meetings, with links to the exact moment. |
| **Timeline** | See the meeting at a glance: speech density, plus colored markers for decisions, action items and open questions. Click to seek. Shift-drag to select a clip. |
| **Notes** | Rendered notes with clickable timestamps. Copy as rich text (for Docs, Slack or email) or as Markdown, edit them in place, or have Claude rewrite them. |
| **Transcript** | The current sentence and word are highlighted during playback. Find within the transcript, shift-click to select a range, then copy it, make a clip from it, or ask about it. Fix misheard names everywhere at once. Export as .txt, .srt or .vtt. |
| **Clips** | Captioned clips or highlight reels (several moments with title cards), in 16:9, 1:1 or 9:16, with three caption styles. Live Remotion preview, rendered to MP4 on your Mac. |
| **Ask** | A multi-turn chat with Claude about the meeting. Answers cite timestamps you can click. |

## Command line

The web app is a front end for `mp.py`, which you can also run on its own:

```sh
./mp.py                                  # process everything in inbox/
./mp.py call.mp4 --title "Weekly sync" --language pt --vocab "Jumpad, Ana"
./mp.py meetings/<id> --force enrich     # re-run one step
./mp.py --help
```

## Layout

```
mp.py               pipeline: ingest → audio → transcribe (mlx-whisper) → enrich (claude -p)
prompts/enrich.md   the notes prompt (edit it to change the notes format)
server/             Bun + Hono API: job queue (SQLite), SSE events, search, chat, Remotion renders
web/                Vite + React + TanStack Router/Query + Tailwind + shadcn/ui
video/              Remotion compositions (CaptionedClip, Highlights); `bun run studio` to tweak them
meetings/<date>-<slug>/
  meta.json  transcript.json  transcript.md  transcript.srt  notes.md   ← committed
  media/  renders/                                                     ← gitignored
```

Files in `meetings/` are the source of truth. The app's SQLite database in `.data/` holds only the job queue and chat history.

## Licensing note

Remotion is free for individuals and companies of up to three people. Larger companies need a [company license](https://remotion.dev/license).
