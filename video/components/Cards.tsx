import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Brand } from "../schema";
import { EASE_OUT, FONT_BODY, FONT_DISPLAY, alpha, type Layout } from "../theme";
import { InOut, Rise } from "./Overlays";
import { Stars } from "./Stars";

const DOWNSCALE = 10;

/**
 * Frosted olive backdrop so cards never sit on a busy image. The blur is done on a 1/10-size copy
 * of the photo scaled back up: visually the same as a 20px blur at a fraction of the per-frame cost
 * (CSS blur / backdrop-filter on a full 1080×1920 frame dominated render time).
 */
const Frost: React.FC<{ src: string; brand: Brand; strength?: number }> = ({ src, brand, strength = 0.7 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const w = Math.ceil(width / DOWNSCALE);
  const h = Math.ceil(height / DOWNSCALE);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: w,
          height: h,
          marginLeft: -w / 2,
          marginTop: -h / 2,
          transform: `scale(${DOWNSCALE * (1.12 + frame * 0.0006)})`,
          filter: "blur(1.6px) saturate(0.85)",
        }}
      >
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${alpha(brand.primaryDark, strength)} 0%, ${alpha(brand.primary, strength * 0.85)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Centre: React.FC<{ layout: Layout; children: React.ReactNode; align?: "center" | "flex-start" }> = ({
  layout: L,
  children,
  align = "center",
}) => (
  <AbsoluteFill
    style={{
      padding: `${L.safe.top}px ${L.safe.right}px ${L.safe.bottom}px ${L.safe.left}px`,
      justifyContent: "center",
      alignItems: align,
      textAlign: align === "center" ? "center" : "left",
    }}
  >
    {children}
  </AbsoluteFill>
);

/** "4.9★ rating · Which? Trusted Trader" (+ homeowner rating when there is one). */
export const RatingCard: React.FC<{
  photoSrc: string;
  whichRating: string | null;
  rating: number | null;
  layout: Layout;
  brand: Brand;
}> = ({ photoSrc, whichRating, rating, layout: L, brand }) => {
  const star = L.type.hook * 0.62;
  const value = whichRating !== null ? Number(whichRating) : (rating ?? 0);
  return (
    <InOut inFrames={10} lift={0}>
      <Frost src={photoSrc} brand={brand} />
      <Centre layout={L}>
        <Rise style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Stars value={value} size={star} color={brand.accent} start={4} />
          <div
            style={{
              marginTop: star * 0.45,
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: L.type.cta,
              lineHeight: 1.05,
              color: brand.text,
            }}
          >
            {whichRating !== null ? `${whichRating} out of 5` : `Rated ${rating} out of 5`}
          </div>
          <div
            style={{
              marginTop: L.type.small * 0.4,
              fontFamily: FONT_DISPLAY,
              fontSize: L.type.service * 0.8,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            {whichRating !== null ? "Which? Trusted Trader" : "by the homeowner"}
          </div>
        </Rise>
      </Centre>
    </InOut>
  );
};

/**
 * Homeowner quote typed on character by character. The full text is laid out from the first
 * frame (untyped characters are transparent) so lines never re-wrap while typing.
 */
export const QuoteCard: React.FC<{
  photoSrc: string;
  quote: string;
  attribution: string | null;
  rating: number | null;
  typingFrames: number;
  layout: Layout;
  brand: Brand;
}> = ({ photoSrc, quote, attribution, rating, typingFrames, layout: L, brand }) => {
  const frame = useCurrentFrame();
  const typeStart = 10;
  const shown = Math.floor(
    interpolate(frame - typeStart, [0, typingFrames], [0, quote.length + 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  const done = frame - typeStart >= typingFrames;
  const attrT = interpolate(frame - typeStart - typingFrames, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  // Typographic quotes/apostrophes; hanging open-quote via negative indent.
  const text = `“${quote.replace(/'/g, "’")}”`;
  const size = quote.length > 150 ? L.type.quote * 0.86 : L.type.quote;
  const caretOn = !done || Math.floor(frame / 15) % 2 === 0;
  return (
    <InOut inFrames={10} lift={0}>
      <Frost src={photoSrc} brand={brand} strength={0.8} />
      <Centre layout={L} align={L.width > L.height ? "center" : "flex-start"}>
        <Rise lift={24} style={{ maxWidth: L.measure, textAlign: "left" }}>
          {rating !== null ? (
            <div style={{ display: "flex", alignItems: "center", gap: size * 0.4, marginBottom: size * 0.7 }}>
              <Stars value={rating} size={size * 0.8} color={brand.accent} start={2} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: L.type.label, letterSpacing: "0.16em", color: "rgba(255,255,255,0.85)" }}>
                {rating}/5
              </span>
            </div>
          ) : null}
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: "italic",
              fontSize: size,
              lineHeight: 1.3,
              color: brand.text,
              textIndent: "-0.42em",
            }}
          >
            <span>{text.slice(0, shown)}</span>
            <span
              style={{
                display: "inline-block",
                width: 3,
                height: size * 0.95,
                marginLeft: 2,
                marginRight: -5,
                verticalAlign: "-0.12em",
                background: caretOn && attrT < 1 ? brand.accent : "transparent",
              }}
            />
            <span style={{ color: "transparent" }}>{text.slice(shown)}</span>
          </div>
          {attribution ? (
            <div
              style={{
                marginTop: size * 0.9,
                display: "flex",
                alignItems: "center",
                gap: size * 0.4,
                opacity: attrT,
                transform: `translateY(${(1 - attrT) * 16}px)`,
                fontFamily: FONT_BODY,
                fontWeight: 700,
                fontSize: L.type.small,
                letterSpacing: "0.06em",
                color: "rgba(255,255,255,0.9)",
              }}
            >
              <span style={{ width: size * 0.8, height: 3, background: brand.accent, borderRadius: 2 }} />
              {attribution}
            </div>
          ) : null}
        </Rise>
      </Centre>
    </InOut>
  );
};
