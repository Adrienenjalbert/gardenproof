/**
 * The form wears the business's own look: colours, logo, phone and real project photos from tenants.profile
 * (the intel pipeline), falling back to tenants.config and the demo stills. Server-only (reads the disk to
 * prefer locally stored copies of scraped images over hot-linking the business's website).
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/config";
import type { Tenant } from "@/db/schema";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/intel/types";
import type { DefinitionContext } from "./definitions";
import type { FormGlyph, FormOption } from "./types";

export type FormBrand = {
  name: string;
  logoUrl: string;
  primary: string;
  primaryInk: string;
  dark: string;
  soft: string;
  phone: string | null;
  website: string;
  ownerFirstName: string | null;
  heroImage: string;
  review: { text: string; author: string | null; rating: number | null; provider: string } | null;
  rating: { value: number; count: number } | null;
};

const PUBLIC_DIR = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "public");
const DATA_DIR = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "profiles");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function exists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * tenants.profile, or (before onboarding has been confirmed) the intel pipeline's file for this business in
 * data/profiles/. The file fallback is a demo convenience; tests never read it (deterministic fixtures).
 */
export function profileFor(tenant: Pick<Tenant, "profile" | "slug" | "name">): BusinessProfile | null {
  if (tenant.profile) return tenant.profile;
  if (process.env.NODE_ENV === "test") return null;
  for (const name of [tenant.slug, slugify(tenant.name)]) {
    const file = path.join(DATA_DIR(), `${name}.json`);
    if (!exists(file)) continue;
    try {
      const parsed = BusinessProfileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      if (parsed.success) return parsed.data;
    } catch {
      /* unreadable file: ignore, fall back to config */
    }
  }
  return null;
}

/**
 * A browser URL for a scraped image: only a local copy under public/ (the intel pipeline downloads them). We never
 * hot-link the business's own site: it may block it, and a broken card is worse than a glyph.
 */
export function imageUrlFor(img: { url: string; key: string | null }, profileSlug: string): string | null {
  const candidates: string[] = [];
  if (img.key) candidates.push(img.key.replace(/^\/+/, ""), `intel/${profileSlug}/${path.posix.basename(img.key)}`);
  try {
    candidates.push(`intel/${profileSlug}/${path.posix.basename(new URL(img.url).pathname)}`);
  } catch {
    /* not a URL */
  }
  for (const rel of candidates) {
    if (!rel.includes("..") && exists(path.join(PUBLIC_DIR(), rel))) return `/${rel}`;
  }
  return null;
}

const SERVICE_GLYPHS: Record<string, FormGlyph> = {
  full_design: "sprout",
  patio_paving: "patio",
  fencing: "fence",
  lawn_turf: "lawn",
  planting: "flower",
  structures: "pergola",
  maintenance: "scissors",
};

/** Which project categories/titles illustrate which service. Order matters: the broad "design" match goes last. */
const SERVICE_MATCH: [string, RegExp][] = [
  ["patio_paving", /patio|paving|porcelain|sandstone|terrace/i],
  ["fencing", /fenc|screen|trellis/i],
  ["lawn_turf", /lawn|turf/i],
  ["planting", /plant|border|hedg/i],
  ["structures", /pergola|garden room|structure|raised|water|pond|decking/i],
  ["maintenance", /mainten/i],
  ["full_design", /design|build|landscap|garden|makeover/i],
];

/** Real Thorburn stills shipped with the demo; used when no scraped portfolio is available. */
const DEMO_SERVICE_IMAGES: Record<string, string> = {
  full_design: "/demo/pond-garden-after.jpg",
  patio_paving: "/demo/sandstone-patio-after.jpg",
  structures: "/demo/garden-room-after.jpg",
};
const DEMO_STYLES: FormOption[] = [
  { value: "pond-gravel-garden", label: "Pond and gravel garden", image: "/demo/pond-garden-after.jpg" },
  { value: "sandstone-patio", label: "Sandstone patio", image: "/demo/sandstone-patio-after.jpg" },
  { value: "garden-room", label: "Garden room and lawn", image: "/demo/garden-room-after.jpg" },
];

type ProjectImage = { src: string; title: string; label: string; hint: string | null; category: string | null; slug: string; certain: boolean };

const isBefore = (i: { url: string; alt: string | null }) => /\bbefore\b|before[-_ ]?\d/i.test(`${i.url} ${i.alt ?? ""}`);
const isAfter = (i: { url: string; alt: string | null }) => /\bafter\b|after[-_ ]?\d/i.test(`${i.url} ${i.alt ?? ""}`);

/** "Courtyard Garden Renovation in Clapham/Battersea: Full Garden Design" -> "Courtyard Garden Renovation". */
export function projectLabel(title: string, area: string | null): { label: string; hint: string | null } {
  const hint = area?.split("/")[0]?.trim() || null;
  let label = title.split(":")[0].replace(/\s+in\s+[^,]+$/i, "").trim();
  if (hint && label.toLowerCase().endsWith(` ${hint.toLowerCase()}`)) label = label.slice(0, -hint.length - 1).trim();
  return { label: label || title, hint };
}

/**
 * One photo per project: an explicit "after" shot first, else any photo not marked "before". A "before" photo is
 * never used to show what the business does. `certain` = explicitly an after photo (preferred for cards).
 */
function projectImages(profile: BusinessProfile | null): ProjectImage[] {
  if (!profile) return [];
  const slug = slugify(profile.name);
  const out: ProjectImage[] = [];
  for (const p of profile.projects) {
    const candidates = [...p.images.filter(isAfter), ...p.images.filter((i) => !isAfter(i) && !isBefore(i))];
    const pick = candidates.map((i) => ({ i, src: imageUrlFor(i, slug) })).find((c) => c.src);
    if (!pick?.src) continue;
    const { label, hint } = projectLabel(p.title, p.area);
    out.push({ src: pick.src, title: p.title, label, hint, category: p.category, slug: slugify(p.title).slice(0, 60) || `project-${out.length}`, certain: isAfter(pick.i) });
  }
  return out.sort((a, b) => Number(b.certain) - Number(a.certain));
}

async function ownerFirstName(tenantId: string): Promise<string | null> {
  const db = await getDb();
  const [owner] = await db
    .select({ name: schema.crewMembers.name })
    .from(schema.crewMembers)
    .where(
      and(
        eq(schema.crewMembers.tenantId, tenantId),
        eq(schema.crewMembers.active, true),
        or(eq(schema.crewMembers.teamRole, "owner"), eq(schema.crewMembers.role, "owner")),
      ),
    )
    .limit(1);
  return owner?.name.split(" ")[0] ?? null;
}

/** Whole sentences up to ~170 characters (a quote cut mid-word reads as careless). */
export function shortQuote(text: string, max = 170): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  return out.trim() || `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

// --- colour helpers (hex only; anything else falls back to the config colour) -----------------------------------
const HEX = /^#([0-9a-f]{6})$/i;
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex: string, withHex: string, amount: number): string {
  const [a, b] = [rgb(hex), rgb(withHex)];
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** White text when it reaches 4.5:1 on the brand colour, else near-black. */
export const inkOn = (hex: string) => ((1.05 / (luminance(hex) + 0.05)) >= 4.5 ? "#ffffff" : "#16180f");

export async function resolveBrand(tenant: Tenant): Promise<{ brand: FormBrand; context: DefinitionContext }> {
  const profile = profileFor(tenant);
  const cfg = tenant.config;
  const primaryRaw = profile?.brand.colors.primary ?? cfg.brand.primary;
  const primary = HEX.test(primaryRaw) ? primaryRaw : cfg.brand.primary;
  const owner = await ownerFirstName(tenant.id);
  const images = projectImages(profile);
  const profileSlug = profile ? slugify(profile.name) : "";
  const isDemoTenant = tenant.slug === env.defaultTenantSlug;

  // Service cards: one distinct real photo each where we can find one.
  const used = new Set<string>();
  const services = cfg.services.map((s) => {
    const re = SERVICE_MATCH.find(([k]) => k === s.key)?.[1];
    const match = re ? images.find((p) => !used.has(p.src) && re.test(`${p.category ?? ""} ${p.title}`)) : undefined;
    // The demo stills are Thorburn's own photos: only ever shown for the demo tenant.
    const image = match?.src ?? (isDemoTenant && !used.has(DEMO_SERVICE_IMAGES[s.key]) ? (DEMO_SERVICE_IMAGES[s.key] ?? null) : null);
    if (image) used.add(image);
    return { key: s.key, label: s.label, image, glyph: SERVICE_GLYPHS[s.key] ?? ("leaf" as const) };
  });

  const portfolio = images.filter((p) => !/mainten/i.test(`${p.category ?? ""} ${p.title}`));
  const styles: FormOption[] = portfolio.length >= 2
    ? portfolio.slice(0, 6).map((p) => ({ value: p.slug, label: p.label, hint: p.hint ?? undefined, image: p.src }))
    : isDemoTenant
      ? DEMO_STYLES
      : [];

  const featured = profile?.reviews.featured.find((r) => r.text.length > 30 && (r.rating ?? 5) >= 4);
  const logo = profile?.brand.logoUrl ? imageUrlFor({ url: profile.brand.logoUrl, key: profile.brand.logoKey }, profileSlug) : null;
  const agg = profile?.reviews.aggregate;

  const brand: FormBrand = {
    name: profile?.name ?? tenant.name,
    logoUrl: logo ?? cfg.brand.logoPath,
    primary,
    primaryInk: inkOn(primary),
    dark: mix(primary, "#000000", 0.55),
    soft: mix(primary, "#ffffff", 0.9),
    phone: profile?.contact.phone ?? cfg.phone,
    website: profile?.source.url ?? cfg.website,
    ownerFirstName: owner,
    heroImage: portfolio[0]?.src ?? images[0]?.src ?? (isDemoTenant ? "/demo/pond-garden-after.jpg" : logo ?? cfg.brand.logoPath),
    review: featured ? { text: shortQuote(featured.text), author: featured.author, rating: featured.rating, provider: featured.provider } : null,
    rating: agg?.rating && agg.count > 0 ? { value: agg.rating, count: agg.count } : null,
  };
  return { brand, context: { businessName: brand.name, ownerFirstName: owner, services, styles } };
}
