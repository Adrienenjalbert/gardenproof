/**
 * The single rule for which image file may ever appear publicly (web pages, WordPress, videos, exports, feeds).
 * - Originals (`storageKey`) are NEVER public: they keep EXIF/GPS.
 * - `publicKey` is the EXIF-stripped derivative.
 * - Images flagged "needs blur" (faces, number plates, house numbers) are withheld until either a real blurred copy
 *   exists (`blurredKey`) or the operator has checked and cleared them (`privacyClearedAt`).
 * - Images never screened (no qualityScore/qualityNotes) are withheld too: privacy screening runs before content.
 * Every module must call `publishableImageKey` instead of reading media keys directly.
 */
import type { Media } from "@/db/schema";

export const NEEDS_BLUR = /needs blur/i;

export function needsBlur(m: Pick<Media, "qualityNotes">): boolean {
  return NEEDS_BLUR.test(m.qualityNotes ?? "");
}

export function publishableImageKey(
  m: Pick<Media, "kind" | "publicKey" | "blurredKey" | "privacyClearedAt" | "qualityNotes" | "qualityScore">,
): string | null {
  if (m.kind !== "image") return null;
  // Never screened (no quality assessment yet) → treat as unsafe until enrichment or an operator has looked at it.
  const screened = m.qualityScore != null || m.qualityNotes != null;
  if (!screened && !m.privacyClearedAt && !m.blurredKey) return null;
  if (needsBlur(m)) {
    if (m.blurredKey) return m.blurredKey;
    if (m.privacyClearedAt && m.publicKey) return m.publicKey;
    return null;
  }
  return m.publicKey ?? null;
}
