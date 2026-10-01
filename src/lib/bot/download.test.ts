import { describe, expect, it, vi } from "vitest";
import { downloadInboundMedia, isAllowedMediaHost } from "./download";

const TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1";
const ok = (body: BodyInit, type = "image/jpeg", extra: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": type, ...extra } });

describe("isAllowedMediaHost", () => {
  it("allows only https Twilio hosts", () => {
    expect(isAllowedMediaHost(TWILIO_URL)).toBe(true);
    expect(isAllowedMediaHost("https://media.twiliocdn.com/x.jpg")).toBe(true);
    expect(isAllowedMediaHost("https://mms.twilio.com/x")).toBe(true);
    for (const bad of [
      "http://api.twilio.com/x", // not https
      "https://api.twilio.com.evil.example/x",
      "https://eviltwilio.com/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://user:pw@api.twilio.com/x",
      "https://api.twilio.com:8443/x",
      "not a url",
    ]) {
      expect(isAllowedMediaHost(bad), bad).toBe(false);
    }
  });
});

describe("downloadInboundMedia", () => {
  it("downloads with basic auth, following a redirect to the CDN without leaking the auth header", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === TWILIO_URL) return new Response(null, { status: 307, headers: { location: "https://media.twiliocdn.com/abc.jpg" } });
      return ok(Buffer.from("jpegbytes"));
    });
    const got = await downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", authorization: "Basic xyz", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(got).toEqual({ data: Buffer.from("jpegbytes"), mimeType: "image/jpeg" });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe("Basic xyz");
    expect((calls[1][1].headers as Record<string, string>).authorization).toBeUndefined();
    expect(calls[0][1].redirect).toBe("manual");
  });

  it("refuses a redirect off the allow-list (SSRF)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } }));
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/host not allowed/);
  });

  it("refuses disallowed declared or served types", async () => {
    const fetchImpl = vi.fn(async () => ok("<html>", "text/html"));
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "application/pdf", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/type not allowed/);
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/served type not allowed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the declared type for a generic octet-stream", async () => {
    const fetchImpl = vi.fn(async () => ok("BEGIN:VCARD", "application/octet-stream"));
    const got = await downloadInboundMedia(TWILIO_URL, { declaredType: "text/x-vcard", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(got.mimeType).toBe("text/x-vcard");
  });

  it("caps the size, by header and while streaming", async () => {
    const big = vi.fn(async () => ok("x", "image/jpeg", { "content-length": String(50 * 1024 * 1024) }));
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", fetchImpl: big as unknown as typeof fetch })).rejects.toThrow(/too large/);
    const lying = vi.fn(async () => ok(Buffer.alloc(2048), "image/jpeg"));
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", maxBytes: 1024, fetchImpl: lying as unknown as typeof fetch })).rejects.toThrow(/too large/);
  });

  it("times out", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    await expect(downloadInboundMedia(TWILIO_URL, { declaredType: "image/jpeg", timeoutMs: 50, fetchImpl: hang as unknown as typeof fetch })).rejects.toThrow(/aborted/);
  });
});
