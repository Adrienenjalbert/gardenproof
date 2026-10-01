/**
 * Run the website onboarding pipeline for one URL, without the queue or the database.
 *
 *   node --env-file=.env.local --import tsx scripts/onboard.ts https://thorburnlandscapes.co.uk [--fresh] [--preview]
 *
 * Writes data/profiles/<slug>.json (validated), stores images under STORAGE_DIR (default .data/intel/storage) and
 * copies them to public/intel/<slug>/… (same relative paths as the storage keys, JPEG ≤ 1600px, < 15 MB) so
 * prototypes can use them directly. Firecrawl responses are cached in .data/intel-cache (--fresh bypasses it).
 * --preview renders the cloned header/footer with Playwright next to the homepage screenshot.
 */
import fs from "node:fs/promises";
import path from "node:path";

process.env.STORAGE_DIR ??= path.join(process.cwd(), ".data", "intel", "storage");
process.env.PGLITE_DIR ??= path.join(process.cwd(), ".data", "intel", "pglite");

const PUBLIC_BUDGET = 15 * 1024 * 1024 - 256 * 1024;

async function copyToPublic(keys: string[], slug: string): Promise<{ files: number; bytes: number; skipped: number }> {
  const sharp = (await import("sharp")).default;
  const { getObject } = await import("@/lib/storage");
  const root = path.join(process.cwd(), "public", "intel", slug);
  await fs.rm(root, { recursive: true, force: true });
  let bytes = 0;
  let files = 0;
  let skipped = 0;
  for (const key of keys) {
    const rel = key.replace(new RegExp(`^intel/${slug}/`), "");
    const buf = await getObject(key).catch(() => null);
    if (!buf) continue;
    const out = /\.png$/i.test(key)
      ? await sharp(buf).resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer()
      : await sharp(buf).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 74, mozjpeg: true }).toBuffer();
    if (bytes + out.length > PUBLIC_BUDGET) {
      skipped++;
      continue;
    }
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, out);
    bytes += out.length;
    files++;
  }
  return { files, bytes, skipped };
}

async function preview(profile: import("@/lib/intel/types").BusinessProfile, outDir: string): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const { objectPath } = await import("@/lib/storage");
  await fs.mkdir(outDir, { recursive: true });
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${profile.shell.css}body{margin:0;font-family:system-ui}</style></head><body>${profile.shell.headerHtml}<main style="min-height:60vh;display:grid;place-items:center;background:#f4f4f0;color:#666">Directory page content</main>${profile.shell.footerHtml}</body></html>`;
  const file = path.join(outDir, "shell.html");
  await fs.writeFile(file, html);
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  for (const [name, width, height] of [["desktop", 1920, 1080], ["mobile", 390, 844]] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`file://${file}`, { waitUntil: "networkidle" }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, `shell-${name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  if (profile.shell.screenshotKey) {
    const sharp = (await import("sharp")).default;
    const shot = await sharp(objectPath(profile.shell.screenshotKey)).metadata();
    const top = Math.round(((shot.width ?? 1440) / 1920) * 200);
    const theirs = await sharp(objectPath(profile.shell.screenshotKey)).extract({ left: 0, top: 0, width: shot.width ?? 1440, height: top }).resize({ width: 1920 }).png().toBuffer();
    const ours = await sharp(path.join(outDir, "shell-desktop.png")).extract({ left: 0, top: 0, width: 1920, height: 200 }).png().toBuffer();
    const theirsMeta = await sharp(theirs).metadata();
    await sharp({ create: { width: 1920, height: (theirsMeta.height ?? 200) + 210, channels: 3, background: "#ff0000" } })
      .composite([{ input: theirs, top: 0, left: 0 }, { input: ours, top: (theirsMeta.height ?? 200) + 10, left: 0 }])
      .png()
      .toFile(path.join(outDir, "compare-header.png"));
  }
}

function summary(p: import("@/lib/intel/types").BusinessProfile, credits: number): string {
  const lines: string[] = [];
  const add = (s = "") => lines.push(s);
  add(`\n${p.name}${p.legalName ? ` (${p.legalName})` : ""}${p.companyNumber ? ` · company ${p.companyNumber}` : ""}`);
  add(`  ${p.tagline ?? ""}`);
  add(`  ${p.contact.phone ?? "no phone"} · ${p.contact.email ?? "no email"} · ${p.contact.address ?? ""} ${p.contact.postcode ?? ""}`);
  add(`  Years trading: ${p.yearsTrading ?? "?"} · CTA: ${p.cta.text} → ${p.cta.url}`);
  add(`  Brand: ${p.brand.colors.primary} / ${p.brand.colors.secondary} / text ${p.brand.colors.text} · fonts ${p.brand.fonts.heading}/${p.brand.fonts.body}`);
  add(`  Services: ${p.services.map((s) => s.label).join(", ")}`);
  add(`  Areas (${p.areas.length}): ${p.areas.map((a) => `${a.name}${a.outward ? ` ${a.outward}` : ""}`).join(", ")}`);
  add(`  Menu: ${p.shell.navLinks.map((l) => l.label).join(" · ")}`);
  add(`  Social: ${p.social.map((s) => s.network).join(", ")}`);
  add(`\nBadges`);
  for (const b of p.badges) add(`  [${b.status}] ${b.name}${b.profileUrl ? ` — ${b.profileUrl}` : ""}${b.imageKey ? " (logo stored)" : ""}\n      ${b.evidence.map((e) => `${e.note ?? ""} <${e.url}>`).join("\n      ")}`);
  add(`\nReviews: aggregate ${p.reviews.aggregate.rating ?? "–"} from ${p.reviews.aggregate.count} reviews`);
  for (const s of p.reviews.sources) add(`  ${s.provider}: ${s.rating ?? "–"}/5 · ${s.count ?? "?"} reviews · matched by ${s.matched.by.join("+")} (${s.matched.confidence}) <${s.url}>`);
  add(`  Featured:`);
  for (const r of p.reviews.featured) add(`   – ${r.provider} ${r.rating ?? ""} ${r.date ?? ""} ${r.author ?? ""}: "${r.text.slice(0, 90)}…"`);
  add(`\nProjects (${p.projects.length}, ${p.projects.reduce((n, x) => n + x.images.length, 0)} photos)`);
  for (const x of p.projects) add(`  ${x.title} · ${x.category ?? "–"} · ${x.area ?? "–"} · ${x.images.length} photos`);
  add(`\nRejected look-alikes`);
  for (const r of p.rejected) add(`  ✗ ${r.url}\n      ${r.reason}`);
  add(`\nWarnings`);
  for (const w of p.warnings) add(`  ! ${w}`);
  add(`\nFirecrawl credits used this run (cache hits are free): ~${credits}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("Usage: scripts/onboard.ts <url> [--fresh] [--preview]");
    process.exit(1);
  }
  const { normaliseSiteUrl, checkPublicHttpsUrl } = await import("@/lib/intel/url");
  const site = normaliseSiteUrl(url);
  const check = site ? await checkPublicHttpsUrl(site.replace(/^http:/, "https:")) : null;
  if (!check?.ok) {
    console.error(check?.reason ?? "Not a web address");
    process.exit(1);
  }
  const { createFirecrawl } = await import("@/lib/intel/firecrawl");
  const { buildProfile } = await import("@/lib/intel/pipeline");
  const { postcodesIo } = await import("@/lib/intel/places");
  const { BusinessProfileSchema } = await import("@/lib/intel/types");
  const fc = createFirecrawl({ fresh: args.includes("--fresh") });
  const { createDownloader } = await import("@/lib/intel/images");
  const download = createDownloader({ cacheDir: path.join(process.cwd(), ".data", "intel-cache", "downloads"), fresh: args.includes("--fresh") });
  const { profile, failedSteps } = await buildProfile(check.url, { fc, download, places: postcodesIo(), log: (m) => console.log(m) });
  const valid = BusinessProfileSchema.parse(profile);
  const slug = (await import("@/lib/intel/text")).slugify(valid.name);

  const outFile = path.join(process.cwd(), "data", "profiles", `${slug}.json`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(valid, null, 2)}\n`);

  const keys = [
    valid.brand.logoKey,
    ...valid.badges.map((b) => b.imageKey),
    ...valid.projects.flatMap((p) => p.images.map((i) => i.key)),
    valid.shell.screenshotKey,
  ].filter((k): k is string => Boolean(k));
  const pub = await copyToPublic([...new Set(keys)], slug);

  console.log(summary(valid, fc.creditsUsed));
  console.log(`\nWrote ${path.relative(process.cwd(), outFile)} · public/intel/${slug}: ${pub.files} files, ${(pub.bytes / 1024 / 1024).toFixed(1)} MB${pub.skipped ? ` (${pub.skipped} skipped for size)` : ""}`);
  if (failedSteps.length) console.log(`Steps that didn't finish: ${failedSteps.join(", ")}`);
  if (args.includes("--preview")) {
    const dir = path.join(process.cwd(), ".data", "intel", "preview", slug);
    await preview(valid, dir);
    console.log(`Shell preview: ${path.relative(process.cwd(), dir)}/{shell-desktop,shell-mobile,compare-header}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
