/**
 * Minimal, safe Markdown → HTML renderer for AI-drafted articles (no dependencies).
 *
 * Safety model: every piece of source text is HTML-escaped *before* any markup is added, and the only
 * markup produced is a fixed whitelist of tags we emit ourselves. Raw HTML in the source is shown as text,
 * and links are limited to http(s)/mailto/tel/relative targets (see `safeHref`).
 *
 * Supported: #–###### headings (never above <h2>: the page owns the single <h1>), paragraphs, **bold**, *italic*,
 * `code`, [links](url), - / * / 1. lists, > blockquotes, --- rules.
 */
import { escapeHtml, safeHref } from "./html";

export type MarkdownOptions = {
  /** Highest heading level emitted. Default 2: "# x" and "## x" both render as <h2>. */
  minHeadingLevel?: number;
};

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(lines[i++].match(QUOTE)![1]);
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    const ordered = OL_ITEM.test(line);
    if (ordered || UL_ITEM.test(line)) {
      const pattern = ordered ? OL_ITEM : UL_ITEM;
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = lines[i].match(pattern);
        if (m) items.push(m[1]);
        else if (/^\s+/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !UL_ITEM.test(lines[i]) &&
      !OL_ITEM.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", lines: para });
  }
  return blocks;
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>");
}

/** Render inline markdown. Input is raw source text; output is safe HTML. */
export function renderInline(raw: string): string {
  // Code spans first: their contents are literal.
  return raw
    .replace(/\u0000/g, "") // reserved for link placeholders below
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      const links: string[] = [];
      const withPlaceholders = part.replace(/\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g, (whole, text: string, url: string) => {
        const href = safeHref(url);
        const label = emphasis(escapeHtml(text));
        if (!href) {
          links.push(label);
        } else {
          const external = /^https?:/i.test(href) ? ' rel="noopener noreferrer"' : "";
          links.push(`<a href="${escapeHtml(href)}"${external}>${label}</a>`);
        }
        return `\u0000${links.length - 1}\u0000`;
      });
      return emphasis(escapeHtml(withPlaceholders)).replace(/\u0000(\d+)\u0000/g, (_, n: string) => links[Number(n)]);
    })
    .join("");
}

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const minLevel = options.minHeadingLevel ?? 2;
  return parseBlocks(markdown)
    .map((block) => {
      switch (block.kind) {
        case "heading": {
          const level = Math.min(6, Math.max(minLevel, block.level));
          return `<h${level}>${renderInline(block.text)}</h${level}>`;
        }
        case "paragraph":
          return `<p>${renderInline(block.lines.join(" "))}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          return `<${tag}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
        }
        case "quote":
          return `<blockquote>${renderMarkdown(block.lines.join("\n"), options)}</blockquote>`;
        case "rule":
          return "<hr>";
      }
    })
    .join("\n");
}
