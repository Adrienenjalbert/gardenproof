/** POST /api/forms/<token>/answer — save one answer the moment it is given. */
import { z } from "zod";
import { saveAnswer } from "@/lib/forms";
import { formErrorResponse, guard, json, readJson } from "../../guards";

const BodySchema = z.object({ stepId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), value: z.unknown() }).strict();

export async function POST(req: Request, ctx: RouteContext<"/api/forms/[token]/answer">) {
  const { token } = await ctx.params;
  const refused = guard(req, token, "answer");
  if (refused) return refused;
  const body = await readJson(req, BodySchema);
  if (!body.ok) return body.res;
  try {
    const saved = await saveAnswer(token, body.data.stepId, body.data.value ?? null);
    return json(200, { ok: true, ...saved });
  } catch (err) {
    return formErrorResponse(err);
  }
}
