/** Minimal DB seed for publishing / lead tests (in-memory PGlite). Mirrors scripts/seed.ts ids. */
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, schema } from "@/db";
import type { AssetStatus, AssetType } from "@/lib/domain";
import { newId } from "@/lib/ids";
import { putObject } from "@/lib/storage";
import { THORBURN_CONFIG } from "@/lib/tenant";

export const TENANT_ID = "ten_thorburn";

export async function seedBase() {
  const db = await getDb();
  await db
    .insert(schema.tenants)
    .values({ id: TENANT_ID, slug: "thorburn", name: "Thorburn Landscapes", config: THORBURN_CONFIG })
    .onConflictDoNothing();
  await db
    .insert(schema.jobs)
    .values([
      { id: "job_patio", tenantId: TENANT_ID, code: "TL-5937", service: "patio_paving", area: "Putney", title: "Sandstone patio & brick raised beds, Putney", status: "content_draft" },
      { id: "job_pond", tenantId: TENANT_ID, code: "TL-4821", service: "full_design", area: "Wimbledon", title: "Pond & gravel garden, Wimbledon", status: "content_draft" },
    ])
    .onConflictDoNothing();
  const demo = (f: string) => fs.readFile(path.join(process.cwd(), "public", "demo", f));
  const patio = await putObject("thorburn/job_patio/after-1.jpg", await demo("sandstone-patio-after.jpg"));
  const pondB = await putObject("thorburn/job_pond/before-1.jpg", await demo("pond-garden-before.jpg"));
  const pondA = await putObject("thorburn/job_pond/after-1.jpg", await demo("pond-garden-after.jpg"));
  await db
    .insert(schema.media)
    .values([
      { id: "med_patio_a1", tenantId: TENANT_ID, jobId: "job_patio", stage: "after", kind: "image", storageKey: patio, publicKey: patio, qualityScore: 0.8, width: 1280, height: 720 },
      { id: "med_pond_b1", tenantId: TENANT_ID, jobId: "job_pond", stage: "before", kind: "image", storageKey: pondB, publicKey: pondB, qualityScore: 0.8, width: 720, height: 720 },
      { id: "med_pond_a1", tenantId: TENANT_ID, jobId: "job_pond", stage: "after", kind: "image", storageKey: pondA, publicKey: pondA, qualityScore: 0.8, width: 720, height: 720 },
    ])
    .onConflictDoNothing();
}

export async function insertAsset(a: {
  id?: string;
  jobId: string | null;
  type: AssetType;
  status: AssetStatus;
  title: string;
  content: object;
  fileKey?: string | null;
  version?: number;
  checks?: { id: string; ok: boolean; message: string }[];
}) {
  const db = await getDb();
  const id = a.id ?? newId("ast");
  await db.insert(schema.assets).values({
    id,
    tenantId: TENANT_ID,
    jobId: a.jobId,
    type: a.type,
    status: a.status,
    title: a.title,
    content: a.content as Record<string, unknown>,
    fileKey: a.fileKey ?? null,
    version: a.version ?? 1,
    checks: a.checks ?? [],
  });
  return id;
}

/** An extra job, so tests that change job state don't interfere with the shared seed jobs. */
export async function insertJob(id: string, area = "Putney") {
  const db = await getDb();
  await db
    .insert(schema.jobs)
    .values({ id, tenantId: TENANT_ID, code: `TL-${id.slice(-6).toUpperCase()}`, service: "patio_paving", area, title: `Job ${id}`, status: "content_draft" })
    .onConflictDoNothing();
  return id;
}

/** A homeowner response with explicit consent answers (defaults: everything agreed). */
export async function insertTestimonial(
  jobId: string,
  t: Partial<{
    status: "pending" | "sent" | "responded" | "expired";
    consentPhotos: boolean | null;
    consentArea: boolean | null;
    consentFirstName: boolean | null;
    consentQuote: boolean | null;
    withdrawnAt: Date | null;
    createdAt: Date;
  }> = {},
) {
  const db = await getDb();
  const id = newId("tst");
  await db.insert(schema.testimonials).values({
    id,
    tenantId: TENANT_ID,
    jobId,
    token: newId("tok"),
    status: t.status ?? "responded",
    rating: 5,
    quote: "Tidy, on time and exactly what we pictured.",
    consentPhotos: t.consentPhotos === undefined ? true : t.consentPhotos,
    consentArea: t.consentArea === undefined ? true : t.consentArea,
    consentFirstName: t.consentFirstName === undefined ? true : t.consentFirstName,
    consentQuote: t.consentQuote === undefined ? true : t.consentQuote,
    withdrawnAt: t.withdrawnAt ?? null,
    ...(t.createdAt ? { createdAt: t.createdAt } : {}),
  });
  return id;
}

/** Media rows with real files in storage: an EXIF-bearing "original" and its public derivative. */
export async function insertImage(
  jobId: string,
  n: number,
  extra: Partial<{ qualityNotes: string; blurredKey: string; privacyClearedAt: Date }> = {},
) {
  const db = await getDb();
  const storageKey = await putObject(`thorburn/${jobId}/after-${n}.jpg`, Buffer.from(`original-with-gps-${n}`));
  const publicKey = await putObject(`thorburn/${jobId}/after-${n}.public.jpg`, Buffer.from(`public-${n}`));
  if (extra.blurredKey) await putObject(extra.blurredKey, Buffer.from(`blurred-${n}`));
  const id = `med_${jobId}_${n}`;
  await db.insert(schema.media).values({
    id,
    tenantId: TENANT_ID,
    jobId,
    stage: "after",
    kind: "image",
    storageKey,
    publicKey,
    width: 720,
    height: 720,
    qualityScore: 0.8, // fixture photos count as privacy-screened
    qualityNotes: extra.qualityNotes ?? null,
    blurredKey: extra.blurredKey ?? null,
    privacyClearedAt: extra.privacyClearedAt ?? null,
  });
  return { id, storageKey, publicKey };
}
