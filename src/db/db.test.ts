import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetDbForTests, getDb } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
  __resetDbForTests();
});

describe("getDb", () => {
  it("does not cache a failed connection: the next call retries", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://nobody:nothing@127.0.0.1:1/none?connect_timeout=2");
    await expect(getDb()).rejects.toThrow();
    vi.unstubAllEnvs(); // back to in-memory PGlite
    const db = await getDb();
    const { rows } = (await db.execute("select 1 as one")) as unknown as { rows: { one: number }[] };
    expect(rows[0].one).toBe(1);
  }, 60_000);

  it("returns the same instance to concurrent callers", async () => {
    const [a, b] = await Promise.all([getDb(), getDb()]);
    expect(a).toBe(b);
  }, 60_000);
});
