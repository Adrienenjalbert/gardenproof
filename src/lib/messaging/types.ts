/**
 * Outbound messaging contract. Implementations: simulator (default) and Twilio WhatsApp.
 * All sends go through `sendMessage` in ./index.ts, which applies safe-mode and opt-out rules.
 */
export type MessageOption = { id: string; title: string };

export type OutboundChannel = "whatsapp" | "simulator";

export type OutboundMessage = {
  tenantId: string;
  to: string; // E.164 phone
  body: string;
  mediaUrls?: string[];
  /** Quick-reply options (rendered as buttons in the simulator, numbered list on WhatsApp fallback). */
  options?: MessageOption[];
  /**
   * Who receives it. Only "customer" is subject to safe mode (held for approval) and opt-out.
   * "unknown" = a number we don't recognise (gets one polite reply, never held).
   */
  audience: "crew" | "customer" | "owner" | "unknown";
  conversationId?: string;
  /** Force a channel (the bot replies on the channel it was contacted on). Defaults from config. */
  channel?: OutboundChannel;
  /**
   * Approved WhatsApp Content template (Twilio ContentSid + numbered variables). Required for business-initiated
   * messages outside the 24h customer-service window; `body` should be the same text, rendered, for the record.
   */
  template?: MessageTemplate;
  /** Typed links stored on the message row (e.g. { kind: "review_request", testimonialId, jobId }). */
  meta?: Record<string, unknown>;
};

export type MessageTemplate = { sid: string; variables: Record<string, string> };

export interface MessagingProvider {
  readonly channel: OutboundChannel;
  deliver(msg: OutboundMessage): Promise<{ providerId: string | null }>;
}
