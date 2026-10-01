import { describe, expect, it } from "vitest";
import { THORBURN_ENTRIES } from "./__fixtures__/fake-firecrawl";
import { sanitiseHtml } from "./sanitize";
import { extractShellParts, navLinksOf, renderFooter, renderHeader, renderShellCss } from "./shell";

const SITE = "https://thorburnlandscapes.co.uk/";
const opts = { baseUrl: "https://thorburnlandscapes.co.uk/about/", siteUrl: SITE };

describe("sanitiseHtml", () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', "<p>ok</p>"],
    ['<img src="/a.png" onerror="alert(1)">', '<img src="https://thorburnlandscapes.co.uk/a.png" alt="" loading="lazy" decoding="async">'],
    ['<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="java\tscript:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="  JaVaScRiPt:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="&#106;avascript:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', "<a>x</a>"],
    ['<svg onload="alert(1)"><circle/></svg>ok', "ok"],
    ['<iframe src="https://evil.example"></iframe>ok', "ok"],
    ['<form action="https://evil.example"><input name="card"><button>Pay</button></form>ok', "ok"],
    ['<div style="background:url(javascript:alert(1))" class="elementor gp-x">ok</div>', '<div class="gp-x">ok</div>'],
    ['<p onclick="steal()" onmouseover="x()">hi</p>', "<p>hi</p>"],
    ["<style>body{display:none}</style>ok", "ok"],
    ['<img src="https://www.facebook.com/tr?id=1&ev=PageView" width="1" height="1">ok', "ok"],
    ['<img src="https://tracker.example/p.gif" width="1" height="1">ok', "ok"],
    ['<img src="https://evil.example/logo.png">ok', "ok"], // images only from the business's own site
    ['<img src="data:image/png;base64,AAAA">ok', "ok"],
    ["<scr<script>ipt>alert(1)</script>ok", "ipt&gt;alert(1)ok"],
    ["<p>1 &lt; 2 &amp; <b>bold</b></p>", "<p>1 &lt; 2 &amp; <b>bold</b></p>"],
  ])("sanitises %s", (input, expected) => {
    expect(sanitiseHtml(input, opts)).toBe(expected);
  });

  it("absolutises links and images against the page and keeps real site links", () => {
    const out = sanitiseHtml('<a href="../service/landscaping/">Landscaping</a><a href="tel: 020 8064 1303">Call</a><img src="//thorburnlandscapes.co.uk/wp-content/logo.png" alt="Logo">', opts);
    expect(out).toContain('href="https://thorburnlandscapes.co.uk/service/landscaping/"');
    expect(out).toContain('href="tel:020 8064 1303"');
    expect(out).toContain('src="https://thorburnlandscapes.co.uk/wp-content/logo.png"');
  });

  it("marks external links noopener and keeps target only with it", () => {
    const out = sanitiseHtml('<a href="https://www.instagram.com/x/" target="_blank">IG</a>', opts);
    expect(out).toBe('<a href="https://www.instagram.com/x/" rel="noopener noreferrer" target="_blank">IG</a>');
  });

  it("escapes attribute values", () => {
    expect(sanitiseHtml('<a title="&quot;><script>alert(1)</script>" href="/x">x</a>', opts)).toBe(
      '<a title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" href="https://thorburnlandscapes.co.uk/x">x</a>',
    );
  });
});

describe("shell from the Thorburn homepage", () => {
  const home = THORBURN_ENTRIES.find((e) => e.endpoint === "scrape" && e.url === "https://thorburnlandscapes.co.uk/");
  const raw = home && "rawHtml" in home.response ? (home.response.rawHtml ?? "") : "";
  const parts = extractShellParts(raw, SITE, { logoUrl: "https://thorburnlandscapes.co.uk/wp-content/uploads/2014/09/logo-header1.png" });

  it("reads logo, menu, contact items and call to action", () => {
    expect(parts.logo?.src).toBe("https://thorburnlandscapes.co.uk/wp-content/uploads/2014/09/logo-header1.png");
    expect(parts.nav.map((n) => n.label)).toEqual(["Services", "Gallery", "Locations", "About", "Contact"]);
    expect(parts.nav[0].children.map((c) => c.label)).toEqual(["Landscaping", "Garden Design", "Garden Maintenance"]);
    expect(parts.contacts).toEqual([
      { kind: "email", label: "Email", text: "info@thorburnlandscapes.co.uk", href: "mailto:info@thorburnlandscapes.co.uk" },
      { kind: "phone", label: "Call", text: "020 8064 1303", href: "tel:02080641303" },
      { kind: "location", label: "Location", text: "Wimbledon, SW19 3NW", href: "https://thorburnlandscapes.co.uk/contact/" },
    ]);
    expect(parts.cta).toEqual({ text: "Contact us", href: "https://thorburnlandscapes.co.uk/contact/" });
    expect(parts.footer.columns.map((c) => c.heading)).toEqual(["Services", "Quick Link"]);
    expect(parts.footer.social).toEqual([{ network: "instagram", url: "https://www.instagram.com/thorburn.landscapes/" }]);
  });

  it("gives a parent menu item without a page its first child's link", () => {
    expect(navLinksOf(parts.nav)[0]).toEqual({ label: "Services", href: "https://thorburnlandscapes.co.uk/service/landscaping/" });
  });

  it("renders safe markup with only our classes and real site links", () => {
    const html = renderHeader(parts, "Thorburn Landscapes") + renderFooter(parts, "Thorburn Landscapes", "Thorburn Landscapes Limited", 2026);
    expect(html).not.toMatch(/<script|on\w+=|style=|javascript:|elementor|<svg|<form|<iframe/i);
    for (const cls of html.match(/class="([^"]+)"/g) ?? []) expect(cls).toMatch(/^class="(gp-[a-z0-9-]+ ?)+"$/);
    expect(html).toContain('href="https://thorburnlandscapes.co.uk/gallery-2/"');
    expect(html).toContain("© 2026 Thorburn Landscapes Limited");
    expect(html).not.toContain("Better-clicks"); // the theme's stale copyright is not copied
  });

  it("builds CSS from brand tokens with the font import first", () => {
    const css = renderShellCss({
      primary: "#2A7D2E", text: "#0B3D2C", headerBg: "#EEEEE1", headerText: "#0B3D2C", topbarBg: "#FFFFFF", topbarText: "#0B3D2C", topbarAccent: "#2A7D2E", footerBg: "#0B3D2C",
      footerText: "#FFFFFF", headingFont: "Montserrat", bodyFont: "Roboto", buttonBg: "#2A7D2E", buttonText: "#FFFFFF", buttonRadius: "20px",
    });
    expect(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Montserrat')).toBe(true);
    expect(css).toContain("--gp-header-bg:#EEEEE1");
    expect(css).not.toMatch(/thorburnlandscapes\.co\.uk/); // never hotlinks their theme
  });
});
