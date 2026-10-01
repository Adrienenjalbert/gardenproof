/**
 * Versioned asset writes. One logical asset per (job, type) — or per slug for area articles.
 *
 * - no row yet                       -> insert v1 (in_review)
 * - latest is draft/in_review/rejected -> update it in place, version + 1 (no duplicates)
 * - latest is approved/published     -> never touch it; insert a NEW row at version + 1 (in_review)
 */
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import type { AssetType } from "@/lib/domain";
import { newId } from "@/lib/ids";
import type { Check } from "./types";

export type SaveInput = {
  tenantId: string;
  jobId: string | null;
  type: AssetType;
  title: string;
  content: Record<string, unknown>;
  checks: Check[];
  /** For job-less assets (area articles): identity by content slug. */
  slug?: string;
};

export type SaveResult = { assetId: string; version: number; action: "created" | "updated" | "new_version" };

const LOCKED = new Set(["approved", "published"]);

export async function findLatestAsset(q: { tenantId: string; jobId: string | null; type: AssetType; slug?: string }): Promise<Asset | null> {
  const db = await getDb();
  const where = and(
    eq(schema.assets.tenantId, q.tenantId),
    eq(schema.assets.type, q.type),
    q.jobId ? eq(schema.assets.jobId, q.jobId) : isNull(schema.assets.jobId),
    q.slug ? sql`${schema.assets.content}->>'slug' = ${q.slug}` : undefined,
  );
  const [row] = await db.select().from(schema.assets).where(where).orderBy(desc(schema.assets.version), desc(schema.assets.createdAt)).limit(1);
  return row ?? null;
}

export async function saveAssetVersion(input: SaveInput): Promise<SaveResult> {
  const db = await getDb();
  const latest = await findLatestAsset(input);
  const now = new Date();
  if (latest && !LOCKED.has(latest.status)) {
    const version = latest.version + 1;
    await db
      .update(schema.assets)
      .set({ title: input.title, content: input.content, checks: input.checks, status: "in_review", version, updatedAt: now })
      .where(eq(schema.assets.id, latest.id));
    return { assetId: latest.id, version, action: "updated" };
  }
  const id = newId("ast");
  const version = latest ? latest.version + 1 : 1;
  await db.insert(schema.assets).values({
    id,
    tenantId: input.tenantId,
    jobId: input.jobId,
    type: input.type,
    status: "in_review",
    title: input.title,
    content: input.content,
    checks: input.checks,
    version,
  });
  return { assetId: id, version, action: latest ? "new_version" : "created" };
}

/** Portfolio slugs are URLs: make sure another job does not already own this one. */
export async function uniqueSlug(tenantId: string, jobId: string, slug: string, suffix: string): Promise<string> {
  const db = await getDb();
  const [clash] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenantId),
        eq(schema.assets.type, "portfolio_page"),
        ne(schema.assets.jobId, jobId),
        sql`${schema.assets.content}->>'slug' = ${slug}`,
      ),
    )
    .limit(1);
  return clash ? `${slug}-${suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 80).replace(/-+$/, "") : slug;
}
