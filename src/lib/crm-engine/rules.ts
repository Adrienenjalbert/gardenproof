/**
 * The CRM rules table: which message goes out, to whom, when, and how much trust it needs — per stage.
 * Declarative on purpose: the owner sees `label` and `reason`; engineers read one row per behaviour.
 * Templates are short, warm WhatsApp messages in British English. They only use facts we hold (first name,
 * area, service, dates); never prices, promises or anything invented.
 */
import type { CrmStage, TrustTier } from "@/lib/crm";
import { reviewRequestText, reviewRequestVariables } from "@/lib/testimonials";
import type { MessageStyle } from "./settings";
import { DAY_MS, londonAt, londonDateKey } from "./time";

export type Audience = "customer" | "crew" | "owner";

export type RuleContext = {
  now: Date;
  /** When the job entered its current stage. */
  stageEnteredAt: Date;
  job: {
    id: string;
    stage: CrmStage;
    area: string | null;
    postcode: string | null;
    serviceLabel: string | null;
    /** Site visit / start date / next maintenance visit, depending on the stage. */
    nextActionAt: Date | null;
  };
  customer: {
    id: string;
    firstName: string | null;
    phone: string | null;
    optedOut: boolean;
  } | null;
  crewLead: { id: string; name: string; phone: string } | null;
  business: { name: string; ownerName: string | null; phone: string | null };
  style: MessageStyle;
  links: { projectForm: string | null };
};

export type Composed = { body: string; reason: string };

export type Rule = {
  key: string;
  /** Owner-facing name ("Quote follow-up"). */
  label: string;
  stage: CrmStage;
  audience: Audience;
  trustTier: TrustTier;
  /** Date-anchored rules get one instance per anchor date (e.g. every maintenance visit). */
  anchor?: (ctx: RuleContext) => Date | null;
  /** When to send; null = not applicable (missing date). */
  when: (ctx: RuleContext) => Date | null;
  compose: (ctx: RuleContext) => Composed;
  /** Delivered through the homeowner review flow (keeps consent logging) instead of a plain message. */
  via?: "review_request";
  /**
   * Crew capture prompts: once sent, the crew lead's WhatsApp is pointed at this job, so the photos they send
   * next land on it (no "which job?", no new job code). "before" on the start day, "after" on the finish day.
   */
  arm?: "before" | "after";
};

// ---------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------

const firstName = (c: RuleContext) => c.customer?.firstName?.trim() || "there";
const service = (c: RuleContext) => (c.job.serviceLabel ?? "garden").toLowerCase();
const inArea = (c: RuleContext) => (c.job.area ? ` in ${c.job.area}` : "");
const ownerOrUs = (c: RuleContext) => c.business.ownerName ?? "we";

export function signature(c: Pick<RuleContext, "business" | "style">): string {
  if (c.style.signOff?.trim()) return c.style.signOff.trim();
  return c.business.ownerName ? `${c.business.ownerName}, ${c.business.name}` : c.business.name;
}

/** Greeting + body + sign-off, shaped by the owner's chosen tone. */
export function letter(c: Pick<RuleContext, "business" | "style">, name: string, body: string): string {
  const sig = signature(c);
  switch (c.style.tone) {
    case "professional":
      return `Dear ${name},\n\n${body}\n\nKind regards,\n${sig}`;
    case "brief":
      return `Hi ${name}, ${body}\n\n${sig}`;
    default:
      return `Hi ${name},\n\n${body}\n\nThanks,\n${sig}`;
  }
}

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const shortDayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
});

export const clock = (d: Date) => timeFmt.format(d);
export const longDay = (d: Date) => dayFmt.format(d);
export const shortDay = (d: Date) => shortDayFmt.format(d);

/** "at 10:00" unless the time is midnight (a date without a time). */
const atTime = (d: Date) => (clock(d) === "00:00" ? "" : ` at ${clock(d)}`);

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const next = (c: RuleContext) => c.job.nextActionAt;

/** The whole day of the stage's date (a capture prompt belongs to the day, not to a start time). */
const dayOf = (c: RuleContext) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, 0, 23, 59) : null);

/**
 * Capture prompts go at a set time on the day (or 15 minutes before an earlier start time) and never once the
 * day is over: "starting today" a day late would be wrong.
 */
function captureTime(c: RuleContext, hour: number, minute: number): Date | null {
  const day = c.job.nextActionAt;
  if (!day) return null;
  if (c.now.getTime() >= londonAt(day, 0, 23, 59).getTime()) return null;
  const set = londonAt(day, 0, hour, minute);
  const early = clock(day) !== "00:00" ? new Date(day.getTime() - 15 * 60_000) : null;
  return early && early.getTime() < set.getTime() ? early : set;
}

export const RULES: readonly Rule[] = [
  {
    key: "enquiry_ack",
    label: "Thank-you for the enquiry",
    stage: "enquiry",
    audience: "customer",
    trustTier: "automatic",
    when: (c) => c.stageEnteredAt,
    compose: (c) => {
      const form = c.links.projectForm
        ? ` So we arrive prepared, could you tell us a little more here? It takes two minutes: ${c.links.projectForm}`
        : "";
      const who = c.business.ownerName ? `${c.business.ownerName} will` : "We'll";
      return {
        body: letter(
          c,
          firstName(c),
          `Thank you for getting in touch with ${c.business.name} about your ${service(c)}${inArea(c)}.${form} ${who} call you within a day to arrange a visit.`,
        ),
        reason: `Thanks ${firstName(c)} straight away${c.links.projectForm ? " and asks for a few details, so you arrive prepared" : ""}.`,
      };
    },
  },
  {
    key: "site_visit_reminder",
    label: "Visit reminder",
    stage: "site_visit",
    audience: "customer",
    trustTier: "automatic",
    anchor: next,
    when: (c) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, -1, 18) : null),
    compose: (c) => ({
      body: letter(
        c,
        firstName(c),
        `Just a reminder that ${ownerOrUs(c) === "we" ? "we'll" : `${ownerOrUs(c)} will`} come and see your garden tomorrow${atTime(c.job.nextActionAt!)}. If anything changes, just reply here.`,
      ),
      reason: `Reminds ${firstName(c)} the evening before the visit.`,
    }),
  },
  {
    key: "site_visit_crew",
    label: "Visit note for the team",
    stage: "site_visit",
    audience: "crew",
    trustTier: "automatic",
    anchor: next,
    when: (c) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, 0, 7, 30) : null),
    compose: (c) => ({
      body: `Morning ${c.crewLead?.name ?? ""}. Site visit today${atTime(c.job.nextActionAt!)}: ${firstName(c)}${inArea(c)}${c.job.postcode ? ` (${c.job.postcode})` : ""}, ${service(c)}.`.replace(
        "Morning .",
        "Morning.",
      ),
      reason: `Tells ${c.crewLead?.name ?? "the crew lead"} about the visit that morning.`,
    }),
  },
  {
    key: "quote_follow_up",
    label: "Quote follow-up",
    stage: "quoted",
    audience: "customer",
    trustTier: "quick_yes",
    when: (c) => londonAt(new Date(c.stageEnteredAt.getTime() + 5 * DAY_MS), 0, 10),
    compose: (c) => ({
      body: letter(
        c,
        firstName(c),
        `I hope you've had a chance to look over our quote for your ${service(c)}. Happy to talk it through or adjust anything, just reply here${c.business.phone ? ` or call ${c.business.phone}` : ""}.`,
      ),
      reason: `${firstName(c)} hasn't replied to the quote in 5 days. A gentle nudge usually helps.`,
    }),
  },
  {
    key: "booked_prep",
    label: "Before we start",
    stage: "booked",
    audience: "customer",
    trustTier: "quick_yes",
    when: (c) => londonAt(c.stageEnteredAt, 1, 9),
    compose: (c) => {
      const start = c.job.nextActionAt ? ` on ${longDay(c.job.nextActionAt)}` : "";
      return {
        body: letter(
          c,
          firstName(c),
          `We're looking forward to starting${start}. A few things that make day one easy:\n• clear access to the garden (side gate unlocked)\n• space nearby for our van\n• pets kept inside while we work\nAny questions, just reply here.`,
        ),
        reason: `Helps ${firstName(c)} get ready, so day one runs smoothly.`,
      };
    },
  },
  {
    key: "start_reminder",
    label: "Start reminder",
    stage: "booked",
    audience: "customer",
    trustTier: "automatic",
    anchor: next,
    when: (c) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, -1, 18) : null),
    compose: (c) => ({
      body: letter(
        c,
        firstName(c),
        `A quick note that ${c.crewLead ? `${c.crewLead.name} and the team` : "the team"} arrive tomorrow${atTime(c.job.nextActionAt!) || " morning"} to start your ${service(c)}. See you then.`,
      ),
      reason: `Reminds ${firstName(c)} the evening before work starts.`,
    }),
  },
  {
    key: "start_crew",
    label: "Start note for the team",
    stage: "booked",
    audience: "crew",
    trustTier: "automatic",
    anchor: next,
    when: (c) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, -1, 17) : null),
    compose: (c) => ({
      body: `${c.crewLead?.name ?? "Team"}, tomorrow you start ${firstName(c)}'s ${service(c)}${inArea(c)}${c.job.postcode ? ` (${c.job.postcode})` : ""}. They know you're coming.`,
      reason: `Gives ${c.crewLead?.name ?? "the crew lead"} a heads-up the day before.`,
    }),
  },
  {
    key: "capture_before",
    label: "Before photos",
    stage: "booked",
    audience: "crew",
    trustTier: "automatic",
    arm: "before",
    anchor: dayOf,
    when: (c) => captureTime(c, 7, 30),
    compose: (c) => ({
      body: `Morning${c.crewLead ? ` ${c.crewLead.name}` : ""}. Starting ${firstName(c)}'s ${service(c)}${inArea(c)} today. Before anything moves, send 2 or 3 before photos here. They go straight on this job.`,
      reason: `Asks ${c.crewLead?.name ?? "the crew lead"} for before photos on the start morning, so every job gets its "before".`,
    }),
  },
  {
    key: "capture_after",
    label: "After photos",
    stage: "on_site",
    audience: "crew",
    trustTier: "automatic",
    arm: "after",
    anchor: dayOf,
    when: (c) => captureTime(c, 15, 30),
    compose: (c) => ({
      body: `${c.crewLead?.name ?? "Team"}, finishing at ${firstName(c)}'s today? Send the after photos here from the same spots as the befores, then tap Done.`,
      reason: `Asks for after photos on the finish day. Tapping Done moves the job to Finished and starts the review request.`,
    }),
  },
  {
    key: "review_request",
    label: "Review request",
    stage: "finished",
    audience: "customer",
    trustTier: "quick_yes",
    via: "review_request",
    when: (c) => londonAt(c.stageEnteredAt, 1, 10),
    compose: (c) => {
      const from = c.business.ownerName
        ? `${c.business.ownerName} at ${c.business.name}`
        : `the team at ${c.business.name}`;
      return {
        body: reviewRequestText(
          reviewRequestVariables({
            firstName: c.customer?.firstName ?? null,
            from,
            link: "(their private review link)",
          }),
        ),
        reason: `Asks ${firstName(c)} how it feels now and what we may show. Their answer unlocks the page and videos.`,
      };
    },
  },
  {
    key: "aftercare_offer",
    label: "Aftercare & maintenance offer",
    stage: "finished",
    audience: "customer",
    trustTier: "quick_yes",
    when: (c) => londonAt(new Date(c.stageEnteredAt.getTime() + 7 * DAY_MS), 0, 10),
    compose: (c) => ({
      body: letter(
        c,
        firstName(c),
        `It's been a week since we finished. How is the garden settling in? If you'd like us to keep it looking this good, we offer regular maintenance visits. Just reply and I'll send the details.`,
      ),
      reason: `Checks in a week after finishing and offers maintenance.`,
    }),
  },
  {
    key: "maintenance_visit",
    label: "Visit reminder",
    stage: "maintenance",
    audience: "customer",
    trustTier: "automatic",
    anchor: next,
    when: (c) => (c.job.nextActionAt ? londonAt(c.job.nextActionAt, -1, 18) : null),
    compose: (c) => ({
      body: letter(
        c,
        firstName(c),
        `${c.crewLead ? `${c.crewLead.name} will` : "We'll"} be with you tomorrow for your garden visit. Nothing you need to do.`,
      ),
      reason: `Reminds ${firstName(c)} the evening before each visit.`,
    }),
  },
  {
    key: "maintenance_renewal",
    label: "Maintenance renewal",
    stage: "maintenance",
    audience: "customer",
    trustTier: "always_ask",
    anchor: (c) => new Date(c.stageEnteredAt.getTime() + 365 * DAY_MS),
    when: (c) => londonAt(new Date(c.stageEnteredAt.getTime() + 335 * DAY_MS), 0, 10),
    compose: (c) => {
      const renews = new Date(c.stageEnteredAt.getTime() + 365 * DAY_MS);
      return {
        body: letter(
          c,
          firstName(c),
          `Your year of garden care with us renews on ${longDay(renews)}. We'd love to keep looking after it. Shall we carry on as before?`,
        ),
        reason: `${firstName(c)}'s maintenance plan renews on ${shortDay(renews)}.`,
      };
    },
  },
];

export const RULES_BY_KEY: ReadonlyMap<string, Rule> = new Map(RULES.map((r) => [r.key, r]));

/** "quote_follow_up" or "maintenance_visit:2026-10-02" (one instance per anchor date). */
export function instanceKey(rule: Rule, ctx: RuleContext): string | null {
  if (!rule.anchor) return rule.key;
  const a = rule.anchor(ctx);
  return a ? `${rule.key}:${londonDateKey(a)}` : null;
}

export function ruleOf(ruleKey: string): Rule | undefined {
  return RULES_BY_KEY.get(ruleKey.split(":")[0]);
}
