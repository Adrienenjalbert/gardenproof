/**
 * House style: Arvo slab-serif display (matches Thorburn's existing ads), Nunito Sans body,
 * and per-ratio layout with platform safe zones for burned-in captions.
 */
import { Easing } from "remotion";
import { BODY_FAMILY, DISPLAY_FAMILY, loadBrandFonts } from "./fonts";
import type { Ratio } from "./schema";

loadBrandFonts();

export const FONT_DISPLAY = `"${DISPLAY_FAMILY}", "Rockwell", Georgia, serif`;
export const FONT_BODY = `"${BODY_FAMILY}", "Helvetica Neue", Arial, sans-serif`;

/** Premium motion: smooth deceleration, never bouncy. */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export type Layout = {
  width: number;
  height: number;
  /** Text-safe box (px from each edge). */
  safe: { top: number; bottom: number; left: number; right: number };
  /** Type scale in px. */
  type: { hook: number; service: number; area: number; label: number; quote: number; cta: number; small: number };
  /** Max width of a text block. */
  measure: number;
  logo: number;
};

/**
 * 9:16 keeps text out of the top 14% (profile / progress UI) and bottom 20% (caption, CTA button).
 * 1:1 and 16:9 use a comfortable title-safe margin.
 */
export function layoutFor(ratio: Ratio): Layout {
  if (ratio === "9:16") {
    return {
      width: 1080,
      height: 1920,
      safe: { top: Math.round(1920 * 0.14), bottom: Math.round(1920 * 0.2), left: 84, right: 84 },
      type: { hook: 112, service: 76, area: 34, label: 28, quote: 58, cta: 96, small: 34 },
      measure: 912,
      logo: 176,
    };
  }
  if (ratio === "1:1") {
    return {
      width: 1080,
      height: 1080,
      safe: { top: 84, bottom: 84, left: 84, right: 84 },
      type: { hook: 96, service: 64, area: 30, label: 24, quote: 48, cta: 80, small: 30 },
      measure: 900,
      logo: 150,
    };
  }
  return {
    width: 1920,
    height: 1080,
    safe: { top: 84, bottom: 84, left: 120, right: 120 },
    type: { hook: 104, service: 68, area: 30, label: 24, quote: 62, cta: 88, small: 30 },
    measure: 1100,
    logo: 150,
  };
}

/** rgba() from #RRGGBB. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const TEXT_SHADOW = "0 2px 18px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.35)";
