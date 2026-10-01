/** GET /api/forms/<token>/postcode?q=SW195AB — live preview of the area while the postcode is typed. */
import { getForm } from "@/lib/forms";
import { profileFor } from "@/lib/forms/brand";
import { normalisePostcode } from "@/lib/forms/engine";
import { resolvePostcode } from "@/lib/forms/postcode";
import { guard, json } from "../../guards";

export async function GET(req: Request, ctx: RouteContext<"/api/forms/[token]/postcode">) {
  const { token } = await ctx.params;
  const refused = guard(req, token, "postcode");
  if (refused) return refused;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!normalisePostcode(q)) return json(422, { ok: false, error: "That doesn't look like a UK postcode" });
  const form = await getForm(token);
  if (!form) return json(404, { ok: false, error: "This link doesn't look right" });
  const place = await resolvePostcode(q, form.tenant.config, profileFor(form.tenant));
  if (!place) return json(422, { ok: false, error: "We couldn't find that postcode" });
  return json(200, { ok: true, place });
}
