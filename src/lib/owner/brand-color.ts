/** Choosing a usable accent from a brand palette (pure, client-safe). */
const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance (WCAG). Used to avoid near-white or near-black accents that vanish on the UI. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** First usable brand colour: readable on white (contrast ≥ 3:1) and not almost black. */
export function pickAccent(candidates: Array<string | null | undefined>, fallback = "#2A7D2E"): string {
  for (const c of candidates) {
    if (!c || !HEX.test(c)) continue;
    const l = luminance(c);
    if (1.05 / (l + 0.05) >= 3 && l > 0.02) return c;
  }
  return fallback;
}
