import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, FONT_BODY } from "../theme";

/** Gradient scrim so white type stays legible on busy foliage. */
export const Scrim: React.FC<{ side: "top" | "bottom"; size: number; strength?: number }> = ({
  side,
  size,
  strength = 0.62,
}) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(${side === "top" ? "180deg" : "0deg"}, rgba(12,14,8,${strength}) 0%, rgba(12,14,8,${
        strength * 0.55
      }) ${size * 45}%, rgba(12,14,8,0) ${size * 100}%)`,
    }}
  />
);

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.32) 100%)" }}
  />
);

const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.2'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

/** Subtle animated film grain: one tiny tile, shifted every frame (cheap to render). */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  const x = Math.floor(random(`gx${frame}`) * 240);
  const y = Math.floor(random(`gy${frame}`) * 240);
  return (
    <AbsoluteFill
      style={{ backgroundImage: NOISE, backgroundPosition: `${x}px ${y}px`, opacity, mixBlendMode: "overlay", pointerEvents: "none" }}
    />
  );
};

/** Fades/lifts children in at the start of the Sequence and fades them out at its end. */
export const InOut: React.FC<{
  children: React.ReactNode;
  inFrames?: number;
  outFrames?: number;
  lift?: number;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, inFrames = 12, outFrames = 8, lift = 24, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fin = interpolate(frame - delay, [0, inFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const fout = outFrames
    ? interpolate(frame, [durationInFrames - outFrames, durationInFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  return (
    <AbsoluteFill style={{ opacity: fin * fout, transform: `translateY(${(1 - fin) * lift}px)`, ...style }}>
      {children}
    </AbsoluteFill>
  );
};

/** Block-level rise + fade in (for content inside a positioned container). */
export const Rise: React.FC<{ children: React.ReactNode; delay?: number; frames?: number; lift?: number; style?: React.CSSProperties }> = ({
  children,
  delay = 0,
  frames = 16,
  lift = 28,
  style,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  return <div style={{ opacity: t, transform: `translateY(${(1 - t) * lift}px)`, ...style }}>{children}</div>;
};

/** Small uppercase stage label ("Before", "Week 2", "Finished"). */
export const Chip: React.FC<{ label: string; size: number; dot?: string }> = ({ label, size, dot }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: size * 0.5,
      padding: `${size * 0.45}px ${size * 0.8}px`,
      borderRadius: 999,
      background: "rgba(16,18,10,0.62)",
      border: "1px solid rgba(255,255,255,0.28)",
      color: "#fff",
      fontFamily: FONT_BODY,
      fontSize: size,
      fontWeight: 800,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      lineHeight: 1,
    }}
  >
    {dot ? <span style={{ width: size * 0.45, height: size * 0.45, borderRadius: 99, background: dot }} /> : null}
    {label}
  </div>
);
