/** GET /api/forms/<token>/photo/<id> — a photo uploaded to this form, only to whoever holds the form link. */
import { getForm } from "@/lib/forms";
import { readFormPhoto } from "@/lib/forms/photos";
import { PHOTO_ID } from "@/lib/forms/engine";
import { guard } from "../../../guards";

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

export async function GET(req: Request, ctx: RouteContext<"/api/forms/[token]/photo/[photoId]">) {
  const { token, photoId } = await ctx.params;
  const refused = guard(req, token, "photo", { csrf: false });
  if (refused) return refused;
  if (!PHOTO_ID.test(photoId)) return notFound();
  const form = await getForm(token);
  if (!form) return notFound();
  try {
    const data = await readFormPhoto(form.row.id, photoId);
    return new Response(new Uint8Array(data), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  } catch {
    return notFound();
  }
}
