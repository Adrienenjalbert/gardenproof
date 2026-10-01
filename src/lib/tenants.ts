import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tenant } from "@/db/schema";
import { env } from "./config";

export async function getTenantBySlug(slug = env.defaultTenantSlug): Promise<Tenant> {
  const db = await getDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug));
  if (!t) throw new Error(`Tenant "${slug}" not found. Run \`pnpm seed\`.`);
  return t;
}

export async function getTenant(id: string): Promise<Tenant> {
  const db = await getDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id));
  if (!t) throw new Error(`Tenant ${id} not found`);
  return t;
}
