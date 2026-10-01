/**
 * Plain words for the owner app. The owner reads "Quote sent 6 days ago", never a status code.
 * Pure (no DB) so every phrase is unit-tested; all dates are shown in London time.
 */
import type { CrmStage } from "@/lib/crm";

const TZ = "Europe/London";
const DAY = 86_400_000;

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "numeric",
  hourCycle: "h23",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "long",
});
const shortFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const longDateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Whole London calendar days from a to b (b later = positive). */
export function calendarDaysBetween(a: Date, b: Date): number {
  const [ay, am, ad] = dayKey.format(a).split("-").map(Number);
  const [by, bm, bd] = dayKey.format(b).split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

export const clockTime = (d: Date) => timeFmt.format(d);
const hasTime = (d: Date) => clockTime(d) !== "00:00";

export function greeting(now: Date, name?: string | null): string {
  const h = Number(hourFmt.format(now));
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export const todayLabel = (now: Date) => longDateFmt.format(now);

/** "just now", "2 hours ago", "yesterday", "6 days ago", "3 weeks ago". */
export function ago(d: Date, now: Date): string {
  const ms = now.getTime() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m} min ago`;
  }
  const days = calendarDaysBetween(d, now);
  if (days === 0) {
    const h = Math.floor(ms / 3600_000);
    return h <= 1 ? "an hour ago" : `${h} hours ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** "today at 10:00", "tomorrow", "Friday at 18:00", "Tue 6 Oct". */
export function when(d: Date, now: Date): string {
  const days = calendarDaysBetween(now, d);
  const at = hasTime(d) ? ` at ${clockTime(d)}` : "";
  if (days === 0) return `today${at}`;
  if (days === 1) return `tomorrow${at}`;
  if (days === -1) return `yesterday${at}`;
  if (days > 1 && days < 7) return `${weekdayFmt.format(d)}${at}`;
  return shortFmt.format(d);
}

export const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Day heading for the week planner: "Today", "Tomorrow", else "Fri 2 Oct". */
export function dayHeading(d: Date, now: Date): string {
  const days = calendarDaysBetween(now, d);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return shortFmt.format(d);
}

export type StatusInput = {
  stage: CrmStage;
  stageSince: Date;
  nextActionAt: Date | null;
  reviewAsked?: boolean;
  reviewRating?: number | null;
};

/** One line under a job row: what is true right now, in the owner's words. */
export function jobStatusLine(j: StatusInput, now: Date): string {
  const since = ago(j.stageSince, now);
  switch (j.stage) {
    case "enquiry":
      return `New enquiry · ${since}`;
    case "site_visit":
      return j.nextActionAt ? `Site visit ${when(j.nextActionAt, now)}` : "Site visit to arrange";
    case "quoted":
      return `Quote sent ${since}`;
    case "booked":
      return j.nextActionAt ? `Starts ${when(j.nextActionAt, now)}` : `Booked ${since}`;
    case "on_site": {
      const day = calendarDaysBetween(j.stageSince, now) + 1;
      return day <= 1 ? "On site · first day" : `On site · day ${day}`;
    }
    case "finished":
      if (j.reviewRating) return `Finished ${since} · rated ${j.reviewRating}★`;
      return `Finished ${since}${j.reviewAsked ? " · review asked" : ""}`;
    case "maintenance":
      return j.nextActionAt ? `Next visit ${when(j.nextActionAt, now)}` : "Maintenance · no visit booked";
    case "lost":
      return `Didn't go ahead · ${since}`;
  }
}

/** The owner's words for stages (short, as on the stepper). */
export const STAGE_WORDS: Record<CrmStage, string> = {
  enquiry: "Enquiry",
  site_visit: "Visit",
  quoted: "Quoted",
  booked: "Booked",
  on_site: "On site",
  finished: "Finished",
  maintenance: "Maintenance",
  lost: "Lost",
};

/** Section headings on the Jobs list. */
export const STAGE_GROUPS: Record<CrmStage, string> = {
  enquiry: "New enquiries",
  site_visit: "Site visits",
  quoted: "Quoted",
  booked: "Booked",
  on_site: "On site",
  finished: "Finished",
  maintenance: "Maintenance",
  lost: "Didn't go ahead",
};

/** Timeline wording for a stage change. */
export const STAGE_EVENT_WORDS: Record<CrmStage, string> = {
  enquiry: "Enquiry came in",
  site_visit: "Site visit arranged",
  quoted: "Quote sent",
  booked: "Booked in",
  on_site: "Work started",
  finished: "Work finished",
  maintenance: "Moved to maintenance",
  lost: "Marked as not going ahead",
};

/** Which date the stage asks for when moving a job there (null = none). */
export const STAGE_DATE_PROMPT: Partial<Record<CrmStage, string>> = {
  site_visit: "When is the visit?",
  booked: "When do you start?",
  on_site: "When should it be finished?",
  maintenance: "When is the next visit?",
};

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** wa.me link for a UK E.164 number, optionally with a draft message. */
export function whatsappLink(phone: string, text?: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** "+447700900101" → "07700 900101" (how people say UK mobiles). */
export function prettyPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = phone.match(/^\+44(7\d{3})(\d{6})$/);
  return m ? `0${m[1]} ${m[2]}` : phone;
}
