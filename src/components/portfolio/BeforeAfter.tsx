"use client";
/* eslint-disable @next/next/no-img-element -- media is served by our own route and mirrored in WordPress markup */
/**
 * Before/after comparison.
 * - Server render / no JS: both photos side by side in the same box (no layout shift once enhanced).
 * - Enhanced: drag anywhere (mouse, pen, touch — vertical scrolling still works) or focus the slider and use
 *   arrow keys / Home / End; a real <input type="range"> carries the accessible name and value.
 */
import { useId, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { PublicImage } from "@/lib/publish/view";

const noopSubscribe = () => () => {};

export function BeforeAfter({ before, after }: { before: PublicImage; after: PublicImage }) {
  const enhanced = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);
  const inputId = useId();
  // Portrait/square phone shots would make a very tall box: never taller than 5:4 (object-cover crops).
  const natural = after.width && after.height ? after.width / after.height : 1.5;
  const ratio = natural < 1.25 ? "5 / 4" : `${after.width} / ${after.height}`;
  // Don't upscale small phone stills: cap the box at the narrower photo's own width.
  const nativeWidth = Math.min(before.width ?? Infinity, after.width ?? Infinity);
  const boxStyle = { aspectRatio: ratio, ...(Number.isFinite(nativeWidth) ? { maxWidth: `${nativeWidth}px` } : {}) };

  const label = (text: string, side: "left" | "right") => (
    <span
      className={`pointer-events-none absolute top-4 z-10 rounded-full bg-black/45 px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-white uppercase backdrop-blur-sm ${side === "left" ? "left-4" : "right-4"}`}
    >
      {text}
    </span>
  );

  if (!enhanced) {
    return (
      <div className="mx-auto grid grid-cols-2 gap-1 overflow-hidden bg-olive-100" style={boxStyle}>
        {[before, after].map((img, i) => (
          <figure key={img.mediaId} className="relative m-0 h-full">
            <img src={img.src} alt={img.alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            {label(i === 0 ? "Before" : "After", "left")}
          </figure>
        ))}
      </div>
    );
  }

  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPos(Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))));
  };

  return (
    <div
      className="group relative mx-auto cursor-ew-resize touch-pan-y overflow-hidden bg-olive-100 select-none"
      style={boxStyle}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => dragging.current && moveTo(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <img
        src={after.src}
        alt={after.alt}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
        decoding="async"
      />
      <img
        src={before.src}
        alt={before.alt}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
        decoding="async"
      />
      {pos > 12 && label("Before", "left")}
      {pos < 88 && label("After", "right")}

      <label htmlFor={inputId} className="sr-only">
        Compare before and after photos
      </label>
      <input
        id={inputId}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-valuetext={`${pos}% of the before photo shown`}
        className="peer sr-only"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white/95 shadow-[0_0_12px_rgba(0,0,0,0.35)]"
        style={{ left: `${pos}%` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-olive shadow-[0_6px_24px_rgba(0,0,0,0.25)] transition-transform group-active:scale-95 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-white"
        style={{ left: `${pos}%` }}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
