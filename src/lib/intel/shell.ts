/**
 * The site shell: a header and footer that look like the business's own, for pages we host on the directory.
 *
 * We do NOT copy their theme markup or hotlink their CSS (fragile, heavy, and a security risk). Instead we read the
 * homepage's header/footer semantically (logo, menu, contact items, call-to-action, footer columns), rebuild them
 * with our own `gp-` classes, style them from the brand tokens (colours sampled from the real page), and run the
 * result through the allowlist sanitiser as a final guard. Links keep pointing at the real site.
 */
import { ancestors, findAll, findFirst, hasClassLike, parseHtml, textOf, walk, type HtmlEl } from "./html";
import { socialNetworkOf } from "./providers";
import { sanitiseHtml } from "./sanitize";
import { collapse, findPhones, findPostcodes, formatUkPhone, normalisePhone } from "./text";
import { absolutise, isSameSite } from "./url";

export type NavItem = { label: string; href: string | null; children: NavItem[] };
export type ContactItem = { kind: "phone" | "email" | "location"; label: string | null; text: string; href: string | null };
export type FooterColumn = { heading: string; links: { label: string; href: string }[] };

export type ShellParts = {
  siteUrl: string;
  logo: { src: string; alt: string; width: number | null; height: number | null } | null;
  nav: NavItem[];
  contacts: ContactItem[];
  cta: { text: string; href: string } | null;
  footer: {
    logo: { src: string; alt: string } | null;
    blurb: string | null;
    columns: FooterColumn[];
    contacts: ContactItem[];
    social: { network: string; url: string }[];
  };
};

export type ShellTokens = {
  primary: string;
  text: string;
  headerBg: string;
  headerText: string;
  topbarBg: string;
  topbarText: string;
  /** Labels and icons in the top bar. */
  topbarAccent: string;
  footerBg: string;
  footerText: string;
  headingFont: string | null;
  bodyFont: string | null;
  buttonBg: string;
  buttonText: string;
  buttonRadius: string;
};

const isDeadHref = (href: string | null) => !href || /\/#$|#$/.test(href);

function linkText(a: HtmlEl): string {
  const dataText = findFirst(a, (e) => Boolean(e.attrs["data-text"]))?.attrs["data-text"];
  return collapse(dataText || textOf(a) || a.attrs["aria-label"] || a.attrs.title || "");
}

/** The header region: <header>, else the first element whose class/id says header, else null. */
function findHeader(root: HtmlEl): HtmlEl | null {
  return (
    findFirst(root, (e) => e.tag === "header" && findAll(e, (x) => x.tag === "a").length >= 3) ??
    findFirst(root, (e) => /^(div|section)$/.test(e.tag) && hasClassLike(e, /(^|[\s_-])(site-)?header([\s_-]|$)/i) && findAll(e, (x) => x.tag === "a").length >= 3)
  );
}

function findFooter(root: HtmlEl): HtmlEl | null {
  const footers = findAll(root, (e) => e.tag === "footer" && !ancestors(e).some((a) => a.tag === "footer" || a.tag === "article"));
  if (footers.length) return footers[footers.length - 1];
  const byClass = findAll(root, (e) => /^(div|section)$/.test(e.tag) && hasClassLike(e, /(^|[\s_-])(site-)?(footer|colophon)([\s_-]|$)/i));
  return byClass[byClass.length - 1] ?? null;
}

/** Menu = the <ul> with the most direct link items (≥ 2), preferring ones marked as menus. */
function findMenu(scope: HtmlEl): HtmlEl | null {
  let best: { el: HtmlEl; score: number } | null = null;
  for (const ul of findAll(scope, (e) => e.tag === "ul" && !ancestors(e).some((a) => a.tag === "ul"))) {
    const items = ul.children.filter((c): c is HtmlEl => c.type === "el" && c.tag === "li" && Boolean(findFirst(c, (x) => x.tag === "a")));
    if (items.length < 2) continue;
    const score = items.length + (hasClassLike(ul, /menu|nav/i) ? 3 : 0) + (ancestors(ul).some((a) => a.tag === "nav") ? 2 : 0);
    if (!best || score > best.score) best = { el: ul, score };
  }
  return best?.el ?? null;
}

function menuItems(ul: HtmlEl, base: string, depth = 0): NavItem[] {
  const out: NavItem[] = [];
  for (const li of ul.children) {
    if (li.type !== "el" || li.tag !== "li") continue;
    const a = findFirst(li, (x) => x.tag === "a" && !ancestors(x).slice(0, ancestors(x).indexOf(li)).some((p) => p.tag === "ul"));
    if (!a) continue;
    const label = linkText(a);
    if (!label || label.length > 40) continue;
    const sub = depth < 1 ? findFirst(li, (x) => x.tag === "ul") : null;
    const href = absolutise(a.attrs.href, base);
    out.push({ label, href: isDeadHref(href) ? null : href, children: sub ? menuItems(sub, base, depth + 1) : [] });
  }
  return out.slice(0, 9);
}

/** "Email :" next to the link → "Email". Looks up a few ancestors for a short leading label. */
function labelFor(a: HtmlEl, value: string): string | null {
  for (const anc of ancestors(a).slice(0, 4)) {
    const t = textOf(anc);
    if (t.length > value.length + 25) break;
    const rest = collapse(t.replace(value, ""));
    if (rest && rest.length <= 20 && /:$/.test(rest)) return rest.replace(/\s*:$/, "");
  }
  return null;
}

function contactItems(scope: HtmlEl, base: string, exclude: Set<HtmlEl>): ContactItem[] {
  const out: ContactItem[] = [];
  const seen = new Set<string>();
  for (const a of findAll(scope, (e) => e.tag === "a" && !exclude.has(e))) {
    const href = absolutise(a.attrs.href, base);
    const text = linkText(a);
    if (!href || !text) continue;
    let item: ContactItem | null = null;
    if (href.startsWith("tel:")) {
      const p = normalisePhone(href.slice(4)) ?? normalisePhone(text);
      if (p) item = { kind: "phone", label: labelFor(a, text), text: formatUkPhone(p), href: `tel:${p}` };
    } else if (href.startsWith("mailto:")) {
      const email = href.slice(7).split("?")[0].trim().toLowerCase();
      if (email.includes("@")) item = { kind: "email", label: labelFor(a, text), text: email, href: `mailto:${email}` };
    } else if (findPostcodes(text).length && text.length < 80) {
      item = { kind: "location", label: labelFor(a, text), text, href };
    }
    if (item && !seen.has(`${item.kind}:${item.text}`)) {
      seen.add(`${item.kind}:${item.text}`);
      out.push(item);
    }
  }
  return out;
}

/**
 * Contact items in the header, including a top bar that sits just above the <header> element (common in themes):
 * every link from the start of the page to the end of the header.
 */
function headerContacts(root: HtmlEl, header: HtmlEl, base: string, exclude: Set<HtmlEl>): ContactItem[] {
  if (header === root) return contactItems(root, base, exclude);
  const inHeader = new Set(findAll(header, (e) => e.tag === "a"));
  const last = [...inHeader].pop();
  const before = new Set<HtmlEl>();
  for (const a of findAll(root, (e) => e.tag === "a")) {
    if (a === last) break;
    if (!inHeader.has(a) && !ancestors(a).some((p) => p.tag === "footer" || p.tag === "main")) before.add(a);
  }
  const topbar = [...before].slice(-12); // only the links right before the header, not a whole page of them
  const scope: HtmlEl = { type: "el", tag: "#fragment", attrs: {}, children: [...topbar, header], parent: null };
  const items = contactItems(scope, base, exclude);
  // Top bars often show the number as plain text (no tel: link).
  if (!items.some((c) => c.kind === "phone")) {
    const phone = findPhones(textBefore(root, header).slice(-600))[0];
    if (phone) items.unshift({ kind: "phone", label: null, text: formatUkPhone(phone), href: `tel:${phone}` });
  }
  return items;
}

/** Visible text that comes before `stop` in document order (skipping scripts/styles). */
function textBefore(root: HtmlEl, stop: HtmlEl): string {
  const parts: string[] = [];
  let done = false;
  walk(root, (n) => {
    if (done) return false;
    if (n === stop) {
      done = true;
      return false;
    }
    if (n.type === "text") parts.push(n.text);
    else if (/^(script|style|svg|noscript|template|head)$/.test(n.tag)) return false;
  });
  return parts.join(" ").replace(/\s+/g, " ");
}

function findLogo(scope: HtmlEl, base: string, siteUrl: string, preferred: string | null): ShellParts["logo"] {
  const imgs = findAll(scope, (e) => e.tag === "img");
  const pick =
    (preferred && imgs.find((i) => absolutise(i.attrs.src, base) === preferred)) ||
    imgs.find((i) => /logo/i.test(`${i.attrs.class ?? ""} ${i.attrs.src ?? ""} ${i.attrs.alt ?? ""}`)) ||
    imgs.find((i) => ancestors(i).some((a) => a.tag === "a" && absolutise(a.attrs.href, base)?.replace(/\/$/, "") === new URL(siteUrl).origin)) ||
    null;
  const src = pick ? absolutise(pick.attrs.src ?? pick.attrs["data-src"], base) : preferred;
  if (!src) return null;
  const n = (v: string | undefined) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : null);
  return { src, alt: pick?.attrs.alt ?? "", width: n(pick?.attrs.width), height: n(pick?.attrs.height) };
}

const CTA_TEXT = /quote|contact|book|enquir|get in touch|call|consult|estimate/i;

function findCta(scope: HtmlEl, base: string, menu: HtmlEl | null): ShellParts["cta"] {
  const inMenu = (a: HtmlEl) => Boolean(menu && ancestors(a).includes(menu));
  const anchors = findAll(scope, (e) => e.tag === "a" && !inMenu(e));
  const buttonish = anchors.filter((a) => hasClassLike(a, /btn|button|cta/i) || ancestors(a).slice(0, 3).some((p) => hasClassLike(p, /btn|button|cta/i)));
  for (const a of [...buttonish, ...anchors.filter((x) => CTA_TEXT.test(linkText(x)))]) {
    const href = absolutise(a.attrs.href, base);
    const text = linkText(a);
    if (!href || isDeadHref(href) || !text || text.length > 30 || href.startsWith("mailto:")) continue;
    if (!CTA_TEXT.test(text) && !buttonish.includes(a)) continue;
    return { text, href };
  }
  return null;
}

function footerColumns(footer: HtmlEl, base: string, used: Set<string>): FooterColumn[] {
  const cols: FooterColumn[] = [];
  const headings = findAll(footer, (e) => /^h[2-6]$/.test(e.tag));
  const anchors = findAll(footer, (e) => e.tag === "a");
  const order = new Map<HtmlEl, number>();
  let i = 0;
  const all = findAll(footer, () => true);
  for (const el of all) order.set(el, i++);
  for (let h = 0; h < headings.length; h++) {
    const start = order.get(headings[h]) ?? 0;
    const end = h + 1 < headings.length ? (order.get(headings[h + 1]) ?? Infinity) : Infinity;
    const links: { label: string; href: string }[] = [];
    for (const a of anchors) {
      const pos = order.get(a) ?? -1;
      if (pos <= start || pos >= end) continue;
      const href = absolutise(a.attrs.href, base);
      const label = linkText(a);
      if (!href || isDeadHref(href) || !label || label.length > 40 || /^(tel|mailto):/.test(href) || socialNetworkOf(href)) continue;
      if (used.has(`${label}|${href}`)) continue;
      used.add(`${label}|${href}`);
      links.push({ label, href });
    }
    const heading = collapse(textOf(headings[h]));
    if (links.length && heading.length <= 40) cols.push({ heading, links: links.slice(0, 8) });
  }
  return cols.slice(0, 4);
}

/** Read the semantic parts of the header and footer from a homepage's raw HTML. */
export function extractShellParts(rawHtml: string, pageUrl: string, opts: { siteUrl?: string; logoUrl?: string | null } = {}): ShellParts {
  const siteUrl = opts.siteUrl ?? new URL(pageUrl).origin + "/";
  const root = parseHtml(rawHtml);
  const header = findHeader(root) ?? root;
  const menu = findMenu(header);
  const nav = menu ? menuItems(menu, pageUrl) : [];
  const menuAnchors = new Set(menu ? findAll(menu, (e) => e.tag === "a") : []);
  const footer = findFooter(root);

  const social = new Map<string, string>();
  for (const a of findAll(footer ?? root, (e) => e.tag === "a")) {
    const href = absolutise(a.attrs.href, pageUrl);
    const net = href ? socialNetworkOf(href) : null;
    if (href && net && !social.has(net)) social.set(net, href);
  }

  let footerLogo: ShellParts["footer"]["logo"] = null;
  let blurb: string | null = null;
  let columns: FooterColumn[] = [];
  let footerContacts: ContactItem[] = [];
  if (footer) {
    // Footer logo only when it is a variant of the header logo (same file stem): footers are full of badge images.
    const headerLogo = findLogo(header, pageUrl, siteUrl, opts.logoUrl ?? null);
    const stem = (u: string) => (u.split("/").pop() ?? "").replace(/(-\d+x\d+)?\.[a-z0-9]+$/i, "").toLowerCase();
    const img = headerLogo ? findAll(footer, (e) => e.tag === "img").find((i) => stem(absolutise(i.attrs.src, pageUrl) ?? "") === stem(headerLogo.src)) : undefined;
    const src = img ? absolutise(img.attrs.src, pageUrl) : null;
    if (src && isSameSite(src, siteUrl)) footerLogo = { src, alt: img?.attrs.alt ?? "" };
    blurb = findAll(footer, (e) => e.tag === "p").map(textOf).find((t) => t.length >= 40 && t.length <= 400 && !/©|copyright/i.test(t)) ?? null;
    columns = footerColumns(footer, pageUrl, new Set());
    footerContacts = contactItems(footer, pageUrl, new Set());
  }

  return {
    siteUrl,
    logo: findLogo(header, pageUrl, siteUrl, opts.logoUrl ?? null),
    nav,
    contacts: headerContacts(root, header, pageUrl, menuAnchors),
    cta: findCta(header, pageUrl, menu),
    footer: { logo: footerLogo, blurb, columns, contacts: footerContacts, social: [...social].map(([network, url]) => ({ network, url })) },
  };
}

/** Flat list for the owner app and for SEO links: top-level items (a parent without a link uses its first child). */
export function navLinksOf(nav: NavItem[]): { label: string; href: string }[] {
  return nav
    .map((i) => ({ label: i.label, href: i.href ?? i.children.find((c) => c.href)?.href ?? null }))
    .filter((l): l is { label: string; href: string } => Boolean(l.href));
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small generic line icons (drawn here; never anyone's logo). Rendered as CSS masks so no <svg> enters the HTML. */
const ICONS: Record<ContactItem["kind"] | "menu", string> = {
  phone: "M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z",
  email: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm8 7.2L4.8 7.4v.1L12 12.3l7.2-4.8v-.1z",
  location: "M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7zm0 4.5A2.5 2.5 0 1 0 12 11.5 2.5 2.5 0 0 0 12 6.5z",
  menu: "M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z",
};
const iconUrl = (k: keyof typeof ICONS) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${ICONS[k]}'/></svg>`)}")`;

function renderContacts(items: ContactItem[], cls: string): string {
  return items
    .map((c) => {
      const label = c.label ? `<span class="gp-shell-label">${esc(c.label)}:</span> ` : "";
      const value = c.href ? `<a class="gp-shell-value" href="${esc(c.href)}">${esc(c.text)}</a>` : `<span class="gp-shell-value">${esc(c.text)}</span>`;
      return `<li class="${cls} gp-shell-${c.kind}"><span class="gp-shell-icon gp-shell-icon-${c.kind}" aria-hidden="true"></span>${label}${value}</li>`;
    })
    .join("");
}

function renderNav(nav: NavItem[]): string {
  return nav
    .map((i) => {
      const href = i.href ?? i.children.find((c) => c.href)?.href ?? null;
      const link = href ? `<a class="gp-shell-navlink" href="${esc(href)}">${esc(i.label)}</a>` : `<span class="gp-shell-navlink">${esc(i.label)}</span>`;
      const sub = i.children.filter((c) => c.href);
      const subHtml = sub.length
        ? `<ul class="gp-shell-sub">${sub.map((c) => `<li><a href="${esc(c.href!)}">${esc(c.label)}</a></li>`).join("")}</ul>`
        : "";
      return `<li class="gp-shell-navitem${sub.length ? " gp-shell-has-sub" : ""}">${link}${subHtml}</li>`;
    })
    .join("");
}

export function renderHeader(parts: ShellParts, businessName: string): string {
  const home = parts.siteUrl;
  const logo = parts.logo
    ? `<img class="gp-shell-logo" loading="eager" src="${esc(parts.logo.src)}" alt="${esc(parts.logo.alt || businessName)}"${parts.logo.width ? ` width="${parts.logo.width}"` : ""}${parts.logo.height ? ` height="${parts.logo.height}"` : ""}>`
    : `<span class="gp-shell-wordmark">${esc(businessName)}</span>`;
  const phone = parts.contacts.find((c) => c.kind === "phone");
  const cta = parts.cta ? `<a class="gp-shell-cta" href="${esc(parts.cta.href)}">${esc(parts.cta.text)}</a>` : "";
  const topbar = parts.contacts.length ? `<ul class="gp-shell-topbar">${renderContacts(parts.contacts, "gp-shell-topitem")}</ul>` : "";
  const nav = parts.nav.length ? `<nav class="gp-shell-nav" aria-label="${esc(businessName)}"><ul class="gp-shell-menu">${renderNav(parts.nav)}</ul></nav>` : "";
  const mobileNav = parts.nav.length
    ? `<details class="gp-shell-burger"><summary class="gp-shell-burger-btn" aria-label="Menu"><span class="gp-shell-icon gp-shell-icon-menu" aria-hidden="true"></span></summary><ul class="gp-shell-mobile-menu">${navLinksOf(parts.nav)
        .map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`)
        .join("")}</ul></details>`
    : "";
  const mobilePhone = phone?.href ? `<a class="gp-shell-mobile-phone" href="${esc(phone.href)}" aria-label="Call ${esc(phone.text)}"><span class="gp-shell-icon gp-shell-icon-phone" aria-hidden="true"></span></a>` : "";
  const html = `<header class="gp-shell gp-shell-header"><div class="gp-shell-inner"><a class="gp-shell-home" href="${esc(home)}">${logo}</a><div class="gp-shell-main">${topbar}<div class="gp-shell-row">${nav}${cta}</div></div><div class="gp-shell-mobile">${mobilePhone}${mobileNav}</div></div></header>`;
  return sanitiseHtml(html, { baseUrl: home, siteUrl: home });
}

export function renderFooter(parts: ShellParts, businessName: string, legalName: string | null, year = new Date().getFullYear()): string {
  const f = parts.footer;
  const home = parts.siteUrl;
  const logo = f.logo ?? parts.logo;
  const brand = `<div class="gp-shell-fbrand"><a class="gp-shell-home" href="${esc(home)}">${
    logo ? `<img class="gp-shell-flogo" src="${esc(logo.src)}" alt="${esc(logo.alt || businessName)}">` : `<span class="gp-shell-wordmark">${esc(businessName)}</span>`
  }</a>${f.blurb ? `<p class="gp-shell-blurb">${esc(f.blurb)}</p>` : ""}${
    f.social.length
      ? `<ul class="gp-shell-social">${f.social.map((s) => `<li><a href="${esc(s.url)}">${esc(s.network[0].toUpperCase() + s.network.slice(1))}</a></li>`).join("")}</ul>`
      : ""
  }</div>`;
  const columns = f.columns.length ? f.columns : parts.nav.length ? [{ heading: "Explore", links: navLinksOf(parts.nav) }] : [];
  const cols = columns
    .map((c) => `<div class="gp-shell-fcol"><h2 class="gp-shell-fhead">${esc(c.heading)}</h2><ul>${c.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")}</ul></div>`)
    .join("");
  const contacts = f.contacts.length ? f.contacts : parts.contacts;
  const contactCol = contacts.length ? `<div class="gp-shell-fcol"><h2 class="gp-shell-fhead">Contact</h2><ul class="gp-shell-fcontact">${renderContacts(contacts, "gp-shell-fitem")}</ul></div>` : "";
  const html = `<footer class="gp-shell gp-shell-footer"><div class="gp-shell-finner">${brand}${cols}${contactCol}</div><div class="gp-shell-fbar"><p>© ${year} ${esc(legalName ?? businessName)}</p></div></footer>`;
  return sanitiseHtml(html, { baseUrl: home, siteUrl: home });
}

const GENERIC_FONTS = new Set(["arial", "helvetica", "helvetica neue", "georgia", "times new roman", "verdana", "system-ui", "sans-serif", "serif", "-apple-system", "segoe ui"]);

/** Google Fonts import for the brand fonts (only real web-font families). */
function fontImport(fonts: (string | null)[]): string {
  const fams = [...new Set(fonts.filter((f): f is string => Boolean(f) && !GENERIC_FONTS.has(f!.toLowerCase())))];
  if (!fams.length) return "";
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&");
  return `@import url("https://fonts.googleapis.com/css2?${q}&display=swap");\n`;
}

const cssFont = (f: string | null, fallback: string) => (f ? `"${f.replace(/"/g, "")}", ${fallback}` : fallback);

/** CSS for the shell, scoped to .gp-shell and driven entirely by the brand tokens. */
export function renderShellCss(t: ShellTokens): string {
  const body = cssFont(t.bodyFont, "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif");
  const head = cssFont(t.headingFont, body);
  return `${fontImport([t.headingFont, t.bodyFont])}.gp-shell{--gp-primary:${t.primary};--gp-text:${t.text};--gp-header-bg:${t.headerBg};--gp-header-text:${t.headerText};--gp-topbar-bg:${t.topbarBg};--gp-topbar-text:${t.topbarText};--gp-topbar-accent:${t.topbarAccent};--gp-footer-bg:${t.footerBg};--gp-footer-text:${t.footerText};--gp-btn-bg:${t.buttonBg};--gp-btn-text:${t.buttonText};--gp-btn-radius:${t.buttonRadius};font-family:${body};box-sizing:border-box;line-height:1.5}
:where(.gp-shell) *,:where(.gp-shell) *::before,:where(.gp-shell) *::after{box-sizing:inherit}
:where(.gp-shell) ul{list-style:none;margin:0;padding:0}
:where(.gp-shell) a{color:inherit;text-decoration:none}
:where(.gp-shell) img{max-width:100%;height:auto;display:block}
.gp-shell-icon{display:inline-block;width:1em;height:1em;background:currentColor;flex:none;-webkit-mask:var(--gp-icon) center/contain no-repeat;mask:var(--gp-icon) center/contain no-repeat}
.gp-shell-icon-phone{--gp-icon:${iconUrl("phone")}}.gp-shell-icon-email{--gp-icon:${iconUrl("email")}}.gp-shell-icon-location{--gp-icon:${iconUrl("location")}}.gp-shell-icon-menu{--gp-icon:${iconUrl("menu")}}
.gp-shell-header{background:var(--gp-header-bg);color:var(--gp-header-text);position:relative;z-index:20}
.gp-shell-inner{display:flex;align-items:center;gap:24px;padding:10px 0 18px clamp(16px,11vw,210px);min-height:162px}
.gp-shell-home{display:flex;align-items:center;flex:none}
.gp-shell-logo{width:auto;max-height:80px;max-width:180px}
.gp-shell-wordmark{font-family:${head};font-weight:700;font-size:22px;color:var(--gp-primary)}
.gp-shell-main{flex:1;display:flex;flex-direction:column;gap:18px;margin-left:clamp(24px,10.5vw,201px);min-width:0}
.gp-shell-topbar{display:flex;align-items:center;gap:0;background:var(--gp-topbar-bg);border-radius:999px 0 0 999px;padding:17px 40px 17px 52px;font-size:16px;line-height:24px;color:var(--gp-topbar-text)}
.gp-shell-topitem{display:flex;align-items:center;gap:8px;white-space:nowrap}
.gp-shell-topitem+.gp-shell-topitem::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--gp-topbar-accent);margin:0 48px 0 44px}
.gp-shell-topitem .gp-shell-icon{color:var(--gp-topbar-accent);margin-right:4px}
.gp-shell-label{color:var(--gp-topbar-accent);font-weight:500}
.gp-shell-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-right:clamp(16px,3.2vw,62px)}
.gp-shell-menu{display:flex;align-items:center;gap:40px;margin-left:clamp(0px,5vw,95px)}
.gp-shell-navitem{position:relative}
.gp-shell-navlink{font-family:${head};font-weight:500;font-size:18px;color:var(--gp-header-text);display:inline-flex;align-items:center;gap:6px;padding:6px 0}
.gp-shell-has-sub>.gp-shell-navlink::after{content:"";width:7px;height:7px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg) translateY(-3px)}
.gp-shell-navlink:hover{color:var(--gp-primary)}
.gp-shell-sub{display:none;position:absolute;top:100%;left:-16px;min-width:220px;background:#fff;box-shadow:0 12px 32px rgba(0,0,0,.12);border-radius:8px;padding:8px 0}
.gp-shell-has-sub:hover .gp-shell-sub,.gp-shell-has-sub:focus-within .gp-shell-sub{display:block}
.gp-shell-sub a{display:block;padding:8px 16px;color:var(--gp-text);font-size:15px}
.gp-shell-sub a:hover{color:var(--gp-primary)}
.gp-shell-cta{display:inline-flex;align-items:center;justify-content:center;background:var(--gp-btn-bg);color:var(--gp-btn-text)!important;border-radius:var(--gp-btn-radius);font-family:${head};font-weight:600;font-size:16px;padding:16px 40px;white-space:nowrap}
.gp-shell-cta:hover{filter:brightness(1.08)}
.gp-shell-mobile{display:none;margin-left:auto;align-items:center;gap:8px}
.gp-shell-mobile-phone,.gp-shell-burger-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--gp-btn-bg);color:var(--gp-btn-text);font-size:20px;cursor:pointer;list-style:none}
.gp-shell-burger-btn::-webkit-details-marker{display:none}
.gp-shell-burger-btn{background:transparent;color:var(--gp-header-text);font-size:26px}
.gp-shell-burger{position:relative}
.gp-shell-mobile-menu{position:absolute;right:0;top:52px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.15);padding:8px 0;min-width:220px}
.gp-shell-mobile-menu a{display:block;padding:12px 20px;font-family:${head};font-weight:500;color:var(--gp-text)}
@media (max-width:1280px){.gp-shell-main{margin-left:32px}.gp-shell-menu{gap:24px;margin-left:0}.gp-shell-topitem+.gp-shell-topitem::before{margin:0 20px}.gp-shell-topbar{padding:12px 24px}}
@media (max-width:1024px){.gp-shell-inner{padding:10px 16px;min-height:0}.gp-shell-main{display:none}.gp-shell-mobile{display:flex}.gp-shell-logo{max-height:56px}}
.gp-shell-footer{background:var(--gp-footer-bg);color:var(--gp-footer-text)}
.gp-shell-finner{display:grid;grid-template-columns:1.4fr repeat(auto-fit,minmax(160px,1fr));gap:40px;max-width:1280px;margin:0 auto;padding:64px 24px 40px}
.gp-shell-flogo{max-height:80px;width:auto;margin-bottom:16px}
.gp-shell-blurb{margin:0 0 16px;opacity:.85;max-width:34ch}
.gp-shell-social{display:flex;flex-wrap:wrap;gap:12px}
.gp-shell-social a{border:1px solid currentColor;border-radius:999px;padding:4px 12px;font-size:14px;opacity:.9}
.gp-shell-fhead{font-family:${head};font-size:18px;font-weight:600;margin:0 0 16px;color:inherit}
.gp-shell-fcol li{margin:0 0 10px}
.gp-shell-fcol a{opacity:.85}.gp-shell-fcol a:hover{opacity:1;text-decoration:underline}
.gp-shell-fitem{display:flex;gap:8px;align-items:center}
.gp-shell-fitem .gp-shell-label{color:inherit;opacity:.7;font-weight:400}
.gp-shell-fbar{border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);text-align:center;padding:18px 16px;font-size:14px;opacity:.8}
.gp-shell-fbar p{margin:0}
@media (max-width:720px){.gp-shell-finner{grid-template-columns:1fr;gap:28px;padding:40px 16px 24px}}
`;
}
