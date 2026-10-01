/** Photo URLs for the owner's own (private) app: the public-safe copy when one exists, else the signed-in route. */
import type { Media } from "@/db/schema";
import { operatorMediaUrl } from "@/lib/dashboard/queries";
import { mediaPrivacy } from "@/lib/dashboard/media-privacy";
import { publicUrl } from "@/lib/storage";

export function photoUrl(m: Media): string {
  const p = mediaPrivacy(m);
  return p.publicKey ? publicUrl(p.publicKey) : operatorMediaUrl(m.id);
}

/** Best cover for a job: hero after → any after → progress → before. */
export function coverOf(media: Media[]): Media | null {
  const imgs = media.filter((m) => m.kind === "image");
  const rank = (m: Media) =>
    m.isHero && m.stage === "after" ? 0 : m.stage === "after" ? 1 : m.stage === "progress" ? 2 : m.isHero ? 3 : 4;
  return [...imgs].sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}
