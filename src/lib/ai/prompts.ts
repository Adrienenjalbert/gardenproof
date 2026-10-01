/**
 * Versioned prompt files (prompts/*.md) with tiny {{var}} templating.
 *
 * File format:
 *   ---
 *   version: 3
 *   ---
 *   Markdown body with {{vars}} and {{> partial/name}} includes (e.g. {{> voice/thorburn}}).
 *
 * Why files instead of string constants: prompts are reviewed and diffed like copy, and the
 * version travels into each asset's checks so a regression can be traced to a prompt change.
 */
import fs from "node:fs";
import path from "node:path";

export type PromptFile = { name: string; version: number; body: string };

const cache = new Map<string, PromptFile>();

export const promptsDir = () => process.env.PROMPTS_DIR ?? path.join(process.cwd(), "prompts");

export function parsePromptFile(name: string, raw: string): PromptFile {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  const version = Number(meta.version ?? "1");
  if (!Number.isInteger(version) || version < 1) throw new Error(`Prompt ${name}: invalid version "${meta.version}"`);
  return { name, version, body: (m ? raw.slice(m[0].length) : raw).trim() };
}

export function loadPrompt(name: string): PromptFile {
  if (!/^[a-z0-9_/-]+$/.test(name)) throw new Error(`Invalid prompt name: ${name}`);
  const hit = cache.get(name);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const file = path.join(promptsDir(), `${name}.md`);
  const parsed = parsePromptFile(name, fs.readFileSync(file, "utf8"));
  cache.set(name, parsed);
  return parsed;
}

/**
 * Replace {{var}} with vars[var] and {{> partial}} with the partial's body (one level deep).
 * Unknown variables throw: a silently empty slot is how prompts rot.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
  loadPartial: (name: string) => string = (n) => loadPrompt(n).body,
): string {
  const withPartials = template.replace(/\{\{>\s*([a-z0-9_/-]+)\s*\}\}/g, (_, p: string) => loadPartial(p));
  return withPartials.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Missing template variable "${key}"`);
    return String(vars[key]);
  });
}

export function renderPrompt(name: string, vars: Record<string, string | number>): { text: string; version: number } {
  const p = loadPrompt(name);
  return { text: renderTemplate(p.body, vars), version: p.version };
}
