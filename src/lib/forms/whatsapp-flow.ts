/**
 * WhatsApp Flow completion -> the same form_responses row as the web form.
 *
 * We send the Flow with `flow_token` = the form token (Twilio Content template variable), so a completion finds
 * its form without guessing. Twilio forwards the Flow reply on the inbound-message webhook as `InteractiveData`
 * (JSON). Accepted shapes, most to least wrapped:
 *   {"type":"nfm_reply","nfm_reply":{"name":"flow","body":"Sent","response_json":"{\"flow_token\":…}"}}
 *   {"response_json":"{…}"}          (nfm_reply body only)
 *   {"flow_token":"…", …fields}      (already-decoded response)
 * Every field goes through saveAnswer (same validation as the web). If something required is missing or
 * invalid the form stays open and the caller replies with the web link to finish the last questions.
 */
import { z } from "zod";
import { normalisePhone, sendMessage } from "@/lib/messaging";
import { findStep, normaliseMobile } from "./engine";
import { completeForm, FormError, formUrl, getForm, saveAnswer } from "./store";
import type { Answers } from "./types";
import type { SmartFormKind } from "./definitions";

export type FlowReply = { flowToken: string; response: Record<string, unknown> };

const ResponseSchema = z.record(z.string(), z.unknown());

function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return null;
    }
  }
  const parsed = ResponseSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/** Unwrap Twilio's InteractiveData (string or object) into the Flow's completion payload. */
export function parseFlowReply(raw: unknown): FlowReply | null {
  let obj = asObject(raw);
  for (let depth = 0; obj && depth < 3; depth++) {
    if (typeof obj.flow_token === "string") {
      const { flow_token, ...response } = obj;
      return /^[A-Za-z0-9_-]{16,64}$/.test(flow_token) ? { flowToken: flow_token, response } : null;
    }
    obj = asObject(obj.nfm_reply ?? obj.response_json ?? null);
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : str(v) ? [str(v)!] : []);

/** DatePicker sends "YYYY-MM-DD" (Flow JSON ≥ 5) or epoch milliseconds (older clients). */
export function flowDate(v: unknown): string | undefined {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ms = typeof v === "number" ? v : typeof v === "string" && /^\d{10,13}$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

/**
 * Pure mapping from Flow field names to form answers (client-shaped values; saveAnswer validates).
 * `from` is the sender's WhatsApp number: we never ask for a phone we already have.
 */
export function mapFlowResponse(kind: SmartFormKind, r: Record<string, unknown>, from: string | null): Answers {
  const out: Answers = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  };
  if (kind === "enquiry") {
    set("services", list(r.services));
    set("size", str(r.size));
    set("budget", str(r.budget));
    set("frequency", str(r.frequency));
    const timing = str(r.timing);
    if (timing) set("timing", timing === "date" ? { choice: timing, date: flowDate(r.date) } : { choice: timing });
    if (str(r.postcode)) set("postcode", { postcode: str(r.postcode) });
    const phone = from ? normaliseMobile(from.replace(/^whatsapp:/i, "")) : null;
    if (str(r.firstName) && phone) {
      set("contact", { firstName: str(r.firstName), lastName: str(r.lastName) ?? null, phone, consent: r.consent === true || r.consent === "true" });
    }
    const days = list(r.callDays);
    const windows = list(r.callWindows);
    if (days.length && windows.length) set("callTime", { days, windows });
  }
  if (kind === "maintenance_visit") {
    set("feeling", str(r.feeling));
    set("issues", list(r.issues));
    set("note", str(r.note) ?? null);
  }
  if (kind === "project_brief") {
    // No Flow for the brief yet (it needs photos): map same-named fields so a future Flow just works.
    for (const [k, v] of Object.entries(r)) if (!k.startsWith("_")) set(k, v);
  }
  return out;
}

export type FlowCompletion =
  | { status: "not_found" }
  | { status: "completed"; tenantId: string; token: string; url: string }
  | { status: "already_completed"; tenantId: string; token: string; url: string }
  | { status: "incomplete"; tenantId: string; token: string; url: string; remaining: number; problems: { stepId: string; error: string }[] };

/** Save every mapped answer, then complete. Idempotent: a repeated webhook finds the form already completed. */
export async function handleFlowCompletion(input: { interactiveData: unknown; from: string | null; fetchImpl?: typeof fetch }): Promise<FlowCompletion> {
  const reply = parseFlowReply(input.interactiveData);
  if (!reply) return { status: "not_found" };
  const form = await getForm(reply.flowToken);
  if (!form) return { status: "not_found" };
  const tenantId = form.tenant.id;
  const url = formUrl(form.row.token);
  if (form.completed) return { status: "already_completed", tenantId, token: form.row.token, url };

  const answers = mapFlowResponse(form.kind, reply.response, input.from);
  const problems: { stepId: string; error: string }[] = [];
  let remaining = form.remaining;
  // Definition order, so skip logic sees earlier answers first.
  for (const step of form.definition.steps) {
    if (!(step.id in answers)) continue;
    const value = answers[step.id];
    if (value === null && !findStep(form.definition, step.id)?.optional) continue;
    try {
      remaining = (await saveAnswer(form.row.token, step.id, value, { fetchImpl: input.fetchImpl })).remaining;
    } catch (err) {
      if (!(err instanceof FormError)) throw err;
      problems.push({ stepId: step.id, error: err.message });
    }
  }
  try {
    const done = await completeForm(form.row.token, { source: "whatsapp_flow" });
    return { status: done.alreadyCompleted ? "already_completed" : "completed", tenantId, token: form.row.token, url };
  } catch (err) {
    if (!(err instanceof FormError) || err.code !== "incomplete") throw err;
    return { status: "incomplete", tenantId, token: form.row.token, url, remaining, problems };
  }
}

/**
 * The one thing the customer needs back after tapping Submit on a Flow: nothing when it's a duplicate,
 * a short "thanks" when it went through, or the web link when gaps remain (same tone as the 24h/72h nudges
 * in ./reminders). Called from the inbound webhook, never in-line — a WhatsApp send can be slow.
 */
export async function replyToFlowCompletion(outcome: FlowCompletion, from: string): Promise<void> {
  if (outcome.status === "not_found" || outcome.status === "already_completed") return;
  const to = normalisePhone(from);
  if (outcome.status === "completed") {
    await sendMessage({ tenantId: outcome.tenantId, to, body: "Thanks — that's everything. We'll be in touch soon.", audience: "customer" });
    return;
  }
  const left = outcome.remaining;
  await sendMessage({
    tenantId: outcome.tenantId,
    to,
    body: `Almost there — ${left} question${left === 1 ? "" : "s"} left: ${outcome.url}`,
    audience: "customer",
  });
}
