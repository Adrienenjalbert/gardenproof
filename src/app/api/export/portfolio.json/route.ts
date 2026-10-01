/**
 * GET /api/export/portfolio.json?tenant=thorburn — public feed of PUBLISHED projects (for the future embed
 * widget and for AI/answer-engine crawlers). Only consented, published content ever reaches this feed.
 */
import { env } from "@/lib/config";
import { listProjectCards } from "@/lib/publish/data";
import { getTenantBySlug } from "@/lib/tenants";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("tenant") ?? env.defaultTenantSlug;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return Response.json({ error: "Invalid tenant" }, { status: 400 });
  let tenant;
  try {
    tenant = await getTenantBySlug(slug);
  } catch {
    return Response.json({ error: "Unknown tenant" }, { status: 404 });
  }
  const cards = await listProjectCards(tenant, { mode: "absolute" });
  const projects = cards.map((c) => ({
    id: c.assetId,
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    service: c.service,
    area: c.area,
    url: c.url,
    image: c.image ? { url: c.image.src, alt: c.image.alt, width: c.image.width, height: c.image.height } : null,
    rating: c.rating,
    publishedAt: c.publishedAt,
  }));
  return Response.json(
    { tenant: { slug: tenant.slug, name: tenant.config.name, website: tenant.config.website }, count: projects.length, projects },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
