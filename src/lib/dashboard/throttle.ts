/**
 * Login throttling (P2-5). In-memory fixed windows per IP plus a global cap, which is enough for a single
 * pilot instance; on multiple instances each has its own budget (documented limitation, move to the DB later).
 * Only failed attempts count, so a correct password is never locked out by someone else's typos from another IP
 * unless the global cap trips (a sign of a distributed attack).
 */

export type ThrottleOptions = { perIp: number; global: number; windowMs: number };

export const LOGIN_THROTTLE: ThrottleOptions = { perIp: 5, global: 50, windowMs: 15 * 60_000 };

type Window = { count: number; resetAt: number };

export class LoginThrottle {
  private readonly byIp = new Map<string, Window>();
  private globalWindow: Window = { count: 0, resetAt: 0 };

  constructor(private readonly opts: ThrottleOptions = LOGIN_THROTTLE) {}

  private current(w: Window | undefined, now: number): Window {
    return !w || w.resetAt <= now ? { count: 0, resetAt: now + this.opts.windowMs } : w;
  }

  /** Milliseconds until this IP may try again, or 0 when allowed. */
  retryAfter(ip: string, now = Date.now()): number {
    const ipW = this.current(this.byIp.get(ip), now);
    const g = this.current(this.globalWindow, now);
    const waits = [ipW.count >= this.opts.perIp ? ipW.resetAt - now : 0, g.count >= this.opts.global ? g.resetAt - now : 0];
    return Math.max(...waits);
  }

  recordFailure(ip: string, now = Date.now()): void {
    const ipW = this.current(this.byIp.get(ip), now);
    ipW.count++;
    this.byIp.set(ip, ipW);
    this.globalWindow = this.current(this.globalWindow, now);
    this.globalWindow.count++;
    // Keep the map bounded: drop expired windows opportunistically.
    if (this.byIp.size > 5000) for (const [k, w] of this.byIp) if (w.resetAt <= now) this.byIp.delete(k);
  }

  recordSuccess(ip: string): void {
    this.byIp.delete(ip);
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for; the first entry is the client). */
export function clientIp(h: { get(name: string): string | null }): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}
