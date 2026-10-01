/**
 * Twilio WhatsApp inbound webhook. Configure in Twilio as POST {APP_URL}/api/whatsapp/webhook.
 * - X-Twilio-Signature is validated whenever TWILIO_AUTH_TOKEN is set, and in production an unsigned
 *   setup is refused outright (no token = every request rejected), so nobody can impersonate a crew phone.
 * - Answers with empty TwiML at once and handles the message (media download, bot reply) after the
 *   response, so Twilio never times out on a burst of photos. The bot only queues pipeline work.
 * - Retries are de-duplicated on MessageSid inside handleInbound.
 */
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handleInbound } from "@/lib/bot";
import { env, isProduction } from "@/lib/config";
import { handleFlowCompletion, replyToFlowCompletion } from "@/lib/forms";
import { normalisePhone } from "@/lib/messaging";
import { candidateUrls, isValidTwilioSignature } from "@/lib/messaging/twilio-signature";
import { getTenantBySlug } from "@/lib/tenants";

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const TwilioInbound = z.object({
  MessageSid: z.string().min(10),
  From: z.string().min(5),
  To: z.string().min(5),
  Body: z.string().default(""),
  NumMedia: z.coerce.number().int().min(0).max(10).default(0),
  ButtonPayload: z.string().optional(),
  // Set only when the tapped message was a WhatsApp Flow's final "Submit" (see whatsapp/flows/README.md).
  InteractiveData: z.string().optional(),
});

/**
 * Tapping "Submit" on an enquiry/maintenance-visit Flow lands here, not in the crew capture bot: it's the
 * same completion the web form (/f/[token]) produces, just answered in-chat. `not_found` means the payload
 * wasn't a Flow reply we recognise (or belongs to no live form) — the caller falls through to the bot as usual.
 */
async function handleFlowReply(interactiveData: string, from: string): Promise<boolean> {
  const outcome = await handleFlowCompletion({ interactiveData, from });
  if (outcome.status === "not_found") return false;
  await replyToFlowCompletion(outcome, from);
  return true;
}

async function tenantIdFor(to: string): Promise<string> {
  const db = await getDb();
  const [t] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.whatsappNumber, normalisePhone(to)));
  return t?.id ?? (await getTenantBySlug()).id;
}

export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());

  const token = env.twilio.authToken;
  if (!token && isProduction()) return new Response("Webhook disabled: TWILIO_AUTH_TOKEN is not set", { status: 403 });
  if (token && !isValidTwilioSignature(token, req.headers.get("x-twilio-signature"), candidateUrls(req, env.appUrl), params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const parsed = TwilioInbound.safeParse(Object.fromEntries(params));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const msg = parsed.data;

  const authorization = env.twilio.accountSid && token
    ? `Basic ${Buffer.from(`${env.twilio.accountSid}:${token}`).toString("base64")}`
    : undefined;
  // URLs are only fetched from Twilio hosts (see lib/bot/download.ts); anything else is dropped there.
  const media = Array.from({ length: msg.NumMedia }, (_, i) => ({
    url: params.get(`MediaUrl${i}`) ?? "",
    mimeType: params.get(`MediaContentType${i}`) ?? "application/octet-stream",
    authorization,
  })).filter((m) => m.url);

  const tenantId = await tenantIdFor(msg.To);
  after(async () => {
    try {
      if (msg.InteractiveData && (await handleFlowReply(msg.InteractiveData, msg.From))) return;
      await handleInbound({
        tenantId,
        from: msg.From,
        body: msg.Body,
        choiceId: msg.ButtonPayload ?? null,
        media,
        providerId: msg.MessageSid,
        channel: "whatsapp",
      });
    } catch (err) {
      console.error("[whatsapp] inbound failed", msg.MessageSid, err);
    }
  });

  return new Response(TWIML_EMPTY, { headers: { "content-type": "text/xml; charset=utf-8" } });
}
