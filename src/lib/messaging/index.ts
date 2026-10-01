/**
 * The single door for outbound messages. Every message is persisted first, then rules apply:
 *   1. customer opted out (STOP)          -> "cancelled", never delivered
 *   2. SAFE_MODE on + audience "customer" -> "held" until the agency approves it
 *   3. otherwise                          -> delivered now via the provider ("sent" | "failed")
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Message } from "@/db/schema";
import { env, isSimulatorMessaging } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { providerFor } from "./providers";
import type { MessageTemplate, OutboundChannel, OutboundMessage } from "./types";

export type { OutboundMessage, MessageOption, MessagingProvider, MessageTemplate } from "./types";
export { normalisePhone, parseUkMobile, renderWithNumberedOptions } from "./format";

const OutboundSchema = z.object({
  tenantId: z.string().min(1),
  to: z.string().regex(/^\+\d{7,15}$/, "to must be E.164"),
  body: z.string().min(1).max(4096),
  mediaUrls: z.array(z.string().min(1)).max(10).optional(),
  options: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(60) })).max(10).optional(),
  audience: z.enum(["crew", "customer", "owner", "unknown"]),
  conversationId: z.string().optional(),
  channel: z.enum(["whatsapp", "simulator"]).optional(),
  template: z.object({ sid: z.string().regex(/^HX[0-9a-fA-F]{32}$/, "template sid must be a Twilio Content SID (HX…)"), variables: z.record(z.string(), z.string().max(1024)) }).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** The template travels in messages.meta so a held message is delivered exactly as composed. */
function templateOf(row: Message): MessageTemplate | undefined {
  const t = (row.meta as { template?: MessageTemplate }).template;
  return t && typeof t.sid === "string" && typeof t.variables === "object" ? t : undefined;
}

const defaultChannel = (): OutboundChannel => (isSimulatorMessaging() ? "simulator" : "whatsapp");

async function isCustomerOptedOut(tenantId: string, phone: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ optedOut: schema.customers.optedOut })
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, phone)));
  return rows.some((r) => r.optedOut);
}

async function conversationIdFor(tenantId: string, phone: string): Promise<string | null> {
  const db = await getDb();
  const [c] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.phone, phone)));
  return c?.id ?? null;
}

async function tenantNumber(tenantId: string): Promise<string | null> {
  const db = await getDb();
  const [t] = await db
    .select({ n: schema.tenants.whatsappNumber })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return t?.n ?? null;
}

/** Deliver a persisted row through its channel's provider and record the outcome. */
async function deliverRow(row: Message): Promise<Message> {
  const db = await getDb();
  const channel: OutboundChannel = row.channel === "whatsapp" ? "whatsapp" : "simulator";
  try {
    const { providerId } = await providerFor(channel).deliver({
      tenantId: row.tenantId,
      to: row.toNumber ?? "",
      body: row.body ?? "",
      mediaUrls: row.mediaUrls,
      options: row.options,
      template: templateOf(row),
      audience: "crew",
    });
    const [updated] = await db
      .update(schema.messages)
      .set({ status: "sent", providerId, error: null })
      .where(eq(schema.messages.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const [updated] = await db
      .update(schema.messages)
      .set({ status: "failed", error })
      .where(eq(schema.messages.id, row.id))
      .returning();
    await logEvent({ tenantId: row.tenantId, type: "message.failed", entity: "message", entityId: row.id, data: { error } });
    return updated;
  }
}

export async function sendMessage(input: OutboundMessage): Promise<Message> {
  const msg = OutboundSchema.parse(input);
  const db = await getDb();

  let status: Message["status"] = "queued";
  if (msg.audience === "customer" && (await isCustomerOptedOut(msg.tenantId, msg.to))) status = "cancelled";
  else if (msg.audience === "customer" && env.safeMode) status = "held";

  const [row] = await db
    .insert(schema.messages)
    .values({
      id: newId("msg"),
      tenantId: msg.tenantId,
      conversationId: msg.conversationId ?? (await conversationIdFor(msg.tenantId, msg.to)),
      direction: "out",
      channel: msg.channel ?? defaultChannel(),
      fromNumber: await tenantNumber(msg.tenantId),
      toNumber: msg.to,
      body: msg.body,
      mediaUrls: msg.mediaUrls ?? [],
      options: msg.options ?? [],
      meta: { ...(msg.meta ?? {}), ...(msg.template ? { template: msg.template } : {}) },
      status,
      error: status === "cancelled" ? "recipient opted out" : null,
    })
    .returning();

  if (status === "cancelled") {
    await logEvent({ tenantId: msg.tenantId, type: "message.blocked_opt_out", entity: "message", entityId: row.id });
    return row;
  }
  if (status === "held") {
    await logEvent({ tenantId: msg.tenantId, type: "message.held", entity: "message", entityId: row.id });
    return row;
  }
  return deliverRow(row);
}

async function currentRow(id: string): Promise<Message> {
  const db = await getDb();
  const [row] = await db.select().from(schema.messages).where(eq(schema.messages.id, id));
  if (!row) throw new Error(`Message ${id} not found`);
  return row;
}

/** Lets the testimonial loop react when its (held) homeowner message is finally sent or dropped. */
async function notifyTestimonials(row: Message): Promise<void> {
  try {
    const { syncTestimonialWithMessage } = await import("@/lib/testimonials");
    await syncTestimonialWithMessage(row);
  } catch (err) {
    console.error("[messaging] testimonial sync failed", err);
  }
}

/**
 * Agency approved a held customer message: re-check opt-out (may have changed while held), then deliver.
 * The held -> approved/cancelled transition is a conditional UPDATE, so a double click, two tabs or the
 * simulator racing the dashboard can only ever deliver once; later calls return the row unchanged.
 */
export async function approveHeldMessage(id: string, actor = "agency"): Promise<Message> {
  const db = await getDb();
  const current = await currentRow(id);
  const optedOut = current.toNumber ? await isCustomerOptedOut(current.tenantId, current.toNumber) : false;
  const [claimed] = await db
    .update(schema.messages)
    .set(optedOut ? { status: "cancelled", error: "recipient opted out" } : { status: "approved" })
    .where(and(eq(schema.messages.id, id), eq(schema.messages.status, "held")))
    .returning();
  if (!claimed) return currentRow(id); // already decided elsewhere: no-op

  const result = optedOut ? claimed : await deliverRow(claimed);
  await logEvent({
    tenantId: claimed.tenantId,
    type: "message.approved",
    entity: "message",
    entityId: id,
    actor,
    data: { outcome: result.status },
  });
  await notifyTestimonials(result);
  return result;
}

export async function cancelHeldMessage(id: string, actor = "agency"): Promise<Message> {
  const db = await getDb();
  const [result] = await db
    .update(schema.messages)
    .set({ status: "cancelled" })
    .where(and(eq(schema.messages.id, id), eq(schema.messages.status, "held")))
    .returning();
  if (!result) return currentRow(id); // already approved/sent or cancelled: never cancel a message in flight
  await logEvent({ tenantId: result.tenantId, type: "message.cancelled", entity: "message", entityId: id, actor });
  await notifyTestimonials(result);
  return result;
}
