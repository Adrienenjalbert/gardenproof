/**
 * Turning a scheduled_messages row into a real message. Everything goes through @/lib/messaging (opt-out and
 * safe mode apply); a held customer message is released only when a person said yes or the owner switched on
 * automatic sending for routine messages.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Message, ScheduledMessage } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { approveHeldMessage, sendMessage } from "@/lib/messaging";
import { requestTestimonial } from "@/lib/testimonials";
import { ruleOf } from "./rules";

export const APPROVED_EVENT = "crm.message_approved";

/** The owner (or an earned quick-yes) approved this row; recorded so a deferred send still counts as approved. */
export async function recordApproval(row: ScheduledMessage, actor: string): Promise<void> {
  await logEvent({
    tenantId: row.tenantId,
    type: APPROVED_EVENT,
    entity: "scheduled_message",
    entityId: row.id,
    actor,
    data: { ruleKey: row.ruleKey, jobId: row.jobId },
  });
}

export async function hasApproval(rowId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.type, APPROVED_EVENT), eq(schema.events.entityId, rowId)))
    .limit(1);
  return rows.length > 0;
}

async function recipientPhone(row: ScheduledMessage): Promise<string | null> {
  const db = await getDb();
  if (row.audience === "customer" && row.customerId) {
    const [c] = await db
      .select({ phone: schema.customers.phone })
      .from(schema.customers)
      .where(eq(schema.customers.id, row.customerId));
    return c?.phone ?? null;
  }
  if (row.audience === "crew" && row.crewId) {
    const [c] = await db
      .select({ phone: schema.crewMembers.phone })
      .from(schema.crewMembers)
      .where(eq(schema.crewMembers.id, row.crewId));
    return c?.phone ?? null;
  }
  return null;
}

/** The homeowner review flow sends its own message (with consent wording and a private link). */
async function sendReviewRequest(row: ScheduledMessage): Promise<Message | null> {
  if (!row.jobId) return null;
  await requestTestimonial(row.jobId);
  const db = await getDb();
  const [msg] = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.direction, "out"),
        sql`${schema.messages.meta}->>'kind' = 'review_request'`,
        sql`${schema.messages.meta}->>'jobId' = ${row.jobId}`,
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return msg ?? null;
}

/**
 * Capture prompts point the crew lead's WhatsApp at the job before the message goes, so the photos they send
 * back land on it. If they are mid-capture on another job, the message tells them how to switch instead.
 */
async function armForCapture(row: ScheduledMessage, stage: "before" | "after"): Promise<string> {
  const body = row.body ?? "";
  if (!row.jobId || !row.crewId) return body;
  const { armCrewCapture } = await import("@/lib/bot/arm");
  const result = await armCrewCapture({ jobId: row.jobId, crewId: row.crewId, stage }).catch((err) => {
    console.error("[crm] arming capture failed", row.jobId, err);
    return "skipped" as const;
  });
  if (result !== "busy") return body;
  const db = await getDb();
  const [job] = await db.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, row.jobId));
  return job ? `${body.replace(/ They go straight on this job\.$/, "")} Type ${job.code} first to switch to this job.` : body;
}

export type DeliverOutcome = {
  status: "sent" | "awaiting_approval" | "cancelled";
  message: Message | null;
  note?: string;
};

/**
 * Send the row's message. `release` = a person approved it (or routine auto-send is on for this tier), so a
 * safe-mode hold is released at once; otherwise a held message waits for approval in the owner app.
 */
export async function deliver(
  row: ScheduledMessage,
  opts: { release: boolean; actor: string },
): Promise<DeliverOutcome> {
  const rule = ruleOf(row.ruleKey);
  let msg: Message | null;
  if (rule?.via === "review_request") {
    msg = await sendReviewRequest(row);
    if (!msg)
      return {
        status: "cancelled",
        message: null,
        note: "No review request could be sent (no mobile number or already asked).",
      };
  } else {
    const to = await recipientPhone(row);
    if (!to || !row.body)
      return {
        status: "cancelled",
        message: null,
        note: "No mobile number to send to.",
      };
    const body = rule?.arm ? await armForCapture(row, rule.arm) : row.body;
    msg = await sendMessage({
      tenantId: row.tenantId,
      to,
      body,
      audience: row.audience,
      meta: {
        kind: "crm",
        ruleKey: row.ruleKey,
        scheduledId: row.id,
        jobId: row.jobId,
      },
    });
  }
  if (msg.status === "held") {
    if (!opts.release) return { status: "awaiting_approval", message: msg };
    msg = await approveHeldMessage(msg.id, opts.actor);
  }
  if (msg.status === "cancelled")
    return {
      status: "cancelled",
      message: msg,
      note: msg.error ?? "Not sent.",
    };
  return { status: "sent", message: msg };
}
