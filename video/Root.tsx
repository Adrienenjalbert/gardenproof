import React from "react";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { Process } from "./compositions/Process";
import { Proof } from "./compositions/Proof";
import { Reveal } from "./compositions/Reveal";
import { COMPOSITION_IDS, FPS, RATIO_DIMENSIONS, VideoPropsSchema, type Template, type VideoProps } from "./schema";
import { timelineFor } from "./timing";

/** Studio preview props (real Thorburn stills from /public/demo; no quote because none was given). */
const demoProps: VideoProps = {
  ratio: "9:16",
  beforeSrc: staticFile("demo/pond-garden-before.jpg"),
  afterSrc: staticFile("demo/pond-garden-after.jpg"),
  progressSrcs: [],
  progressLabels: [],
  hook: "Same garden. Three weeks apart.",
  serviceLine: "Pond & gravel garden",
  areaLine: "Wimbledon",
  durationLabel: "3 weeks on site",
  quote: null,
  quoteAttribution: null,
  rating: null,
  whichRating: "4.9",
  brandName: "Thorburn Landscapes",
  ctaText: "Book a design consultation",
  website: "thorburnlandscapes.co.uk",
  logoSrc: staticFile("thorburn-logo.jpg"),
  brand: { primary: "#464A33", primaryDark: "#2F3222", accent: "#B7C24A", text: "#FFFFFF" },
};

/** Width/height come from the ratio prop, duration from which sections have real content. */
const metadataFor =
  (template: Template): CalculateMetadataFunction<VideoProps> =>
  ({ props }) => ({
    ...RATIO_DIMENSIONS[props.ratio],
    durationInFrames: timelineFor(template, props).durationInFrames,
    fps: FPS,
  });

export const Root: React.FC = () => (
  <>
    <Composition
      id={COMPOSITION_IDS.reveal}
      component={Reveal}
      schema={VideoPropsSchema}
      defaultProps={demoProps}
      calculateMetadata={metadataFor("reveal")}
      {...RATIO_DIMENSIONS["9:16"]}
      fps={FPS}
      durationInFrames={240}
    />
    <Composition
      id={COMPOSITION_IDS.proof}
      component={Proof}
      schema={VideoPropsSchema}
      defaultProps={demoProps}
      calculateMetadata={metadataFor("proof")}
      {...RATIO_DIMENSIONS["9:16"]}
      fps={FPS}
      durationInFrames={360}
    />
    <Composition
      id={COMPOSITION_IDS.process}
      component={Process}
      schema={VideoPropsSchema}
      defaultProps={demoProps}
      calculateMetadata={metadataFor("process")}
      {...RATIO_DIMENSIONS["9:16"]}
      fps={FPS}
      durationInFrames={450}
    />
  </>
);
