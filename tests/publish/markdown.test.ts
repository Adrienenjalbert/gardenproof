import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown } from "@/lib/publish/markdown";
import { escapeHtml, safeHref } from "@/lib/publish/html";

describe("renderMarkdown", () => {
  it("renders the supported block and inline syntax", () => {
    const html = renderMarkdown(
      ["# Title", "", "Some **bold**, *italic* and `code`.", "", "- one", "- two", "", "1. first", "2. second", "", "> quoted", "", "---"].join("\n"),
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<hr>");
  });

  it("never emits a heading above h2 (the page owns the h1)", () => {
    expect(renderMarkdown("## Sub")).toBe("<h2>Sub</h2>");
    expect(renderMarkdown("### Minor")).toBe("<h3>Minor</h3>");
    expect(renderMarkdown("# Top", { minHeadingLevel: 1 })).toBe("<h1>Top</h1>");
    expect(renderMarkdown("###### Deep")).toBe("<h6>Deep</h6>");
  });

  it("escapes raw HTML instead of passing it through", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes HTML inside code spans, headings, list items and link text", () => {
    expect(renderInline("`<b>`")).toBe("<code>&lt;b&gt;</code>");
    expect(renderMarkdown("# <i>x</i>")).toBe("<h2>&lt;i&gt;x&lt;/i&gt;</h2>");
    expect(renderMarkdown("- <u>y</u>")).toBe("<ul><li>&lt;u&gt;y&lt;/u&gt;</li></ul>");
    expect(renderInline("[<b>hi</b>](/x)")).toBe('<a href="/x">&lt;b&gt;hi&lt;/b&gt;</a>');
  });

  it("only allows safe link targets", () => {
    expect(renderInline("[a](https://example.com/?a=1&b=2)")).toBe(
      '<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">a</a>',
    );
    expect(renderInline("[a](/projects/x)")).toBe('<a href="/projects/x">a</a>');
    for (const bad of ["javascript:void0", "JaVaScRiPt:void0", "data:text/html,x", "//evil.com", "vbscript:x"]) {
      expect(renderInline(`[click](${bad})`)).toBe("click");
    }
  });

  it("cannot break out of the href attribute", () => {
    const html = renderInline('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain("&quot;");
  });

  it("ignores injected placeholder characters", () => {
    expect(renderInline("a\u00000\u0000b [l](/x)")).toBe('a0b <a href="/x">l</a>');
  });
});

describe("html helpers", () => {
  it("escapes all attribute-breaking characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
  it("safeHref rejects obfuscated schemes", () => {
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    expect(safeHref(" mailto:a@b.co ")).toBe("mailto:a@b.co");
    expect(safeHref("#faq")).toBe("#faq");
  });
});
