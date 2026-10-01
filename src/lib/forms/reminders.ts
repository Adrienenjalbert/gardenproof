/**
 * Save & resume nudges for unfinished forms. Hourly sweep (task "forms.remind"):
 *   24h after the last answer  -> WhatsApp reminder 1 ("pick up where you left off — 2 questions left")
 *   72h after the last answer  -> reminder 2 (the last one)
 *   24h after reminder 2       -> tell the owner once, then stop for good.
 * Only for people who started (at least one answer): an untouched link is the CRM engine's to follow up.
 * Never between 20:00 and 08:00 London time, never to someone who opted out, never twice (each step is
 * claimed with a conditional UPDATE on reminders_sent before anything is sent).
 */
import { and, eq, isNull, lt, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FormResponse } from "@/db/schema";
import { sendMessage, type MessageTemplate } from "@/lib/messaging";
import { normaliseMobile, summarise } from "./engine";
import { getForm, formUrl, type LoadedForm } from "./store";
import type { ContactValue } from "./types";

const HOUR = 3_600_000;
export const FIRST_REMINDER_AFTER_MS = 24 * HOUR;
export const SECOND_REMINDER_AFTER_MS = 72 * HOUR;
export const OWNER_NOTICE_AFTER_MS = 24 * HOUR; // after the second reminder
/** Forms idle for longer than this when first seen are closed quietly (never nudge about something stale). */
export const STALE_AFTER_MS = 10 * 24 * HOUR;
/** reminders_sent value meaning "finished with this form". */
export const REMINDERS_DONE = 3;
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 8;

export function londonHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(at));
}

export const isQuietHours = (at: Date) => {
  const h = londonHour(at);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
};

const NOUNS: Record<LoadedForm["kind"], string> = {
  enquiry: "your garden enquiry",
  project_brief: "your project brief",
  maintenance_visit: "your visit feedback",
};

/** Optional approved WhatsApp template (business-initiated message outside the 24h window). */
function reminderTemplate(vars: Record<string, string>): MessageTemplate | undefined {
  const sid = process.env.TWILIO_TEMPLATE_FORM_REMINDER;
  return sid && /^HX[0-9a-fA-F]{32}$/.test(sid) ? { sid, variables: vars } : undefined;
}

export function reminderText(n: 1 | 2, o: { firstName: string | null; business: string; noun: string; remaining: number; url: string }): string {
  const hi = `Hi ${o.firstName ?? "there"},`;
  const left = o.remaining <= 0 ? "it's ready to send" : `${o.remaining} question${o.remaining === 1 ? "" : "s"} left`;
  return n === 1
    ? `${hi} pick up where you left off with ${o.noun} for ${o.business}: ${left}. Everything you've answered is saved.\n${o.url}`
    : `${hi} a last gentle nudge about ${o.noun} for ${o.business} (${left}). We won't remind you again.\n${o.url}`;
}

function phoneOf(form: LoadedForm, customerPhone: string | null): string | null {
  const contact = form.answers.contact as ContactValue | undefined;
  const raw = contact?.phone ?? form.meta.prefill?.phone ?? customerPhone;
  return raw ? normaliseMobile(raw) : null;
}

function firstNameOf(form: LoadedForm, customerFirst: string | null): string | null {
  const contact = form.answers.contact as ContactValue | undefined;
  return contact?.firstName ?? form.meta.prefill?.firstName ?? customerFirst ?? null;
}

/** Move reminders_sent from `from` to `to` iff nobody else did (and the form is still open). */
async function claim(row: FormResponse, from: number, to: number, now: Date): Promise<boolean> {
  const db = await getDb();
  const done = await db
    .update(schema.formResponses)
    .set({ remindersSent: to, lastReminderAt: now })
    .where(and(eq(schema.formResponses.id, row.id), eq(schema.formResponses.remindersSent, from), isNull(schema.formResponses.completedAt)))
    .returning({ id: schema.formResponses.id });
  return done.length === 1;
}

async function ownerPhone(tenantId: string): Promise<string | null> {
  const db = await getDb();
  const crew = await db
    .select({ phone: schema.crewMembers.phone, teamRole: schema.crewMembers.teamRole, role: schema.crewMembers.role })
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, tenantId), eq(schema.crewMembers.active, true)));
  return (crew.find((c) => c.teamRole === "owner") ?? crew.find((c) => c.role === "owner"))?.phone ?? null;
}

export type ReminderSummary = { reminded: number; ownerNotified: number; closed: number; skipped: number };

export async function sendFormReminders(now: Date): Promise<ReminderSummary> {
  const summary: ReminderSummary = { reminded: 0, ownerNotified: 0, closed: 0, skipped: 0 };
  if (isQuietHours(now)) return summary; // the next hourly run after 08:00 picks everything up

  const db = await getDb();
  const due = await db
    .select()
    .from(schema.formResponses)
    .where(
      and(
        isNull(schema.formResponses.completedAt),
        lt(schema.formResponses.remindersSent, REMINDERS_DONE),
        lte(schema.formResponses.updatedAt, new Date(now.getTime() - FIRST_REMINDER_AFTER_MS)),
      ),
    )
    .limit(200);

  for (const row of due) {
    const form = await getForm(row.token);
    if (!form) continue;
    if (Object.keys(form.answers).length === 0) {
      summary.skipped++;
      continue;
    }
    const [customer] = row.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, row.customerId)) : [];
    const phone = phoneOf(form, customer?.phone ?? null);
    if (!phone) {
      summary.skipped++; // web visitor who never reached the contact step: nobody to remind
      continue;
    }
    const idle = now.getTime() - row.updatedAt.getTime();
    const sinceReminder = row.lastReminderAt ? now.getTime() - row.lastReminderAt.getTime() : Infinity;

    const [optOut] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, row.tenantId), eq(schema.customers.phone, phone), eq(schema.customers.optedOut, true)))
      .limit(1);
    if (optOut || (row.remindersSent === 0 && idle > STALE_AFTER_MS)) {
      if (await claim(row, row.remindersSent, REMINDERS_DONE, now)) summary.closed++;
      continue;
    }

    const firstName = firstNameOf(form, customer?.firstName ?? null);
    const vars = { firstName, business: form.brand.name, noun: NOUNS[form.kind], remaining: form.remaining, url: `${formUrl(row.token)}?welcome` };

    if (row.remindersSent === 0 || (row.remindersSent === 1 && idle >= SECOND_REMINDER_AFTER_MS)) {
      const n = (row.remindersSent + 1) as 1 | 2;
      if (!(await claim(row, row.remindersSent, n, now))) continue;
      await sendMessage({
        tenantId: row.tenantId,
        to: phone,
        body: reminderText(n, vars),
        audience: "customer",
        template: reminderTemplate({ "1": firstName ?? "there", "2": vars.noun, "3": String(vars.remaining), "4": vars.url }),
        meta: { kind: "form_reminder", formId: row.id, reminder: n },
      });
      summary.reminded++;
      continue;
    }

    if (row.remindersSent === 2 && sinceReminder >= OWNER_NOTICE_AFTER_MS) {
      if (!(await claim(row, 2, REMINDERS_DONE, now))) continue;
      const owner = await ownerPhone(row.tenantId);
      if (!owner) continue;
      const known = summarise(form.definition, form.answers).filter((l) => l.id !== "contact");
      const body = [
        `${firstName ?? "Someone"} (${phone}) started ${NOUNS[form.kind].replace("your ", "a ")} but didn't finish, even after two reminders.`,
        ...known.map((l) => `${l.label}: ${l.value}`),
        form.kind === "enquiry" ? "Might be worth a quick call." : null,
      ]
        .filter(Boolean)
        .join("\n");
      await sendMessage({ tenantId: row.tenantId, to: owner, body, audience: "owner", meta: { kind: "form_abandoned", formId: row.id } });
      summary.ownerNotified++;
    }
  }
  return summary;
}

