/**
 * GET /enquire/<tenantSlug> — the public enquiry link (website buttons, ads, the-dude.ai directory, Google
 * Business Profile). Creates a saved form and redirects to /f/<token>, so progress survives a closed tab.
 *
 * Query: ?service=patio_paving[,planting]  utm_source/medium/campaign/content/term  gclid  fbclid
 *        src=directory|gbp|website (when there are no UTMs)  project=<portfolio slug>
 *        gp_ft / gp_lt = JSON first/last touch from gp-track.js (a website link can pass them through).
 * The same browser coming back resumes its unfinished enquiry (cookie scoped to this path) instead of
 * starting another. Link-preview bots get a tiny page with a title and no form row.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { inferSource } from "@/app/api/leads/lead";
import { clientIp, createRateLimiter } from "@/app/api/leads/guards";
import { createFormLink, getForm } from "@/lib/forms";
import { touchFromRequest, touchParam } from "@/lib/forms/attribution";
import { getTenantBySlug } from "@/lib/tenants";

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|twitterbot|linkedinbot|embedly|preview|headless(?!chrome)/i;
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 });
const COOKIE_MAX_AGE = 30 * 24 * 3600;

const html = (status: number, title: string, body: string) =>
  new NextResponse(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><meta property="og:title" content="${title}"></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;background:#fbfaf7;color:#16180f"><main style="max-width:26rem;text-align:center"><h1 style="font-size:1.4rem">${title}</h1><p style="opacity:.7;line-height:1.5">${body}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SourceSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const ProjectSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/i);

export async function GET(req: Request, ctx: RouteContext<"/enquire/[tenantSlug]">) {
  const { tenantSlug } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(tenantSlug)) return html(404, "Page not found", "Please check the link.");
  let tenant;
  try {
    tenant = await getTenantBySlug(tenantSlug);
  } catch {
    return html(404, "Page not found", "Please check the link.");
  }
  const title = esc(`Tell us about your garden · ${tenant.name}`);
  if (BOT_UA.test(req.headers.get("user-agent") ?? "")) return html(200, title, "A few quick taps and we'll be in touch.");

  const url = new URL(req.url);
  const cookieName = `gp_enq_${tenantSlug.replace(/-/g, "_")}`;
  const existing = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9_-]{16,64})`))?.[1];
  if (existing) {
    const form = await getForm(existing);
    if (form && !form.completed && form.tenant.id === tenant.id) return NextResponse.redirect(new URL(`/f/${existing}`, req.url), 303);
  }

  if (!limiter(clientIp(req.headers)).ok) return html(429, "One moment", "Too many requests from this connection. Please try again in a few minutes.");

  const touch = touchFromRequest(url, req.headers.get("referer"));
  const first = touchParam(url.searchParams.get("gp_ft")) ?? touch;
  const last = touchParam(url.searchParams.get("gp_lt")) ?? touch;
  const services = (url.searchParams.get("service") ?? "")
    .split(",")
    .filter((s) => tenant.config.services.some((d) => d.key === s))
    .join(",");
  const src = SourceSchema.safeParse(url.searchParams.get("src"));
  const project = ProjectSchema.safeParse(url.searchParams.get("project"));
  const source = first.source ?? (src.success ? src.data.toLowerCase() : null) ?? (first.referrer || first.gclid || first.fbclid ? inferSource(first).source : "direct");

  const { token } = await createFormLink({
    tenantId: tenant.id,
    kind: "enquiry",
    prefill: services ? { service: services } : undefined,
    source,
    attribution: { first, last },
    projectSlug: project.success ? project.data : null,
  });
  const res = NextResponse.redirect(new URL(`/f/${token}`, req.url), 303);
  res.cookies.set(cookieName, token, { path: `/enquire/${tenantSlug}`, maxAge: COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax", secure: url.protocol === "https:" });
  return res;
}
