/** P0-1 (originals never public), QA B4 (byte ranges) and exports behind the dashboard session. */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { GET as mediaGet, HEAD as mediaHead } from "@/app/api/media/[...key]/route";
import { GET as exportGet } from "@/app/api/export/[assetId]/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/dashboard/auth";
import { cookieValue } from "@/lib/publish/access";
import { publishAsset } from "@/lib/publish";
import { parseRange } from "@/lib/publish/serve-file";
import { putObject } from "@/lib/storage";
import { patioAds, patioVideo } from "../fixtures/mod-d";
import { insertAsset, insertImage, insertJob, insertTestimonial, seedBase } from "../fixtures/mod-d-db";

const PASSWORD = "correct horse battery staple";
let session = "";

beforeAll(async () => {
  await seedBase();
  session = `${SESSION_COOKIE}=${encodeURIComponent(await createSessionToken(PASSWORD))}`;
}, 120_000);
beforeEach(() => vi.stubEnv("ADMIN_PASSWORD", PASSWORD));
afterEach(() => vi.unstubAllEnvs());

const media = (key: string, headers: Record<string, string> = {}, method = "GET") => {
  const req = new Request(`http://t/api/media/${key}`, { method, headers });
  const ctx = { params: Promise.resolve({ key: key.split("/") }) } as RouteContext<"/api/media/[...key]">;
  return method === "HEAD" ? mediaHead(req, ctx) : mediaGet(req, ctx);
};

describe("/api/media access rules", () => {
  it("serves the public derivative to anyone but never the original (EXIF/GPS)", async () => {
    const job = await insertJob("job_media_a");
    const img = await insertImage(job, 1);
    const pub = await media(img.publicKey);
    expect(pub.status).toBe(200);
    expect(await pub.text()).toBe("public-1");
    expect(pub.headers.get("cache-control")).toBe("public, max-age=300");

    const original = await media(img.storageKey);
    expect(original.status).toBe(404);
    expect(await original.text()).not.toContain("gps");
  });

  it("serves originals, voice notes and anything else in storage to the signed-in operator", async () => {
    const job = await insertJob("job_media_b");
    const img = await insertImage(job, 1);
    const res = await media(img.storageKey, { cookie: `other=1; ${session}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("original-with-gps-1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const voice = await putObject(`thorburn/${job}/brief-1.ogg`, Buffer.from("voice"));
    expect((await media(voice)).status).toBe(404);
    expect((await media(voice, { cookie: session })).status).toBe(200);
    // a forged or stale cookie is just a visitor
    expect((await media(img.storageKey, { cookie: `${SESSION_COOKIE}=1.forged` })).status).toBe(404);
  });

  it("is open in the zero-config local demo but closed in a misconfigured production deploy", async () => {
    const job = await insertJob("job_media_c");
    const img = await insertImage(job, 1);
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await media(img.storageKey)).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    expect((await media(img.storageKey)).status).toBe(404);
    expect((await media(img.publicKey)).status).toBe(200);
  });

  it("withholds 'needs blur' photos until a blurred copy exists or the operator cleared them", async () => {
    const job = await insertJob("job_media_d");
    const pending = await insertImage(job, 1, { qualityNotes: "House number visible — needs blur" });
    const blurred = await insertImage(job, 2, { qualityNotes: "needs blur", blurredKey: `thorburn/${job}/after-2.blurred.jpg` });
    const cleared = await insertImage(job, 3, { qualityNotes: "needs blur", privacyClearedAt: new Date() });
    expect((await media(pending.publicKey)).status).toBe(404);
    expect((await media(blurred.publicKey)).status).toBe(404);
    expect(await (await media(`thorburn/${job}/after-2.blurred.jpg`)).text()).toBe("blurred-2");
    expect((await media(cleared.publicKey)).status).toBe(200);
  });

  it("stops serving a job's photos once the homeowner refused or withdrew photo consent", async () => {
    const refused = await insertJob("job_media_e");
    const a = await insertImage(refused, 1);
    await insertTestimonial(refused, { consentPhotos: false });
    expect((await media(a.publicKey)).status).toBe(404);

    const withdrawn = await insertJob("job_media_f");
    const b = await insertImage(withdrawn, 1);
    await insertTestimonial(withdrawn);
    expect((await media(b.publicKey)).status).toBe(200);
    await insertTestimonial(withdrawn, { withdrawnAt: new Date() });
    expect((await media(b.publicKey)).status).toBe(404);
  });

  it("serves rendered files of published assets only", async () => {
    const job = await insertJob("job_media_g");
    const fileKey = await putObject(`thorburn/${job}/video/reveal-9x16.mp4`, Buffer.from("0123456789"));
    const thumb = await putObject(`thorburn/${job}/video/reveal-9x16.jpg`, Buffer.from("thumb"));
    const id = await insertAsset({ jobId: job, type: "video", status: "in_review", title: "Reveal", content: patioVideo, fileKey });
    const db = await getDb();
    await db.update(schema.assets).set({ thumbnailKey: thumb }).where(eq(schema.assets.id, id));
    expect((await media(fileKey)).status).toBe(404);
    expect((await media(fileKey, { cookie: session })).status).toBe(200);
    await db.update(schema.assets).set({ status: "published" }).where(eq(schema.assets.id, id));
    expect((await media(fileKey)).status).toBe(200);
    expect((await media(thumb)).status).toBe(200);
  });

  it("rejects traversal-looking keys", async () => {
    expect((await media("thorburn/../../etc/passwd", { cookie: session })).status).toBe(404);
  });
});

describe("byte ranges (iOS Safari video playback, seeking)", () => {
  let key = "";
  beforeAll(async () => {
    const job = await insertJob("job_range");
    key = await putObject(`thorburn/${job}/video/proof-1x1.mp4`, Buffer.from("0123456789"));
    const id = await insertAsset({ jobId: job, type: "video", status: "published", title: "Proof", content: patioVideo, fileKey: key });
    expect(id).toBeTruthy();
  });

  it("parses single ranges and flags unsatisfiable ones", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=5-999", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
    expect(parseRange("items=0-1", 10)).toBeNull();
    expect(parseRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=abc", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
  });

  it("answers a full GET with Content-Length and Accept-Ranges", async () => {
    const res = await media(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("0123456789");
  });

  it("returns 206 with Content-Range for a range and 416 for a bad one", async () => {
    const part = await media(key, { range: "bytes=2-5" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(part.headers.get("content-length")).toBe("4");
    expect(await part.text()).toBe("2345");

    const probe = await media(key, { range: "bytes=0-1" }); // Safari's first probe
    expect(await probe.text()).toBe("01");

    const bad = await media(key, { range: "bytes=50-60" });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");
  });

  it("supports HEAD without a body", async () => {
    const res = await media(key, { range: "bytes=0-4" }, "HEAD");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("");
  });
});

describe("/api/export stays behind the dashboard session", () => {
  it("404s for visitors, serves the operator (with ranges for the mp4s)", async () => {
    const job = await insertJob("job_export_auth");
    const videoKey = await putObject(`thorburn/${job}/video/reveal-1x1.mp4`, Buffer.from("abcdefghij"));
    const videoId = await insertAsset({ jobId: job, type: "video", status: "approved", title: "Reveal", content: patioVideo, fileKey: videoKey });
    const adId = await insertAsset({ jobId: job, type: "ad_copy", status: "approved", title: "Ads", content: patioAds });
    await publishAsset(adId);
    const ctx = { params: Promise.resolve({ assetId: adId }) } as RouteContext<"/api/export/[assetId]">;
    const get = (qs = "", headers: Record<string, string> = {}) =>
      exportGet(new Request(`http://t/api/export/${adId}${qs}`, { headers }), ctx);

    expect((await get()).status).toBe(404);
    expect((await get("?file=meta-ads.csv")).status).toBe(404);
    expect((await get("", { cookie: session })).status).toBe(200);
    const name = `${patioVideo.template}-${patioVideo.ratio.replace(":", "x")}-${videoId}.mp4`.toLowerCase();
    const file = `?file=${encodeURIComponent(name)}`;
    const part = await get(file, { cookie: session, range: "bytes=0-2" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("abc");
    expect(part.headers.get("content-disposition")).toContain("attachment");

    // the export folder itself is not reachable through /api/media either
    const [asset] = await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, adId));
    expect((await media(`${asset.externalId}/meta-ads.csv`)).status).toBe(404);
  });
});

describe("cookieValue", () => {
  it("finds a cookie among several and tolerates junk", () => {
    expect(cookieValue("a=1; gp_session=x%2Ey; b", "gp_session")).toBe("x.y");
    expect(cookieValue("gp_sessionx=1", "gp_session")).toBeNull();
    expect(cookieValue(null, "gp_session")).toBeNull();
    expect(cookieValue("gp_session=%E0%A4%A", "gp_session")).toBeNull();
  });
});
