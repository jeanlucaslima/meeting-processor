import { Link } from "@tanstack/react-router";
import { Moon, Sun, Upload } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { JobsButton } from "./jobs";
import { useUpload } from "./upload";

export function AppHeader() {
  const { pickFiles } = useUpload();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-paper px-4 sm:px-6">
      <Link to="/" className="flex items-center gap-2.5 rounded-md text-[15px] font-semibold tracking-tight">
        <Wordmark />
        <span className="hidden sm:inline">Meetings</span>
      </Link>
      <div className="flex-1" />
      <JobsButton />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme</TooltipContent>
      </Tooltip>
      <Button onClick={pickFiles} aria-label="Upload recording">
        <Upload /> <span className="hidden sm:inline">Upload recording</span>
      </Button>
    </header>
  );
}

/** A miniature timeline: speech bars with a playhead, the app's core idea. */
function Wordmark() {
  const bars = [5, 9, 6, 12, 8, 4, 10, 7];
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden className="text-foreground">
      {bars.map((h, i) => (
        <rect key={i} x={i * 3.2} y={(18 - h) / 2} width="2" height={h} rx="1" fill="currentColor" opacity={i < 5 ? 1 : 0.35} />
      ))}
      <rect x="15.4" y="0" width="1.6" height="18" rx="0.8" fill="var(--playhead)" />
    </svg>
  );
}
