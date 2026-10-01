import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
  src: string;
  /** Scale at the first / last frame of the enclosing Sequence (slow push-in by default). */
  zoom?: [number, number];
  /** Drift in % of frame size, [x0, y0] -> [x1, y1]. */
  pan?: [number, number, number, number];
  /** Gaussian blur in px (used behind cards). */
  blur?: number;
  /** Frames over which zoom runs; defaults to the Sequence duration. */
  duration?: number;
  objectPosition?: string;
};

/**
 * Full-bleed photo with a slow, linear Ken Burns move. Linear on purpose: eased zooms read
 * as "effects", a constant drift reads as camera.
 */
export const Photo: React.FC<Props> = ({
  src,
  zoom = [1.02, 1.12],
  pan = [0, 0, 0, 0],
  blur = 0,
  duration,
  objectPosition = "50% 50%",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = duration ?? durationInFrames;
  const t = interpolate(frame, [0, Math.max(1, d)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = zoom[0] + (zoom[1] - zoom[0]) * t;
  const x = pan[0] + (pan[2] - pan[0]) * t;
  const y = pan[1] + (pan[3] - pan[1]) * t;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#111" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition,
          transform: `translate(${x}%, ${y}%) scale(${scale})`,
          filter: blur > 0 ? `blur(${blur}px) saturate(0.9)` : undefined,
          willChange: "transform",
        }}
      />
    </AbsoluteFill>
  );
};
