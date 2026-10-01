import { describe, expect, it } from "vitest";
import { publishableImageKey } from "./privacy";

const base = { kind: "image" as const, publicKey: "t/j/after-1.public.jpg", blurredKey: null, privacyClearedAt: null, qualityNotes: null, qualityScore: 0.8 };

describe("publishableImageKey", () => {
  it("uses the EXIF-stripped derivative, never the original", () => {
    expect(publishableImageKey(base)).toBe("t/j/after-1.public.jpg");
  });
  it("withholds flagged images until blurred or cleared", () => {
    const flagged = { ...base, qualityNotes: "faces visible; needs blur" };
    expect(publishableImageKey(flagged)).toBeNull();
    expect(publishableImageKey({ ...flagged, blurredKey: "t/j/after-1.blurred.jpg" })).toBe("t/j/after-1.blurred.jpg");
    expect(publishableImageKey({ ...flagged, privacyClearedAt: new Date() })).toBe("t/j/after-1.public.jpg");
  });
  it("withholds images that were never screened", () => {
    expect(publishableImageKey({ ...base, qualityScore: null })).toBeNull();
    expect(publishableImageKey({ ...base, qualityScore: null, privacyClearedAt: new Date() })).toBe("t/j/after-1.public.jpg");
  });
  it("never publishes audio/video originals or images without a derivative", () => {
    expect(publishableImageKey({ ...base, kind: "audio" })).toBeNull();
    expect(publishableImageKey({ ...base, publicKey: null })).toBeNull();
  });
});
