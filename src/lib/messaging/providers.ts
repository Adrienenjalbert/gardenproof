/**
 * Delivery providers. The simulator provider does nothing on the wire: the message row itself is
 * what the in-app simulator renders. Twilio is called over plain REST (no SDK dependency).
 */
import { env } from "@/lib/config";
import { renderWithNumberedOptions } from "./format";
import type { MessagingProvider, OutboundChannel, OutboundMessage } from "./types";

export const simulatorProvider: MessagingProvider = {
  channel: "simulator",
  async deliver() {
    return { providerId: null };
  },
};

function absolute(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${env.appUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function twilioProvider(fetchImpl: typeof fetch = fetch): MessagingProvider {
  return {
    channel: "whatsapp",
    async deliver(msg: OutboundMessage) {
      const { accountSid, authToken, whatsappFrom } = env.twilio;
      if (!accountSid || !authToken || !whatsappFrom) throw new Error("Twilio WhatsApp is not configured");
      const form = new URLSearchParams();
      form.set("From", whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`);
      form.set("To", `whatsapp:${msg.to}`);
      if (msg.template) {
        // Template sends: WhatsApp renders the approved text itself; Body/MediaUrl must not be sent alongside.
        form.set("ContentSid", msg.template.sid);
        form.set("ContentVariables", JSON.stringify(msg.template.variables));
      } else {
        form.set("Body", renderWithNumberedOptions(msg.body, msg.options));
        // WhatsApp accepts one media item per message; the first one is the one that matters (framing guide / hero).
        const [firstMedia] = msg.mediaUrls ?? [];
        if (firstMedia) form.set("MediaUrl", absolute(firstMedia));
      }
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!res.ok || !json.sid) throw new Error(`Twilio ${res.status}: ${json.message ?? "send failed"}`);
      return { providerId: json.sid };
    },
  };
}

export function providerFor(channel: OutboundChannel): MessagingProvider {
  return channel === "whatsapp" ? twilioProvider() : simulatorProvider;
}
