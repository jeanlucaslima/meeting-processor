/** 75 -> "1:15", 3725 -> "1:02:05" */
export function clock(sec: number | null | undefined): string {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Always HH:MM:SS, the format used in notes and copied transcripts. */
export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${hms(ms / 1000)},${String(ms % 1000).padStart(3, "0")}`;
}

/** "00:12:30" | "12:30" -> seconds */
export function parseClock(str: string): number {
  return str.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
}

/** Human duration: 3725 -> "1 h 2 min", 95 -> "2 min", 20 -> "20 s" */
export function duration(sec: number | null | undefined): string {
  const s = Math.round(sec ?? 0);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function dateLong(iso?: string): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function relative(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
