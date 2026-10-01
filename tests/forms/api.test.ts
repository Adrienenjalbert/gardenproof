import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { T, seedTenant } from "@/lib/bot/test-fixtures";
import { createFormLink, getForm, saveAnswer } from "@/lib/forms";
import { POST as answer } from "@/app/api/forms/[token]/answer/route";
import { POST as complete } from "@/app/api/forms/[token]/complete/route";
import { POST as upload } from "@/app/api/forms/[token]/upload/route";
import { GET as photo } from "@/app/api/forms/[token]/photo/[photoId]/route";
import { GET as enquire } from "@/app/enquire/[tenantSlug]/route";
import { isSameOrigin } from "@/app/api/forms/guards";

beforeAll(() => seedTenant(), 120_000);

const APP = "http://localhost:3000";
let ip = 0;
/** A fresh client IP per request keeps the in-memory rate limiter out of the way (except where tested). */
const headers = (extra: Record<string, string> = {}) => ({ origin: APP, "x-forwarded-for": `10.0.0.${++ip % 250}`, ...extra });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) }) as never;
const json = (token: string, route: "answer" | "complete", body: unknown, extra: Record<string, string> = {}) =>
  new Request(`${APP}/api/forms/${token}/${route}`, { method: "POST", headers: headers({ "content-type": "application/json", ...extra }), body: typeof body === "string" ? body : JSON.stringify(body) });

async function newForm() {
  return createFormLink({ tenantId: T, kind: "maintenance_visit", customerId: "cus_harriet" });
}

describe("same-origin (CSRF) check", () => {
  it("accepts same-origin and non-browser requests, refuses cross-site ones", () => {
    const r = (h: Record<string, string>) => new Request(`${APP}/api/forms/x/answer`, { method: "POST", headers: h });
    expect(isSameOrigin(r({ origin: APP }))).toBe(true);
    expect(isSameOrigin(r({}))).toBe(true);
    expect(isSameOrigin(r({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(r({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(r({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(r({ origin: "https://forms.example", host: "forms.example", "x-forwarded-proto": "https" }))).toBe(true);
  });
});

describe("POST /api/forms/<token>/answer", () => {
  it("saves a valid answer", async () => {
    const { token } = await newForm();
    const res = await answer(json(token, "answer", { stepId: "feeling", value: "issue" }), ctx({ token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, value: "issue", remaining: 3, answers: { feeling: "issue" } });
  });

  it("validates everything at the boundary", async () => {
    const { token } = await newForm();
    const cases: [Request, number][] = [
      [json(token, "answer", { stepId: "feeling", value: "issue" }, { origin: "https://evil.example" }), 403],
      [json(token, "answer", "{nope", {}), 400],
      [json(token, "answer", { stepId: "feeling", value: "x", extra: 1 }), 400],
      [json(token, "answer", { stepId: "../x", value: 1 }), 400],
      [json(token, "answer", { stepId: "feeling", value: "ecstatic" }), 422],
      [json(token, "answer", { stepId: "unknown", value: "x" }), 422],
      [new Request(`${APP}/api/forms/${token}/answer`, { method: "POST", headers: headers({ "content-type": "text/plain" }), body: "{}" }), 415],
      [json(token, "answer", { stepId: "note", value: "x".repeat(40_000) }), 413],
    ];
    for (const [i, [req, status]] of cases.entries()) expect((await answer(req, ctx({ token }))).status, `case ${i}`).toBe(status);
    expect((await answer(json("unknown_token_unknown_token", "answer", { stepId: "feeling", value: "great" }), ctx({ token: "unknown_token_unknown_token" }))).status).toBe(404);
    expect((await answer(json("bad", "answer", { stepId: "feeling", value: "great" }), ctx({ token: "bad" }))).status).toBe(404);
  });

  it("rate-limits one client hammering one form", async () => {
    const { token } = await newForm();
    const fixed = { "x-forwarded-for": "192.0.2.77" };
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await answer(json(token, "answer", { stepId: "feeling", value: "great" }, fixed), ctx({ token }))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/forms/<token>/complete", () => {
  it("says which question is missing, then completes idempotently", async () => {
    const { token } = await newForm();
    const early = await complete(json(token, "complete", {}), ctx({ token }));
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ ok: false, code: "incomplete", stepId: "feeling" });
    await saveAnswer(token, "feeling", "great");
    await saveAnswer(token, "note", null);
    expect(await (await complete(json(token, "complete", {}), ctx({ token }))).json()).toEqual({ ok: true, alreadyCompleted: false });
    expect(await (await complete(json(token, "complete", {}), ctx({ token }))).json()).toEqual({ ok: true, alreadyCompleted: true });
    expect((await answer(json(token, "answer", { stepId: "feeling", value: "fine" }), ctx({ token }))).status).toBe(409);
  });
});

describe("POST /api/forms/<token>/upload + GET photo", () => {
  const multipart = (token: string, blob: Blob, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append("file", blob, "garden.jpg");
    return new Request(`${APP}/api/forms/${token}/upload`, { method: "POST", headers: headers(extra), body: fd });
  };

  it("stores an EXIF-free, resized JPEG readable only through the form link", async () => {
    const { token } = await newForm();
    const img = await sharp({ create: { width: 2600, height: 2600, channels: 3, background: "#6a5" } }).png().toBuffer();
    const res = await upload(multipart(token, new Blob([new Uint8Array(img)], { type: "image/png" })), ctx({ token }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { photo: { id: string; width: number }; url: string };
    expect(body.photo.width).toBe(2000);
    expect(body.url).toBe(`/api/forms/${token}/photo/${body.photo.id}`);
    const got = await photo(new Request(`${APP}${body.url}`, { headers: headers() }), ctx({ token, photoId: body.photo.id }));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    const other = await newForm();
    expect((await photo(new Request(`${APP}/x`, { headers: headers() }), ctx({ token: other.token, photoId: body.photo.id }))).status).toBe(404);
  });

  it("refuses non-images, junk bytes, cross-site posts and finished forms", async () => {
    const { token } = await newForm();
    expect((await upload(multipart(token, new Blob(["hello"], { type: "text/plain" })), ctx({ token }))).status).toBe(415);
    expect((await upload(multipart(token, new Blob(["not really a jpeg"], { type: "image/jpeg" })), ctx({ token }))).status).toBe(422);
    const img = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect((await upload(multipart(token, new Blob([new Uint8Array(img)], { type: "image/jpeg" }), { origin: "https://evil.example" }), ctx({ token }))).status).toBe(403);
    await saveAnswer(token, "feeling", "great");
    await saveAnswer(token, "note", null);
    await complete(json(token, "complete", {}), ctx({ token }));
    expect((await upload(multipart(token, new Blob([new Uint8Array(img)], { type: "image/jpeg" })), ctx({ token }))).status).toBe(409);
  });
});

describe("GET /enquire/<tenantSlug>", () => {
  const get = (qs: string, extra: Record<string, string> = {}) =>
    enquire(new Request(`${APP}/enquire/thorburn${qs}`, { headers: { "x-forwarded-for": `10.1.0.${++ip % 250}`, "user-agent": "Mozilla/5.0 (iPhone)", ...extra } }), ctx({ tenantSlug: "thorburn" }));

  it("creates a saved enquiry with attribution and redirects to it", async () => {
    const res = await get("?service=patio_paving,bogus&utm_source=facebook&utm_medium=paid_social&utm_campaign=spring&utm_content=asset_abc&fbclid=fb1&project=pond-garden", {
      referer: "https://l.facebook.com/",
    });
    expect(res.status).toBe(303);
    const token = res.headers.get("location")!.match(/\/f\/([A-Za-z0-9_-]+)$/)![1];
    expect(res.headers.get("set-cookie")).toMatch(/gp_enq_thorburn=.*Path=\/enquire\/thorburn/i);
    const form = (await getForm(token))!;
    expect(form.row.source).toBe("facebook");
    expect(form.meta).toMatchObject({ prefill: { service: "patio_paving" }, projectSlug: "pond-garden", attribution: { first: { source: "facebook", campaign: "spring", content: "asset_abc", fbclid: "fb1", referrer: "https://l.facebook.com/" } } });
  });

  it("resumes the same browser's unfinished enquiry instead of starting another", async () => {
    const first = await get("");
    const token = first.headers.get("location")!.split("/f/")[1];
    const again = await get("", { cookie: `gp_enq_thorburn=${token}` });
    expect(again.headers.get("location")).toMatch(new RegExp(`/f/${token}$`));
  });

  it("labels directory / Google Business Profile traffic, and gives link-preview bots no form row", async () => {
    const res = await get("?src=directory");
    expect((await getForm(res.headers.get("location")!.split("/f/")[1]))!.row.source).toBe("directory");
    const bot = await get("", { "user-agent": "WhatsApp/2.23.20.0" });
    expect(bot.status).toBe(200);
    expect(await bot.text()).toContain("Tell us about your garden · Thorburn Landscapes");
    const unknown = await enquire(new Request(`${APP}/enquire/nobody`), ctx({ tenantSlug: "nobody" }));
    expect(unknown.status).toBe(404);
  });
});
