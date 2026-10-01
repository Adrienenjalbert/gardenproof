import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { Hook, LowerThird } from "../components/Captions";
import { RatingCard } from "../components/Cards";
import { EndCard } from "../components/EndCard";
import { Chip, Grain, InOut, Vignette } from "../components/Overlays";
import { Photo } from "../components/Photo";
import type { Brand, VideoProps } from "../schema";
import { EASE_OUT, FONT_BODY, layoutFor, type Layout } from "../theme";
import { effectiveTemplate, processTimeline, type ProcessTimeline } from "../timing";
import { Proof } from "./Proof";

const XFADE = 10;

/** Step rail: "Before — Week 1 — Week 2 — Finished", current step highlighted. */
const Rail: React.FC<{ tl: ProcessTimeline; layout: Layout; brand: Brand }> = ({ tl, layout: L, brand }) => {
  const frame = useCurrentFrame();
  const n = tl.steps.length;
  const last = tl.steps[n - 1]!;
  const fill = interpolate(frame, tl.steps.map((s) => s.from).concat(last.from + 1), [...tl.steps.map((_, i) => i / (n - 1 || 1)), 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const active = tl.steps.reduce((acc, s, i) => (frame >= s.from ? i : acc), 0);
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: L.type.label * 0.7 }}>
      <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2 }}>
        <div style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, background: brand.accent, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {tl.steps.map((s, i) => (
          <div
            key={i}
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 800,
              fontSize: L.type.label * 0.85,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: i === active ? "#fff" : "rgba(255,255,255,0.55)",
              textShadow: "0 1px 8px rgba(0,0,0,0.5)",
            }}
          >
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Crossfade in over XFADE frames (the previous photo stays underneath). */
const FadeIn: React.FC<{ children: React.ReactNode; first: boolean }> = ({ children, first }) => {
  const frame = useCurrentFrame();
  const o = first ? 1 : interpolate(frame, [0, XFADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

/**
 * Process (~15s): before → up to 3 progress shots → finished, with a step rail, stage chips
 * and the time on site; then rating and end card.
 */
export const Process: React.FC<VideoProps> = (p) => {
  if (effectiveTemplate("process", p) === "proof") return <Proof {...p} />;
  return <ProcessSteps {...p} />;
};

const ProcessSteps: React.FC<VideoProps> = (p) => {
  const tl = processTimeline(p);
  const L = layoutFor(p.ratio);
  const after = tl.steps[tl.steps.length - 1]!;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0e08" }}>
      {tl.steps.map((s, i) => {
        const from = i === 0 ? 0 : s.from - XFADE;
        const isLast = i === tl.steps.length - 1;
        const until = isLast ? tl.end.from + 20 : s.from + s.duration;
        return (
          <Sequence key={i} from={from} durationInFrames={until - from} name={s.label}>
            <FadeIn first={i === 0}>
              <Photo src={s.src} zoom={isLast ? [1.0, 1.1] : [1.02, 1.08]} pan={i % 2 ? [1, 0, -1, 0] : [-1, 0, 1, 0]} />
            </FadeIn>
          </Sequence>
        );
      })}
      <Vignette />

      <Sequence from={0} durationInFrames={tl.steps[0]!.duration} name="Hook">
        <Hook text={p.hook} layout={L} brand={p.brand} />
      </Sequence>

      {tl.steps.slice(0, -1).map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.duration} name={`${s.label} chip`}>
          <InOut inFrames={12} outFrames={6} lift={12}>
            <AbsoluteFill
              style={{
                justifyContent: "flex-end",
                paddingBottom: L.safe.bottom + L.type.label * 4.2,
                paddingLeft: L.safe.left,
              }}
            >
              <div>
                <Chip label={s.label} size={L.type.label} dot={s.stage === "before" ? "#C8553D" : p.brand.accent} />
              </div>
            </AbsoluteFill>
          </InOut>
        </Sequence>
      ))}

      <Sequence from={after.from} durationInFrames={after.duration} name="Finished">
        <LowerThird
          service={p.serviceLine}
          area={[p.areaLine, p.brandName].filter(Boolean).join(" · ")}
          layout={L}
          brand={p.brand}
          extra={
            p.durationLabel ? (
              <div style={{ marginTop: L.type.label * 0.4 }}>
                <Chip label={p.durationLabel} size={L.type.label} dot={p.brand.accent} />
              </div>
            ) : null
          }
        />
      </Sequence>

      <Sequence from={0} durationInFrames={after.from + 2} name="Rail">
        <InOut inFrames={10} outFrames={8} lift={0}>
          <AbsoluteFill
            style={{
              justifyContent: "flex-end",
              padding: `0 ${L.safe.right}px ${L.safe.bottom}px ${L.safe.left}px`,
              background: "linear-gradient(0deg, rgba(12,14,8,0.55) 0%, rgba(12,14,8,0) 35%)",
            }}
          >
            <Rail tl={tl} layout={L} brand={p.brand} />
          </AbsoluteFill>
        </InOut>
      </Sequence>

      {tl.proof ? (
        <Sequence from={tl.proof.from} durationInFrames={tl.proof.duration + 16} name="Rating">
          <RatingCard photoSrc={p.afterSrc} whichRating={p.whichRating} rating={p.rating} layout={L} brand={p.brand} />
        </Sequence>
      ) : null}

      <Sequence from={tl.end.from} durationInFrames={tl.end.duration} name="End card">
        <EndCard
          ctaText={p.ctaText}
          website={p.website}
          logoSrc={p.logoSrc}
          whichRating={p.whichRating}
          photoSrc={p.afterSrc}
          layout={L}
          brand={p.brand}
        />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
};
