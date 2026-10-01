/**
 * Self-hosted brand fonts (SIL OFL, files in video/fonts, fetched from Google Fonts).
 *
 * Why not @remotion/google-fonts at render time: render workers fetch fonts.gstatic.com from inside
 * headless Chromium, which fails on locked-down / proxied networks (it did in our sandbox) and
 * silently falls back to a system serif. Bundled woff2 files make every render identical offline.
 */
import { cancelRender, continueRender, delayRender } from "remotion";
import arvoBold from "./fonts/Arvo-Bold.woff2";
import arvoItalic from "./fonts/Arvo-Italic.woff2";
import arvoRegular from "./fonts/Arvo-Regular.woff2";
import nunito from "./fonts/NunitoSans-Variable.woff2";

export const DISPLAY_FAMILY = "GP Arvo";
export const BODY_FAMILY = "GP Nunito Sans";

const faces: [string, string, FontFaceDescriptors][] = [
  [DISPLAY_FAMILY, arvoRegular, { weight: "400", style: "normal" }],
  [DISPLAY_FAMILY, arvoBold, { weight: "700", style: "normal" }],
  [DISPLAY_FAMILY, arvoItalic, { weight: "400", style: "italic" }],
  [BODY_FAMILY, nunito, { weight: "200 1000", style: "normal" }],
];

let loaded = false;

/** Register the faces once and hold the first frame until they are ready. */
export function loadBrandFonts(): void {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("Loading brand fonts");
  Promise.all(
    faces.map(async ([family, url, desc]) => {
      const face = new FontFace(family, `url(${url}) format("woff2")`, desc);
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    // Fail loudly: a video in a fallback font must never reach the client.
    .catch((err) => cancelRender(err));
}
