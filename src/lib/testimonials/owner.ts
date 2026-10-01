/** The business owner: who homeowner feedback and consent changes are routed to. */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sendMessage } from "@/lib/messaging";

export async function ownerOf(tenantId: string) {
  const db = await getDb();
  const [owner] = await db
    .select()
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, tenantId), eq(schema.crewMembers.role, "owner"), eq(schema.crewMembers.active, true)));
  return owner ?? null;
}

/** Best effort: a failed WhatsApp to the owner must never fail the homeowner's action. */
export async function notifyOwner(tenantId: string, body: string): Promise<void> {
  const owner = await ownerOf(tenantId);
  if (!owner) return;
  try {
    await sendMessage({ tenantId, to: owner.phone, body, audience: "owner" });
  } catch (err) {
    console.error("[testimonials] owner notification failed", err);
  }
}
