import { loadFont } from "@remotion/google-fonts/Inter";
import { Fragment, useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fmtTime, pageAt, paginate, wordsInClip } from "./captions";
import { CARD_SECONDS, FPS, INTRO_SECONDS, clipSeconds, type ClipRange, type MeetingClipProps } from "./schema";

const { fontFamily } = loadFont("normal", { weights: ["500", "700", "800"], subsets: ["latin", "latin-ext"] });

export const MeetingClip: React.FC<MeetingClipProps> = (props) => {
  const { clips, titleCards } = props;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0d", fontFamily, color: "white" }}>
      <Series>
        {titleCards ? (
          <Series.Sequence durationInFrames={Math.round(INTRO_SECONDS * FPS)} name="Intro">
            <TitleCard title={props.title} subtitle={props.subtitle} accent={props.accent} count={clips.length} />
          </Series.Sequence>
        ) : null}
        {clips.map((clip, i) => (
          <Fragment key={i}>
            {titleCards ? (
              <Series.Sequence durationInFrames={Math.round(CARD_SECONDS * FPS)} name={`Card ${i + 1}`}>
                <LabelCard index={i + 1} total={clips.length} label={clip.label} at={clip.start} accent={props.accent} />
              </Series.Sequence>
            ) : null}
            <Series.Sequence durationInFrames={Math.round(clipSeconds(clip) * FPS)} name={`Clip ${i + 1}`}>
              <ClipScene {...props} clip={clip} />
            </Series.Sequence>
          </Fragment>
        ))}
      </Series>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- scenes

const ClipScene: React.FC<MeetingClipProps & { clip: ClipRange }> = ({
  clip, mediaUrl, isVideo, segments, captionStyle, accent, title, format,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const t = frame / fps;
  const scale = width / 1080;
  const trim = { trimBefore: Math.round(clip.start * fps), trimAfter: Math.round(clip.end * fps) };
  const fade = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {isVideo ? (
        <AbsoluteFill style={{ justifyContent: format === "vertical" ? "flex-start" : "center", paddingTop: format === "vertical" ? 260 * scale : 0 }}>
          <OffthreadVideo src={mediaUrl} {...trim} style={{ width: "100%", height: format === "landscape" ? "100%" : "auto", objectFit: "contain" }} />
        </AbsoluteFill>
      ) : (
        <>
          <Audio src={mediaUrl} {...trim} />
          <AudioBackdrop accent={accent} />
        </>
      )}

      <AbsoluteFill style={{ padding: 48 * scale, justifyContent: "flex-start" }}>
        <div style={{ display: "flex", gap: 14 * scale, alignItems: "center", fontSize: 26 * scale, fontWeight: 600, textShadow: "0 2px 8px rgba(0,0,0,.6)" }}>
          <span style={{ width: 12 * scale, height: 12 * scale, borderRadius: 99, background: accent }} />
          <span style={{ opacity: 0.95 }}>{title}</span>
          <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{fmtTime(clip.start + t)}</span>
        </div>
      </AbsoluteFill>

      <Captions segments={segments} clip={clip} t={t} style={captionStyle} accent={accent} scale={scale} format={format} isVideo={isVideo} />

      <div style={{ position: "absolute", left: 0, bottom: 0, height: 6 * scale, width: `${(frame / durationInFrames) * 100}%`, background: accent }} />
    </AbsoluteFill>
  );
};

const Captions: React.FC<{
  segments: MeetingClipProps["segments"]; clip: ClipRange; t: number; style: MeetingClipProps["captionStyle"];
  accent: string; scale: number; format: MeetingClipProps["format"]; isVideo: boolean;
}> = ({ segments, clip, t, style, accent, scale, format, isVideo }) => {
  const pages = useMemo(
    () => paginate(wordsInClip(segments, clip), style === "minimal" ? 12 : format === "landscape" ? 7 : 5),
    [segments, clip, style, format],
  );
  const page = pageAt(pages, t);
  if (!page) return null;

  const bottom = format === "vertical" ? (isVideo ? 520 : 760) * scale : 110 * scale;
  const base: React.CSSProperties = {
    position: "absolute", left: 60 * scale, right: 60 * scale, bottom,
    display: "flex", flexWrap: "wrap", justifyContent: "center", textAlign: "center",
  };

  if (style === "minimal") {
    return (
      <div style={base}>
        <span style={{ background: "rgba(0,0,0,.72)", padding: `${10 * scale}px ${18 * scale}px`, borderRadius: 10 * scale, fontSize: 38 * scale, fontWeight: 500, lineHeight: 1.35 }}>
          {page.words.map((w) => w.text).join(" ")}
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...base, gap: `${4 * scale}px ${16 * scale}px` }}>
      {page.words.map((w, i) => {
        const active = t >= w.start && t < w.end + 0.05;
        const spoken = t >= w.start;
        const pop = spring({ frame: Math.max(0, (t - w.start) * FPS), fps: FPS, config: { damping: 14, mass: 0.5 }, durationInFrames: 8 });
        const color = style === "karaoke" ? (spoken ? "white" : "rgba(255,255,255,.38)") : active ? accent : "white";
        return (
          <span
            key={i}
            style={{
              fontSize: (format === "landscape" ? 64 : 70) * scale,
              fontWeight: 800,
              lineHeight: 1.15,
              color,
              textTransform: style === "bold" ? "uppercase" : "none",
              WebkitTextStroke: style === "bold" ? `${6 * scale}px black` : undefined,
              paintOrder: "stroke fill",
              textShadow: "0 4px 18px rgba(0,0,0,.55)",
              transform: style === "bold" && active ? `scale(${1 + 0.08 * pop})` : undefined,
              display: "inline-block",
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

const AudioBackdrop: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const bars = 48;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 0%, ${accent}33, #0b0b0d 60%)` }}>
      <div style={{ position: "absolute", top: height * 0.32, left: 0, right: 0, height: height * 0.18, display: "flex", alignItems: "center", justifyContent: "center", gap: width / 220 }}>
        {Array.from({ length: bars }, (_, i) => {
          // decorative, deterministic motion (no audio analysis needed, so long files stay cheap)
          const h = 0.25 + 0.75 * Math.abs(Math.sin(frame / 7 + i * 0.55) * Math.cos(frame / 13 + i * 0.21));
          return <div key={i} style={{ width: width / 120, height: `${h * 100}%`, borderRadius: 99, background: accent, opacity: 0.35 + 0.5 * h }} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ title: string; subtitle?: string; accent: string; count: number }> = ({ title, subtitle, accent, count }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const s = width / 1080;
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: 90 * s, opacity: out, background: `linear-gradient(160deg, ${accent}40, #0b0b0d 55%)` }}>
      <div style={{ transform: `translateY(${(1 - enter) * 40}px)`, opacity: enter }}>
        <div style={{ fontSize: 30 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: accent, fontWeight: 700 }}>
          Highlights · {count} moment{count === 1 ? "" : "s"}
        </div>
        <div style={{ fontSize: 96 * s, fontWeight: 800, lineHeight: 1.05, marginTop: 20 * s }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 36 * s, opacity: 0.7, marginTop: 24 * s }}>{subtitle}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const LabelCard: React.FC<{ index: number; total: number; label?: string; at: number; accent: string }> = ({ index, total, label, at, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const s = width / 1080;
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const bar = interpolate(frame, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: 90 * s }}>
      <div style={{ opacity: enter, transform: `translateX(${(1 - enter) * -30}px)` }}>
        <div style={{ fontSize: 28 * s, color: accent, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")} · {fmtTime(at)}
        </div>
        <div style={{ fontSize: 64 * s, fontWeight: 800, lineHeight: 1.1, marginTop: 16 * s, maxWidth: 1600 * s }}>{label || `Moment ${index}`}</div>
        <div style={{ height: 6 * s, width: `${bar * 100}%`, maxWidth: 600 * s, background: accent, marginTop: 36 * s, borderRadius: 99 }} />
      </div>
    </AbsoluteFill>
  );
};
