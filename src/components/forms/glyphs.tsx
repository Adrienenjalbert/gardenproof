/** Line glyphs for option tiles (24px grid, 1.6 stroke). Only the shapes the form definitions use. */
import type { FormGlyph } from "@/lib/forms/types";

const PATHS: Record<FormGlyph | "chevron-left" | "camera" | "mic" | "x" | "phone" | "arrow-right" | "pin" | "lock", string> = {
  sprout: "M12 21v-8M12 13c0-4 3-7 8-7 0 4-3 7-8 7ZM12 15c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5Z",
  "ruler-s": "M3 3h18v18H3zM3 14h7v7",
  "ruler-m": "M3 3h18v18H3zM3 10h11v11",
  "ruler-l": "M3 3h18v18H3zM3 6h15v15",
  question: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  calendar: "M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 10h18M8 3v4M16 3v4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z",
  leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7",
  house: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  gate: "M4 21V5l4-2v18M20 21V5l-4-2v18M8 8h8M8 14h8",
  car: "M5 16h14M6 16v3M18 16v3M4 16l1.5-6a2 2 0 0 1 2-1.5h9a2 2 0 0 1 2 1.5L20 16M7.5 12.5h.01M16.5 12.5h.01",
  paw: "M12 20c-3 0-5-1.5-5-3.5S9 12 12 12s5 2.5 5 4.5S15 20 12 20ZM6 10.5a1.5 2 0 1 0 0-.01M18 10.5a1.5 2 0 1 0 0-.01M9.5 6.5a1.5 2 0 1 0 0-.01M14.5 6.5a1.5 2 0 1 0 0-.01",
  check: "M20 6 9 17l-5-5",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2-2 8-8M14.7 6.3 13 5 5 13l-2-2 8-8 1.7 1.3Z",
  "thumbs-up": "M7 10v11M3 11h4v10H3zM7 10l4-7c1.5 0 2.5 1.2 2.2 2.7L12.5 10H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7",
  meh: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 15h8M9 9.5h.01M15 9.5h.01",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  flower: "M12 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 9a3 3 0 1 1 3-3M15 11.5a3 3 0 1 1 1 4M9 11.5a3 3 0 1 0-1 4M12 14v7M12 18c-2 0-3.5-1-4-2.5",
  patio: "M3 21h18M3 16h18M3 11h18M8 11v10M15 11v10M12 3l7 5H5z",
  fence: "M5 21V6l2-3 2 3v15M15 21V6l2-3 2 3v15M9 9h6M9 16h6M3 21h18",
  lawn: "M3 20h18M5 20c0-3 1-6 1-6s1 3 1 6M10 20c0-4 1.5-8 1.5-8s1.5 4 1.5 8M16 20c0-3 1-6 1-6s1 3 1 6",
  pergola: "M3 7h18M5 7v14M19 7v14M3 4h18M9 7v3M15 7v3M12 7v3",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  "chevron-left": "m15 18-6-6 6-6",
  camera: "M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  x: "M18 6 6 18M6 6l12 12",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
};

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className = "h-6 w-6", strokeWidth = 1.6 }: { name: GlyphName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
