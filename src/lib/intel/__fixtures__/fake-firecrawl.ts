/**
 * Test double for Firecrawl, replaying trimmed real responses captured from the onboarding cache for
 * thorburnlandscapes.co.uk (see thorburn-firecrawl.json). Unknown requests fail like a 404 / return no results,
 * and every call is recorded so tests can assert what was (not) fetched.
 */
import fs from "node:fs";
import path from "node:path";
import { FirecrawlError, type Firecrawl, type ScrapeResult, type SearchResult } from "../firecrawl";

type Entry =
  | { endpoint: "scrape"; url: string; json: boolean; response: ScrapeResult }
  | { endpoint: "search"; query: string; response: SearchResult[] | { web?: SearchResult[] } }
  | { endpoint: "map"; url: string; response: { links?: (string | { url: string })[] } };

export const THORBURN_ENTRIES: Entry[] = JSON.parse(fs.readFileSync(path.join(__dirname, "thorburn-firecrawl.json"), "utf8"));

const norm = (u: string) => u.replace(/\/+$/, "");

export function fakeFirecrawl(entries: Entry[] = THORBURN_ENTRIES): Firecrawl & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    creditsUsed: 0,
    async scrape(req) {
      calls.push(`scrape ${req.url}`);
      const wantsJson = req.formats.some((f) => typeof f === "object" && f.type === "json");
      const matches = entries.filter((e): e is Extract<Entry, { endpoint: "scrape" }> => e.endpoint === "scrape" && norm(e.url) === norm(req.url));
      const hit = matches.find((e) => e.json === wantsJson) ?? matches[0];
      if (!hit) throw new FirecrawlError(`Firecrawl scrape 404 (no fixture for ${req.url})`, 404);
      return structuredClone(hit.response);
    },
    async search(req) {
      calls.push(`search ${req.query}`);
      const hit = entries.find((e): e is Extract<Entry, { endpoint: "search" }> => e.endpoint === "search" && e.query === req.query);
      if (!hit) return [];
      return Array.isArray(hit.response) ? hit.response : (hit.response.web ?? []);
    },
    async map(req) {
      calls.push(`map ${req.url}`);
      const hit = entries.find((e): e is Extract<Entry, { endpoint: "map" }> => e.endpoint === "map" && norm(e.url) === norm(req.url));
      return (hit?.response.links ?? []).map((l) => (typeof l === "string" ? l : l.url));
    },
  };
}
