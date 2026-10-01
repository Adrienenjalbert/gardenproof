import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  authMode,
  createSessionToken,
  isPublicPath,
  passwordMatches,
  safeEqual,
  safeNextPath,
  verifySessionToken,
} from "./auth";

describe("isPublicPath", () => {
  it.each([
    "/r/abc123",
    "/api/cron/testimonials",
    "/gp-track.js",
    "/preview/ast_1",
    "/portfolio",
    "/portfolio/putney",
    "/api/whatsapp/webhook",
    "/api/leads",
    "/api/media/thorburn/x.jpg",
    "/api/export/portfolio.json",
    "/login",
    "/_next/static/chunk.js",
    "/favicon.ico",
  ])("%s is public", (p) => expect(isPublicPath(p)).toBe(true));

  it.each(["/", "/jobs", "/jobs/job_1", "/showcase", "/more/team", "/start", "/ops", "/ops/jobs/job_1", "/ops/review", "/ops/messages", "/ops/leads", "/ops/media/m_1", "/simulator", "/api/simulator/send", "/api/export/other", "/portfolios"])(
    "%s is protected",
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});

describe("session tokens", () => {
  const now = 1_800_000_000_000;
  it("round-trips and expires", async () => {
    const t = await createSessionToken("s3cret", now);
    expect(await verifySessionToken(t, "s3cret", now + 1000)).toBe(true);
    expect(await verifySessionToken(t, "s3cret", now + SESSION_TTL_MS + 1)).toBe(false);
  });
  it("rejects wrong secret, tampering and junk", async () => {
    const t = await createSessionToken("s3cret", now);
    expect(await verifySessionToken(t, "other", now)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1000}.${sig}`, "s3cret", now)).toBe(false);
    for (const junk of [undefined, "", "abc", "1.2.3", "x.y"]) {
      expect(await verifySessionToken(junk, "s3cret", now)).toBe(false);
    }
  });
});

describe("password + redirects", () => {
  it("compares passwords in constant time", async () => {
    expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(await passwordMatches("hunter", "hunter2")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("only allows same-site relative next paths", () => {
    expect(safeNextPath("/jobs/job_1?tab=media")).toBe("/jobs/job_1?tab=media");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it.each([
    "/\t/evil.example", // tab stripped by browsers → //evil.example (CODE_REVIEW P2-1)
    "/%09/evil.example",
    "/\n/evil.example",
    "/%0D%0A/evil.example",
    "%2F%2Fevil.example",
    "/%5C%5Cevil.example",
    "\\evil.example",
    " //evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
    "http:/evil.example",
    "/login?next=//evil",
    "/%E0%A4%A", // malformed escape
  ])("rejects %j", (next) => expect(safeNextPath(next)).toBe("/"));

  it("keeps query and hash on legitimate paths", () => {
    expect(safeNextPath("/review#job-job_1")).toBe("/review#job-job_1");
    expect(safeNextPath("/leads?days=30")).toBe("/leads?days=30");
  });
});

describe("session versions", () => {
  const now = 1_800_000_000_000;
  it("invalidates cookies signed under an older SESSION_VERSION", async () => {
    const t = await createSessionToken("s3cret", now, "1");
    expect(await verifySessionToken(t, "s3cret", now, "1")).toBe(true);
    expect(await verifySessionToken(t, "s3cret", now, "2")).toBe(false);
  });
});

describe("authMode", () => {
  it("enforces when a password is set", () => {
    expect(authMode({ ADMIN_PASSWORD: "x", NODE_ENV: "production" })).toBe("enforced");
  });
  it("stays open for the local zero-config demo", () => {
    expect(authMode({ NODE_ENV: "development" })).toBe("open");
    expect(authMode({ NODE_ENV: "test" })).toBe("open");
    expect(authMode({ NODE_ENV: "production", DEMO_MODE: "on" })).toBe("open");
  });
  it("refuses to leave a production dashboard open (P1-2)", () => {
    expect(authMode({ NODE_ENV: "production" })).toBe("misconfigured");
    expect(authMode({ NODE_ENV: "production", DEMO_MODE: "off" })).toBe("misconfigured");
  });
});
