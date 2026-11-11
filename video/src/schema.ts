import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const FPS = 30;
export const INTRO_SECONDS = 2.5;
export const CARD_SECONDS = 1.6;

export const FORMATS = {
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1920 },
} as const;

const word = z.tuple([z.number(), z.number(), z.string()]); // [start, end, word]

export const segmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(word).optional(),
});

export const clipSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  label: z.string().optional(),
});

export const meetingClipSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  /** Absolute or root-relative URL of the meeting's video or audio. */
  mediaUrl: z.string(),
  isVideo: z.boolean(),
  clips: z.array(clipSchema).min(1),
  /** Transcript segments (absolute meeting times). Only those overlapping the clips are used. */
  segments: z.array(segmentSchema),
  format: z.enum(["landscape", "square", "vertical"]),
  captionStyle: z.enum(["bold", "minimal", "karaoke"]),
  /** Show an intro title card and a label card before each clip (highlight reels). */
  titleCards: z.boolean(),
  accent: zColor(),
});

export type MeetingClipProps = z.infer<typeof meetingClipSchema>;
export type ClipRange = z.infer<typeof clipSchema>;
export type SegmentInput = z.infer<typeof segmentSchema>;

export const clipSeconds = (c: ClipRange) => Math.max(0.5, c.end - c.start);

export function totalFrames(p: Pick<MeetingClipProps, "clips" | "titleCards">) {
  const intro = p.titleCards ? INTRO_SECONDS : 0;
  const cards = p.titleCards ? CARD_SECONDS * p.clips.length : 0;
  const body = p.clips.reduce((n, c) => n + clipSeconds(c), 0);
  return Math.max(1, Math.round((intro + cards + body) * FPS));
}
