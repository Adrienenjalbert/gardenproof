/**
 * POST /api/leads — enquiry + attribution from the tenant website (public/gp-track.js).
 * Accepts JSON sent as application/json or text/plain (the tracker uses text/plain to skip the CORS preflight).
 * GET is deliberately not exposed: lead data is only readable in the dashboard.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tenant } from "@/db/schema";
import { env } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { getTenantBySlug } from "@/lib/tenants";
import { allowedOrigins, clientIp, corsHeaders, createRateLimiter, isAllowedOrigin } from "./guards";
import { assetIdCandidates, attributionColumns, attributionJson, isBot, LeadPayloadSchema } from "./lead";

const MAX_BODY_BYTES = 16 * 1024;
const rateLimit = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

async function resolveTenant(slug: string | null | undefined): Promise<Tenant | null> {
  try {
    return await getTenantBySlug(slug || env.defaultTenantSlug);
  } catch {
    return null;
  }
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  const ok = !!tenant && isAllowedOrigin(origin, allowedOrigins(tenant.config, env.appUrl));
  return new Response(null, { status: ok ? 204 : 403, headers: ok ? corsHeaders(origin) : { Vary: "Origin" } });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
    Response.json(body, { status, headers: { ...corsHeaders(origin), ...extra } });

  const limited = rateLimit(clientIp(req.headers));
  if (!limited.ok) {
    return reply(429, { ok: false, error: "Too many requests" }, { "Retry-After": String(limited.retryAfterSec) });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "Payload too large" });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "Body must be JSON" });
  }

  const parsed = LeadPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return reply(400, {
      ok: false,
      error: "Invalid lead",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const lead = parsed.data;

  const tenant = await resolveTenant(lead.tenant ?? new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return reply(400, { ok: false, error: "Unknown tenant" });
  if (!isAllowedOrigin(origin, allowedOrigins(tenant.config, env.appUrl))) {
    return Response.json({ ok: false, error: "Origin not allowed" }, { status: 403, headers: { Vary: "Origin" } });
  }
  // Pretend success so bots don't learn to skip the honeypot.
  if (isBot(lead)) return reply(200, { ok: true });

  const db = await getDb();
  // Any asset type (portfolio page, ad copy, video, social pack…) of this tenant can be the attributed creative.
  const candidates = assetIdCandidates(lead);
  const matched = candidates.length
    ? await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(eq(schema.assets.tenantId, tenant.id), inArray(schema.assets.id, candidates)))
    : [];
  const assetId = candidates.find((id) => matched.some((m) => m.id === id)) ?? null;

  const id = newId("lead");
  await db.insert(schema.leads).values({
    id,
    tenantId: tenant.id,
    ...attributionColumns(lead),
    projectSlug: lead.projectSlug ?? null,
    assetId,
    name: lead.name ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    postcode: lead.postcode ?? null,
    service: lead.service ?? null,
    message: lead.message ?? null,
    attribution: attributionJson(lead),
  });
  await logEvent({
    tenantId: tenant.id,
    type: "lead.received",
    entity: "lead",
    entityId: id,
    actor: "website",
    data: { assetId, projectSlug: lead.projectSlug ?? null, source: attributionColumns(lead).source },
  });
  return reply(201, { ok: true, id });
}
