import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { EASE_IN_OUT, FONT_BODY } from "../theme";

/**
 * Before → after slider. `children` is the AFTER layer, revealed left-to-right behind a white
 * divider with a handle; after `duration` frames the after layer is fully visible and the
 * divider leaves the frame.
 */
export const Wipe: React.FC<{ duration: number; labelSize: number; children: React.ReactNode }> = ({
  duration,
  labelSize,
  children,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const pct = p * 100;
  const handle = labelSize * 3;
  const label: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    fontFamily: FONT_BODY,
    fontWeight: 800,
    fontSize: labelSize,
    letterSpacing: "0.18em",
    color: "#fff",
    textShadow: "0 2px 12px rgba(0,0,0,0.5)",
  };
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>{children}</AbsoluteFill>
      {p < 1 ? (
        <AbsoluteFill style={{ left: `${pct}%`, width: 0 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: -2,
              width: 4,
              background: "#fff",
              boxShadow: "0 0 24px rgba(0,0,0,0.45)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: -handle / 2,
              width: handle,
              height: handle,
              marginTop: -handle / 2,
              borderRadius: 999,
              background: "#fff",
              boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#2F3222",
              fontSize: labelSize * 1.3,
              fontWeight: 800,
              fontFamily: FONT_BODY,
            }}
          >
            ‹ ›
          </div>
          <div style={{ ...label, right: handle / 2 + labelSize }}>AFTER</div>
          <div style={{ ...label, left: handle / 2 + labelSize }}>BEFORE</div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
