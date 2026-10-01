/**
 * The evening digest: one calm WhatsApp that replaces a day of pings. What happened, what is ready to send
 * (with a one-tap "Send all"), and what's on tomorrow. Nothing to say = no message.
 */
import { and, desc, eq, gt, gte, lt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MessageOption } from "@/lib/messaging";
import { CRM_STAGE_LABELS } from "@/lib/crm";
import { findOwner } from "./context";
import { DIGEST_ITEM_EVENT, OWNER_BUTTONS } from "./notify";
import { clock, ruleOf } from "./rules";
import { DAY_MS, londonAt } from "./time";

export const DIGEST_SENT_EVENT = "owner.digest_sent";

export async function digestAlreadySent(tenantId: string, day: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.type, DIGEST_SENT_EVENT), eq(schema.events.entityId, `${tenantId}:${day}`)))
    .limit(1);
  return rows.length > 0;
}

async function lastDigestAt(tenantId: string, now: Date): Promise<Date> {
  const db = await getDb();
  const [e] = await db
    .select({ at: schema.events.createdAt })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.type, DIGEST_SENT_EVENT),
        lt(schema.events.createdAt, now),
      ),
    )
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  return e?.at ?? new Date(now.getTime() - DAY_MS);
}

/** "Charlotte and Ben", "Amelia, Tom and 2 others". */
export function joinNames(names: string[]): string {
  const uniq = [...new Set(names)];
  if (uniq.length <= 1) return uniq[0] ?? "";
  if (uniq.length <= 3) return `${uniq.slice(0, -1).join(", ")} and ${uniq.at(-1)}`;
  return `${uniq.slice(0, 2).join(", ")} and ${uniq.length - 2} others`;
}

export async function buildDigest(
  tenantId: string,
  now: Date,
): Promise<{ body: string; options: MessageOption[] } | null> {
  const db = await getDb();
  const since = await lastDigestAt(tenantId, now);
  const owner = await findOwner(tenantId);

  const [items, reviews, waiting, tomorrow] = await Promise.all([
    db
      .select({ data: schema.events.data })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.tenantId, tenantId),
          eq(schema.events.type, DIGEST_ITEM_EVENT),
          gt(schema.events.createdAt, since),
        ),
      ),
    db
      .select({
        rating: schema.testimonials.rating,
        firstName: schema.customers.firstName,
      })
      .from(schema.testimonials)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.testimonials.customerId))
      .where(and(eq(schema.testimonials.tenantId, tenantId), gt(schema.testimonials.respondedAt, since))),
    db
      .select({
        ruleKey: schema.scheduledMessages.ruleKey,
        trustTier: schema.scheduledMessages.trustTier,
        firstName: schema.customers.firstName,
      })
      .from(schema.scheduledMessages)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.scheduledMessages.customerId))
      .where(
        and(eq(schema.scheduledMessages.tenantId, tenantId), eq(schema.scheduledMessages.status, "awaiting_approval")),
      ),
    db
      .select({
        at: schema.jobs.nextActionAt,
        stage: schema.jobs.stage,
        firstName: schema.customers.firstName,
      })
      .from(schema.jobs)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
      .where(
        and(
          eq(schema.jobs.tenantId, tenantId),
          inArray(schema.jobs.stage, ["site_visit", "booked", "maintenance"]),
          gte(schema.jobs.nextActionAt, londonAt(now, 1, 0)),
          lt(schema.jobs.nextActionAt, londonAt(now, 2, 0)),
        ),
      ),
  ]);

  const happened = [
    ...items.map((i) => String((i.data as { text?: unknown }).text ?? "")).filter(Boolean),
    ...reviews.map((r) => `${r.firstName ?? "A customer"} rated the job ${r.rating ?? "?"}★`),
  ];

  const byLabel = new Map<string, string[]>();
  for (const w of waiting) {
    const label = ruleOf(w.ruleKey)?.label ?? "Message";
    byLabel.set(label, [...(byLabel.get(label) ?? []), w.firstName ?? "a customer"]);
  }
  const ready = [...byLabel].map(([label, names]) => `${label} to ${joinNames(names)}`);
  const plans = tomorrow
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    .map(
      (j) =>
        `${j.stage === "maintenance" ? "Maintenance visit" : j.stage === "booked" ? "Start" : CRM_STAGE_LABELS[j.stage]} · ${j.firstName ?? "customer"}${j.at && clock(j.at) !== "00:00" ? ` at ${clock(j.at)}` : ""}`,
    );

  if (!happened.length && !ready.length && !plans.length) return null;

  const parts = [`Good evening${owner ? ` ${owner.name}` : ""}.`];
  if (happened.length) parts.push(`Today:\n${happened.map((h) => `• ${h}`).join("\n")}`);
  if (ready.length) parts.push(`Ready to send:\n${ready.map((r) => `• ${r}`).join("\n")}`);
  if (plans.length) parts.push(`Tomorrow:\n${plans.map((p) => `• ${p}`).join("\n")}`);

  const quick = waiting.filter((w) => w.trustTier === "quick_yes").length;
  const options: MessageOption[] = [
    ...(quick
      ? [
          {
            id: OWNER_BUTTONS.sendAll,
            title: quick === 1 ? "Send it" : `Send all ${quick}`,
          },
        ]
      : []),
    { id: OWNER_BUTTONS.openApp, title: "Open GardenProof" },
  ];
  return { body: parts.join("\n\n"), options };
}
