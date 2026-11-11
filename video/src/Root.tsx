import { Composition, type CalculateMetadataFunction } from "remotion";
import { MeetingClip } from "./MeetingClip";
import { FORMATS, FPS, meetingClipSchema, totalFrames, type MeetingClipProps } from "./schema";

const calculateMetadata: CalculateMetadataFunction<MeetingClipProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
  ...FORMATS[props.format],
});

// Sample props for Remotion Studio (`bun run studio`). Real renders pass inputProps from the server.
const sample: MeetingClipProps = {
  title: "Weekly Sync",
  subtitle: "Nov 10, 2026",
  mediaUrl: "https://remotion.media/video.mp4",
  isVideo: true,
  clips: [{ start: 0, end: 6, label: "Billing migration status" }],
  segments: [
    { start: 0, end: 3, text: "The migration is about eighty percent done." },
    { start: 3, end: 6, text: "We decided to move the cutover to next Friday." },
  ],
  format: "landscape",
  captionStyle: "bold",
  titleCards: false,
  accent: "#7c9cff",
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="CaptionedClip"
      component={MeetingClip}
      schema={meetingClipSchema}
      defaultProps={sample}
      calculateMetadata={calculateMetadata}
      fps={FPS}
      durationInFrames={180}
      width={1920}
      height={1080}
    />
    <Composition
      id="Highlights"
      component={MeetingClip}
      schema={meetingClipSchema}
      defaultProps={{ ...sample, titleCards: true, clips: [{ start: 0, end: 3, label: "Status" }, { start: 3, end: 6, label: "Decision: cutover next Friday" }] }}
      calculateMetadata={calculateMetadata}
      fps={FPS}
      durationInFrames={180}
      width={1920}
      height={1080}
    />
  </>
);
