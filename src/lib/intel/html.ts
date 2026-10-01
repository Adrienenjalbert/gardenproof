/**
 * A small, forgiving HTML parser (no dependencies are allowed in this repo). It builds a plain tree good enough
 * for pulling headers, footers, menus and images out of real-world CMS pages. It is NOT a spec-complete HTML5
 * parser; safety never relies on it matching a browser: the sanitiser re-serialises everything from an allowlist.
 */

export type HtmlText = { type: "text"; text: string };
export type HtmlEl = { type: "el"; tag: string; attrs: Record<string, string>; children: HtmlNode[]; parent: HtmlEl | null };
export type HtmlNode = HtmlEl | HtmlText;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "xmp", "iframe", "template"]);
/** Opening one of these closes an open <p> (the common implicit-close case in CMS output). */
const CLOSES_P = new Set(["address", "article", "aside", "div", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "nav", "ol", "p", "section", "table", "ul"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", ndash: "–", mdash: "—", hellip: "…", pound: "£", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•", laquo: "«", raquo: "»", times: "×", euro: "€",
  colon: ":", lpar: "(", rpar: ")", sol: "/", tab: "\t", newline: "\n", period: ".", comma: ",", excl: "!", quest: "?",
};

/** Decode HTML character references (named subset + all numeric forms). */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "�";
      return String.fromCodePoint(code);
    }
    const v = NAMED[ref.toLowerCase()];
    return v ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue; // first wins, like browsers
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseHtml(html: string): HtmlEl {
  const root: HtmlEl = { type: "el", tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = html.length;

  const pushText = (t: string) => {
    if (!t) return;
    const last = cur.children[cur.children.length - 1];
    const text = decodeEntities(t);
    if (last && last.type === "text") last.text += text;
    else cur.children.push({ type: "text", text });
  };
  const closeTo = (tag: string): boolean => {
    for (let el: HtmlEl | null = cur; el && el !== root; el = el.parent) {
      if (el.tag === tag) {
        cur = el.parent ?? root;
        return true;
      }
    }
    return false;
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = html[i + 1] === "/";
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i + (close ? 2 : 1), i + (close ? 2 : 1) + 64));
    if (!nameMatch) {
      pushText("<");
      i += 1;
      continue;
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = i + (close ? 2 : 1) + nameMatch[0].length;
    let quote: string | null = null;
    for (; j < n; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const tag = nameMatch[0].toLowerCase();
    const inner = html.slice(i + (close ? 2 : 1) + nameMatch[0].length, j);
    i = j + 1;

    if (close) {
      if (tag === "p" && !closeTo("p")) cur.children.push({ type: "el", tag: "p", attrs: {}, children: [], parent: cur });
      else closeTo(tag);
      continue;
    }
    if (CLOSES_P.has(tag)) {
      for (let el: HtmlEl | null = cur; el && el !== root; el = el.parent) {
        if (el.tag === "p") {
          cur = el.parent ?? root;
          break;
        }
        if (el.tag !== "span" && el.tag !== "a" && el.tag !== "strong" && el.tag !== "em" && el.tag !== "b" && el.tag !== "i") break;
      }
    }
    if (tag === "li" && cur.tag === "li") cur = cur.parent ?? root;
    const el: HtmlEl = { type: "el", tag, attrs: parseAttrs(inner), children: [], parent: cur };
    cur.children.push(el);
    if (VOID.has(tag) || /\/\s*$/.test(inner)) continue;
    if (RAW_TEXT.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(i);
      const m = endRe.exec(rest);
      const raw = m ? rest.slice(0, m.index) : rest;
      if (raw) el.children.push({ type: "text", text: tag === "textarea" || tag === "title" ? decodeEntities(raw) : raw });
      i += m ? m.index + m[0].length : rest.length;
      continue;
    }
    cur = el;
  }
  return root;
}

/** Depth-first walk; return false from `visit` to skip an element's children. */
export function walk(node: HtmlNode, visit: (n: HtmlNode) => boolean | void): void {
  if (visit(node) === false) return;
  if (node.type === "el") for (const c of node.children) walk(c, visit);
}

export function findAll(root: HtmlNode, pred: (el: HtmlEl) => boolean): HtmlEl[] {
  const out: HtmlEl[] = [];
  walk(root, (n) => {
    if (n.type === "el" && n.tag !== "#root" && pred(n)) out.push(n);
  });
  return out;
}

export function findFirst(root: HtmlNode, pred: (el: HtmlEl) => boolean): HtmlEl | null {
  let found: HtmlEl | null = null;
  walk(root, (n) => {
    if (found) return false;
    if (n.type === "el" && n.tag !== "#root" && pred(n)) {
      found = n;
      return false;
    }
  });
  return found;
}

const INVISIBLE = new Set(["script", "style", "noscript", "template", "svg", "iframe", "head", "title"]);
const BLOCKISH = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "tr", "td", "ul", "ol", "header", "footer", "nav"]);

/** Visible text, whitespace collapsed. Block boundaries become spaces so words never run together. */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  walk(node, (n) => {
    if (n.type === "text") {
      parts.push(n.text);
      return;
    }
    if (INVISIBLE.has(n.tag)) return false;
    if (BLOCKISH.has(n.tag)) parts.push(" ");
  });
  return parts.join("").replace(/[\s ]+/g, " ").trim();
}

export const classesOf = (el: HtmlEl): string[] => (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
export const hasClassLike = (el: HtmlEl, re: RegExp): boolean => re.test(el.attrs.class ?? "") || re.test(el.attrs.id ?? "");

export function ancestors(el: HtmlEl): HtmlEl[] {
  const out: HtmlEl[] = [];
  for (let p = el.parent; p && p.tag !== "#root"; p = p.parent) out.push(p);
  return out;
}

/** Escape text for HTML element content and double-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
