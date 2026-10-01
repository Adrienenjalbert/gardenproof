import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Hook, LowerThird } from "../components/Captions";
import { RatingCard } from "../components/Cards";
import { EndCard } from "../components/EndCard";
import { Chip, Grain, Vignette } from "../components/Overlays";
import { Photo } from "../components/Photo";
import { Wipe } from "../components/Wipe";
import type { VideoProps } from "../schema";
import { layoutFor } from "../theme";
import { revealTimeline } from "../timing";

/**
 * Reveal (~8s): messy "before" with slow push-in and the hook → slider wipe to the finished
 * garden → service · area → rating → olive end card.
 * Without a before photo it becomes a short after-only hero spot (same beats, no wipe).
 */
export const Reveal: React.FC<VideoProps> = (p) => {
  const tl = revealTimeline(p);
  const L = layoutFor(p.ratio);
  const photoEnd = tl.end.from + 20;
  const afterFrom = tl.wipe ? tl.wipe.from : 0;

  const after = <Photo src={p.afterSrc} zoom={[1.0, 1.1]} pan={[0, 0, 0, -1.5]} />;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0e08" }}>
      {tl.wipe && p.beforeSrc ? (
        <Sequence durationInFrames={tl.wipe.from + tl.wipe.duration} name="Before">
          <Photo src={p.beforeSrc} zoom={[1.0, 1.14]} pan={[0, 0, 1, 0.5]} />
        </Sequence>
      ) : null}
      <Sequence from={afterFrom} durationInFrames={photoEnd - afterFrom} name="After">
        {tl.wipe ? (
          <Wipe duration={tl.wipe.duration} labelSize={L.type.label}>
            {after}
          </Wipe>
        ) : (
          after
        )}
      </Sequence>
      <Vignette />

      <Sequence from={tl.hook.from} durationInFrames={tl.hook.duration + (tl.wipe ? 4 : 0)} name="Hook">
        <Hook text={p.hook} layout={L} brand={p.brand} />
        {tl.wipe ? (
          <AbsoluteFill
            style={{
              justifyContent: "flex-end",
              paddingBottom: L.safe.bottom,
              paddingLeft: L.safe.left,
            }}
          >
            <div>
              <Chip label="Before" size={L.type.label} dot="#C8553D" />
            </div>
          </AbsoluteFill>
        ) : null}
      </Sequence>

      <Sequence from={tl.service.from} durationInFrames={tl.service.duration} name="Service">
        <LowerThird service={p.serviceLine} area={[p.areaLine, p.brandName].filter(Boolean).join(" · ")} layout={L} brand={p.brand} />
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
