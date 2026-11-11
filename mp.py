#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["mlx-whisper>=0.4"]
# ///
"""meeting-processor: turn meeting recordings into compressed audio, transcripts and notes.

Usage:
  ./mp.py                         process every media file in inbox/
  ./mp.py rec.mp4 --title "Sync"  process a specific file
  ./mp.py meetings/<id> --force enrich   re-run one step on an existing meeting

Pipeline per meeting (each step is skipped when its output exists, unless --force):
  ingest     -> media/original.<ext>   (moved from inbox; optionally re-encoded video)
  audio      -> media/audio.m4a        (mono 16 kHz AAC 32 kbps, ~14 MB/hour)
  transcribe -> transcript.json / .srt / .md   (mlx-whisper, local)
  enrich     -> notes.md               (claude -p with prompts/enrich.md)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INBOX = ROOT / "inbox"
MEETINGS = ROOT / "meetings"
ENRICH_PROMPT = ROOT / "prompts" / "enrich.md"

MEDIA_EXTS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
    ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".opus", ".flac", ".wma", ".amr",
}
DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo"
STEPS = ("audio", "transcribe", "enrich")


# ---------------------------------------------------------------- helpers

EVENTS = os.environ.get("MP_EVENTS") == "1"


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


def event(**data) -> None:
    """Machine-readable progress for the web server (enabled with MP_EVENTS=1)."""
    if EVENTS:
        print("@@" + json.dumps(data, ensure_ascii=False), flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:60] or "meeting"


def probe(path: Path) -> dict:
    out = run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def recorded_at(path: Path, info: dict) -> dt.datetime:
    tag = (info.get("format", {}).get("tags") or {}).get("creation_time")
    if tag:
        try:
            return dt.datetime.fromisoformat(tag.replace("Z", "+00:00")).astimezone()
        except ValueError:
            pass
    # Many recorders put the date in the filename, e.g. 2026-11-10 or 20261110
    m = re.search(r"(20\d\d)[-_.]?([01]\d)[-_.]?([0-3]\d)", path.stem)
    if m:
        try:
            return dt.datetime(int(m[1]), int(m[2]), int(m[3])).astimezone()
        except ValueError:
            pass
    return dt.datetime.fromtimestamp(path.stat().st_mtime).astimezone()


def has_video(info: dict) -> bool:
    return any(
        s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1
        for s in info.get("streams", [])
    )


def fmt_ts(seconds: float, srt: bool = False) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}" if srt else f"{h:02}:{m:02}:{s:02}"


def load_meta(mdir: Path) -> dict:
    p = mdir / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def save_meta(mdir: Path, meta: dict) -> None:
    (mdir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- steps

def ingest(src: Path, title: str | None, compress_video: bool, copy: bool) -> Path:
    info = probe(src)
    when = recorded_at(src, info)
    # drop a leading date from the file name ("2026-11-10 Weekly Sync" -> "Weekly Sync")
    title = title or re.sub(r"^\s*20\d\d[-_.]?[01]\d[-_.]?[0-3]\d[\s_-]*", "", src.stem) or src.stem
    mdir = MEETINGS / f"{when:%Y-%m-%d}-{slugify(title)}"
    n = 2
    while mdir.exists():
        mdir = MEETINGS / f"{when:%Y-%m-%d}-{slugify(title)}-{n}"
        n += 1
    media = mdir / "media"
    media.mkdir(parents=True)

    video = has_video(info)
    if video and compress_video:
        dest = media / "original.mp4"
        event(step="compress")
        log(f"compressing video -> {dest.relative_to(ROOT)}")
        run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-i", str(src),
            "-vf", "scale=-2:'min(720,ih)'", "-r", "15",
            "-c:v", "hevc_videotoolbox", "-q:v", "50", "-tag:v", "hvc1",
            "-c:a", "aac", "-b:a", "64k", "-ac", "1",
            "-movflags", "+faststart", str(dest),
        ])
        if not copy:
            src.unlink()
    else:
        dest = media / f"original{src.suffix.lower()}"
        (shutil.copy2 if copy else shutil.move)(src, dest)
        log(f"{'copied' if copy else 'moved'} -> {dest.relative_to(ROOT)}")

    save_meta(mdir, {
        "title": title,
        "source_file": src.name,
        "recorded_at": when.isoformat(timespec="seconds"),
        "duration_seconds": round(float(info.get("format", {}).get("duration", 0)), 1),
        "has_video": video,
        "original": dest.name,
    })
    return mdir


def step_audio(mdir: Path, force: bool) -> None:
    out = mdir / "media" / "audio.m4a"
    if out.exists() and not force:
        return
    original = mdir / "media" / load_meta(mdir)["original"]
    event(step="audio")
    log("extracting audio (mono 16 kHz, 32 kbps AAC)")
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(original),
        "-vn", "-ac", "1", "-ar", "16000",
        # light cleanup: drop rumble/hiss and even out quiet vs loud speakers
        "-af", "highpass=f=80,lowpass=f=8000,dynaudnorm",
        "-c:a", "aac", "-b:a", "32k", str(out),
    ])


def split_segment(seg: dict, max_words: int = 30) -> list[dict]:
    """Split long Whisper segments into sentence-sized pieces using word timestamps,
    so transcript lines and subtitles stay short and individually seekable."""
    words = seg["words"]
    if len(words) < 2:
        return [seg]
    pieces, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        sentence_end = re.search(r"[.?!…。？！]$", w[2].strip()) and len(cur) >= 4
        long_pause = nxt is not None and nxt[0] - w[1] > 1.0 and len(cur) >= 2
        if nxt is None or sentence_end or long_pause or len(cur) >= max_words:
            pieces.append({
                "start": cur[0][0], "end": cur[-1][1],
                "text": "".join(x[2] for x in cur).strip(), "words": cur,
            })
            cur = []
    return pieces


def step_transcribe(mdir: Path, force: bool, model: str, language: str | None, vocab: str | None) -> None:
    if (mdir / "transcript.json").exists() and not force:
        return
    import mlx_whisper  # heavy import, only when needed

    # the package re-exports the `transcribe` function under the module's name
    mwt = sys.modules["mlx_whisper.transcribe"]

    event(step="transcribe", progress=0)
    if EVENTS:
        # report transcription progress through whisper's own progress bar
        base = mwt.tqdm.tqdm

        class Progress(base):
            def update(self, n=1):
                super().update(n)
                if self.total:
                    event(step="transcribe", progress=round(self.n / self.total, 3))

        mwt.tqdm = type("tqdm_shim", (), {"tqdm": Progress})

    log(f"transcribing with {model.split('/')[-1]} (first run downloads the model)")
    result = mlx_whisper.transcribe(
        str(mdir / "media" / "audio.m4a"),
        path_or_hf_repo=model,
        language=language,
        initial_prompt=vocab,
        condition_on_previous_text=False,  # avoids repetition loops on long recordings
        word_timestamps=True,  # used for word-accurate captions and transcript highlighting
        verbose=False if EVENTS else None,
    )
    raw = [
        {
            "start": round(s["start"], 2),
            "end": round(s["end"], 2),
            "text": s["text"].strip(),
            # compact [start, end, word] triples; words keep Whisper's leading space so that
            # "".join(words) reproduces the text exactly (e.g. "80%", and languages without spaces)
            "words": [[round(w["start"], 2), round(w["end"], 2), w["word"]] for w in s.get("words", [])],
        }
        for s in result["segments"]
        if s["text"].strip()
    ]
    segments = [piece for seg in raw for piece in split_segment(seg)]
    # one segment per line: readable diffs without exploding the word arrays
    head = json.dumps({"language": result.get("language"), "model": model}, ensure_ascii=False)[:-1]
    lines = ",\n  ".join(json.dumps(seg, ensure_ascii=False) for seg in segments)
    (mdir / "transcript.json").write_text(f'{head}, "segments": [\n  {lines}\n]}}\n')

    srt = [f"{i}\n{fmt_ts(s['start'], True)} --> {fmt_ts(s['end'], True)}\n{s['text']}\n"
           for i, s in enumerate(segments, 1)]
    (mdir / "transcript.srt").write_text("\n".join(srt))

    meta = load_meta(mdir)
    meta["language"] = result.get("language")
    if vocab:
        meta["vocab"] = vocab  # reused by the notes step to fix spellings
    save_meta(mdir, meta)

    # Markdown: one timestamped line per sentence (so notes and answers can cite exact moments),
    # with a blank line between paragraphs (pauses > 2s or every ~60s)
    blocks: list[list[str]] = []
    last_end, para_start = -99.0, -99.0
    for s in segments:
        if not blocks or s["start"] - last_end > 2 or s["start"] - para_start > 60:
            blocks.append([])
            para_start = s["start"]
        blocks[-1].append(f"[{fmt_ts(s['start'])}] {s['text']}")
        last_end = s["end"]
    body = "\n\n".join("  \n".join(b) for b in blocks)
    (mdir / "transcript.md").write_text(
        f"# {meta['title']} — transcript\n\n"
        f"- Recorded: {meta['recorded_at']}\n"
        f"- Duration: {fmt_ts(meta['duration_seconds'])}\n"
        f"- Language: {meta['language']}\n\n{body}\n"
    )
    log(f"{len(segments)} segments, language={meta['language']}")


def step_enrich(mdir: Path, force: bool, claude_model: str | None) -> None:
    out = mdir / "notes.md"
    if out.exists() and not force:
        return
    if not shutil.which("claude"):
        log("skipping enrich: `claude` CLI not found")
        return
    meta = load_meta(mdir)
    prompt = ENRICH_PROMPT.read_text().format(
        title=meta["title"], recorded_at=meta["recorded_at"],
        duration=fmt_ts(meta["duration_seconds"]), language=meta.get("language") or "unknown",
    )
    if meta.get("vocab"):
        prompt += (f"\nCorrect spellings of names and terms that may appear (the transcript may misspell them): "
                   f"{meta['vocab']}\n")
    cmd = ["claude", "-p", prompt, "--tools", "", "--strict-mcp-config"]
    if claude_model:
        cmd += ["--model", claude_model]
    event(step="enrich")
    log("enriching with claude -p")
    notes = run(cmd, input=(mdir / "transcript.md").read_text(), capture_output=True, text=True).stdout
    out.write_text(notes.strip() + "\n")


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", type=Path, help="media files or meetings/<id> dirs (default: inbox/*)")
    ap.add_argument("--title", help="meeting title (default: file name); only with a single file")
    ap.add_argument("--language", help="force language code, e.g. pt or en (default: auto-detect)")
    ap.add_argument("--vocab", help="names/jargon to bias transcription, e.g. 'Jumpad, Kubernetes, Ana'")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"mlx-whisper model (default: {DEFAULT_MODEL})")
    ap.add_argument("--claude-model", help="model for enrichment (default: claude CLI default)")
    ap.add_argument("--compress-video", action="store_true", help="re-encode video to 720p HEVC instead of keeping original")
    ap.add_argument("--copy", action="store_true", help="copy files instead of moving them out of their location")
    ap.add_argument("--skip", nargs="+", choices=STEPS, default=[], help="steps to skip")
    ap.add_argument("--force", nargs="*", choices=STEPS, help="re-run these steps (no value = all)")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on PATH")

    inputs = args.inputs or sorted(p for p in INBOX.iterdir() if p.suffix.lower() in MEDIA_EXTS)
    if not inputs:
        print("Nothing to do: inbox/ is empty.")
        return 0
    if args.title and len(inputs) > 1:
        sys.exit("--title only works with a single input")
    force = set(STEPS) if args.force == [] else set(args.force or [])

    failed = []
    for inp in inputs:
        print(f"\n▶ {inp}")
        try:
            if inp.is_dir():
                mdir = inp.resolve()
            elif inp.suffix.lower() in MEDIA_EXTS:
                mdir = ingest(inp.resolve(), args.title, args.compress_video, args.copy)
            else:
                log("not a media file, skipping")
                continue
            event(meeting=mdir.name)
            if "audio" not in args.skip:
                step_audio(mdir, "audio" in force)
            if "transcribe" not in args.skip:
                step_transcribe(mdir, "transcribe" in force, args.model, args.language, args.vocab)
            if "enrich" not in args.skip:
                step_enrich(mdir, "enrich" in force, args.claude_model)
            print(f"✓ {mdir.relative_to(ROOT)}")
        except subprocess.CalledProcessError as e:
            print(f"✗ {inp}: {e.cmd[0]} failed ({e.returncode})\n{e.stderr or ''}", file=sys.stderr)
            failed.append(inp)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
