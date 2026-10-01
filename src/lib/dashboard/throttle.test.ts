import { describe, expect, it } from "vitest";
import { LoginThrottle, clientIp } from "./throttle";

describe("LoginThrottle", () => {
  const opts = { perIp: 3, global: 5, windowMs: 60_000 };

  it("locks an IP after N failures until the window resets", () => {
    const t = new LoginThrottle(opts);
    for (let i = 0; i < 3; i++) t.recordFailure("1.1.1.1", 1000);
    expect(t.retryAfter("1.1.1.1", 2000)).toBe(59_000);
    expect(t.retryAfter("2.2.2.2", 2000)).toBe(0);
    expect(t.retryAfter("1.1.1.1", 61_001)).toBe(0);
  });

  it("applies a global cap across IPs", () => {
    const t = new LoginThrottle(opts);
    for (let i = 0; i < 5; i++) t.recordFailure(`10.0.0.${i}`, 1000);
    expect(t.retryAfter("9.9.9.9", 1000)).toBeGreaterThan(0);
  });

  it("clears an IP's failures on success", () => {
    const t = new LoginThrottle(opts);
    t.recordFailure("1.1.1.1", 0);
    t.recordFailure("1.1.1.1", 0);
    t.recordSuccess("1.1.1.1");
    t.recordFailure("1.1.1.1", 0);
    expect(t.retryAfter("1.1.1.1", 0)).toBe(0);
  });
});

describe("clientIp", () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
  it("uses the first forwarded address", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
