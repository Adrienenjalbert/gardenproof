/**
 * Motion + brand variables for the form (globals.css is shared, so the form carries its own small sheet).
 * All motion is disabled for people who ask for reduced motion.
 */
import type { CSSProperties } from "react";
import type { FormBrand } from "@/lib/forms/brand";

const CSS = `
@keyframes gp-in-fwd { from { opacity: 0; transform: translate3d(0, 26px, 0); } to { opacity: 1; transform: none; } }
@keyframes gp-in-back { from { opacity: 0; transform: translate3d(0, -26px, 0); } to { opacity: 1; transform: none; } }
@keyframes gp-rise { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
@keyframes gp-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
@keyframes gp-draw { from { stroke-dashoffset: 30; } to { stroke-dashoffset: 0; } }
@keyframes gp-fade { from { opacity: 0; } to { opacity: 1; } }
.gp-fwd { animation: gp-in-fwd .52s cubic-bezier(.2,.8,.2,1) both; }
.gp-back { animation: gp-in-back .52s cubic-bezier(.2,.8,.2,1) both; }
.gp-rise { animation: gp-rise .4s cubic-bezier(.2,.8,.2,1) both; }
.gp-fade { animation: gp-fade .6s ease both; }
.gp-pop { animation: gp-pop .6s cubic-bezier(.2,.8,.2,1) both; }
.gp-draw { stroke-dasharray: 30; animation: gp-draw .5s .35s ease-out both; }
.gp-stagger > * { animation: gp-rise .5s cubic-bezier(.2,.8,.2,1) both; }
.gp-stagger > *:nth-child(2) { animation-delay: .05s; } .gp-stagger > *:nth-child(3) { animation-delay: .1s; }
.gp-stagger > *:nth-child(4) { animation-delay: .15s; } .gp-stagger > *:nth-child(5) { animation-delay: .2s; }
.gp-stagger > *:nth-child(6) { animation-delay: .25s; } .gp-stagger > *:nth-child(n+7) { animation-delay: .3s; }
.gp-press { -webkit-tap-highlight-color: transparent; }
.gp-press:active { transform: scale(.975); }
@media (prefers-reduced-motion: reduce) {
  .gp-fwd, .gp-back, .gp-rise, .gp-pop, .gp-fade, .gp-stagger > * { animation: none; }
  .gp-draw { animation: none; stroke-dasharray: none; }
  .gp-press:active { transform: none; }
}
`;

export function FormStyles() {
  return <style>{CSS}</style>;
}

export function brandVars(b: FormBrand): CSSProperties {
  return { "--b": b.primary, "--b-ink": b.primaryInk, "--b-dark": b.dark, "--b-soft": b.soft } as CSSProperties;
}
