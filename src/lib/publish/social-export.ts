/**
 * Pure mappers: social pack / GBP post → plain-text hand-off files for the social manager.
 * Phase 1 is a manual hand-off (copy/paste into Meta Business Suite / Google Business Profile);
 * direct GBP API posting is Phase 2 (needs the Business Profile API allow-listing).
 */
import type { GbpPostContent, SocialPackContent } from "@/lib/domain";

export type ExportImage = { mediaId: string; url: string };

const rule = "—".repeat(40);

export function socialPackText(
  pack: SocialPackContent,
  images: ExportImage[],
  meta: { title: string; jobCode: string },
): string {
  const ordered = pack.carouselOrder
    .map((id) => images.find((img) => img.mediaId === id))
    .filter((img): img is ExportImage => !!img);
  const tags = pack.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return [
    `SOCIAL PACK — ${meta.title} (${meta.jobCode})`,
    rule,
    ...pack.captions.flatMap((c, i) => [`CAPTION ${i + 1}`, c.trim(), "", tags, ""]),
    pack.reelCoverText ? `REEL COVER TEXT\n${pack.reelCoverText}\n` : "",
    "CAROUSEL ORDER",
    ...ordered.map((img, i) => `${i + 1}. ${img.url}`),
    ...(ordered.length < pack.carouselOrder.length ? ["(some images are not public-safe yet and were left out)"] : []),
    "",
  ].join("\n");
}

export function gbpPostText(post: GbpPostContent, image: ExportImage | null, meta: { title: string; jobCode: string }): string {
  return [
    `GOOGLE BUSINESS PROFILE POST — ${meta.title} (${meta.jobCode})`,
    rule,
    post.text.trim(),
    "",
    `Button: ${post.ctaType}${post.ctaUrl ? ` → ${post.ctaUrl}` : ""}`,
    `Photo: ${image ? image.url : "none"}`,
    "",
    "Post manually in Google Business Profile (Add update). API posting is planned for Phase 2.",
    "",
  ].join("\n");
}
