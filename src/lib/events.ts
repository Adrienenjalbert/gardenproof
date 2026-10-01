import { getDb, schema } from "@/db";
import { newId } from "./ids";

/** Append to the audit log. Never throws (logging must not break flows). */
export async function logEvent(e: {
  tenantId: string;
  type: string;
  entity?: string;
  entityId?: string;
  actor?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(schema.events).values({
      id: newId("evt"),
      tenantId: e.tenantId,
      type: e.type,
      entity: e.entity ?? null,
      entityId: e.entityId ?? null,
      actor: e.actor ?? "system",
      data: e.data ?? {},
    });
  } catch (err) {
    console.error("[events] failed to log", e.type, err);
  }
}
