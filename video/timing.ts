/**
 * Pure timeline maths shared by the compositions (what to show when) and the app
 * (durationSec on the asset row). No React here so it is cheap to import and test.
 */
import { FPS, type Template, type VideoProps } from "./schema";

export type Segment = { from: number; duration: number };

export type RevealTimeline = {
  kind: "reveal";
  /** "wipe" = before → after slider; "hero" = no before photo, after-only short spot. */
  mode: "wipe" | "hero";
  hook: Segment;
  wipe: Segment | null;
  service: Segment;
  proof: Segment | null;
  end: Segment;
  durationInFrames: number;
};

export type ProofTimeline = {
  kind: "proof";
  hero: Segment;
  quote: Segment | null;
  stars: Segment | null;
  proof: Segment | null;
  end: Segment;
  /** Frames spent typing the quote (the rest of the quote segment is reading time). */
  typingFrames: number;
  durationInFrames: number;
};

export type ProcessStep = { src: string; label: string; stage: "before" | "progress" | "after" };

export type ProcessTimeline = {
  kind: "process";
  steps: (ProcessStep & Segment)[];
  proof: Segment | null;
  end: Segment;
  durationInFrames: number;
};

export type Timeline = RevealTimeline | ProofTimeline | ProcessTimeline;

const s = (seconds: number) => Math.round(seconds * FPS);

/** Section lengths, tuned by eye on the rendered samples. */
export const T = {
  hook: s(2),
  wipe: s(0.9),
  service: s(2.2),
  proof: s(1.5),
  end: s(2.2),
  heroWithService: s(3.5),
  quoteIn: s(0.4),
  quoteHold: s(1.9),
  charsPerSecond: 42,
  starsOnly: s(1.8),
  stepBefore: s(2.2),
  stepProgress: s(1.7),
  stepAfter: s(3.2),
} as const;

/** Rating card appears when there is any real rating to show. */
const hasProof = (p: Pick<VideoProps, "whichRating" | "rating">) => p.whichRating !== null || p.rating !== null;

function chain(lengths: (number | null)[]): (Segment | null)[] {
  let cursor = 0;
  return lengths.map((d) => {
    if (d === null) return null;
    const seg = { from: cursor, duration: d };
    cursor += d;
    return seg;
  });
}

const total = (segs: (Segment | null)[]) =>
  segs.reduce((max, seg) => (seg ? Math.max(max, seg.from + seg.duration) : max), 0);

export function revealTimeline(p: VideoProps): RevealTimeline {
  const mode = p.beforeSrc ? "wipe" : "hero";
  const [hook, wipe, service, proof, end] = chain([
    T.hook,
    mode === "wipe" ? T.wipe : null,
    T.service,
    hasProof(p) ? T.proof : null,
    T.end,
  ]);
  return {
    kind: "reveal",
    mode,
    hook: hook!,
    wipe,
    service: service!,
    proof,
    end: end!,
    durationInFrames: total([hook, wipe, service, proof, end]),
  };
}

export function proofTimeline(p: VideoProps): ProofTimeline {
  const typingFrames = p.quote ? Math.ceil((p.quote.length / T.charsPerSecond) * FPS) : 0;
  const quoteLen = p.quote ? T.quoteIn + typingFrames + T.quoteHold : null;
  // Stars get their own beat only when there is a rating but no quote (otherwise they sit under the quote).
  const starsLen = !p.quote && p.rating !== null ? T.starsOnly : null;
  const [hero, quote, stars, proof, end] = chain([
    T.heroWithService,
    quoteLen,
    starsLen,
    p.whichRating !== null ? T.proof : null,
    T.end,
  ]);
  return {
    kind: "proof",
    hero: hero!,
    quote,
    stars,
    proof,
    end: end!,
    typingFrames,
    durationInFrames: total([hero, quote, stars, proof, end]),
  };
}

export function processSteps(p: VideoProps): ProcessStep[] {
  const steps: ProcessStep[] = [];
  if (p.beforeSrc) steps.push({ src: p.beforeSrc, label: "Before", stage: "before" });
  p.progressSrcs.forEach((src, i) =>
    steps.push({ src, label: p.progressLabels[i] ?? `Stage ${i + 1}`, stage: "progress" }),
  );
  steps.push({ src: p.afterSrc, label: "Finished", stage: "after" });
  return steps;
}

export function processTimeline(p: VideoProps): ProcessTimeline {
  const raw = processSteps(p);
  const lens = raw.map((st, i) =>
    st.stage === "after" ? T.stepAfter : i === 0 ? T.stepBefore : T.stepProgress,
  );
  const segs = chain([...lens, hasProof(p) ? T.proof : null, T.end]);
  const steps = raw.map((st, i) => ({ ...st, ...segs[i]! }));
  const proof = segs[raw.length];
  const end = segs[raw.length + 1]!;
  return { kind: "process", steps, proof, end, durationInFrames: total(segs) };
}

/**
 * Graceful fallback: a Process video needs at least two stages (before/progress + finished);
 * with only the finished photo it is rendered in the Proof style instead.
 */
export function effectiveTemplate(template: Template, p: VideoProps): Template {
  if (template === "process" && !p.beforeSrc && p.progressSrcs.length === 0) return "proof";
  return template;
}

export function timelineFor(template: Template, p: VideoProps): Timeline {
  const t = effectiveTemplate(template, p);
  if (t === "reveal") return revealTimeline(p);
  if (t === "proof") return proofTimeline(p);
  return processTimeline(p);
}

export function durationSeconds(template: Template, p: VideoProps): number {
  return Math.round((timelineFor(template, p).durationInFrames / FPS) * 10) / 10;
}
