/**
 * The onboarding pipeline: website URL → draft BusinessProfile. Six steps with plain-English labels for the
 * progress screen. A failing step is recorded and the next one still runs: the owner always gets whatever we found.
 * No database access here (runs.ts persists), so the CLI can run it without the queue.
 */
import fs from "node:fs/promises";
import sharp from "sharp";
import { putObject } from "@/lib/storage";
import { bodiesMentioned, collectBadgeImages, decideBadges, identifyByFingerprint, identifyByText, type BodyListing, type SiteBadge, type ThirdPartyClaim } from "./badges";
import { brandFromBranding, sampleColours, shellTokens } from "./brand";
import type { BusinessIdentity } from "./entity";
import type { Firecrawl, ScrapeResult } from "./firecrawl";
import { findAll, parseHtml, textOf } from "./html";
import { downloadImage, imageSize, logoFingerprint, originalImageCandidates, storeGraphic, storePhoto, type Downloader } from "./images";
import { noPlaces, type PlaceLookup } from "./places";
import { contentImages, projectFromPage, projectLinksFromIndex, projectsFromGallery, type ProjectDraft } from "./projects";
import { BADGE_NAMES } from "./providers";
import { aggregateRating, pickFeaturedReviews } from "./ratings";
import { buildQueries, investigateWeb, searchAll, type ReviewsOutcome } from "./reviews";
import { extractShellParts, navLinksOf, renderFooter, renderHeader, renderShellCss, type ShellParts } from "./shell";
import {
  aboutFromMarkdown, areaNameFromUrl, contactFacts, pickKeyPages, servicesFrom, SITE_FACTS_JSON_SCHEMA, SITE_FACTS_PROMPT, SITE_FACTS_SCHEMA, socialLinks, yearsTradingFrom,
  type KeyPages, type SiteFacts,
} from "./site";
import { collapse, findPostcodes, formatUkPhone, looseKey, normalisePhone, outwardOf, slugify } from "./text";
import { BusinessProfileSchema, type BusinessProfile, type ScrapedProject } from "./types";
import { absolutise, canonicalUrl } from "./url";

export const ONBOARDING_STEPS = [
  { key: "site", label: "Reading your website" },
  { key: "brand", label: "Finding your brand" },
  { key: "projects", label: "Collecting your projects" },
  { key: "reviews", label: "Searching for your reviews" },
  { key: "badges", label: "Checking your badges" },
  { key: "assemble", label: "Putting it together" },
] as const;
export type StepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export type StepStatus = "pending" | "running" | "done" | "failed";

export type PipelineDeps = {
  fc: Firecrawl;
  download?: Downloader;
  places?: PlaceLookup;
  now?: () => Date;
  /** Progress callback (the queue handler writes it to onboarding_runs.steps). */
  onStep?: (key: StepKey, status: StepStatus, detail?: string) => Promise<void> | void;
  /** Called with a schema-valid draft after every step, so partial results are never lost. */
  onDraft?: (profile: BusinessProfile) => Promise<void> | void;
  maxProjects?: number;
  log?: (msg: string) => void;
};

type Page = { url: string; markdown: string; rawHtml: string; links: string[]; title: string | null };

/** Everything learned so far; `draft()` turns it into a valid profile at any point. */
type State = {
  inputUrl: string;
  siteUrl: string;
  slug: string;
  name: string;
  legalName: string | null;
  companyNumber: string | null;
  yearsTrading: number | null;
  tagline: string | null;
  about: string | null;
  contact: BusinessProfile["contact"];
  otherPhones: string[];
  brand: BusinessProfile["brand"];
  shell: BusinessProfile["shell"];
  services: BusinessProfile["services"];
  areas: BusinessProfile["areas"];
  cta: BusinessProfile["cta"];
  badges: BusinessProfile["badges"];
  reviews: BusinessProfile["reviews"];
  projects: ScrapedProject[];
  social: BusinessProfile["social"];
  warnings: string[];
  rejected: BusinessProfile["rejected"];
  // working data
  home: ScrapeResult | null;
  pages: KeyPages | null;
  extra: Page[];
  facts: SiteFacts | null;
  shellParts: ShellParts | null;
  web: ReviewsOutcome | null;
  places: string[];
};

function draft(s: State, now: Date): BusinessProfile {
  return BusinessProfileSchema.parse({
    version: 1,
    source: { url: s.siteUrl, scrapedAt: now.toISOString() },
    name: s.name,
    legalName: s.legalName,
    companyNumber: s.companyNumber,
    yearsTrading: s.yearsTrading,
    tagline: s.tagline,
    about: s.about,
    contact: s.contact,
    brand: s.brand,
    shell: s.shell,
    services: s.services,
    areas: s.areas,
    cta: s.cta,
    badges: s.badges,
    reviews: s.reviews,
    projects: s.projects,
    social: s.social,
    warnings: [...new Set(s.warnings)],
    rejected: s.rejected,
  });
}

const toPage = (url: string, r: ScrapeResult): Page => ({
  url: (r.metadata?.url as string | undefined) ?? url,
  markdown: r.markdown ?? "",
  rawHtml: r.rawHtml ?? "",
  links: r.links ?? [],
  title: (r.metadata?.title as string | undefined) ?? null,
});

const onPage = (text: string, value: string | null | undefined) => Boolean(value && looseKey(text).includes(looseKey(value)));

// ── steps ────────────────────────────────────────────────────────────────────────────────────────────────────

async function stepSite(s: State, d: Required<Pick<PipelineDeps, "fc" | "places">> & PipelineDeps): Promise<string> {
  const home = await d.fc.scrape({
    url: s.inputUrl,
    formats: ["branding", "rawHtml", "links", "markdown", { type: "screenshot", fullPage: true }, { type: "json", prompt: SITE_FACTS_PROMPT, schema: SITE_FACTS_JSON_SCHEMA }],
    onlyMainContent: false,
  });
  s.home = home;
  const finalUrl = (home.metadata?.url as string | undefined) ?? s.inputUrl;
  s.siteUrl = `${new URL(finalUrl).origin}/`;
  const facts = SITE_FACTS_SCHEMA.safeParse(home.json);
  s.facts = facts.success ? facts.data : null;

  let mapped: string[] = [];
  try {
    mapped = await d.fc.map({ url: s.siteUrl, limit: 300 });
  } catch {
    s.warnings.push("We couldn't list every page of your website; some projects or areas may be missing.");
  }
  const links = [...(home.links ?? []), ...mapped].map((l) => absolutise(l, s.siteUrl)).filter((l): l is string => Boolean(l));
  s.pages = pickKeyPages(links, s.siteUrl);
  s.shellParts = extractShellParts(home.rawHtml ?? "", finalUrl, { siteUrl: s.siteUrl, logoUrl: home.branding?.images?.logo ?? home.branding?.logo ?? null });

  // Read the about/contact/locations pages (one each) for prose, contact details and areas.
  for (const kind of ["about", "contact", "locations"] as const) {
    const url = s.pages[kind][0];
    if (!url) continue;
    try {
      s.extra.push(toPage(url, await d.fc.scrape({ url, formats: ["markdown", "rawHtml", "links"] })));
    } catch {
      /* optional page */
    }
  }
  const homePage = toPage(finalUrl, home);
  const all = [homePage, ...s.extra];
  const allText = all.map((p) => p.markdown).join("\n\n");

  const meta = home.metadata ?? {};
  s.name = collapse(
    (home.branding?.brandName as string | undefined) ?? s.facts?.businessName ?? (meta.ogSiteName as string | undefined) ?? (meta.title ?? "").split(/\s[-|–]\s/).pop() ?? new URL(s.siteUrl).hostname,
  );
  s.slug = slugify(s.name);
  s.legalName = s.facts?.legalName && onPage(allText, s.facts.legalName) ? s.facts.legalName : null;

  const cf = contactFacts(all, s.siteUrl);
  const headerPhone = s.shellParts.contacts.find((c) => c.kind === "phone")?.href?.slice(4) ?? null;
  const phone = headerPhone ?? cf.phones[0] ?? normalisePhone(s.facts?.phone ?? "");
  const host = new URL(s.siteUrl).hostname.replace(/^www\./, "");
  const email = s.shellParts.contacts.find((c) => c.kind === "email")?.text ?? cf.emails.find((e) => e.endsWith(host)) ?? cf.emails[0] ?? null;
  const locationText = s.shellParts.contacts.find((c) => c.kind === "location")?.text ?? null;
  const postcode = (locationText && findPostcodes(locationText)[0]) ?? cf.postcodes[0] ?? null;
  const factAddress = s.facts?.address && onPage(allText, s.facts.address) ? s.facts.address : null;
  s.contact = { phone: phone ? formatUkPhone(phone) : null, email, address: factAddress ?? locationText, postcode };
  s.otherPhones = cf.phones.filter((p) => p !== phone);

  s.yearsTrading =
    (s.facts?.yearsTrading && onPage(allText, String(s.facts.yearsTrading)) ? s.facts.yearsTrading : null) ?? yearsTradingFrom(allText, d.now?.() ?? new Date());
  const tagline = s.facts?.tagline && onPage(allText, s.facts.tagline) ? s.facts.tagline : null;
  s.tagline = tagline ? collapse(tagline) : ((meta.title as string | undefined)?.split(/\s[-|–]\s/)[0] ?? null);
  const aboutPage = s.extra.find((p) => p.url === s.pages?.about[0]);
  const factAbout = s.facts?.about && onPage(allText, s.facts.about.slice(0, 60)) ? s.facts.about : null;
  s.about = factAbout ?? (aboutPage ? aboutFromMarkdown(aboutPage.markdown) : null) ?? aboutFromMarkdown(homePage.markdown) ?? ((meta.description as string | undefined) || null);

  s.services = servicesFrom(s.shellParts.nav, s.pages.service);
  if (!s.services.length && s.facts?.services?.length) s.services = s.facts.services.slice(0, 10).map((l) => ({ key: slugify(l).replace(/-/g, "_"), label: l, url: null }));

  // Areas: location pages, stated areas, and the business's own postcode district.
  const names = new Map<string, string>();
  for (const u of s.pages.location) {
    const n = areaNameFromUrl(u);
    if (n && !/office/i.test(u)) names.set(n.toLowerCase(), n);
  }
  for (const a of s.facts?.areasCovered ?? []) if (a.length <= 30 && onPage(allText, a)) names.set(a.toLowerCase(), a);
  const info = postcode ? await d.places.postcodeInfo(postcode) : null;
  const near = info?.lat != null && info.lon != null ? { lat: info.lat, lon: info.lon } : null;
  const areas: BusinessProfile["areas"] = [];
  for (const n of [...names.values()].slice(0, 30)) areas.push({ name: n, outward: await d.places.outwardFor(n, near) });
  s.areas = areas;
  s.places = [...new Set([...areas.map((a) => a.name), ...(locationText ? locationText.split(",").map((x) => x.trim()).filter((x) => !findPostcodes(x).length) : [])])];
  if (info?.district) s.places.push(info.district);
  if (info?.region) s.places.push(info.region);

  s.social = socialLinks([...(home.links ?? []), ...s.shellParts.footer.social.map((x) => x.url)]);

  // Call to action: the branding's primary button, linked where the page links it.
  const primary = (home.branding?.__llm_button_reasoning as { primary?: { text?: string } } | undefined)?.primary?.text ?? null;
  const anchor = primary
    ? findAll(parseHtml(home.rawHtml ?? ""), (e) => e.tag === "a").find((a) => collapse(a.attrs["data-text"] ?? "") === primary || looseKey(textOf(a)) === looseKey(primary))
    : undefined;
  const anchorHref = anchor ? absolutise(anchor.attrs.href, finalUrl) : null;
  s.cta =
    primary && anchorHref && !/#$/.test(anchorHref)
      ? { text: collapse(primary), url: anchorHref }
      : s.shellParts.cta
        ? { text: s.shellParts.cta.text, url: s.shellParts.cta.href }
        : s.pages.contact[0]
          ? { text: "Get in touch", url: s.pages.contact[0] }
          : { text: "Call us", url: phone ? `tel:${phone}` : s.siteUrl };
  return `${all.length} pages read`;
}

async function stepBrand(s: State, d: PipelineDeps & { download: Downloader }): Promise<string> {
  const home = s.home;
  if (!home || !s.shellParts) throw new Error("website not read");
  s.brand = brandFromBranding(home.branding, { favicon: (home.metadata?.favicon as string | undefined) ?? null });

  let shot: Buffer | null = null;
  if (home.screenshotPath) shot = await fs.readFile(home.screenshotPath).catch(() => null);
  if (!shot && home.screenshot?.startsWith("http")) shot = await d.download(home.screenshot);
  let screenshotKey: string | null = null;
  if (shot) {
    const jpg = await sharp(shot, { failOn: "none", limitInputPixels: false }).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer().catch(() => null);
    if (jpg) screenshotKey = await putObject(`intel/${s.slug}/shell/homepage.jpg`, jpg);
  }
  if (s.brand.logoUrl) {
    const buf = await d.download(s.brand.logoUrl);
    const stored = buf ? await storeGraphic(buf, `intel/${s.slug}/brand/logo.png`) : null;
    s.brand.logoKey = stored?.key ?? null;
  }
  const tokens = shellTokens(s.brand, home.branding, await sampleColours(shot));
  s.shell = {
    headerHtml: renderHeader(s.shellParts, s.name),
    footerHtml: renderFooter(s.shellParts, s.name, s.legalName, (d.now?.() ?? new Date()).getFullYear()),
    css: renderShellCss(tokens),
    navLinks: navLinksOf(s.shellParts.nav),
    screenshotKey,
  };
  return `${s.shell.navLinks.length} menu links`;
}

async function stepProjects(s: State, d: PipelineDeps & { download: Downloader }): Promise<string> {
  if (!s.pages) throw new Error("website not read");
  const max = d.maxProjects ?? 12;
  const areaNames = s.areas.map((a) => a.name);
  const homeLinks = new Set((s.home?.links ?? []).map(canonicalUrl));
  const items = [...s.pages.portfolio_item].sort((a, b) => Number(homeLinks.has(canonicalUrl(b))) - Number(homeLinks.has(canonicalUrl(a)))).slice(0, max);

  // The portfolio / case-studies index: prefer the one in the menu (by label or by URL shape).
  const navHrefs = new Set((s.shell.navLinks ?? []).map((l) => canonicalUrl(l.href)));
  const navIndex = (s.shellParts?.nav ?? [])
    .flatMap((n) => [n, ...n.children])
    .filter((n) => n.href && /case stud|portfolio|projects?|our work|recent work|gallery/i.test(n.label))
    .map((n) => n.href!);
  const indexes = [...new Set([...navIndex, ...[...s.pages.portfolio_index].sort((a, b) => Number(navHrefs.has(canonicalUrl(b))) - Number(navHrefs.has(canonicalUrl(a))))])];
  let index: Page | null = null;
  if (indexes[0]) {
    try {
      index = toPage(indexes[0], await d.fc.scrape({ url: indexes[0], formats: ["markdown", "rawHtml"] }));
    } catch {
      /* index optional */
    }
  }
  if (index && items.length < max) {
    const known = new Set(Object.values(s.pages).flat().filter((u) => !s.pages!.portfolio_item.includes(u)).map((u) => u.replace(/[#?].*$/, "").replace(/\/+$/, "")));
    for (const l of navLinksOf(s.shellParts?.nav ?? [])) known.add(l.href.replace(/[#?].*$/, "").replace(/\/+$/, ""));
    for (const u of projectLinksFromIndex(index.rawHtml, index.url, s.siteUrl, known, max)) {
      if (items.length >= max) break;
      if (!items.some((i) => canonicalUrl(i) === canonicalUrl(u))) items.push(u);
    }
  }
  const pages: Page[] = [];
  for (const url of items) {
    try {
      pages.push(toPage(url, await d.fc.scrape({ url, formats: ["markdown", "rawHtml"] })));
    } catch {
      /* skip unreadable page */
    }
  }
  // Images repeated across project pages are page furniture (sidebars, testimonials, badges), not the project.
  const seenOn = new Map<string, number>();
  for (const p of pages) {
    for (const img of contentImages(p.rawHtml, p.url, { siteUrl: s.siteUrl, max: 80 })) {
      const k = originalImageCandidates(img.url)[0];
      seenOn.set(k, (seenOn.get(k) ?? 0) + 1);
    }
  }
  const exclude = new Set(pages.length >= 2 ? [...seenOn].filter(([, n]) => n >= 2).map(([k]) => k) : []);
  const drafts: ProjectDraft[] = [];
  for (const p of pages) {
    const pd = projectFromPage(p, { siteUrl: s.siteUrl, businessName: s.name, areas: areaNames, exclude });
    if (pd) drafts.push(pd);
  }
  if (drafts.length < max && index) {
    // Gallery top-up: photos on the index page grouped by what their file names say.
    const used = new Set(drafts.flatMap((x) => x.images.map((i) => originalImageCandidates(i.url)[0])));
    const imgs = contentImages(index.rawHtml, index.url, { siteUrl: s.siteUrl, exclude: new Set([...exclude, ...used]), max: 120 });
    drafts.push(...projectsFromGallery(imgs, { galleryUrl: index.url, areas: areaNames }).slice(0, max - drafts.length));
  }

  d.log?.(`  ${pages.length} project pages read, ${drafts.length} projects with photos found`);
  let stored = 0;
  let blocked = 0;
  const projects: ScrapedProject[] = [];
  for (const pd of drafts.slice(0, max)) {
    const images: ScrapedProject["images"] = [];
    for (const ref of pd.images) {
      if (images.length >= 6) break;
      let got = false;
      for (const candidate of originalImageCandidates(ref.url)) {
        const buf = await d.download(candidate);
        const size = buf ? await imageSize(buf) : null;
        if (!buf || !size || Math.max(size.width, size.height) < 500) {
          d.log?.(`  skip ${candidate}: ${!buf ? "download failed" : !size ? "not an image" : "too small"}`);
          continue;
        }
        const saved = await storePhoto(buf, `intel/${s.slug}/projects/${slugify(pd.title).slice(0, 40)}`, candidate);
        if (!saved) continue;
        images.push({ url: candidate, key: saved.key, alt: ref.alt, width: saved.width, height: saved.height });
        stored++;
        got = true;
        break;
      }
      if (!got) {
        // Some sites block downloads (bot challenges): keep the photo as a link so the owner still sees it.
        blocked++;
        images.push({ url: ref.url, key: null, alt: ref.alt, width: ref.declaredWidth, height: null });
      }
    }
    if (images.length) projects.push({ title: pd.title, url: pd.url, category: pd.category, area: pd.area, summary: pd.summary, images });
  }
  s.projects = projects;
  if (blocked) s.warnings.push(`Your website stopped us copying ${blocked} project photo${blocked > 1 ? "s" : ""}; ${blocked > 1 ? "they are" : "it is"} linked from your site for now. Add photos from your jobs to replace ${blocked > 1 ? "them" : "it"}.`);
  if (!projects.length) s.warnings.push("We couldn't find project photos on your website. You can add projects from your jobs instead.");
  return `${projects.length} projects, ${stored} photos${blocked ? ` (${blocked} linked)` : ""}`;
}

function identity(s: State): BusinessIdentity {
  const phones = [s.contact.phone, ...s.otherPhones].map((p) => (p ? normalisePhone(p) : null)).filter((p): p is string => Boolean(p));
  return {
    name: s.name,
    legalName: s.legalName,
    phones: [...new Set(phones)],
    emails: s.contact.email ? [s.contact.email] : [],
    website: s.siteUrl,
    postcodes: s.contact.postcode ? [s.contact.postcode] : [],
    outwardCodes: [...new Set([...s.areas.map((a) => a.outward).filter((o): o is string => Boolean(o)), ...(s.contact.postcode ? [outwardOf(s.contact.postcode)] : [])])],
    places: [...new Set(s.places)],
    companyNumber: s.companyNumber,
  };
}

async function stepReviews(s: State, d: PipelineDeps): Promise<string> {
  const biz = identity(s);
  const town = s.places[0] ?? null;
  const { hits, failed } = await searchAll(d.fc, buildQueries(s.name, town));
  if (failed.length === buildQueries(s.name, town).length) throw new Error("web search unavailable");
  const web = await investigateWeb(d.fc, biz, hits, { googleQuery: `${s.name} ${s.contact.postcode ?? town ?? ""}`.trim() });
  s.web = web;
  if (web.company) {
    s.companyNumber = s.companyNumber ?? web.company.number;
    s.legalName = s.legalName ?? web.company.legalName;
    if (s.yearsTrading === null && web.company.incorporated) {
      s.yearsTrading = Math.max(0, (d.now?.() ?? new Date()).getFullYear() - parseInt(web.company.incorporated.slice(0, 4), 10));
    }
    s.warnings.push(`Please confirm your company: ${web.company.legalName} (${web.company.number}) on Companies House.`);
  }
  for (const soc of web.social) if (!s.social.some((x) => x.network === soc.network)) s.social.push(soc);
  s.rejected.push(...web.rejected);
  s.warnings.push(...web.warnings);
  // One source per provider (the best-matched one).
  const byProvider = new Map<string, (typeof web.sources)[number]>();
  for (const src of web.sources) {
    const prev = byProvider.get(src.provider);
    if (!prev || src.matched.confidence > prev.matched.confidence) byProvider.set(src.provider, src);
  }
  const sources = [...byProvider.values()];
  for (const src of sources) {
    if (src.rating === null && src.count !== null) {
      s.warnings.push(`${src.provider[0].toUpperCase() + src.provider.slice(1)} shows ${src.count} reviews but no current overall rating, so it is not counted in your average.`);
    }
  }
  s.reviews = { sources, featured: pickFeaturedReviews(web.reviews), aggregate: aggregateRating(sources) };
  return `${sources.length} review sources, ${s.rejected.length} look-alikes set aside`;
}

async function stepBadges(s: State, d: PipelineDeps & { download: Downloader }): Promise<string> {
  const site: SiteBadge[] = [];
  const unknown: { width: number | null; height: number | null }[] = [];
  const knownSizes = new Set<string>();
  const homePage = s.home ? toPage(s.siteUrl, s.home) : null;
  const ownPages = [homePage, ...s.extra].filter((p): p is Page => Boolean(p && p.rawHtml));
  const seen = new Set<string>();
  for (const page of ownPages) {
    for (const c of collectBadgeImages(page.rawHtml, page.url, { logoUrl: s.brand.logoUrl })) {
      if (seen.has(c.src)) continue;
      seen.add(c.src);
      let body = identifyByText(c);
      let name = body ? BADGE_NAMES[body] : null;
      const buf = await d.download(c.src);
      if (!body && buf) {
        const fp = identifyByFingerprint(await logoFingerprint(buf));
        if (fp) {
          body = fp.body;
          name = fp.name;
        }
      }
      if (!body || !name) {
        unknown.push({ width: c.width, height: c.height });
        continue;
      }
      knownSizes.add(`${c.width}x${c.height}`);
      const stored = buf ? await storeGraphic(buf, `intel/${s.slug}/badges/${slugify(name)}.png`) : null;
      site.push({ body, name, imageUrl: c.src, imageKey: stored?.key ?? null, evidenceUrl: page.url, how: "Logo shown on your website" });
    }
    for (const body of bodiesMentioned(page.markdown)) {
      if (site.some((x) => x.body === body && x.how === "Mentioned on your website")) continue;
      site.push({ body, name: BADGE_NAMES[body], imageUrl: null, imageKey: null, evidenceUrl: page.url, how: "Mentioned on your website" });
    }
  }
  const listings: BodyListing[] = s.web?.listings ?? [];
  const thirdParty: ThirdPartyClaim[] = s.web?.thirdParty ?? [];
  s.badges = decideBadges({ site, listings, thirdParty, siteUrl: s.siteUrl });
  // Unrecognised images in the same logo row as recognised badges (same size) are probably badges we don't know yet.
  const suspects = unknown.filter((u) => knownSizes.has(`${u.width}x${u.height}`)).length;
  if (suspects) s.warnings.push(`${suspects} logo${suspects > 1 ? "s" : ""} next to your badges ${suspects > 1 ? "weren't" : "wasn't"} recognised. Tell us which trade body ${suspects > 1 ? "they are" : "it is"}.`);
  const claimed = s.badges.filter((b) => b.status === "claimed" && b.body !== "other");
  if (claimed.length) s.warnings.push(`We couldn't confirm ${claimed.map((b) => b.name).join(", ")} on ${claimed.length > 1 ? "their own sites" : "its own site"}. Add your membership link to show ${claimed.length > 1 ? "them" : "it"} as verified.`);
  return `${s.badges.filter((b) => b.verified).length} verified, ${claimed.length} to confirm`;
}

// ── entry point ──────────────────────────────────────────────────────────────────────────────────────────────

export async function buildProfile(url: string, deps: PipelineDeps): Promise<{ profile: BusinessProfile; failedSteps: StepKey[] }> {
  const now = deps.now ?? (() => new Date());
  const d = { ...deps, download: deps.download ?? downloadImage, places: deps.places ?? noPlaces };
  const origin = new URL(url).origin;
  const s: State = {
    inputUrl: url,
    siteUrl: `${origin}/`,
    slug: slugify(new URL(url).hostname.replace(/^www\./, "").split(".")[0]),
    name: new URL(url).hostname.replace(/^www\./, ""),
    legalName: null,
    companyNumber: null,
    yearsTrading: null,
    tagline: null,
    about: null,
    contact: { phone: null, email: null, address: null, postcode: null },
    otherPhones: [],
    brand: brandFromBranding(undefined),
    shell: { headerHtml: "", footerHtml: "", css: "", navLinks: [], screenshotKey: null },
    services: [],
    areas: [],
    cta: { text: "Visit website", url: `${origin}/` },
    badges: [],
    reviews: { sources: [], featured: [], aggregate: { rating: null, count: 0 } },
    projects: [],
    social: [],
    warnings: [],
    rejected: [],
    home: null,
    pages: null,
    extra: [],
    facts: null,
    shellParts: null,
    web: null,
    places: [],
  };
  const steps: Record<StepKey, (st: State) => Promise<string>> = {
    site: (st) => stepSite(st, d),
    brand: (st) => stepBrand(st, d),
    projects: (st) => stepProjects(st, d),
    reviews: (st) => stepReviews(st, d),
    badges: (st) => stepBadges(st, d),
    assemble: async () => "Ready to check",
  };
  const failed: StepKey[] = [];
  for (const { key, label } of ONBOARDING_STEPS) {
    await deps.onStep?.(key, "running");
    try {
      const detail = await steps[key](s);
      deps.log?.(`✓ ${label}: ${detail}`);
      await deps.onStep?.(key, "done", detail);
    } catch (err) {
      failed.push(key);
      const msg = (err as Error).message ?? String(err);
      deps.log?.(`✗ ${label}: ${msg}`);
      s.warnings.push(`${label} didn't finish (${msg.slice(0, 120)}). You can fill this in yourself.`);
      await deps.onStep?.(key, "failed", "We couldn't finish this part");
      if (key === "site") {
        // Nothing else can run without the website.
        for (const rest of ONBOARDING_STEPS.slice(1)) await deps.onStep?.(rest.key, "failed", "Skipped: we couldn't read the website");
        await deps.onDraft?.(draft(s, now()));
        break;
      }
    }
    await deps.onDraft?.(draft(s, now()));
  }
  return { profile: draft(s, now()), failedSteps: failed };
}
