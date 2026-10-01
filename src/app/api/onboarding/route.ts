/**
 * POST /api/onboarding  { url }  → 202 { runId }
 * Starts onboarding from the business's website (the pipeline runs in the background; poll GET /api/onboarding/<runId>).
 * Dashboard-only. https only; private/internal addresses are refused (see checkPublicHttpsUrl).
 */
import { z } from "zod";
import { startOnboarding } from "@/lib/intel";
import { errorResponse, guard, json, readJson } from "./_shared";

const BodySchema = z.object({ url: z.string().trim().min(3).max(2048), tenantId: z.string().min(1).max(64).optional() }).strict();

/** Each run spends Firecrawl credits: a small per-instance cap stops accidental loops. */
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 20;
let window = { start: 0, count: 0 };

export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = await readJson(req, 8 * 1024);
  if (!body.ok) return body.res;
  const parsed = BodySchema.safeParse(body.body);
  if (!parsed.success) return json(400, { error: "Please enter your website address." });
  if (/^http:\/\//i.test(parsed.data.url)) return json(400, { error: "Please use an https:// address.", code: "invalid_url" });

  const now = Date.now();
  if (now - window.start > WINDOW_MS) window = { start: now, count: 0 };
  if (window.count >= MAX_PER_WINDOW) return json(429, { error: "Too many website checks in the last hour. Try again later." });
  window.count++;

  try {
    const { runId } = await startOnboarding(parsed.data.url, { tenantId: parsed.data.tenantId ?? null });
    return json(202, { runId });
  } catch (err) {
    return errorResponse(err);
  }
}
