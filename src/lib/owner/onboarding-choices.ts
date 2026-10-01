/** What the owner kept on the set-up cards, and how it is applied to the profile (pure; used by client and server). */
import { z } from "zod";
import type { BusinessProfile } from "@/lib/intel/types";

export const ChoicesSchema = z.object({
  services: z.array(z.string().max(80)).max(100),
  areas: z.array(z.string().max(80)).max(200),
  /** URLs+text keys of up to three favourite public reviews, in order. */
  favourites: z.array(z.string().max(2000)).max(3),
  /** Project page URLs + image URLs the owner kept. */
  projectImages: z.array(z.string().max(2000)).max(500),
});
export type Choices = z.infer<typeof ChoicesSchema>;

export const reviewKey = (r: { url: string; text: string }) => `${r.url}#${r.text.slice(0, 40)}`;

/** Keep only what the owner kept; favourites first, in the order picked. Projects with no photos left go. */
export function applyChoices(p: BusinessProfile, c: Choices): BusinessProfile {
  const keepImg = new Set(c.projectImages);
  const fav = c.favourites;
  const featured = [...p.reviews.featured].sort((a, b) => {
    const ia = fav.indexOf(reviewKey(a));
    const ib = fav.indexOf(reviewKey(b));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return {
    ...p,
    services: p.services.filter((s) => c.services.includes(s.key)),
    areas: p.areas.filter((a) => c.areas.includes(a.name)),
    reviews: {
      ...p.reviews,
      featured: fav.length ? featured.filter((r) => fav.includes(reviewKey(r))) : featured,
    },
    projects: p.projects
      .map((pr) => ({
        ...pr,
        images: pr.images.filter((i) => keepImg.has(i.url)),
      }))
      .filter((pr) => pr.images.length > 0),
  };
}
