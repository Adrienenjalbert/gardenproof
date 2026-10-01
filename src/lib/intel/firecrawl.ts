/**
 * Minimal Firecrawl v2 REST client (no SDK) with a disk cache keyed by the request, so re-running an onboarding
 * costs no credits. `fresh: true` bypasses the cache (and refreshes it). Credits used are tallied per client so
 * the CLI can report them.
 *
 * The client is an interface so tests (and the pipeline) can swap in a fixture-backed fake.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.firecrawl.dev/v2";

export type ScrapeFormat =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "branding"
  | "images"
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "json"; prompt: string; schema?: Record<string, unknown> };

export type ScrapeRequest = {
  url: string;
  formats: ScrapeFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  location?: { country: string };
};

export type ScrapeResult = {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  images?: string[];
  screenshot?: string;
  /** Local copy of the screenshot (set by this client; the remote URL expires). */
  screenshotPath?: string;
  json?: unknown;
  branding?: FirecrawlBranding;
  metadata?: Record<string, unknown> & { title?: string; description?: string; sourceURL?: string; url?: string; statusCode?: number };
};

/** The subset of Firecrawl's `branding` format we rely on (it returns more; everything is optional). */
export type FirecrawlBranding = {
  colorScheme?: string;
  colors?: Record<string, string | undefined>;
  fonts?: { family?: string; role?: string }[];
  typography?: { fontFamilies?: Record<string, string | undefined>; [k: string]: unknown };
  images?: { logo?: string | null; favicon?: string | null; ogImage?: string | null; [k: string]: unknown };
  components?: Record<string, Record<string, unknown> | undefined>;
  spacing?: Record<string, unknown>;
  logo?: string | null;
  [k: string]: unknown;
};

export type SearchResult = { url: string; title?: string; description?: string; position?: number };
export type SearchRequest = { query: string; limit?: number; location?: string };
export type MapRequest = { url: string; limit?: number; search?: string };

export interface Firecrawl {
  scrape(req: ScrapeRequest): Promise<ScrapeResult>;
  search(req: SearchRequest): Promise<SearchResult[]>;
  map(req: MapRequest): Promise<string[]>;
  /** Approximate credits spent by THIS client (cache hits are free). */
  readonly creditsUsed: number;
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

type Options = {
  apiKey?: string;
  cacheDir?: string;
  fresh?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export const defaultCacheDir = () => process.env.INTEL_CACHE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "intel-cache");

export function cacheKey(endpoint: string, body: unknown): string {
  return crypto.createHash("sha256").update(`${endpoint}\n${JSON.stringify(body)}`).digest("hex").slice(0, 32);
}

/** Rough credit cost per Firecrawl pricing: 1/page, +4 for JSON (LLM) extraction, 2 per 10 search results, 1 per map. */
function estimateCredits(endpoint: string, body: Record<string, unknown>): number {
  if (endpoint === "search") return Math.max(1, Math.ceil(Number(body.limit ?? 5) / 10) * 2);
  if (endpoint === "map") return 1;
  const formats = (body.formats as ScrapeFormat[]) ?? [];
  return 1 + (formats.some((f) => typeof f === "object" && f.type === "json") ? 4 : 0);
}

/**
 * Firecrawl screenshot URLs are signed and expire within hours, so the bytes are saved next to the cache entry
 * at once and the result carries `screenshotPath` (the cache stays useful after the URL has expired).
 */
async function persistScreenshot(data: ScrapeResult, file: string, doFetch: typeof fetch): Promise<void> {
  if (!data.screenshot || !/^https?:\/\//.test(data.screenshot)) return;
  try {
    const res = await doFetch(data.screenshot, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return;
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    data.screenshotPath = file;
  } catch {
    /* the screenshot is optional */
  }
}

export function createFirecrawl(opts: Options = {}): Firecrawl {
  const apiKey = opts.apiKey ?? process.env.FIRECRAWL_API_KEY ?? null;
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const doFetch = opts.fetchImpl ?? fetch;
  let credits = 0;

  async function call<T>(endpoint: "scrape" | "search" | "map", body: Record<string, unknown>): Promise<T> {
    const file = path.join(cacheDir, `${cacheKey(endpoint, body)}.json`);
    if (!opts.fresh) {
      try {
        const cached = JSON.parse(await fs.readFile(file, "utf8")) as { response: T };
        return cached.response;
      } catch {
        /* cache miss */
      }
    }
    if (!apiKey) throw new FirecrawlError("FIRECRAWL_API_KEY is not set", null);

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await doFetch(`${API}/${endpoint}`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          lastErr = new FirecrawlError(`Firecrawl ${endpoint} ${res.status}: ${text.slice(0, 200)}`, res.status);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        if (!res.ok) throw new FirecrawlError(`Firecrawl ${endpoint} ${res.status}: ${text.slice(0, 300)}`, res.status);
        const json = JSON.parse(text) as { success?: boolean; data?: T; error?: string } & Record<string, unknown>;
        if (json.success === false) throw new FirecrawlError(`Firecrawl ${endpoint} failed: ${json.error ?? "unknown error"}`, res.status);
        // /scrape and /search wrap results in `data`; /map returns `links` at the top level.
        const { success: _s, ...rest } = json;
        void _s;
        const data = (json.data ?? rest) as T;
        credits += estimateCredits(endpoint, body);
        await fs.mkdir(cacheDir, { recursive: true });
        if (endpoint === "scrape") await persistScreenshot(data as ScrapeResult, file.replace(/\.json$/, ".screenshot.png"), doFetch);
        await fs.writeFile(file, JSON.stringify({ endpoint, request: body, fetchedAt: new Date().toISOString(), response: data }));
        return data;
      } catch (err) {
        if (err instanceof FirecrawlError && err.status !== null && err.status < 500 && err.status !== 429) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new FirecrawlError(`Firecrawl ${endpoint} failed`, null);
  }

  return {
    get creditsUsed() {
      return credits;
    },
    async scrape(req) {
      const body: Record<string, unknown> = { url: req.url, formats: req.formats, onlyMainContent: req.onlyMainContent ?? false };
      if (req.waitFor) body.waitFor = req.waitFor;
      if (req.location) body.location = req.location;
      return call<ScrapeResult>("scrape", body);
    },
    async search(req) {
      const data = await call<{ web?: SearchResult[] } | SearchResult[]>("search", {
        query: req.query,
        limit: req.limit ?? 5,
        location: req.location ?? "United Kingdom",
      });
      return Array.isArray(data) ? data : (data.web ?? []);
    },
    async map(req) {
      const data = await call<{ links?: (string | { url: string })[] }>("map", { url: req.url, limit: req.limit ?? 200, ...(req.search ? { search: req.search } : {}) });
      return (data.links ?? []).map((l) => (typeof l === "string" ? l : l.url));
    },
  };
}
