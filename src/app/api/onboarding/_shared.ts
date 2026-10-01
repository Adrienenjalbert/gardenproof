/**
 * Shared bits for /api/onboarding/*: operator check (proxy.ts already gates /api/*; this is defence in depth),
 * JSON body parsing with a size cap, and mapping OnboardingError codes to HTTP statuses.
 */
import { OnboardingError, type BusinessProfile } from "@/lib/intel";
import type { OnboardingRun } from "@/db/schema";
import { requestIsOperator } from "@/lib/publish/access";

export const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function guard(req: Request): Promise<Response | null> {
  return (await requestIsOperator(req)) ? null : json(401, { error: "Unauthorised" });
}

export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const raw = await req.text();
  if (raw.length > maxBytes) return { ok: false, res: json(413, { error: "Request too large" }) };
  try {
    return { ok: true, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, res: json(400, { error: "Body must be JSON" }) };
  }
}

const STATUS: Record<OnboardingError["code"], number> = { invalid_url: 400, invalid_edits: 400, not_found: 404, not_ready: 409, conflict: 409 };

export function errorResponse(err: unknown): Response {
  if (err instanceof OnboardingError) return json(STATUS[err.code], { error: err.message, code: err.code });
  console.error("[onboarding]", err);
  return json(500, { error: "Something went wrong. Please try again." });
}

/** What the owner app needs to render progress and the confirm screen. */
export function runView(run: OnboardingRun): {
  id: string;
  url: string;
  status: OnboardingRun["status"];
  steps: OnboardingRun["steps"];
  profile: BusinessProfile | null;
  error: string | null;
  tenantId: string | null;
} {
  return { id: run.id, url: run.url, status: run.status, steps: run.steps, profile: run.profile ?? null, error: run.error, tenantId: run.tenantId };
}
