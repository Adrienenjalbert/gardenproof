import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Brand } from "../schema";
import { EASE_OUT, FONT_BODY, FONT_DISPLAY, TEXT_SHADOW, type Layout } from "../theme";
import { InOut, Rise, Scrim } from "./Overlays";
import { WordReveal } from "./WordReveal";

/** The hook: big slab-serif words at the top of the safe zone, first word on screen by frame 2. */
export const Hook: React.FC<{ text: string; layout: Layout; brand: Brand; start?: number }> = ({
  text,
  layout,
  brand,
  start = 2,
}) => {
  const L = layout;
  const tall = L.height > L.width;
  const maxWidth = L.width > L.height ? L.width * 0.62 : L.measure;
  // Shrink (within limits) so the longest sentence fits on one line: ~0.56em per Arvo Bold glyph.
  const longest = Math.max(...text.split(/(?<=[.!?])\s+/).map((x) => x.length));
  const size = Math.round(Math.min(L.type.hook, Math.max(L.type.hook * 0.74, maxWidth / (longest * 0.56))));
  return (
    <InOut inFrames={1} lift={0}>
      <Scrim side="top" size={tall ? 0.42 : 0.6} />
      <AbsoluteFill
        style={{
          paddingTop: L.safe.top,
          paddingLeft: L.safe.left,
          paddingRight: L.safe.right,
        }}
      >
        <WordReveal
          text={text}
          start={start}
          stagger={4}
          color={brand.text}
          highlight={brand.accent}
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 1.08,
            letterSpacing: "-0.01em",
            maxWidth,
            textShadow: TEXT_SHADOW,
            textWrap: "balance",
          }}
        />
      </AbsoluteFill>
    </InOut>
  );
};

/** Short accent rule that draws in from the left. */
const Rule: React.FC<{ color: string; width: number; delay: number }> = ({ color, width, delay }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  return <div style={{ width: width * t, height: 4, background: color, borderRadius: 2 }} />;
};

/**
 * Service + area lower third, sitting on the bottom edge of the safe zone.
 * `extra` (e.g. a duration pill) renders under the area line.
 */
export const LowerThird: React.FC<{
  service: string;
  area: string | null;
  layout: Layout;
  brand: Brand;
  extra?: React.ReactNode;
}> = ({ service, area, layout, brand, extra }) => {
  const L = layout;
  const tall = L.height > L.width;
  return (
    <InOut inFrames={1} lift={0}>
      <Scrim side="bottom" size={tall ? 0.55 : 0.65} strength={0.7} />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          paddingBottom: L.safe.bottom,
          paddingLeft: L.safe.left,
          paddingRight: L.safe.right,
        }}
      >
        <Rise>
          <div style={{ display: "flex", flexDirection: "column", gap: L.type.area * 0.55 }}>
            <Rule color={brand.accent} width={L.type.service * 1.1} delay={2} />
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: L.type.service,
                lineHeight: 1.1,
                color: brand.text,
                maxWidth: L.measure,
                textShadow: TEXT_SHADOW,
                textWrap: "balance",
              }}
            >
              {service}
            </div>
            {area ? (
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontWeight: 700,
                  fontSize: L.type.area,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.88)",
                  textShadow: TEXT_SHADOW,
                }}
              >
                {area}
              </div>
            ) : null}
            {extra}
          </div>
        </Rise>
      </AbsoluteFill>
    </InOut>
  );
};
