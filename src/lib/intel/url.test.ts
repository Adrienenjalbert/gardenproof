import { describe, expect, it } from "vitest";
import { absolutise, canonicalUrl, checkPublicHttpsUrl, isPrivateIp, normaliseSiteUrl } from "./url";

const lookup = (ips: string[]) => async () => ips;

describe("checkPublicHttpsUrl", () => {
  it("accepts a public https site", async () => {
    expect(await checkPublicHttpsUrl("https://thorburnlandscapes.co.uk/", lookup(["92.205.144.189"]))).toEqual({ ok: true, url: "https://thorburnlandscapes.co.uk/" });
  });
  it.each([
    ["http://thorburnlandscapes.co.uk/", "https"],
    ["https://localhost/", "public"],
    ["https://127.0.0.1/", "public"],
    ["https://[::1]/", "public"],
    ["https://169.254.169.254/latest/meta-data", "public"],
    ["https://10.0.0.5/", "public"],
    ["https://user:pw@example.co.uk/", "login"],
    ["https://example.co.uk:8443/", "normal web address"],
    ["https://intranet/", "public"],
    ["not a url", "web address"],
  ])("refuses %s", async (url, reason) => {
    const r = await checkPublicHttpsUrl(url, lookup(["93.184.216.34"]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(new RegExp(reason, "i"));
  });
  it("refuses hostnames that resolve to private addresses (DNS rebinding style)", async () => {
    expect((await checkPublicHttpsUrl("https://sneaky.example.com/", lookup(["93.184.216.34", "192.168.1.10"]))).ok).toBe(false);
    expect((await checkPublicHttpsUrl("https://gone.example.com/", async () => Promise.reject(new Error("ENOTFOUND")))).ok).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it.each([
    ["10.1.2.3", true], ["172.16.0.1", true], ["172.32.0.1", false], ["192.168.0.1", true], ["100.64.0.1", true], ["8.8.8.8", false],
    ["::1", true], ["fd00::1", true], ["fe80::1", true], ["::ffff:127.0.0.1", true], ["2a00:1450:4009::1", false],
  ])("%s → %s", (ip, priv) => expect(isPrivateIp(ip)).toBe(priv));
});

describe("url helpers", () => {
  it("normalises what owners paste", () => {
    expect(normaliseSiteUrl("thorburnlandscapes.co.uk")).toBe("https://thorburnlandscapes.co.uk/");
    expect(normaliseSiteUrl(" https://www.x.co.uk/about#team ")).toBe("https://www.x.co.uk/about");
    expect(normaliseSiteUrl("ftp://x.co.uk")).toBeNull();
    expect(normaliseSiteUrl("hello")).toBeNull();
  });
  it("absolutises safely", () => {
    expect(absolutise("/a/b", "https://x.co.uk/c/")).toBe("https://x.co.uk/a/b");
    expect(absolutise("mailto: Info@x.co.uk", "https://x.co.uk/")).toBe("mailto:Info@x.co.uk");
    expect(absolutise("#", "https://x.co.uk/")).toBeNull();
    expect(absolutise("vbscript:msgbox(1)", "https://x.co.uk/")).toBeNull();
  });
  it("canonicalises for de-duplication", () => {
    expect(canonicalUrl("https://www.facebook.com/Page/?utm_source=x#top")).toBe(canonicalUrl("https://facebook.com/page"));
  });
});
