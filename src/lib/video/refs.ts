/**
 * Portable media refs stored in assets.content.props:
 *   "storage:<key>"  -> a storage object (job photos)
 *   "public:<path>"  -> a file in /public (tenant logo)
 * They are resolved to fetchable URLs only at render time, so stored props never contain an
 * ephemeral localhost port.
 */
import type { VideoProps } from "../../../video/schema";

export const storageRef = (key: string) => `storage:${key}`;
export const publicRef = (p: string) => `public:${p.replace(/^\/+/, "")}`;

export function resolveRef(ref: string, baseUrl: string): string {
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  if (ref.startsWith("storage:")) return `${baseUrl}/storage/${enc(ref.slice("storage:".length))}`;
  if (ref.startsWith("public:")) return `${baseUrl}/public/${enc(ref.slice("public:".length))}`;
  return ref; // http(s): / data: pass through
}

export function resolvePropsMedia(p: VideoProps, baseUrl: string): VideoProps {
  const r = (s: string) => resolveRef(s, baseUrl);
  return {
    ...p,
    beforeSrc: p.beforeSrc ? r(p.beforeSrc) : null,
    afterSrc: r(p.afterSrc),
    progressSrcs: p.progressSrcs.map(r),
    logoSrc: p.logoSrc ? r(p.logoSrc) : null,
  };
}
