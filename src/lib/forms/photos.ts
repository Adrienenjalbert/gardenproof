/**
 * Homeowner photos uploaded into a form. Already shrunk in the browser; the server still re-encodes every file
 * with sharp: applies the EXIF orientation, strips all metadata (GPS!), caps the size. Private: served only
 * through the form's own token (/api/forms/<token>/photo/<id>), never via /api/media.
 */
import { newId } from "@/lib/ids";
import { getObject, objectExists, putObject } from "@/lib/storage";
import { PHOTO_ID } from "./engine";
import type { PhotoValue } from "./types";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_EDGE_PX = 2000;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];

export class PhotoError extends Error {}

export const photoKey = (formId: string, photoId: string) => {
  if (!PHOTO_ID.test(photoId)) throw new PhotoError("Invalid photo id");
  return `forms/${formId}/${photoId}.jpg`;
};

export async function storeFormPhoto(formId: string, data: Buffer): Promise<PhotoValue> {
  if (data.length === 0) throw new PhotoError("Empty file");
  if (data.length > MAX_UPLOAD_BYTES) throw new PhotoError("That photo is too large");
  const sharp = (await import("sharp")).default;
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(data, { limitInputPixels: 80_000_000, failOn: "error" })
      .rotate() // bake in EXIF orientation before the metadata is dropped
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }) // sharp drops EXIF/XMP/ICC-extras unless withMetadata() is called
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoError("We couldn't read that image");
  }
  const id = newId("ph");
  await putObject(photoKey(formId, id), out.data);
  return { id, width: out.info.width, height: out.info.height };
}

export async function formPhotoExists(formId: string, photoId: string): Promise<boolean> {
  return PHOTO_ID.test(photoId) && objectExists(photoKey(formId, photoId));
}

export const readFormPhoto = (formId: string, photoId: string) => getObject(photoKey(formId, photoId));
