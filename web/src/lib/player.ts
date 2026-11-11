// A tiny external store for the meeting's media element, so the timeline, transcript,
// notes and chat can all read the playhead and seek without prop drilling.
import { useSyncExternalStore } from "react";

type State = { time: number; duration: number; playing: boolean; rate: number };

let el: HTMLMediaElement | null = null;
let state: State = { time: 0, duration: 0, playing: false, rate: 1 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

const handlers: Record<string, () => void> = {
  timeupdate: () => el && set({ time: el.currentTime }),
  seeked: () => el && set({ time: el.currentTime }),
  loadedmetadata: () => el && set({ duration: el.duration || 0 }),
  durationchange: () => el && set({ duration: el.duration || 0 }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  ratechange: () => el && set({ rate: el.playbackRate }),
};

export const player = {
  attach(media: HTMLMediaElement | null) {
    if (el) for (const [k, f] of Object.entries(handlers)) el.removeEventListener(k, f);
    el = media;
    state = { time: 0, duration: media?.duration || 0, playing: false, rate: media?.playbackRate ?? 1 };
    if (el) for (const [k, f] of Object.entries(handlers)) el.addEventListener(k, f);
    emit();
  },
  seek(sec: number, play = true) {
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    set({ time: el.currentTime });
    if (play) el.play().catch(() => {});
  },
  nudge(delta: number) { if (el) player.seek(el.currentTime + delta, !el.paused); },
  toggle() { if (el) (el.paused ? el.play().catch(() => {}) : el.pause()); },
  setRate(r: number) { if (el) el.playbackRate = r; },
  get: () => state,
};

export function usePlayer<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => select(state),
  );
}
