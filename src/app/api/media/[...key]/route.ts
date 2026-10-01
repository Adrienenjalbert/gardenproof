/**
 * GET/HEAD /api/media/<key> — serves stored media, with byte ranges (video seeking, iOS Safari playback).
 *
 * Public visitors only get publishable files (see isPublicStorageKey): EXIF-stripped / blurred image derivatives
 * and the renders of published assets. Phone originals, voice notes, draft videos and exports need the
 * dashboard session. Anything else is a 404 (not 403), so private keys can't be probed.
 */
import { isPublicStorageKey, requestIsOperator } from "@/lib/publish/access";
import { serveStoredFile } from "@/lib/publish/serve-file";

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

async function handle(req: Request, ctx: RouteContext<"/api/media/[...key]">): Promise<Response> {
  const { key } = await ctx.params;
  const k = key.join("/");
  if (!k || k.split("/").some((part) => part === ".." || part === "")) return notFound();

  if (await isPublicStorageKey(k)) {
    // Short cache: consent can be withdrawn and a file then stops being public.
    return serveStoredFile(k, req, { headers: { "cache-control": "public, max-age=300" } });
  }
  if (await requestIsOperator(req)) {
    return serveStoredFile(k, req, { headers: { "cache-control": "private, no-store" } });
  }
  return notFound();
}

export const GET = handle;
export const HEAD = handle;
