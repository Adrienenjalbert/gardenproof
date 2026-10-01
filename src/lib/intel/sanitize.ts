/**
 * Allowlist HTML sanitiser for the cloned site shell. Parses, then REBUILDS the markup from scratch, so nothing
 * the source page contained survives unless it is explicitly allowed:
 * - dropped with their content: script, style, iframe, object/embed, form controls, svg/math, templates, media…
 * - attributes: only a small allowlist; every on* handler, style and unknown attribute is gone. Classes survive
 *   only when they are ours (the "gp-" prefix), so their theme CSS can never style or hide our content.
 * - links: http(s)/tel/mailto only, absolutised against the site; external links get rel="noopener".
 * - images: http(s) on the business's own site (or allowed hosts) only; 1×1 tracking pixels and known tracker hosts
 *   are dropped.
 */
import { escapeHtml, parseHtml, type HtmlEl, type HtmlNode } from "./html";
import { absolutise, isSameSite } from "./url";

const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select",
  "option", "textarea", "noscript", "template", "svg", "math", "link", "meta", "base", "canvas", "video", "audio",
  "source", "track", "head", "title", "dialog", "portal", "slot",
]);
const ALLOWED = new Set([
  "a", "img", "ul", "ol", "li", "nav", "div", "span", "p", "strong", "em", "b", "i", "br", "small", "header", "footer",
  "section", "address", "h1", "h2", "h3", "h4", "h5", "h6", "details", "summary",
]);
const VOID_OUT = new Set(["img", "br"]);
const GLOBAL_ATTRS = new Set(["class", "role", "aria-label", "aria-hidden", "title"]);
const TRACKER_HOST = /(^|\.)(facebook\.com|facebook\.net|google-analytics\.com|googletagmanager\.com|doubleclick\.net|bing\.com|hotjar\.com|linkedin\.com|pinterest\.com|clarity\.ms|quantserve\.com|scorecardresearch\.com)$/i;

export type SanitiseOptions = {
  /** Base URL for relative links (the page the fragment came from). */
  baseUrl: string;
  /** The business's site: images must live here (or on `imageHosts`). */
  siteUrl: string;
  /** Extra hosts allowed for images (e.g. our own media origin). */
  imageHosts?: string[];
  /** Keep only classes with this prefix (default "gp-"). */
  classPrefix?: string;
};

function imageAllowed(src: string, opts: SanitiseOptions): boolean {
  let host: string;
  try {
    host = new URL(src).hostname;
  } catch {
    return false;
  }
  if (TRACKER_HOST.test(host) || /\/(pixel|tracking|beacon|tr)(\.gif|\/|\?|$)/i.test(src)) return false;
  return isSameSite(src, opts.siteUrl) || (opts.imageHosts ?? []).some((h) => host === h || host.endsWith(`.${h}`));
}

function cleanAttrs(el: HtmlEl, opts: SanitiseOptions): Record<string, string> | null {
  const out: Record<string, string> = {};
  const prefix = opts.classPrefix ?? "gp-";
  for (const [name, value] of Object.entries(el.attrs)) {
    if (!GLOBAL_ATTRS.has(name)) continue;
    if (name === "class") {
      const kept = value.split(/\s+/).filter((c) => c.startsWith(prefix) && /^[a-z0-9_-]+$/i.test(c));
      if (kept.length) out.class = kept.join(" ");
      continue;
    }
    out[name] = value.slice(0, 300);
  }
  if (el.tag === "a") {
    const href = absolutise(el.attrs.href, opts.baseUrl);
    if (href) {
      out.href = href;
      if (/^https?:/i.test(href) && !isSameSite(href, opts.siteUrl)) out.rel = "noopener noreferrer";
      if (el.attrs.target === "_blank") {
        out.target = "_blank";
        out.rel = "noopener noreferrer";
      }
    }
  }
  if (el.tag === "img") {
    const src = absolutise(el.attrs.src ?? el.attrs["data-src"] ?? el.attrs["data-lazy-src"], opts.baseUrl);
    if (!src || !/^https?:/i.test(src) || !imageAllowed(src, opts)) return null;
    const w = parseInt(el.attrs.width ?? "", 10);
    const h = parseInt(el.attrs.height ?? "", 10);
    if ((w && w <= 2) || (h && h <= 2)) return null; // tracking pixel
    out.src = src;
    out.alt = el.attrs.alt ?? "";
    if (w > 0 && w < 5000) out.width = String(w);
    if (h > 0 && h < 5000) out.height = String(h);
    out.loading = el.attrs.loading === "eager" ? "eager" : "lazy";
    out.decoding = "async";
  }
  return out;
}

function serialise(node: HtmlNode, opts: SanitiseOptions): string {
  if (node.type === "text") return escapeHtml(node.text);
  if (DROP_WITH_CONTENT.has(node.tag)) return "";
  const inner = node.children.map((c) => serialise(c, opts)).join("");
  if (node.tag === "#root" || !ALLOWED.has(node.tag)) return inner; // unwrap unknown tags, keep their safe content
  const attrs = cleanAttrs(node, opts);
  if (attrs === null) return ""; // e.g. an image we refuse to load
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join("");
  return VOID_OUT.has(node.tag) ? `<${node.tag}${attrStr}>` : `<${node.tag}${attrStr}>${inner}</${node.tag}>`;
}

/** Sanitise an HTML fragment. Safe to insert into a page as-is. */
export function sanitiseHtml(html: string, opts: SanitiseOptions): string {
  return serialise(parseHtml(html), opts).replace(/\s{2,}/g, " ").trim();
}

/** Sanitise an already-parsed element (used by the shell builder). */
export function sanitiseNode(node: HtmlNode, opts: SanitiseOptions): string {
  return serialise(node, opts);
}
