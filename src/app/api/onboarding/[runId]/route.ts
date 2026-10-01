/** GET /api/onboarding/<runId> → progress (plain-English steps) and the draft profile. Dashboard-only. */
import { getOnboardingRun } from "@/lib/intel";
import { guard, json, runView } from "../_shared";

export async function GET(req: Request, ctx: RouteContext<"/api/onboarding/[runId]">) {
  const denied = await guard(req);
  if (denied) return denied;
  const { runId } = await ctx.params;
  if (!/^onb_[A-Za-z0-9_-]{8,40}$/.test(runId)) return json(404, { error: "Not found" });
  const run = await getOnboardingRun(runId);
  return run ? json(200, runView(run)) : json(404, { error: "Not found" });
}
