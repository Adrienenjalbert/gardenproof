import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { allowedOrigins, createRateLimiter, isAllowedOrigin } from "@/app/api/leads/guards";
import { assetIdCandidates, attributionColumns, attributionJson, inferSource, LeadPayloadSchema } from "@/app/api/leads/lead";
import { OPTIONS, POST } from "@/app/api/leads/route";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { insertAsset, seedBase } from "../fixtures/mod-d-db";
import { patioAds, patioVideo } from "../fixtures/mod-d";

describe("LeadPayloadSchema", () => {
  it("accepts a CF7-style enquiry and normalises empty strings away", () => {
    const r = LeadPayloadSchema.parse({ name: " Ann ", email: "ann@example.co.uk", phone: "", postcode: "SW15 2QT", hp: "" });
    expect(r).toMatchObject({ name: "Ann", email: "ann@example.co.uk", postcode: "SW15 2QT" });
    expect(r.phone).toBeUndefined();
  });

  it("requires an email or a phone number", () => {
    expect(LeadPayloadSchema.safeParse({ name: "Ann" }).success).toBe(false);
    expect(LeadPayloadSchema.safeParse({ phone: "+44 7700 900123" }).success).toBe(true);
  });

  it("rejects malformed contact details and oversized fields", () => {
    expect(LeadPayloadSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(LeadPayloadSchema.safeParse({ phone: "call me" }).success).toBe(false);
    expect(LeadPayloadSchema.safeParse({ email: "a@b.co", message: "x".repeat(4001) }).success).toBe(false);
    expect(LeadPayloadSchema.safeParse({ email: "a@b.co", projectSlug: "../etc" }).success).toBe(false);
  });
});

describe("attribution", () => {
  it("takes campaign fields from the first touch and click ids from the last", () => {
    const cols = attributionColumns({
      first: { source: "facebook", medium: "paid_social", campaign: "gp_tl-5937", content: "asset_ast_1", gclid: "old", landingPage: "https://x/projects/p/" },
      last: { source: "google", gclid: "new" },
    });
    expect(cols).toMatchObject({ source: "facebook", medium: "paid_social", campaign: "gp_tl-5937", content: "asset_ast_1", gclid: "new", landingPage: "https://x/projects/p/" });
  });

  it("infers source/medium when there are no utm tags", () => {
    expect(inferSource({ gclid: "g" })).toEqual({ source: "google", medium: "cpc" });
    expect(inferSource({ referrer: "https://www.google.co.uk/" })).toEqual({ source: "google", medium: "organic" });
    expect(inferSource({ referrer: "https://l.instagram.com/" })).toEqual({ source: "instagram", medium: "social" });
    expect(inferSource({ referrer: "https://www.houzz.co.uk/pro/x" })).toEqual({ source: "houzz.co.uk", medium: "referral" });
    expect(inferSource(undefined)).toEqual({ source: "direct", medium: "none" });
    expect(attributionColumns({})).toMatchObject({ source: "direct", medium: "none", campaign: null });
  });

  it("builds the attribution JSON from the validated touches only", () => {
    const parsed = LeadPayloadSchema.parse({ email: "a@b.co", first: { source: " google ", medium: "", gclid: "g1" } });
    expect(attributionJson(parsed)).toEqual({ first: { source: "google", gclid: "g1" }, last: null });
    expect(attributionJson({})).toEqual({ first: null, last: null });
  });

  it("extracts asset ids from utm_content=asset_<id>", () => {
    expect(assetIdCandidates({ first: { content: "asset_ast_abc" }, last: { content: "asset_ast_abc" } })).toEqual(["ast_abc"]);
    expect(assetIdCandidates({ first: { content: "spring-sale" }, last: { content: "asset_ast_2" } })).toEqual(["ast_2"]);
    expect(assetIdCandidates({ first: { content: "asset_x;drop" } })).toEqual([]);
  });
});

describe("guards", () => {
  const allowed = allowedOrigins(THORBURN_CONFIG, "https://app.gardenproof.test");
  it("allows the tenant site with and without www, the app and localhost", () => {
    expect(isAllowedOrigin("https://www.thorburnlandscapes.co.uk", allowed)).toBe(true);
    expect(isAllowedOrigin("https://thorburnlandscapes.co.uk", allowed)).toBe(true);
    expect(isAllowedOrigin("https://app.gardenproof.test", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:8080", allowed)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("https://thorburnlandscapes.co.uk.evil.example", allowed)).toBe(false);
  });
  it("rate-limits per key within the window", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(check("ip", 0).ok).toBe(true);
    expect(check("ip", 10).ok).toBe(true);
    const third = check("ip", 20);
    expect(third).toEqual({ ok: false, retryAfterSec: 1 });
    expect(check("other", 20).ok).toBe(true);
    expect(check("ip", 1001).ok).toBe(true);
  });
});

describe("POST /api/leads", () => {
  beforeAll(seedBase, 120_000);
  let ip = 0;
  const post = (body: unknown, origin = "https://www.thorburnlandscapes.co.uk", contentType = "text/plain;charset=UTF-8") =>
    POST(
      new Request("http://app.test/api/leads?tenant=thorburn", {
        method: "POST",
        headers: { origin, "content-type": contentType, "x-forwarded-for": `10.0.0.${++ip}` },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("stores a lead with attribution and maps utm_content to an existing asset", async () => {
    const adId = await insertAsset({ jobId: "job_patio", type: "ad_copy", status: "published", title: "Ads", content: patioAds });
    const res = await post({
      tenant: "thorburn",
      name: "Ann",
      email: "ann@example.co.uk",
      message: "Patio quote please",
      projectSlug: "indian-sandstone-circle-patio-putney",
      first: { source: "facebook", medium: "paid_social", content: `asset_${adId}`, landingPage: "https://www.thorburnlandscapes.co.uk/projects/x/" },
      last: { fbclid: "fb.1" },
      hp: "",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.thorburnlandscapes.co.uk");
    const { id } = await res.json();
    const db = await getDb();
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    expect(lead).toMatchObject({ assetId: adId, source: "facebook", fbclid: "fb.1", projectSlug: "indian-sandstone-circle-patio-putney", email: "ann@example.co.uk" });
    const events = await db.select().from(schema.events).where(eq(schema.events.entityId, id));
    expect(events[0].type).toBe("lead.received");
  });

  it("keeps the full first and last touch in leads.attribution and attributes video creatives too", async () => {
    const videoId = await insertAsset({ jobId: "job_pond", type: "video", status: "published", title: "Reveal", content: patioVideo });
    const first = { source: "facebook", medium: "paid_social", campaign: "gp_tl-4821", content: `asset_${videoId}`, fbclid: "fb.9", landingPage: "https://www.thorburnlandscapes.co.uk/projects/pond/", ts: 1700000000000 };
    const last = { source: "google", medium: "organic", referrer: "https://www.google.co.uk/", ts: 1700000500000 };
    const res = await post({ email: "v@example.co.uk", first, last });
    expect(res.status).toBe(201);
    const db = await getDb();
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, (await res.json()).id));
    expect(lead.assetId).toBe(videoId);
    expect(lead).toMatchObject({ source: "facebook", content: `asset_${videoId}`, fbclid: "fb.9" });
    expect(lead.attribution).toEqual({ first, last });
  });

  it("ignores unknown asset ids instead of failing", async () => {
    const res = await post({ phone: "07700 900123", first: { content: "asset_ast_doesnotexist" } }, "https://www.thorburnlandscapes.co.uk", "application/json");
    expect(res.status).toBe(201);
    const db = await getDb();
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, (await res.json()).id));
    expect(lead.assetId).toBeNull();
    expect(lead.source).toBe("direct");
  });

  it("silently accepts but drops honeypot submissions", async () => {
    const db = await getDb();
    const before = (await db.select().from(schema.leads)).length;
    const res = await post({ email: "bot@spam.test", hp: "http://spam" });
    expect(res.status).toBe(200);
    expect((await db.select().from(schema.leads)).length).toBe(before);
  });

  it("rejects invalid payloads, bad JSON and foreign origins", async () => {
    expect((await post({ name: "No contact" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    const foreign = await post({ email: "a@b.co" }, "https://evil.example");
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate-limits repeated posts from one IP", async () => {
    const req = () =>
      POST(
        new Request("http://app.test/api/leads", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email: "x@y.co" }),
        }),
      );
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await req()).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("answers CORS preflight for allowed origins only", async () => {
    const pre = (origin: string) =>
      OPTIONS(new Request("http://app.test/api/leads?tenant=thorburn", { method: "OPTIONS", headers: { origin } }));
    const ok = await pre("https://thorburnlandscapes.co.uk");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
    expect((await pre("https://evil.example")).status).toBe(403);
  });
});
