/** POST /api/forms/<token>/complete — finish the form (idempotent). */
import { z } from "zod";
import { completeForm } from "@/lib/forms";
import { formErrorResponse, guard, json, readJson } from "../../guards";

const BodySchema = z.object({}).strict();

export async function POST(req: Request, ctx: RouteContext<"/api/forms/[token]/complete">) {
  const { token } = await ctx.params;
  const refused = guard(req, token, "complete");
  if (refused) return refused;
  const body = await readJson(req, BodySchema);
  if (!body.ok) return body.res;
  try {
    const done = await completeForm(token, { source: "web" });
    return json(200, { ok: true, alreadyCompleted: done.alreadyCompleted });
  } catch (err) {
    return formErrorResponse(err);
  }
}
