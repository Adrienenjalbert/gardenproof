import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPrompt, parsePromptFile, promptsDir, renderPrompt, renderTemplate } from "./prompts";

describe("prompt templating", () => {
  it("replaces {{vars}} (with or without spaces)", () => {
    expect(renderTemplate("Hi {{name}}, {{ n }} jobs", { name: "Adrien", n: 3 })).toBe("Hi Adrien, 3 jobs");
  });

  it("throws on a missing variable instead of leaving a hole", () => {
    expect(() => renderTemplate("Hi {{name}}", {})).toThrow(/Missing template variable "name"/);
  });

  it("inlines partials, then fills their variables", () => {
    const out = renderTemplate("A {{> voice/x}} C", { who: "B" }, (n) => (n === "voice/x" ? "[{{who}}]" : ""));
    expect(out).toBe("A [B] C");
  });

  it("parses front matter version", () => {
    expect(parsePromptFile("t", "---\nversion: 3\n---\nBody")).toEqual({ name: "t", version: 3, body: "Body" });
    expect(parsePromptFile("t", "No front matter").version).toBe(1);
    expect(() => parsePromptFile("t", "---\nversion: x\n---\nBody")).toThrow(/invalid version/);
  });

  it("rejects path traversal in prompt names", () => {
    expect(() => loadPrompt("../package")).toThrow(/Invalid prompt name/);
  });
});

describe("shipped prompt files", () => {
  const files = fs.readdirSync(promptsDir()).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

  it("includes every task prompt and the voice guide", () => {
    expect(files).toEqual(expect.arrayContaining(["system", "enrichment", "portfolio_page", "ad_copy", "social_pack", "gbp_post", "seo_article", "judge"]));
    expect(fs.existsSync(path.join(promptsDir(), "voice", "thorburn.md"))).toBe(true);
  });

  it.each(files)("%s is versioned and renders with its declared variables", (name) => {
    const p = loadPrompt(name);
    expect(p.version).toBeGreaterThanOrEqual(1);
    const vars = Object.fromEntries(
      [...(p.body + loadPrompt("voice/thorburn").body).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => [m[1], `<${m[1]}>`]),
    );
    const { text } = renderPrompt(name, vars);
    expect(text).not.toMatch(/\{\{/);
  });

  it("the voice guide carries excellent-vs-generic examples and the banned list slot", () => {
    const voice = loadPrompt("voice/thorburn").body;
    expect(voice).toMatch(/Excellent/);
    expect(voice).toMatch(/Generic \(never\)/);
    expect(voice).toContain("{{bannedPhrases}}");
  });
});
