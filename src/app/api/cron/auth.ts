import { createHash, timingSafeEqual } from "node:crypto";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Constant-time `Authorization: Bearer <CRON_SECRET>` check (hashing first makes the lengths equal). */
export function isAuthorised(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
