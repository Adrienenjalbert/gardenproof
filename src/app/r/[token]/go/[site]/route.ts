/** Records a happy homeowner's click to a public review site, then sends them there. */
import { recordReviewClick } from "@/lib/testimonials";

export async function GET(req: Request, ctx: RouteContext<"/r/[token]/go/[site]">) {
  const { token, site } = await ctx.params;
  if (site !== "google" && site !== "which") return new Response("Not found", { status: 404 });
  const url = await recordReviewClick(token, site);
  if (!url) return Response.redirect(new URL(`/r/${encodeURIComponent(token)}`, req.url), 303);
  return Response.redirect(url, 303);
}
