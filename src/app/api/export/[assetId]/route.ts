/**
 * GET /api/export/<assetId>            → small HTML index of the asset's published export folder
 * GET /api/export/<assetId>?file=name  → download one file listed in that folder's manifest (byte ranges ok)
 * Operator only (dashboard session; proxy.ts gates it too). Only published assets whose externalId is an
 * export folder are served, and only manifest-listed files.
 */
import { requestIsOperator } from "@/lib/publish/access";
import { escapeHtml } from "@/lib/publish/html";
import { loadAsset } from "@/lib/publish/data";
import { serveStoredFile } from "@/lib/publish/serve-file";
import { isSafeExportFileName, readManifest, type ExportManifest } from "@/lib/publish/exports";

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

function indexHtml(assetId: string, m: ExportManifest): string {
  const base = `/api/export/${encodeURIComponent(assetId)}?file=`;
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const list = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(m.title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#1f2117;background:#fbfaf6;margin:0;padding:48px 20px}
main{max-width:680px;margin:0 auto}h1{font:700 28px/1.2 Georgia,serif;color:#2f3222;margin:0 0 4px}
.meta{color:#6b6e5c;font-size:14px;margin:0 0 32px}ul.files{list-style:none;padding:0;margin:0 0 32px;border-top:1px solid #e4e2d8}
ul.files li{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid #e4e2d8}
a{color:#464a33;font-weight:600}h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6b6e5c;margin:32px 0 8px}
.warn li{color:#7a4b12}</style></head><body><main>
<h1>${escapeHtml(m.title)}</h1><p class="meta">Exported ${escapeHtml(new Date(m.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" }))}</p>
<ul class="files">${m.files
    .map(
      (f) =>
        `<li><a href="${base}${encodeURIComponent(f.name)}" download>${escapeHtml(f.name)}</a><span class="meta">${kb(f.bytes)}</span></li>`,
    )
    .join("")}</ul>
${m.notes.length ? `<h2>How to use</h2><ul>${list(m.notes)}</ul>` : ""}
${m.warnings.length ? `<h2>Check before uploading</h2><ul class="warn">${list(m.warnings)}</ul>` : ""}
</main></body></html>`;
}

export async function GET(req: Request, ctx: RouteContext<"/api/export/[assetId]">) {
  if (!(await requestIsOperator(req))) return notFound();
  const { assetId } = await ctx.params;
  const asset = await loadAsset(assetId);
  if (!asset || asset.status !== "published" || !asset.externalId?.startsWith("exports/")) return notFound();
  const manifest = await readManifest(asset.externalId);
  if (!manifest) return notFound();

  const file = new URL(req.url).searchParams.get("file");
  if (!file) {
    return new Response(indexHtml(asset.id, manifest), {
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "no-store" },
    });
  }
  const entry = manifest.files.find((f) => f.name === file);
  if (!entry || !isSafeExportFileName(file)) return notFound();
  return serveStoredFile(`${asset.externalId}/${entry.name}`, req, {
    contentType: entry.contentType,
    headers: {
      "content-disposition": `attachment; filename="${entry.name}"`,
      "x-robots-tag": "noindex",
      "cache-control": "private, no-store",
    },
  });
}
