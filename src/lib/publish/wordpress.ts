/**
 * WordPress REST client for the GardenProof plugin's custom post types.
 * Auth: Application Password (Basic) for a dedicated "GardenProof" Editor user.
 *
 * Idempotency:
 *  - media: each upload gets the slug `gp-<mediaId>`; we look it up before uploading again;
 *  - posts: update by stored externalId, else find by slug, else create.
 */
import type { PublicImage } from "./view";
import { wpMediaSlug, type WpPostPayload } from "./wp-mappers";

export type WpConfig = {
  baseUrl: string;
  user: string;
  appPassword: string;
  fetch?: typeof fetch;
  readObject: (key: string) => Promise<Buffer>;
};

export class WordPressError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "WordPressError";
  }
}

export const WP_REST_BASE = { portfolio_page: "gp_project", seo_article: "gp_article" } as const;

type WpPost = { id: number; link: string; slug: string };
type WpMedia = { id: number; source_url: string };

export function createWpClient(cfg: WpConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const root = `${cfg.baseUrl.replace(/\/$/, "")}/wp-json/wp/v2`;
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64")}`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${root}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: auth, ...init.headers },
    });
    if (!res.ok) {
      // WP errors are { code, message }; never echo request headers (they hold the credentials).
      let code: string | null = null;
      let message = res.statusText;
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        code = body.code ?? null;
        message = body.message ?? message;
      } catch {
        /* non-JSON error page */
      }
      throw new WordPressError(`WordPress ${res.status} on ${init.method ?? "GET"} ${path}: ${message}`, res.status, code);
    }
    return (await res.json()) as T;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const findMedia = async (slug: string) =>
    (await request<WpMedia[]>(`/media?slug=${encodeURIComponent(slug)}&_fields=id,source_url`))[0];

  /**
   * Upload (or reuse) one image and keep its alt text/caption in sync. `key` is the publishable storage key
   * (publishableImageKey); it is only read here and never sent to WordPress.
   */
  async function ensureMedia(img: PublicImage, key: string): Promise<{ id: number; url: string }> {
    const slug = wpMediaSlug(img.mediaId);
    let media = await findMedia(slug);
    if (!media) {
      const ext = (key.match(/\.(jpe?g|png|webp)$/i)?.[1] ?? "jpg").toLowerCase();
      const data = await cfg.readObject(key);
      media = await request<WpMedia>("/media", {
        method: "POST",
        headers: {
          "Content-Type": ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
          "Content-Disposition": `attachment; filename="${slug}.${ext}"`,
        },
        body: new Uint8Array(data),
      });
    }
    await request(`/media/${media.id}`, json("POST", { alt_text: img.alt, caption: img.caption ?? "" }));
    return { id: media.id, url: media.source_url };
  }

  async function upsertPost(restBase: string, payload: WpPostPayload, externalId: string | null): Promise<WpPost> {
    if (externalId && /^\d+$/.test(externalId)) {
      try {
        return await request<WpPost>(`/${restBase}/${externalId}`, json("POST", payload));
      } catch (err) {
        // Deleted in WordPress since the last publish → fall through and recreate.
        if (!(err instanceof WordPressError && (err.status === 404 || err.status === 410))) throw err;
      }
    }
    const existing = await request<WpPost[]>(
      `/${restBase}?slug=${encodeURIComponent(payload.slug)}&status=publish,future,draft,pending,private&context=edit&_fields=id,link,slug`,
    );
    if (existing[0]) return request<WpPost>(`/${restBase}/${existing[0].id}`, json("POST", payload));
    return request<WpPost>(`/${restBase}`, json("POST", payload));
  }

  /** Take a post off the site (draft keeps it recoverable for the operator). Already gone counts as done. */
  async function unpublishPost(restBase: string, externalId: string): Promise<void> {
    if (!/^\d+$/.test(externalId)) return;
    try {
      await request(`/${restBase}/${externalId}`, json("POST", { status: "draft" }));
    } catch (err) {
      if (!(err instanceof WordPressError && (err.status === 404 || err.status === 410))) throw err;
    }
  }

  /** Permanently delete the attachment we uploaded for a media row (its file URL stops working). */
  async function deleteMedia(mediaId: string): Promise<boolean> {
    const media = await findMedia(wpMediaSlug(mediaId));
    if (!media) return false;
    await request(`/media/${media.id}?force=true`, { method: "DELETE" });
    return true;
  }

  return { ensureMedia, upsertPost, unpublishPost, deleteMedia };
}
