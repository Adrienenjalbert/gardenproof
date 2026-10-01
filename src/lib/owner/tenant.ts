/** The business as the owner app shows it: name, logo and colour from the confirmed profile, else config. */
import type { Tenant } from "@/db/schema";
import { findOwner, loadSettings, type OwnerSettings } from "@/lib/crm-engine";
import { publicUrl } from "@/lib/storage";
import type { TenantConfig } from "@/lib/tenant";
import { pickAccent } from "./brand-color";
import { getTenantBySlug } from "@/lib/tenants";

export type Brand = {
  name: string;
  logoUrl: string | null;
  /** Accent colour for buttons and highlights. */
  accent: string;
  /** Brand heading font name (used sparingly for big titles), null = system. */
  displayFont: string | null;
};

export function brandOf(tenant: Tenant): Brand {
  const config = tenant.config as TenantConfig;
  const p = tenant.profile;
  const logo = p?.brand.logoKey ? publicUrl(p.brand.logoKey) : (p?.brand.logoUrl ?? config.brand.logoPath ?? null);
  return {
    name: p?.name ?? tenant.name,
    logoUrl: logo,
    accent: pickAccent([
      p?.brand.colors.primary,
      p?.brand.colors.accent,
      p?.brand.colors.secondary,
      config.brand.primary,
    ]),
    displayFont: p?.brand.fonts.heading ?? null,
  };
}

export type OwnerContext = {
  tenant: Tenant;
  brand: Brand;
  settings: OwnerSettings;
  ownerName: string | null;
};

export async function getOwnerContext(): Promise<OwnerContext> {
  const tenant = await getTenantBySlug();
  const [settings, owner] = await Promise.all([loadSettings(tenant.id), findOwner(tenant.id)]);
  return {
    tenant,
    brand: brandOf(tenant),
    settings,
    ownerName: owner?.name ?? null,
  };
}
