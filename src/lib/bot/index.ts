/**
 * Thin runtime around the pure capture reducer: identify the sender, load context, reduce,
 * perform effects (DB writes, media storage, replies, pipeline), persist conversation state.
 * Used by the Twilio webhook and the in-app simulator alike.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Conversation, CrewMember, Customer, Tenant } from "@/db/schema";
import { CustomerError, attachCustomerToJob } from "@/lib/customers";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { normalisePhone, sendMessage } from "@/lib/messaging";
import type { OutboundChannel, OutboundMessage } from "@/lib/messaging/types";
import { publicUrl } from "@/lib/storage";
import { getTenant } from "@/lib/tenants";
import { areaFromPostcode, serviceLabel } from "@/lib/tenant";
import { loadBotContext } from "./context";
import { ALLOWED_MEDIA_TYPES, MEDIA_MAX_BYTES, baseMime, downloadInboundMedia, isVCardMime } from "./download";
import { ingestMedia, kindFromMime } from "./media";
import { reduce } from "./reducer";
import { initialBotState, type BotContext, type BotEffect, type BotState, type SharedContact } from "./types";
import { parseVCards } from "./vcard";

export { reduce } from "./reducer";
export type { BotState, BotEffect, BotContext, InboundEvent } from "./types";

const InboundSchema = z.object({
  tenantId: z.string().min(1),
  from: z.string().min(5),
  body: z.string().max(4096).default(""),
  choiceId: z.string().max(200).nullish(),
  media: z
    .array(
      z.object({
        url: z.string().optional(),
        buffer: z.instanceof(Buffer).optional(),
        mimeType: z.string().min(3),
        /** Twilio basic auth for api.twilio.com media URLs (never sent to other hosts). */
        authorization: z.string().optional(),
      }),
    )
    .max(10)
    .default([]),
  providerId: z.string().max(100).nullish(),
  channel: z.enum(["whatsapp", "simulator"]),
});
export type InboundInput = z.input<typeof InboundSchema>;

export type HandleInboundOptions = {
  now?: Date;
};

export type HandleInboundResult = {
  duplicate: boolean;
  role: Conversation["role"];
  inboundMessageId: string | null;
  effects: BotEffect[];
};

// One inbound at a time per phone: a burst of photos must not create two jobs.
// (Single-instance lock; with several server instances, move to SELECT … FOR UPDATE.)
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

type Resolved = { data: Buffer; mimeType: string };
const VCARD_MAX_BYTES = 256 * 1024;

/**
 * Downloads (webhook URLs, Twilio hosts only) or takes (simulator buffers) the crew's attachments.
 * Photos / voice notes / videos become media; contact cards become parsed contacts. Anything else is dropped.
 */
async function resolveMedia(media: z.infer<typeof InboundSchema>["media"]): Promise<{ files: Resolved[]; contacts: SharedContact[] }> {
  const files: Resolved[] = [];
  const contacts: SharedContact[] = [];
  for (const m of media) {
    const declared = baseMime(m.mimeType);
    if (!ALLOWED_MEDIA_TYPES.has(declared)) continue; // PDFs, stickers, locations…
    try {
      let got: Resolved | null = null;
      if (m.buffer) {
        if (m.buffer.byteLength > MEDIA_MAX_BYTES) throw new Error("too large");
        got = { data: m.buffer, mimeType: declared };
      } else if (m.url) {
        got = await downloadInboundMedia(m.url, {
          declaredType: declared,
          authorization: m.authorization,
          maxBytes: isVCardMime(declared) ? VCARD_MAX_BYTES : MEDIA_MAX_BYTES,
        });
      }
      if (!got) continue;
      if (isVCardMime(got.mimeType)) {
        for (const card of parseVCards(got.data.toString("utf8"))) {
          for (const phone of card.phones) contacts.push({ firstName: card.firstName, lastName: card.lastName, phone });
        }
      } else if (kindFromMime(got.mimeType)) files.push(got);
    } catch (err) {
      console.error("[bot] media rejected or download failed", m.url ?? "(buffer)", err instanceof Error ? err.message : err);
    }
  }
  return { files, contacts };
}

/** Postgres unique violation on the inbound MessageSid index (drizzle may wrap the driver error in `cause`). */
export function isDuplicateProviderId(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const { code, constraint, constraint_name, message } = e as { code?: string; constraint?: string; constraint_name?: string; message?: string };
    if (code === "23505") return [constraint, constraint_name, message].some((v) => v?.includes("messages_provider_uq")) || (!constraint && !constraint_name);
  }
  return false;
}

async function identify(tenantId: string, phone: string): Promise<{ crew: CrewMember | null; customer: Customer | null }> {
  const db = await getDb();
  const [crew] = await db
    .select()
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, tenantId), eq(schema.crewMembers.phone, phone), eq(schema.crewMembers.active, true)));
  if (crew) return { crew, customer: null };
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, phone)));
  return { crew: null, customer: customer ?? null };
}

async function upsertConversation(tenantId: string, phone: string, role: Conversation["role"]): Promise<Conversation> {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.phone, phone)));
  if (existing) {
    if (existing.role === role) return existing;
    const [updated] = await db
      .update(schema.conversations)
      .set({ role })
      .where(eq(schema.conversations.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(schema.conversations)
    .values({ id: newId("cnv"), tenantId, phone, role, state: initialBotState() as unknown as Record<string, unknown> })
    .returning();
  return created;
}

/** Keep an internal title in sync once we know what and where ("Patios & paving, Wimbledon"). */
async function refreshJobTitle(tenant: Tenant, jobId: string): Promise<void> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job?.service) return;
  const title = [serviceLabel(job.service, tenant.config), job.area].filter(Boolean).join(", ");
  await db.update(schema.jobs).set({ title }).where(eq(schema.jobs.id, jobId));
}

/**
 * The owner's own WhatsApp buttons: "Send all N" approves every quick-yes message waiting, "Look first" /
 * "Open GardenProof" just points at the app. Neither touches the crew capture state machine.
 * Returns whether it was one of these (caller stops there either way).
 */
async function handleOwnerButton(
  tenantId: string,
  crewMemberId: string,
  choiceId: string,
  now: Date,
  send: (body: string) => Promise<unknown>,
): Promise<boolean> {
  const { OWNER_BUTTONS, approveAllAwaiting } = await import("@/lib/crm-engine");
  if (choiceId === OWNER_BUTTONS.sendAll) {
    const n = await approveAllAwaiting(tenantId, crewMemberId, now);
    await send(n > 0 ? `Sent. ${n === 1 ? "1 message is" : `${n} messages are`} on their way.` : "Nothing left waiting — all caught up.");
    return true;
  }
  if (choiceId === OWNER_BUTTONS.openApp) {
    const { env } = await import("@/lib/config");
    await send(`Here you go: ${env.appUrl}`);
    return true;
  }
  return false;
}

function tappedTitle(state: unknown, choiceId: string | null | undefined): string | null {
  if (!choiceId) return null;
  const options = (state as Partial<BotState> | null)?.lastOptions;
  return (Array.isArray(options) ? options.find((o) => o.id === choiceId)?.title : null) ?? null;
}

/** After a failed homeowner link, stay on (or return to) the homeowner question so the crew can retry. */
function coerceStateForRetry(before: unknown, after: BotState): BotState {
  const prev = before as Partial<BotState> | null;
  if (prev?.step === "homeowner" && prev.homeowner) return { ...after, step: "homeowner", homeowner: prev.homeowner, lastOptions: [{ id: "home:skip", title: "Skip" }] };
  return after;
}

export async function handleInbound(raw: InboundInput, opts: HandleInboundOptions = {}): Promise<HandleInboundResult> {
  const input = InboundSchema.parse(raw);
  const phone = normalisePhone(input.from);
  return withLock(`${input.tenantId}:${phone}`, () => processInbound(input, phone, opts));
}

async function processInbound(
  input: z.infer<typeof InboundSchema>,
  phone: string,
  opts: HandleInboundOptions,
): Promise<HandleInboundResult> {
  const db = await getDb();
  const tenant = await getTenant(input.tenantId);
  const now = opts.now ?? new Date();

  // Idempotency: Twilio retries webhooks; the same MessageSid must never be processed twice.
  if (input.providerId) {
    const [seen] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.providerId, input.providerId));
    if (seen) return { duplicate: true, role: "unknown", inboundMessageId: seen.id, effects: [] };
  }

  const { crew, customer } = await identify(tenant.id, phone);
  const role: Conversation["role"] = crew ? "crew" : customer ? "customer" : "unknown";
  const conversation = await upsertConversation(tenant.id, phone, role);

  const inboundId = newId("msg");
  try {
    await db.insert(schema.messages).values({
      id: inboundId,
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: "in",
      channel: input.channel,
      fromNumber: phone,
      toNumber: tenant.whatsappNumber,
      // A bare button tap (payload, no text) is stored as the option's title so the chat shows what was chosen.
      body: input.body || tappedTitle(conversation.state, input.choiceId) || null,
      status: "sent",
      providerId: input.providerId ?? null,
    });
  } catch (err) {
    // Unique providerId raced with a concurrent retry: that one wins. Anything else is a real failure.
    if (input.providerId && isDuplicateProviderId(err)) return { duplicate: true, role, inboundMessageId: null, effects: [] };
    throw err;
  }

  const { files: media, contacts } = role === "crew" ? await resolveMedia(input.media) : { files: [], contacts: [] };
  const channel: OutboundChannel = input.channel;
  const audience: OutboundMessage["audience"] = role === "crew" ? (crew?.role === "owner" ? "owner" : "crew") : role;
  const send = (body: string, extra: Partial<OutboundMessage> = {}) =>
    sendMessage({ tenantId: tenant.id, to: phone, body, audience, conversationId: conversation.id, channel, ...extra });

  // The owner's own two buttons ("Send all N" / "Look first") ride the same WhatsApp number as the crew
  // bot, but they aren't part of the job-capture flow at all — handle them here, before the state machine
  // ever sees them, and leave the owner's capture state (if he also carries a phone) untouched.
  if (crew?.role === "owner" && input.choiceId) {
    const handled = await handleOwnerButton(tenant.id, crew.id, input.choiceId, now, send);
    if (handled) return { duplicate: false, role, inboundMessageId: inboundId, effects: [] };
  }

  // Photos that failed to download must not silently vanish: tell the crew straight away.
  if (role === "crew" && input.media.length > 0 && media.length === 0 && contacts.length === 0 && !input.body.trim()) {
    await send("Sorry, that didn't come through. Please send it again.");
    return { duplicate: false, role, inboundMessageId: inboundId, effects: [] };
  }

  const ctx: BotContext = await loadBotContext({
    tenant,
    role,
    crew,
    customer,
    activeJobId: conversation.activeJobId,
    now: now.getTime(),
  });
  const { state, effects } = reduce(
    conversation.state,
    {
      text: input.body,
      choiceId: input.choiceId ?? null,
      media: media.map((m) => ({ kind: kindFromMime(m.mimeType)! })),
      contacts,
    },
    ctx,
  );

  const storedUrls: string[] = [];
  const privateKinds = new Set<string>();
  let finalState = state as BotState;
  // When linking the homeowner fails, the optimistic thanks and the pipeline nudge are replaced by a retry prompt.
  let attachFailed = false;
  for (const effect of effects) {
    switch (effect.type) {
      case "reply":
        if (attachFailed) break;
        await send(effect.body, { options: effect.options, mediaUrls: effect.mediaUrls });
        break;
      case "attachCustomer":
        try {
          await attachCustomerToJob(effect.jobId, effect.contact, crew?.id ?? "crew");
        } catch (err) {
          attachFailed = true;
          const reason = err instanceof CustomerError ? err.message : "Something went wrong saving that contact.";
          if (!(err instanceof CustomerError)) console.error("[bot] attachCustomer failed", effect.jobId, err);
          const previous = coerceStateForRetry(conversation.state, finalState);
          finalState = previous;
          await send(`${reason} Try again, or tap Skip.`, { options: [{ id: "home:skip", title: "Skip" }] });
        }
        break;
      case "homeownerStepDone":
        if (attachFailed) break;
        await (await import("@/lib/pipeline")).homeownerStepDone(effect.jobId);
        break;
      case "createJob":
        await db.insert(schema.jobs).values({
          id: effect.jobId,
          tenantId: tenant.id,
          code: effect.code,
          status: "capturing",
          team: crew?.team ?? "landscaping",
          createdByCrewId: crew?.id ?? null,
          startedAt: now,
        });
        await logEvent({ tenantId: tenant.id, type: "job.created", entity: "job", entityId: effect.jobId, actor: crew?.id, data: { code: effect.code, via: channel } });
        break;
      case "updateJob": {
        const patch: Partial<typeof schema.jobs.$inferInsert> = { updatedAt: now };
        if (effect.patch.service !== undefined) patch.service = effect.patch.service;
        if (effect.patch.postcode !== undefined) {
          patch.postcode = effect.patch.postcode;
          patch.area = areaFromPostcode(effect.patch.postcode, tenant.config);
        }
        await db.update(schema.jobs).set(patch).where(eq(schema.jobs.id, effect.jobId));
        await refreshJobTitle(tenant, effect.jobId);
        break;
      }
      case "storeMedia":
        for (const m of media) {
          const row = await ingestMedia({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            jobId: effect.jobId,
            stage: effect.stage,
            data: m.data,
            mimeType: m.mimeType,
            sourceMessageId: inboundId,
          });
          // Only EXIF-stripped image copies are ever linked; originals and voice notes stay private.
          if (row.publicKey) storedUrls.push(publicUrl(row.publicKey));
          else privateKinds.add(row.kind);
        }
        await db.update(schema.jobs).set({ updatedAt: now }).where(eq(schema.jobs.id, effect.jobId));
        // Before photos on a booked job mean work has started: the job moves to On site by itself.
        if (effect.stage === "before" && media.length > 0) {
          await (await import("@/lib/crm-engine/capture")).advanceFromCapture(effect.jobId, "before_photos", { actor: crew?.id, now });
        }
        break;
      case "deleteJob":
        await db.update(schema.conversations).set({ activeJobId: null }).where(eq(schema.conversations.activeJobId, effect.jobId));
        await db.delete(schema.jobs).where(and(eq(schema.jobs.id, effect.jobId), eq(schema.jobs.status, "capturing")));
        await logEvent({ tenantId: tenant.id, type: "job.cancelled", entity: "job", entityId: effect.jobId, actor: crew?.id });
        break;
      case "completeJob":
        // Fast: marks the job captured and queues the pipeline (lazy import keeps AI/video code out of the webhook).
        await (await import("@/lib/pipeline")).markJobCompleted(effect.jobId, { actor: crew?.id, now });
        break;
      case "setOptOut":
        await db
          .update(schema.customers)
          .set({ optedOut: effect.optedOut })
          .where(and(eq(schema.customers.tenantId, tenant.id), eq(schema.customers.phone, phone)));
        await logEvent({ tenantId: tenant.id, type: effect.optedOut ? "customer.opted_out" : "customer.opted_in", entity: "customer", entityId: customer?.id, data: { phone, keyword: input.body.trim() } });
        break;
      case "notifyOwner": {
        const [owner] = await db
          .select()
          .from(schema.crewMembers)
          .where(and(eq(schema.crewMembers.tenantId, tenant.id), eq(schema.crewMembers.role, "owner"), eq(schema.crewMembers.active, true)));
        if (owner) await sendMessage({ tenantId: tenant.id, to: owner.phone, body: effect.body, audience: "owner", channel });
        break;
      }
    }
  }

  const label = !input.body.trim() && privateKinds.size ? (privateKinds.has("audio") ? "Voice note" : "Video") : null;
  if (storedUrls.length || label || contacts.length) {
    const contactLabel = !input.body.trim() && contacts.length ? `Contact card: ${contacts[0].firstName ?? "homeowner"}` : null;
    await db
      .update(schema.messages)
      .set({ mediaUrls: storedUrls, ...(label || contactLabel ? { body: [label, contactLabel].filter(Boolean).join(" · ") } : {}) })
      .where(eq(schema.messages.id, inboundId));
  }
  await db
    .update(schema.conversations)
    .set({ state: finalState as unknown as Record<string, unknown>, activeJobId: finalState.jobId, updatedAt: now })
    .where(eq(schema.conversations.id, conversation.id));

  return { duplicate: false, role, inboundMessageId: inboundId, effects };
}
