/** Pure helpers shared by providers, the bot and the webhook. */
import type { MessageOption } from "./types";

/**
 * WhatsApp without an approved interactive template can't show buttons, so options are
 * appended as a numbered list. The bot accepts "1", "2"… as replies (see bot/reducer.ts).
 */
export function renderWithNumberedOptions(body: string, options: MessageOption[] = []): string {
  if (options.length === 0) return body;
  const list = options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
  return `${body}\n\n${list}\n\nReply with a number.`;
}

/** Normalise "whatsapp:+44 7700 900001" / "07700900001" to E.164 ("+447700900001"). UK default. */
export function normalisePhone(raw: string): string {
  let p = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (p.startsWith("0")) p = `+44${p.slice(1)}`;
  if (!p.startsWith("+")) p = `+${p}`;
  return p;
}

/**
 * A UK mobile typed or shared by a crew member, as E.164 ("+447…"), or null if it isn't one.
 * Accepts "07700 900123", "+44 (0)7700 900123", "0044 7700 900123", "447700900123", with spaces/dots/dashes.
 */
export function parseUkMobile(raw: string): string | null {
  let p = raw.trim().replace(/^whatsapp:/i, "").replace(/\(0\)/g, "").replace(/[\s().-]/g, "");
  if (!/^\+?\d{10,14}$/.test(p)) return null;
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0044")) p = p.slice(4);
  else if (p.startsWith("44")) p = p.slice(2);
  else if (p.startsWith("0")) p = p.slice(1);
  return /^7\d{9}$/.test(p) ? `+44${p}` : null;
}
