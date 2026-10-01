/**
 * Who may see what on the public-facing routes (/api/media, /api/export, /preview, /portfolio?drafts=1).
 *
 * Public visitors only ever get publishable material: publishable image derivatives (see `publishableImageKey`)
 * and the rendered files of PUBLISHED assets. Everything else in storage (phone originals with EXIF/GPS, voice
 * notes, draft videos, exports) needs the operator's dashboard session.
 */
import { and, eq, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/db";
import { authMode, SESSION_COOKIE, verifySessionToken } from "@/lib/dashboard/auth";
import { publishableImageKey } from "@/lib/privacy";
import { loadPublicConsent } from "./consent";

/**
 * Same rule as the dashboard (see authMode): open in the zero-config local demo (the dashboard itself is open
 * there), never in a misconfigured production deploy, otherwise a valid signed session cookie.
 */
async function isOperatorToken(token: string | null | undefined): Promise<boolean> {
  const mode = authMode();
  if (mode === "open") return true;
  if (mode === "misconfigured") return false;
  return verifySessionToken(token, process.env.ADMIN_PASSWORD ?? "");
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Route handlers: does this request carry a valid dashboard session? */
export function requestIsOperator(req: Request): Promise<boolean> {
  return isOperatorToken(cookieValue(req.headers.get("cookie"), SESSION_COOKIE));
}

/** Server components: is the current viewer the signed-in operator? */
export async function viewerIsOperator(): Promise<boolean> {
  const jar = await cookies();
  return isOperatorToken(jar.get(SESSION_COOKIE)?.value);
}

/**
 * True when `key` may be served to anyone: a publishable image derivative of a job whose homeowner has not
 * refused or withdrawn photo consent, or the rendered file / thumbnail of a PUBLISHED asset.
 */
/**
 * Onboarding intel: brand assets, review badges and project photos pulled from the client's own already-public
 * website. Always public (no consent gate — nothing here is a homeowner's photo). The "shell" screenshot capture
 * is excluded: it's a working reference for the onboarding pipeline, not something to serve.
 */
const PUBLIC_INTEL_PATTERN = /^intel\/[^/]+\/(brand|badges|projects)\//;

export async function isPublicStorageKey(key: string): Promise<boolean> {
  if (PUBLIC_INTEL_PATTERN.test(key)) return true;
  const db = await getDb();
  const images = await db
    .select()
    .from(schema.media)
    .where(or(eq(schema.media.publicKey, key), eq(schema.media.blurredKey, key)));
  const publishable = images.filter((m) => publishableImageKey(m) === key);
  if (publishable.length) {
    const consent = await loadPublicConsent([...new Set(publishable.map((m) => m.jobId))]);
    const allowed = (jobId: string) => {
      const c = consent.get(jobId);
      return !c?.withdrawn && c?.photos !== false;
    };
    if (publishable.some((m) => allowed(m.jobId))) return true;
  }
  const [asset] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.status, "published"),
        or(eq(schema.assets.fileKey, key), eq(schema.assets.thumbnailKey, key)),
      ),
    )
    .limit(1);
  return !!asset;
}
