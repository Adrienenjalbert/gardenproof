/** Tiny HTML-string helpers shared by the markdown renderer and the WordPress body fallback. */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML content *and* double/single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Only allow link targets that cannot execute script: http(s), mailto, tel, site-relative paths and anchors.
 * Returns null for anything else (javascript:, data:, vbscript:, protocol-relative "//evil").
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  // Strip control chars/whitespace browsers ignore inside schemes ("java\nscript:").
  const compact = href.replace(/[\u0000- \u007f]/g, "").toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(compact)) return href;
  return null;
}
