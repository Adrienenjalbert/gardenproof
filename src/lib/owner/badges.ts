/** Tab badges: kept to one number that means "something here is waiting for you". */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { approvalBlockers } from "@/lib/dashboard/logic";
import { getTenantBySlug } from "@/lib/tenants";

/** Pages and videos (one per style) that are ready for the owner's look. */
export async function getShowcaseBadge(): Promise<number> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const rows = await db
    .select({
      type: schema.assets.type,
      jobId: schema.assets.jobId,
      content: schema.assets.content,
      checks: schema.assets.checks,
      fileKey: schema.assets.fileKey,
    })
    .from(schema.assets)
    .where(and(eq(schema.assets.tenantId, tenant.id), eq(schema.assets.status, "in_review")));
  const ready = rows.filter(
    (r) =>
      (r.type === "portfolio_page" || (r.type === "video" && r.fileKey)) && approvalBlockers(r.checks).length === 0,
  );
  return new Set(ready.map((r) => (r.type === "video" ? `v:${r.jobId}:${String(r.content.template)}` : `p:${r.jobId}`)))
    .size;
}
