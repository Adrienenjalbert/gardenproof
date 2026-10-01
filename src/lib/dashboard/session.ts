/**
 * Server-side session helpers. Server Actions are reachable by direct POST, so every dashboard action
 * re-checks the session here instead of trusting proxy.ts alone.
 */
import { cookies } from "next/headers";
import { MISCONFIGURED_MESSAGE, SESSION_COOKIE, authMode, verifySessionToken } from "./auth";

export const isAuthEnabled = () => authMode() === "enforced";

export class UnauthorisedError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
  }
}

export async function requireAgency(): Promise<void> {
  const mode = authMode();
  if (mode === "open") return; // local demo: no auth configured
  if (mode === "misconfigured") throw new UnauthorisedError(MISCONFIGURED_MESSAGE);
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value, process.env.ADMIN_PASSWORD ?? ""))) {
    throw new UnauthorisedError();
  }
}
