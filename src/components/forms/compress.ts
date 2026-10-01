/**
 * Shrink a phone photo before upload (12MP HEIC/JPEG -> ~2000px JPEG, usually 300-600KB): fast on 4G and the
 * server re-encodes anyway. Falls back to the original file when the browser can't decode it (e.g. HEIC on
 * desktop Chrome); the server then decides.
 */
const MAX_EDGE = 2000;
const QUALITY = 0.82;

export async function compressImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
