/**
 * Run the content engine on the seeded demo jobs and print what it produced.
 * Seeds nothing: run `pnpm seed` first with the same PGLITE_DIR / STORAGE_DIR.
 *
 *   PGLITE_DIR=.data/mod-b/pglite STORAGE_DIR=.data/mod-b/storage npx tsx scripts/generate-demo-content.ts
 *
 * Also writes review/samples/content-job_patio.json (portfolio page + ad copy) for review.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { usingMockAI } from "@/lib/ai/client";
import { enrichJob, generateContentForJob } from "@/lib/content";

const JOBS = ["job_pond", "job_patio"];

async function main() {
  const db = await getDb();
  console.log(`AI provider: ${usingMockAI() ? "demo mock (no ANTHROPIC_API_KEY)" : "Anthropic"}\n`);

  for (const jobId of JOBS) {
    const enrichment = await enrichJob(jobId);
    console.log(`■ ${jobId} — enriched: service=${enrichment.service}; features=${enrichment.features.join(", ") || "–"}; materials=${enrichment.materials.join(", ") || "–"}; hero after=${enrichment.heroAfterMediaId ?? "–"}`);
    const summary = await generateContentForJob(jobId);
    if (summary.skipped) {
      console.log(`  skipped: ${summary.skipped}\n`);
      continue;
    }
    for (const a of summary.assets) {
      const [row] = await db.select().from(schema.assets).where(eq(schema.assets.id, a.assetId));
      const failed = row.checks.filter((c) => !c.ok);
      console.log(`  ${a.type.padEnd(15)} v${a.version} ${a.action.padEnd(11)} checks ${row.checks.length - failed.length}/${row.checks.length} ok${failed.length ? ` — ${failed.map((f) => `${f.id}: ${f.message}`).join(" | ")}` : ""}`);
    }
    console.log("");
  }

  const pick = async (type: "portfolio_page" | "ad_copy") => {
    const [row] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.jobId, "job_patio"), eq(schema.assets.type, type)));
    return row ? { id: row.id, version: row.version, status: row.status, checks: row.checks, content: row.content } : null;
  };
  const out = path.join(process.cwd(), "review", "samples", "content-job_patio.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify({ portfolio_page: await pick("portfolio_page"), ad_copy: await pick("ad_copy") }, null, 2) + "\n");
  console.log(`Saved ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
