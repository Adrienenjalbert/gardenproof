/**
 * A starting TenantConfig for a business created from onboarding (existing tenants keep their config: onboarding
 * only fills tenants.profile). Everything comes from the confirmed profile; the voice rules are GardenProof's house
 * rules, not the business's words.
 */
import { publicUrl } from "@/lib/storage";
import { THORBURN_CONFIG, type ServiceDef, type TenantConfig } from "@/lib/tenant";
import { normaliseHex } from "./brand";
import type { BusinessProfile } from "./types";

/** Darken a hex colour by `amount` (0–1), for the "primaryDark" token. */
export function darken(hex: string, amount = 0.25): string {
  const h = normaliseHex(hex) ?? "#333333";
  const c = [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const LOW_TICKET = /maintenance|tidy|clean|mow|hedge|lawn care|weed/i;

export function tenantConfigFromProfile(p: BusinessProfile): TenantConfig {
  const services: ServiceDef[] = p.services.map((s) => ({ key: s.key, label: s.label, subServices: [], highTicket: !LOW_TICKET.test(s.label) }));
  const areas: Record<string, string> = {};
  for (const a of p.areas) if (a.outward && !areas[a.outward]) areas[a.outward] = a.name;
  const which = p.reviews.sources.find((s) => s.provider === "which");
  const google = p.reviews.sources.find((s) => s.provider === "google");
  return {
    name: p.name,
    website: p.source.url,
    phone: p.contact.phone,
    wordpress: null,
    brand: {
      primary: p.brand.colors.primary,
      primaryDark: darken(p.brand.colors.primary),
      accent: p.brand.colors.secondary ?? p.brand.colors.accent ?? p.brand.colors.primary,
      text: "#FFFFFF",
      logoPath: p.brand.logoKey ? publicUrl(p.brand.logoKey) : (p.brand.logoUrl ?? ""),
      displayFont: p.brand.fonts.heading ?? "Arvo",
      bodyFont: p.brand.fonts.body ?? "Inter",
    },
    proof: {
      whichRating: which?.rating != null ? which.rating.toFixed(1) : null,
      whichUrl: which?.url ?? null,
      googleReviewUrl: google?.url ?? null,
    },
    services,
    areas,
    cta: p.cta,
    voice: THORBURN_CONFIG.voice,
  };
}
