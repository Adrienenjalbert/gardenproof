import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import type { Brand } from "../schema";
import { EASE_IN_OUT, EASE_OUT, FONT_BODY, FONT_DISPLAY, alpha, type Layout } from "../theme";
import { Stars } from "./Stars";
import { WordReveal } from "./WordReveal";

/**
 * Olive end card in Thorburn's house style: white logo box top-left, big slab-serif CTA with
 * the word highlight, website, and the Which? line. Slides up over the last photo.
 */
export const EndCard: React.FC<{
  ctaText: string;
  website: string;
  logoSrc: string | null;
  whichRating: string | null;
  /** 16:9 only: the finished garden shown beside the olive panel. */
  photoSrc?: string | null;
  layout: Layout;
  brand: Brand;
}> = ({ ctaText, website, logoSrc, whichRating, photoSrc, layout: L, brand }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const fade = (delay: number) =>
    interpolate(frame - delay, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const tall = L.height > L.width;
  const wide = L.width > L.height;
  const split = wide && !!photoSrc;
  const panelWidth = split ? Math.round(L.width * 0.56) : L.width;
  const photoT = fade(6);
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - enter) * 100}% 0 0 0)` }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 20% 10%, ${brand.primary} 0%, ${brand.primary} 45%, ${brand.primaryDark} 100%)`,
        }}
      />
      {split && photoSrc ? (
        <AbsoluteFill style={{ left: panelWidth, width: L.width - panelWidth, overflow: "hidden" }}>
          <Img
            src={photoSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: photoT,
              transform: `scale(${1.08 - 0.05 * photoT})`,
            }}
          />
          <AbsoluteFill style={{ background: `linear-gradient(90deg, ${alpha(brand.primaryDark, 0.35)} 0%, rgba(0,0,0,0) 30%)` }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          width: panelWidth,
          padding: `${L.safe.top}px ${split ? L.safe.left * 0.8 : L.safe.right}px ${L.safe.bottom}px ${L.safe.left}px`,
        }}
      >
        {logoSrc ? (
          <div
            style={{
              width: L.logo,
              height: L.logo,
              background: "#fff",
              borderRadius: 6,
              padding: L.logo * 0.04,
              opacity: fade(8),
              boxShadow: `0 10px 30px ${alpha(brand.primaryDark, 0.5)}`,
            }}
          >
            <Img src={logoSrc} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        ) : (
          <div />
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: L.type.small * 0.9 }}>
          <WordReveal
            text={ctaText}
            start={12}
            stagger={4}
            color={brand.text}
            highlight={brand.accent}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: L.type.cta,
              lineHeight: 1.06,
              maxWidth: split ? panelWidth - L.safe.left * 2 : wide ? L.measure : L.measure * 0.95,
              textWrap: "balance",
            }}
          />
          <div
            style={{
              opacity: fade(22),
              display: "flex",
              alignItems: "center",
              gap: L.type.small * 0.6,
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: L.type.small * 1.15,
              letterSpacing: "0.02em",
              color: brand.text,
            }}
          >
            <span style={{ width: L.type.small * 1.6, height: 4, background: brand.accent, borderRadius: 2 }} />
            {website}
          </div>
          {whichRating !== null ? (
            <div
              style={{
                opacity: fade(26),
                marginTop: L.type.small * (tall ? 2.2 : 1.2),
                paddingTop: L.type.small * (tall ? 1.2 : 0.9),
                borderTop: "1px solid rgba(255,255,255,0.22)",
                display: "flex",
                alignItems: "center",
                gap: L.type.small * 0.6,
                fontFamily: FONT_DISPLAY,
                fontSize: L.type.small,
                color: "rgba(255,255,255,0.92)",
                maxWidth: L.measure * 0.8,
              }}
            >
              <Stars value={Number(whichRating)} size={L.type.small * 1.05} color={brand.accent} start={24} gap={4} stagger={1} />
              <span>{whichRating} · Which? Trusted Trader</span>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
