/**
 * Dev helper for visual checks of the publishing module (run after `pnpm seed` on the same DB):
 *   PGLITE_DIR=.data/mod-d/pglite STORAGE_DIR=.data/mod-d/storage npx tsx tests/fixtures/insert-mod-d-sample.ts
 * Inserts sample assets built from the real seed jobs and publishes the approved ones (local mode).
 */
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { publishAsset } from "@/lib/publish";
import { patioAds, patioArticle, patioGbp, patioPage, patioSocial, pondPage } from "./mod-d";
import { insertAsset } from "./mod-d-db";

const IDS = {
  patio: "ast_sample_patio",
  pond: "ast_sample_pond",
  article: "ast_sample_article",
  ads: "ast_sample_ads",
  social: "ast_sample_social",
  gbp: "ast_sample_gbp",
};

async function main() {
  const db = await getDb();
  const ids = Object.values(IDS);
  await db.delete(schema.leads).where(inArray(schema.leads.assetId, ids));
  await db.delete(schema.assets).where(inArray(schema.assets.id, ids));

  await insertAsset({ id: IDS.patio, jobId: "job_patio", type: "portfolio_page", status: "approved", title: "Portfolio page — Putney patio", content: patioPage });
  await insertAsset({ id: IDS.pond, jobId: "job_pond", type: "portfolio_page", status: "in_review", title: "Portfolio page — Wimbledon pond", content: pondPage, version: 2 });
  await insertAsset({ id: IDS.article, jobId: null, type: "seo_article", status: "draft", title: "Article — sandstone patios", content: patioArticle, version: 2 });
  await insertAsset({ id: IDS.ads, jobId: "job_patio", type: "ad_copy", status: "approved", title: "Ad copy — Putney patio", content: patioAds });
  await insertAsset({ id: IDS.social, jobId: "job_patio", type: "social_pack", status: "approved", title: "Social pack — Putney patio", content: patioSocial });
  await insertAsset({ id: IDS.gbp, jobId: "job_patio", type: "gbp_post", status: "approved", title: "GBP post — Putney patio", content: patioGbp });

  for (const id of [IDS.patio, IDS.ads, IDS.social, IDS.gbp]) {
    const r = await publishAsset(id);
    console.log(`published ${id} → ${r.externalUrl} (${r.mode})`);
  }
  console.log(`preview (draft, operator session required): /preview/${IDS.pond}`);
  console.log(`article (draft, operator session required): /preview/${IDS.article}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
