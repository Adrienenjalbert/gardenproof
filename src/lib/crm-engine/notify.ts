/**
 * Owner notifications: only what matters goes to Stephen's WhatsApp instantly (per his settings); everything
 * else is kept for the evening digest. Best effort: a failed owner notification never fails the caller.
 */
import { logEvent } from "@/lib/events";
import { sendMessage, type MessageOption } from "@/lib/messaging";
import { findOwner } from "./context";
import { loadSettings, type InstantKind } from "./settings";

export const DIGEST_ITEM_EVENT = "owner.digest_item";

/** Button ids the WhatsApp bot routes back to the engine (see approveAllAwaiting). */
export const OWNER_BUTTONS = {
  sendAll: "crm_send_all",
  openApp: "crm_open_app",
} as const;

export async function sendToOwner(
  tenantId: string,
  body: string,
  options?: MessageOption[],
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  const owner = await findOwner(tenantId);
  if (!owner) return false;
  try {
    await sendMessage({
      tenantId,
      to: owner.phone,
      body,
      audience: "owner",
      options,
      meta: { kind: "owner_notification", ...meta },
    });
    return true;
  } catch (err) {
    console.error("[crm] owner notification failed", err);
    return false;
  }
}

/**
 * Tell the owner about something. Instant when he asked for this kind instantly; otherwise it waits in the
 * evening digest. Returns how it was routed.
 */
export async function notifyOwner(
  tenantId: string,
  kind: InstantKind | "info",
  text: string,
): Promise<"instant" | "digest"> {
  const settings = await loadSettings(tenantId);
  const instant = kind !== "info" && settings.notifications.instant.includes(kind);
  if (instant && (await sendToOwner(tenantId, text, undefined, { notification: kind }))) return "instant";
  await queueDigestItem(tenantId, text, kind);
  return "digest";
}

export async function queueDigestItem(tenantId: string, text: string, kind = "info"): Promise<void> {
  // Stored in the audit log: it is exactly the record of "what happened today" the digest summarises.
  await logEvent({
    tenantId,
    type: DIGEST_ITEM_EVENT,
    entity: "tenant",
    entityId: tenantId,
    data: { text, kind },
  });
}
