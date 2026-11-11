import type { ServerEvent } from "./types";

type Listener = (e: ServerEvent) => void;
const listeners = new Set<Listener>();

export const bus = {
  emit(e: ServerEvent) {
    for (const l of listeners) l(e);
  },
  on(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
