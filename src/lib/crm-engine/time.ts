/**
 * Wall-clock helpers for Europe/London. Messages are planned in the owner's local time ("the day before at 18:00")
 * and must survive BST/GMT changes, so we never add fixed hour offsets to UTC.
 */
export const TZ = "Europe/London";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type LondonParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function londonParts(d: Date): LondonParts {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
  };
}

/** "2026-09-24" in London. */
export function londonDateKey(d: Date): string {
  const p = londonParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset of London from UTC at instant `d`, in ms (0 in winter, 3600000 in summer). */
function offsetMs(d: Date): number {
  const p = londonParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(d.getTime() / 60_000) * 60_000;
}

/**
 * The instant at London wall time hour:minute on the London calendar day of `base`, shifted by `dayOffset` days.
 * e.g. londonAt(visit, -1, 18) = "the evening before the visit at 6pm".
 */
export function londonAt(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const p = londonParts(base);
  const guess = Date.UTC(p.year, p.month - 1, p.day + dayOffset, hour, minute);
  const first = guess - offsetMs(new Date(guess));
  // Re-check once: the offset at the result can differ from the guess on DST change days.
  return new Date(guess - offsetMs(new Date(first)));
}

export const QUIET_START_HOUR = 20;
export const QUIET_END = { hour: 8, minute: 30 };

/** True between 20:00 and 08:00 London time (no customer messages then). */
export function isQuietHour(d: Date): boolean {
  const { hour } = londonParts(d);
  return hour >= QUIET_START_HOUR || hour < 8;
}

/** Push a customer message out of quiet hours to 08:30 the next morning (or this morning if after midnight). */
export function outsideQuietHours(d: Date): Date {
  if (!isQuietHour(d)) return d;
  const { hour } = londonParts(d);
  return londonAt(d, hour >= QUIET_START_HOUR ? 1 : 0, QUIET_END.hour, QUIET_END.minute);
}

export const DAY_MS = 24 * 3600_000;
