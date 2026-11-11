const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  // match on accent-folded text but slice the original so accents are preserved
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const t of terms.map(fold)) {
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + 1)) ranges.push([i, i + t.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    out.push(text.slice(pos, s), <mark key={s} className="rounded-sm bg-playhead/15 text-foreground">{text.slice(s, e)}</mark>);
    pos = e;
  }
  out.push(text.slice(pos));
  return <>{out}</>;
}
