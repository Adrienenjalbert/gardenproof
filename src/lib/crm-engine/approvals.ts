/**
 * What the owner does with a planned message: send it now / say yes, change the words, or skip it.
 * Every transition is a conditional UPDATE, so double taps and the WhatsApp "Send all" button racing the
 * app can only ever send once.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ScheduledMessage } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { approveHeldMessage, cancelHeldMessage } from "@/lib/messaging";
import { deliver, recordApproval } from "./deliver";
import { ruleOf } from "./rules";
import { isQuietHour, outsideQuietHours } from "./time";

export class ApprovalError extends Error {}

const OPEN: ScheduledMessage["status"][] = ["scheduled", "awaiting_approval"];

async function loadRow(tenantId: string, id: string): Promise<ScheduledMessage> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.scheduledMessages)
    .where(and(eq(schema.scheduledMessages.id, id), eq(schema.scheduledMessages.tenantId, tenantId)));
  if (!row) throw new ApprovalError("That message no longer exists.");
  return row;
}

export type ApproveOutcome = {
  status: ScheduledMessage["status"];
  sendAt: Date;
  note?: string;
};

/**
 * "Send now" / "Yes". A held message goes at once; a customer message during quiet hours is approved now and
 * goes at 08:30; anything else is sent immediately.
 */
export async function approveScheduledMessage(
  tenantId: string,
  id: string,
  actor = "owner",
  now = new Date(),
): Promise<ApproveOutcome> {
  const db = await getDb();
  const row = await loadRow(tenantId, id);
  if (!OPEN.includes(row.status)) return { status: row.status, sendAt: row.sendAt };

  if (row.messageId) {
    const msg = await approveHeldMessage(row.messageId, actor);
    const status = msg.status === "cancelled" ? "cancelled" : "sent";
    await db.update(schema.scheduledMessages).set({ status }).where(eq(schema.scheduledMessages.id, id));
    await recordApproval(row, actor);
    return { status, sendAt: row.sendAt };
  }

  if (row.audience === "customer" && isQuietHour(now)) {
    const sendAt = outsideQuietHours(now);
    await db
      .update(schema.scheduledMessages)
      .set({ status: "scheduled", sendAt })
      .where(and(eq(schema.scheduledMessages.id, id), inArray(schema.scheduledMessages.status, OPEN)));
    await recordApproval(row, actor);
    return {
      status: "scheduled",
      sendAt,
      note: "It's late, so it goes first thing tomorrow.",
    };
  }

  const [claimed] = await db
    .update(schema.scheduledMessages)
    .set({ status: "sent", sendAt: now })
    .where(and(eq(schema.scheduledMessages.id, id), inArray(schema.scheduledMessages.status, OPEN)))
    .returning();
  if (!claimed) return { status: (await loadRow(tenantId, id)).status, sendAt: row.sendAt };
  await recordApproval(row, actor);
  const outcome = await deliver(claimed, { release: true, actor });
  await db
    .update(schema.scheduledMessages)
    .set({ status: outcome.status, messageId: outcome.message?.id ?? null })
    .where(eq(schema.scheduledMessages.id, id));
  return { status: outcome.status, sendAt: now, note: outcome.note };
}

export async function skipScheduledMessage(tenantId: string, id: string, actor = "owner"): Promise<void> {
  const db = await getDb();
  const row = await loadRow(tenantId, id);
  const [skipped] = await db
    .update(schema.scheduledMessages)
    .set({ status: "skipped" })
    .where(and(eq(schema.scheduledMessages.id, id), inArray(schema.scheduledMessages.status, OPEN)))
    .returning();
  if (!skipped) return;
  if (row.messageId) await cancelHeldMessage(row.messageId, actor);
  await logEvent({
    tenantId,
    type: "crm.message_skipped",
    entity: "scheduled_message",
    entityId: id,
    actor,
    data: { ruleKey: row.ruleKey, jobId: row.jobId },
  });
}

/** Change the words of a message that hasn't gone yet (a held copy is withdrawn; the new words go instead). */
export async function editScheduledMessage(tenantId: string, id: string, body: string, actor = "owner"): Promise<void> {
  const text = body.trim();
  if (!text) throw new ApprovalError("The message can't be empty.");
  if (text.length > 1000) throw new ApprovalError("Please keep it under 1,000 characters.");
  const row = await loadRow(tenantId, id);
  if (!OPEN.includes(row.status)) throw new ApprovalError("This message has already gone.");
  if (ruleOf(row.ruleKey)?.via === "review_request") {
    throw new ApprovalError("The review request uses fixed wording so the homeowner's consent is recorded exactly.");
  }
  const db = await getDb();
  if (row.messageId) await cancelHeldMessage(row.messageId, actor);
  await db
    .update(schema.scheduledMessages)
    .set({ body: text, messageId: null })
    .where(and(eq(schema.scheduledMessages.id, id), inArray(schema.scheduledMessages.status, OPEN)));
  await logEvent({
    tenantId,
    type: "crm.message_edited",
    entity: "scheduled_message",
    entityId: id,
    actor,
    data: { ruleKey: row.ruleKey },
  });
}

/**
 * The owner said yes to everything waiting (WhatsApp "Send all" button or the app). Always-ask messages are
 * never included: they need their own look.
 */
export async function approveAllAwaiting(
  tenantId: string,
  actor = "owner",
  now = new Date(),
  ids?: string[],
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledMessages)
    .where(
      and(eq(schema.scheduledMessages.tenantId, tenantId), eq(schema.scheduledMessages.status, "awaiting_approval")),
    );
  let n = 0;
  for (const r of rows) {
    if (ids ? !ids.includes(r.id) : r.trustTier === "always_ask") continue;
    const out = await approveScheduledMessage(tenantId, r.id, actor, now);
    if (out.status === "sent" || out.status === "scheduled") n++;
  }
  return n;
}
