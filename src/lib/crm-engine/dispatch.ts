/**
 * The every-minute sweep (task "crm.dispatch_due"). For each due message:
 *   automatic            -> sent (customer messages still pass safe mode unless routine auto-send is on)
 *   quick_yes            -> waits for a one-tap yes (sent automatically once the owner has earned it)
 *   always_ask           -> waits for the owner
 * Then: one owner WhatsApp per batch of new approvals (when there is no digest), and the evening digest.
 * Idempotent: every row is claimed with a conditional UPDATE; the digest is keyed per tenant per London day.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ScheduledMessage } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { deliver, hasApproval } from "./deliver";
import { buildDigest, digestAlreadySent, DIGEST_SENT_EVENT } from "./digest";
import { OWNER_BUTTONS, sendToOwner } from "./notify";
import { quickYesEarned } from "./plan";
import { ruleOf } from "./rules";
import { loadSettings, type OwnerSettings } from "./settings";
import { isQuietHour, londonDateKey, londonParts, outsideQuietHours } from "./time";

export type DispatchSummary = {
  sent: number;
  awaiting: number;
  cancelled: number;
  deferred: number;
  digests: number;
};
export type DispatchOptions = { digest?: boolean; limit?: number };

const DUE_LIMIT = 200;

async function setStatus(id: string, status: ScheduledMessage["status"], messageId?: string | null) {
  const db = await getDb();
  await db
    .update(schema.scheduledMessages)
    .set({ status, ...(messageId !== undefined ? { messageId } : {}) })
    .where(eq(schema.scheduledMessages.id, id));
}

/** Messages held in the outbox and then approved/cancelled elsewhere (e.g. the ops view) close their row. */
async function reconcileHeld(): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.scheduledMessages.id,
      msgStatus: schema.messages.status,
    })
    .from(schema.scheduledMessages)
    .innerJoin(schema.messages, eq(schema.messages.id, schema.scheduledMessages.messageId))
    .where(
      and(
        eq(schema.scheduledMessages.status, "awaiting_approval"),
        inArray(schema.messages.status, ["sent", "approved", "cancelled", "failed"]),
      ),
    );
  for (const r of rows) await setStatus(r.id, r.msgStatus === "cancelled" ? "cancelled" : "sent");
}

/** Why a due row must not go any more (job moved on, recipient opted out), or null. */
async function staleReason(row: ScheduledMessage): Promise<string | null> {
  const rule = ruleOf(row.ruleKey);
  if (!rule) return "unknown rule";
  if (!row.jobId) return null;
  const db = await getDb();
  const [job] = await db.select({ stage: schema.jobs.stage }).from(schema.jobs).where(eq(schema.jobs.id, row.jobId));
  if (!job) return "job deleted";
  if (job.stage !== rule.stage) return `job is now ${job.stage}`;
  if (row.audience === "customer" && row.customerId) {
    const [c] = await db
      .select({ optedOut: schema.customers.optedOut })
      .from(schema.customers)
      .where(eq(schema.customers.id, row.customerId));
    if (c?.optedOut) return "customer opted out";
  }
  return null;
}

async function earned(row: ScheduledMessage, settings: OwnerSettings, now: Date): Promise<boolean> {
  if (row.trustTier !== "quick_yes") return false;
  const db = await getDb();
  const base = row.ruleKey.split(":")[0];
  const history = await db
    .select({
      status: schema.scheduledMessages.status,
      createdAt: schema.scheduledMessages.createdAt,
    })
    .from(schema.scheduledMessages)
    .where(
      and(
        eq(schema.scheduledMessages.tenantId, row.tenantId),
        sql`split_part(${schema.scheduledMessages.ruleKey}, ':', 1) = ${base}`,
        inArray(schema.scheduledMessages.status, ["sent", "skipped"]),
      ),
    );
  return quickYesEarned(history, settings.notifications.autoApproveAfterDays, now);
}

export async function dispatchDueMessages(now: Date, opts: DispatchOptions = {}): Promise<DispatchSummary> {
  const db = await getDb();
  const summary: DispatchSummary = {
    sent: 0,
    awaiting: 0,
    cancelled: 0,
    deferred: 0,
    digests: 0,
  };
  await reconcileHeld();

  const due = await db
    .select()
    .from(schema.scheduledMessages)
    .where(and(eq(schema.scheduledMessages.status, "scheduled"), lte(schema.scheduledMessages.sendAt, now)))
    .orderBy(asc(schema.scheduledMessages.sendAt))
    .limit(opts.limit ?? DUE_LIMIT);

  const settingsCache = new Map<string, OwnerSettings>();
  const settingsFor = async (tenantId: string) => {
    if (!settingsCache.has(tenantId)) settingsCache.set(tenantId, await loadSettings(tenantId));
    return settingsCache.get(tenantId)!;
  };
  const newlyAwaiting = new Map<string, ScheduledMessage[]>();

  for (const row of due) {
    try {
      const stale = await staleReason(row);
      if (stale) {
        await db
          .update(schema.scheduledMessages)
          .set({ status: "cancelled" })
          .where(and(eq(schema.scheduledMessages.id, row.id), eq(schema.scheduledMessages.status, "scheduled")));
        await logEvent({
          tenantId: row.tenantId,
          type: "crm.message_cancelled",
          entity: "scheduled_message",
          entityId: row.id,
          data: { reason: stale },
        });
        summary.cancelled++;
        continue;
      }
      if (row.audience === "customer" && isQuietHour(now)) {
        await db
          .update(schema.scheduledMessages)
          .set({ sendAt: outsideQuietHours(now) })
          .where(and(eq(schema.scheduledMessages.id, row.id), eq(schema.scheduledMessages.status, "scheduled")));
        summary.deferred++;
        continue;
      }
      const settings = await settingsFor(row.tenantId);
      const approved = await hasApproval(row.id);
      const autoEarned = await earned(row, settings, now);
      const goesNow = row.trustTier === "automatic" || approved || autoEarned;

      if (!goesNow) {
        const [claimed] = await db
          .update(schema.scheduledMessages)
          .set({ status: "awaiting_approval" })
          .where(and(eq(schema.scheduledMessages.id, row.id), eq(schema.scheduledMessages.status, "scheduled")))
          .returning();
        if (claimed) {
          newlyAwaiting.set(row.tenantId, [...(newlyAwaiting.get(row.tenantId) ?? []), claimed]);
          summary.awaiting++;
        }
        continue;
      }

      // Claim before sending so a second worker (or a retry) can never send the same row twice.
      const [claimed] = await db
        .update(schema.scheduledMessages)
        .set({ status: "sent" })
        .where(and(eq(schema.scheduledMessages.id, row.id), eq(schema.scheduledMessages.status, "scheduled")))
        .returning();
      if (!claimed) continue;
      const release = approved || autoEarned || row.audience !== "customer" || settings.autoSendRoutine;
      const outcome = await deliver(claimed, {
        release,
        actor: approved ? "owner" : "crm:auto",
      });
      await setStatus(row.id, outcome.status, outcome.message?.id ?? null);
      summary[outcome.status === "sent" ? "sent" : outcome.status === "cancelled" ? "cancelled" : "awaiting"]++;
    } catch (err) {
      // One bad row must not block the rest; it stays visible to the agency via the audit log.
      console.error("[crm] dispatch failed for", row.id, err);
      await logEvent({
        tenantId: row.tenantId,
        type: "crm.dispatch_failed",
        entity: "scheduled_message",
        entityId: row.id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  for (const [tenantId, rows] of newlyAwaiting) {
    const settings = await settingsFor(tenantId);
    if (settings.notifications.digestHour === null) await notifyBatch(tenantId, rows);
  }
  if (opts.digest !== false) summary.digests = await sendDueDigests(now);
  return summary;
}

/** One WhatsApp for a batch of new approvals (never one per message). */
async function notifyBatch(tenantId: string, rows: ScheduledMessage[]): Promise<void> {
  const quick = rows.filter((r) => r.trustTier === "quick_yes");
  const lines = rows.map((r) => `• ${ruleOf(r.ruleKey)?.label ?? "Message"}${r.reason ? `: ${r.reason}` : ""}`);
  const body = `${rows.length === 1 ? "1 message is" : `${rows.length} messages are`} ready to go:\n${lines.join("\n")}`;
  const options = [
    ...(quick.length
      ? [
          {
            id: OWNER_BUTTONS.sendAll,
            title: quick.length === 1 ? "Send it" : `Send all ${quick.length}`,
          },
        ]
      : []),
    { id: OWNER_BUTTONS.openApp, title: "Look first" },
  ];
  await sendToOwner(tenantId, body, options, {
    notification: "approvals",
    scheduledIds: rows.map((r) => r.id),
  });
}

/** The evening digest: once per London day, at or after the owner's chosen hour. */
async function sendDueDigests(now: Date): Promise<number> {
  const db = await getDb();
  const tenants = await db.select({ id: schema.tenants.id, settings: schema.tenants.settings }).from(schema.tenants);
  const { hour } = londonParts(now);
  let sent = 0;
  for (const t of tenants) {
    const settings = await loadSettings(t.id);
    const at = settings.notifications.digestHour;
    if (at === null || hour < at) continue;
    const day = londonDateKey(now);
    if (await digestAlreadySent(t.id, day)) continue;
    const digest = await buildDigest(t.id, now);
    // Record first: a crash after sending must not produce a second digest.
    await logEvent({
      tenantId: t.id,
      type: DIGEST_SENT_EVENT,
      entity: "digest",
      entityId: `${t.id}:${day}`,
      data: { empty: !digest },
    });
    if (!digest) continue;
    if (
      await sendToOwner(t.id, digest.body, digest.options, {
        notification: "digest",
        day,
      })
    )
      sent++;
  }
  return sent;
}
