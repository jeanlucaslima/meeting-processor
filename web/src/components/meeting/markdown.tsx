import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkifyTimestamps } from "@/lib/notes";
import { player } from "@/lib/player";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Markdown with `[00:12:30]` timestamps rendered as buttons that seek the player. */
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-read", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: kids, ...rest }) => {
            const t = href?.match(/^#t=(\d+(?:\.\d+)?)$/);
            if (t) return <TimeLink seconds={Number(t[1])} />;
            return <a href={href} target="_blank" rel="noreferrer" className="text-playhead underline underline-offset-2" {...rest}>{kids}</a>;
          },
        }}
      >
        {linkifyTimestamps(children)}
      </ReactMarkdown>
    </div>
  );
});

export function TimeLink({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => player.seek(seconds)}
      title={`Play from ${clock(seconds)}`}
      className={cn(
        "tabular mx-0.5 inline-flex translate-y-[-1px] items-center rounded-full bg-accent px-1.5 align-middle font-sans text-[0.75rem] leading-5 font-medium text-accent-foreground hover:bg-playhead hover:text-white",
        className,
      )}
    >
      {clock(seconds)}
    </button>
  );
}
