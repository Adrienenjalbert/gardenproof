/**
 * Brand tokens from Firecrawl's `branding` format, plus colours sampled from the homepage screenshot (the header
 * and footer backgrounds are often not in the branding palette: Thorburn's header is a pale sage, not white).
 */
import sharp, { type Sharp } from "sharp";
import type { FirecrawlBranding } from "./firecrawl";
import type { ShellTokens } from "./shell";
import type { BusinessProfile } from "./types";

type Rgb = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
export function normaliseHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const m = HEX_RE.exec(c.trim());
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return `#${h.toUpperCase()}`;
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  return rgb ? toHex([+rgb[1], +rgb[2], +rgb[3]]) : null;
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const fromHex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(fromHex(a)), luminance(fromHex(b))].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}
/** Readable text colour on a background: the preferred colour if it has ≥ 4.5:1 contrast, else white/near-black. */
export function readableOn(bg: string, preferred: string): string {
  if (contrast(bg, preferred) >= 4.5) return preferred;
  return contrast(bg, "#FFFFFF") >= contrast(bg, "#111111") ? "#FFFFFF" : "#111111";
}

/** Most common colour (quantised to 8 levels per channel) in a region of an image. */
async function dominantColour(img: Sharp, region: { left: number; top: number; width: number; height: number }): Promise<string | null> {
  if (region.width < 4 || region.height < 4) return null;
  const { data, info } = await img.clone().extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<number, { n: number; sum: Rgb }>();
  for (let i = 0; i < data.length; i += info.channels * 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = counts.get(key) ?? { n: 0, sum: [0, 0, 0] as Rgb };
    e.n++;
    e.sum[0] += r;
    e.sum[1] += g;
    e.sum[2] += b;
    counts.set(key, e);
  }
  let best: { n: number; sum: Rgb } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best ? toHex([best.sum[0] / best.n, best.sum[1] / best.n, best.sum[2] / best.n]) : null;
}

export type SampledColours = { headerBg: string | null; footerBg: string | null };

/**
 * Header background = dominant colour of the left strip at the very top (where the logo sits on the header,
 * away from menus); footer background = dominant colour of the bottom strip of a full-page screenshot.
 */
export async function sampleColours(screenshot: Buffer | null): Promise<SampledColours> {
  if (!screenshot) return { headerBg: null, footerBg: null };
  try {
    const img = sharp(screenshot);
    const { width = 0, height = 0 } = await img.metadata();
    if (!width || !height) return { headerBg: null, footerBg: null };
    const headerBg = await dominantColour(img, { left: 0, top: 0, width: Math.min(width, Math.round(width * 0.25)), height: Math.min(height, 120) });
    const footerBg = height > 1600 ? await dominantColour(img, { left: 0, top: height - 160, width, height: 150 }) : null;
    return { headerBg, footerBg };
  } catch {
    return { headerBg: null, footerBg: null };
  }
}

/** Firecrawl lists fonts by role; fall back to the typography block. */
function brandFonts(b: FirecrawlBranding | undefined): { heading: string | null; body: string | null } {
  const byRole = (role: string) => b?.fonts?.find((f) => f.role === role)?.family ?? null;
  const ff = b?.typography?.fontFamilies ?? {};
  return { heading: byRole("heading") ?? ff.heading ?? null, body: byRole("body") ?? ff.primary ?? ff.body ?? null };
}

export function brandFromBranding(b: FirecrawlBranding | undefined, meta: { favicon?: string | null } = {}): BusinessProfile["brand"] {
  const c = b?.colors ?? {};
  const primary = normaliseHex(c.primary) ?? normaliseHex(b?.components?.buttonPrimary?.background as string) ?? "#2F3A22";
  const button = b?.components?.buttonPrimary as { borderRadius?: string } | undefined;
  return {
    colors: {
      primary,
      secondary: normaliseHex(c.secondary),
      accent: normaliseHex(c.accent),
      background: normaliseHex(c.background) ?? "#FFFFFF",
      text: normaliseHex(c.textPrimary ?? c.text) ?? "#1F2117",
    },
    fonts: brandFonts(b),
    logoUrl: b?.images?.logo ?? b?.logo ?? null,
    logoKey: null,
    faviconUrl: b?.images?.favicon ?? meta.favicon ?? null,
    buttonRadius: button?.borderRadius ?? (typeof b?.spacing?.borderRadius === "string" ? (b.spacing.borderRadius as string) : null),
  };
}

export function shellTokens(brand: BusinessProfile["brand"], b: FirecrawlBranding | undefined, sampled: SampledColours): ShellTokens {
  const btn = (b?.components?.buttonPrimary ?? {}) as { background?: string; textColor?: string; borderRadius?: string };
  const headerBg = sampled.headerBg ?? brand.colors.background;
  const footerBg = sampled.footerBg && contrast(sampled.footerBg, headerBg) > 1.3 ? sampled.footerBg : brand.colors.text;
  const buttonBg = normaliseHex(btn.background) ?? brand.colors.primary;
  // A white header gets a brand-coloured top bar; a tinted header gets a white "pill" (Thorburn's look).
  const whiteHeader = contrast(headerBg, "#FFFFFF") < 1.05;
  const topbarBg = whiteHeader ? brand.colors.primary : "#FFFFFF";
  const topbarText = whiteHeader ? readableOn(topbarBg, "#FFFFFF") : readableOn(topbarBg, brand.colors.text);
  return {
    primary: brand.colors.primary,
    text: brand.colors.text,
    headerBg,
    headerText: readableOn(headerBg, brand.colors.text),
    topbarBg,
    topbarText,
    topbarAccent: whiteHeader ? topbarText : readableOn(topbarBg, brand.colors.primary),
    footerBg,
    footerText: readableOn(footerBg, "#FFFFFF"),
    headingFont: brand.fonts.heading,
    bodyFont: brand.fonts.body,
    buttonBg,
    buttonText: readableOn(buttonBg, normaliseHex(btn.textColor) ?? "#FFFFFF"),
    buttonRadius: btn.borderRadius ?? brand.buttonRadius ?? "8px",
  };
}
