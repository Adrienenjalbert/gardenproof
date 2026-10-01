/**
 * POST /api/forms/<token>/upload — one photo (multipart field "file"). Images only, size-capped, re-encoded
 * with sharp (EXIF/GPS stripped, orientation applied, max 2000px). The client then saves the photo ids as the
 * step's answer; saveAnswer checks each id belongs to this form.
 */
import { getForm } from "@/lib/forms";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, PhotoError, storeFormPhoto } from "@/lib/forms/photos";
import { formErrorResponse, guard, json } from "../../guards";

export async function POST(req: Request, ctx: RouteContext<"/api/forms/[token]/upload">) {
  const { token } = await ctx.params;
  const refused = guard(req, token, "upload");
  if (refused) return refused;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return json(413, { ok: false, error: "That photo is too large" });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return json(415, { ok: false, error: "Send the photo as a file" });

  try {
    const form = await getForm(token);
    if (!form) return json(404, { ok: false, error: "This link doesn't look right" });
    if (form.completed) return json(409, { ok: false, error: "This form has already been sent" });
    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      return json(400, { ok: false, error: "Send the photo as a file" });
    }
    if (!(file instanceof Blob)) return json(400, { ok: false, error: "No photo received" });
    if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) return json(415, { ok: false, error: "Photos only, please (JPEG, PNG, HEIC or WebP)" });
    if (file.size > MAX_UPLOAD_BYTES) return json(413, { ok: false, error: "That photo is too large" });
    const photo = await storeFormPhoto(form.row.id, Buffer.from(await file.arrayBuffer()));
    return json(201, { ok: true, photo, url: `/api/forms/${token}/photo/${photo.id}` });
  } catch (err) {
    if (err instanceof PhotoError) return json(422, { ok: false, error: err.message });
    return formErrorResponse(err);
  }
}
