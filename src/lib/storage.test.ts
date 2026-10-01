import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getObject, localObjectPath, objectPath, putObject, safeKey, supabaseAdapter, supabaseConfig } from "./storage";

const cfg = { url: "https://proj.supabase.co", serviceKey: "service-key", bucket: "media" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("storage keys", () => {
  it("rejects traversal", () => {
    expect(() => safeKey("../etc/passwd")).toThrow();
    expect(safeKey("/a/./b/../c.jpg")).toBe("a/c.jpg");
  });
});

describe("local adapter (default)", () => {
  it("round-trips and exposes a real path", async () => {
    await putObject("unit/storage/a.txt", Buffer.from("hello"));
    expect((await getObject("unit/storage/a.txt")).toString()).toBe("hello");
    expect(await fs.readFile(objectPath("unit/storage/a.txt"), "utf8")).toBe("hello");
    expect(await localObjectPath("unit/storage/a.txt")).toBe(objectPath("unit/storage/a.txt"));
  });
});

describe("Supabase adapter", () => {
  it("is selected only when all three variables are set", () => {
    expect(supabaseConfig({ SUPABASE_URL: cfg.url, SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeNull();
    expect(supabaseConfig({ SUPABASE_URL: cfg.url, SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_BUCKET: "b" })).toEqual({ url: cfg.url, serviceKey: "k", bucket: "b" });
  });

  it("uploads with upsert and service-role auth, downloads, checks existence and deletes", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") return new Response("{}", { status: 200 });
      if (init?.method === "HEAD") return new Response(null, { status: u.includes("missing") ? 400 : 200 });
      if (init?.method === "DELETE") return new Response("[]", { status: 200 });
      if (u.includes("missing")) return new Response('{"error":"not_found"}', { status: 400 });
      return new Response("bytes", { status: 200 });
    });
    const s = supabaseAdapter(cfg, fetchImpl as unknown as typeof fetch);
    await s.put("thorburn/job 1/a.jpg", Buffer.from("x"), "image/jpeg");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/media/thorburn/job%201/a.jpg");
    expect(init.headers).toMatchObject({ authorization: "Bearer service-key", apikey: "service-key", "x-upsert": "true", "content-type": "image/jpeg" });
    expect((await s.get("thorburn/a.jpg")).toString()).toBe("bytes");
    await expect(s.get("thorburn/missing.jpg")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await s.exists("thorburn/a.jpg")).toBe(true);
    expect(await s.exists("thorburn/missing.jpg")).toBe(false);
    await s.remove("thorburn/a.jpg");
    const del = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(del[0]).toBe("https://proj.supabase.co/storage/v1/object/media");
    expect(JSON.parse(String(del[1].body))).toEqual({ prefixes: ["thorburn/a.jpg"] });
  });

  it("surfaces upload errors", async () => {
    const s = supabaseAdapter(cfg, (async () => new Response("quota", { status: 413 })) as unknown as typeof fetch);
    await expect(s.put("a.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow(/413/);
  });

  it("gives renderers a downloaded temp file when storage is remote; objectPath refuses", async () => {
    vi.stubEnv("SUPABASE_URL", cfg.url);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", cfg.serviceKey);
    vi.stubEnv("SUPABASE_BUCKET", cfg.bucket);
    const fetchMock = vi.fn(async () => new Response("remote-bytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const key = `unit/remote-${Date.now()}.jpg`;
    const file = await localObjectPath(key);
    expect(await fs.readFile(file, "utf8")).toBe("remote-bytes");
    await localObjectPath(key); // cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => objectPath(key)).toThrow(/localObjectPath/);
  });
});
