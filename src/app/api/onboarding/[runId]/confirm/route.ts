/**
 * POST /api/onboarding/<runId>/confirm  { edits?: OnboardingEdits, tenantId?: string }
 * → { tenantId, slug, profile }. Writes the confirmed profile into tenants.profile (creating the tenant if needed).
 * Edits may correct words and remove items; verification, ratings and review text can't be made up (see confirm.ts).
 */
import { z } from "zod";
import { confirmOnboarding } from "@/lib/intel";
import { errorResponse, guard, json, readJson } from "../../_shared";

const BodySchema = z.object({ edits: z.unknown().optional(), tenantId: z.string().min(1).max(64).optional() }).strict();

export async function POST(req: Request, ctx: RouteContext<"/api/onboarding/[runId]/confirm">) {
  const denied = await guard(req);
  if (denied) return denied;
  const { runId } = await ctx.params;
  if (!/^onb_[A-Za-z0-9_-]{8,40}$/.test(runId)) return json(404, { error: "Not found" });
  const body = await readJson(req, 512 * 1024);
  if (!body.ok) return body.res;
  const parsed = BodySchema.safeParse(body.body);
  if (!parsed.success) return json(400, { error: "Invalid request" });
  try {
    return json(200, await confirmOnboarding(runId, parsed.data.edits ?? {}, parsed.data.tenantId ?? null));
  } catch (err) {
    return errorResponse(err);
  }
}
