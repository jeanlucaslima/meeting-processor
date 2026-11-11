import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Meeting } from "@/lib/api";
import { player, usePlayer } from "@/lib/player";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

const RATES = [1, 1.25, 1.5, 1.75, 2];

export function MediaPlayer({ meeting, startAt }: { meeting: Meeting; startAt?: number }) {
  const src = meeting.media.video ?? meeting.media.audio;
  const isVideo = !!meeting.media.video;

  const ref = useCallback(
    (el: HTMLMediaElement | null) => {
      player.attach(el);
      if (el && startAt != null) {
        const go = () => player.seek(startAt, false);
        if (el.readyState >= 1) go();
        else el.addEventListener("loadedmetadata", go, { once: true });
      }
    },
    [startAt],
  );
  useEffect(() => () => player.attach(null), []);
  useKeyboardShortcuts();

  if (!src) {
    return (
      <div className="grid aspect-video place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
        The recording isn't on this machine, so playback is off.
        <br />Transcript and notes still work.
      </div>
    );
  }

  return (
    <div>
      {isVideo ? (
        <video ref={ref} src={src} controls preload="metadata" playsInline className="aspect-video w-full rounded-xl bg-black" />
      ) : (
        <>
          <audio ref={ref} src={src} preload="metadata" className="hidden" />
          <AudioDeck />
        </>
      )}
      <Transport />
    </div>
  );
}

/** Audio-only meetings get a large play surface instead of a thin native bar. */
function AudioDeck() {
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const dur = usePlayer((s) => s.duration);
  return (
    <button
      onClick={player.toggle}
      className="group flex w-full items-center gap-4 rounded-xl border bg-paper p-4 text-left hover:border-playhead/60"
      aria-label={playing ? "Pause" : "Play"}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-playhead text-white">
        {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </span>
      <span className="tabular text-2xl font-semibold">{clock(time)}</span>
      <span className="tabular text-muted-foreground">/ {clock(dur)}</span>
    </button>
  );
}

function Transport() {
  const rate = usePlayer((s) => s.rate);
  return (
    <div className="mt-2 flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={() => player.nudge(-10)} aria-label="Back 10 seconds"><RotateCcw /></Button>
        </TooltipTrigger>
        <TooltipContent>Back 10 s <Kbd>J</Kbd></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={() => player.nudge(10)} aria-label="Forward 10 seconds"><RotateCw /></Button>
        </TooltipTrigger>
        <TooltipContent>Forward 10 s <Kbd>L</Kbd></TooltipContent>
      </Tooltip>
      <div className="ml-auto flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Playback speed">
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => player.setRate(r)}
            aria-pressed={rate === r}
            className={cn("tabular rounded-md px-2 py-0.5 text-xs", rate === r ? "bg-paper font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1.5 rounded border border-current/30 px-1 text-[10px] opacity-80">{children}</kbd>;
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable],[role=slider],video,audio")) return;
      const map: Record<string, () => void> = {
        " ": player.toggle, k: player.toggle,
        j: () => player.nudge(-10), l: () => player.nudge(10),
        ArrowLeft: () => player.nudge(-5), ArrowRight: () => player.nudge(5),
      };
      const fn = map[e.key];
      if (fn && !(e.key === " " && t.closest("button,a"))) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
