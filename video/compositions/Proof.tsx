import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Hook, LowerThird } from "../components/Captions";
import { QuoteCard, RatingCard } from "../components/Cards";
import { EndCard } from "../components/EndCard";
import { Grain, Vignette } from "../components/Overlays";
import { Photo } from "../components/Photo";
import type { VideoProps } from "../schema";
import { layoutFor } from "../theme";
import { proofTimeline } from "../timing";

/**
 * Proof (~12s): finished garden with a slow Ken Burns, hook + service · area, then the
 * homeowner's own words typed on (only when they gave a quote), stars (only a real rating),
 * Which? card, end card.
 */
export const Proof: React.FC<VideoProps> = (p) => {
  const tl = proofTimeline(p);
  const L = layoutFor(p.ratio);
  const photoEnd = tl.end.from + 20;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0e08" }}>
      <Sequence durationInFrames={photoEnd} name="After">
        <Photo src={p.afterSrc} zoom={[1.0, 1.18]} pan={[-1, 0, 1.5, -1]} />
      </Sequence>
      <Vignette />

      <Sequence from={tl.hero.from} durationInFrames={tl.hero.duration} name="Hook">
        <Hook text={p.hook} layout={L} brand={p.brand} />
      </Sequence>
      <Sequence from={tl.hero.from + 42} durationInFrames={tl.hero.duration - 42} name="Service">
        <LowerThird service={p.serviceLine} area={[p.areaLine, p.brandName].filter(Boolean).join(" · ")} layout={L} brand={p.brand} />
      </Sequence>

      {tl.quote && p.quote ? (
        <Sequence from={tl.quote.from} durationInFrames={tl.quote.duration} name="Quote">
          <QuoteCard
            photoSrc={p.afterSrc}
            quote={p.quote}
            attribution={p.quoteAttribution}
            rating={p.rating}
            typingFrames={tl.typingFrames}
            layout={L}
            brand={p.brand}
          />
        </Sequence>
      ) : null}

      {tl.stars ? (
        <Sequence from={tl.stars.from} durationInFrames={tl.stars.duration} name="Homeowner rating">
          <RatingCard photoSrc={p.afterSrc} whichRating={null} rating={p.rating} layout={L} brand={p.brand} />
        </Sequence>
      ) : null}

      {tl.proof ? (
        <Sequence from={tl.proof.from} durationInFrames={tl.proof.duration + 16} name="Which?">
          <RatingCard photoSrc={p.afterSrc} whichRating={p.whichRating} rating={null} layout={L} brand={p.brand} />
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
