/**
 * Operator-only media: withheld photos, full-resolution originals (EXIF kept) and voice notes are served here,
 * never through the public /api/media route. The proxy guards this path and we re-check the session, because
 * route handlers are reachable directly.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { UnauthorisedError, requireAgency } from "@/lib/dashboard/session";
import { getObject, mimeFromKey } from "@/lib/storage";
import { getTenantBySlug } from "@/lib/tenants";

export async function GET(req: Request, ctx: RouteContext<"/ops/media/[id]">) {
  try {
    await requireAgency();
  } catch (err) {
    if (err instanceof UnauthorisedError) return new Response(err.message, { status: 401 });
    throw err;
  }
  const { id } = await ctx.params;
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [m] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.tenantId, tenant.id)));
  if (!m) return new Response("Not found", { status: 404 });

  // Default to the EXIF-stripped copy; the original only when explicitly asked for.
  const original = new URL(req.url).searchParams.get("v") === "original";
  const key = original ? m.storageKey : (m.publicKey ?? m.storageKey);
  try {
    const data = await getObject(key);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": original && m.mimeType ? m.mimeType : mimeFromKey(key),
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
        ...(original ? { "content-disposition": `inline; filename="${key.split("/").pop()}"` } : {}),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
