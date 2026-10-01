import React from "react";
import { interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { EASE_OUT } from "../theme";

type Props = {
  text: string;
  /** Frame (relative to the Sequence) at which the first word starts. */
  start?: number;
  /** Frames between words. */
  stagger?: number;
  color: string;
  /** Each word lands in this colour then settles to `color` — Thorburn's karaoke highlight. */
  highlight: string;
  style?: React.CSSProperties;
};

/** Word-by-word entrance: rise + fade + highlight sweep. Layout is fixed from frame 0 (no reflow). */
export const WordReveal: React.FC<Props> = ({ text, start = 0, stagger = 4, color, highlight, style }) => {
  const frame = useCurrentFrame();
  // One line per sentence ("Same garden. / Three weeks apart.") reads better than balanced wrapping.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.split(/\s+/).filter(Boolean))
    .filter((w) => w.length > 0);
  let index = 0;
  return (
    <div style={style}>
      {sentences.map((words, si) => (
        <div key={si}>
          {words.map((w, wi) => {
            const f = frame - start - index++ * stagger;
            const inT = interpolate(f, [0, 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE_OUT,
            });
            const c = interpolateColors(Math.max(0, f), [4, 18], [highlight, color]);
            return (
              <React.Fragment key={wi}>
                <span style={{ display: "inline-block", opacity: inT, transform: `translateY(${(1 - inT) * 0.28}em)`, color: c }}>
                  {w}
                </span>
                {wi < words.length - 1 ? " " : null}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
};
