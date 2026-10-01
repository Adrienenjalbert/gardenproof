/**
 * Privacy state of a photo as the operator sees it (P0-2). The decision of which file may go public lives in
 * `@/lib/privacy` (`publishableImageKey`); this module only explains that decision and the operator's options.
 */
import type { Media } from "@/db/schema";
import { NEEDS_BLUR, publishableImageKey } from "@/lib/privacy";

/** Tag the dashboard writes when the operator deliberately keeps a flagged photo out of public use. */
export const KEPT_WITHHELD_TAG = "privacy:kept-withheld";

export type PrivacyKind =
  /** Flagged "needs blur" and nobody has decided yet: withheld, needs the operator. */
  | "withheld"
  /** Flagged, and the operator chose to keep it withheld. */
  | "kept_withheld"
  /** Flagged, but a real blurred copy exists: the blurred copy is public. */
  | "blurred"
  /** Flagged, and the operator checked it and cleared it for publishing. */
  | "cleared"
  /** Never screened by the enrichment step. */
  | "not_checked"
  /** Screened, nothing found. */
  | "clear"
  /** Voice notes and other non-images: never public. */
  | "private";

export type PrivacyView = {
  kind: PrivacyKind;
  /** Why it was flagged, e.g. "neighbour's window" (null when not flagged). */
  reason: string | null;
  /** Which stored copy public surfaces use, or null when none may be used. */
  publicKey: string | null;
  publicLabel: string;
};

type MediaLike = Pick<
  Media,
  "kind" | "publicKey" | "blurredKey" | "privacyClearedAt" | "qualityNotes" | "qualityScore" | "tags"
>;

/** "needs blur (neighbour's window); slightly dark" → "neighbour's window". */
export function blurReason(notes: string | null): string | null {
  const part = (notes ?? "").split(/[;\n]/).find((p) => NEEDS_BLUR.test(p));
  if (!part) return null;
  const detail = part.replace(NEEDS_BLUR, "").replace(/^[\s:,-]+/, "").replace(/^\((.*)\)$/, "$1").trim();
  return detail || "faces, number plates or house numbers";
}

export function isUnscreened(m: Pick<Media, "qualityNotes" | "qualityScore">): boolean {
  return (m.qualityNotes === null && m.qualityScore === null) || /\bunassessed\b/i.test(m.qualityNotes ?? "");
}

export function mediaPrivacy(m: MediaLike): PrivacyView {
  if (m.kind !== "image") return { kind: "private", reason: null, publicKey: null, publicLabel: "Never public" };
  const publicKey = publishableImageKey(m);
  const reason = blurReason(m.qualityNotes);
  if (reason !== null) {
    if (m.blurredKey) return { kind: "blurred", reason, publicKey, publicLabel: "Blurred copy" };
    if (m.privacyClearedAt) return { kind: "cleared", reason, publicKey, publicLabel: "EXIF-stripped copy (checked by you)" };
    const kept = (m.tags ?? []).includes(KEPT_WITHHELD_TAG);
    return { kind: kept ? "kept_withheld" : "withheld", reason, publicKey: null, publicLabel: "None — withheld" };
  }
  const label = publicKey ? "EXIF-stripped copy" : "None — withheld";
  if (isUnscreened(m)) return { kind: "not_checked", reason: null, publicKey, publicLabel: label };
  return { kind: "clear", reason: null, publicKey, publicLabel: label };
}

/** Photos that still need an operator decision (shown in "Needs you"). */
export function needsPrivacyDecision(m: MediaLike): boolean {
  return mediaPrivacy(m).kind === "withheld";
}
