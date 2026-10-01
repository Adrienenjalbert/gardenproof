/**
 * Pure form engine: skip logic, per-step validation (zod), progress. No database or Node imports, so the
 * client runner uses exactly the same rules as the API (the server always re-validates).
 */
import { z } from "zod";
import { parseUkMobile } from "@/lib/messaging/format";
import type { Answers, Condition, FormDefinition, FormStep } from "./types";

export const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;

/** "sw19 5ab" / "SW195AB" -> "SW19 5AB"; null when it isn't a UK postcode. */
export function normalisePostcode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** UK mobiles in any common format, or an international E.164 number. Landlines are refused (WhatsApp). */
export function normaliseMobile(raw: string): string | null {
  const uk = parseUkMobile(raw);
  if (uk) return uk;
  const compact = raw.trim().replace(/[\s().-]/g, "");
  return /^\+(?!44)[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Skip logic
// ---------------------------------------------------------------------------------------------------------------
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

export function conditionHolds(c: Condition, answers: Answers): boolean {
  const v = answers[c.step];
  const list = asList(v);
  switch (c.op) {
    case "answered":
      return v !== undefined && v !== null;
    case "eq":
      return v === c.value;
    case "neq":
      return v !== c.value;
    case "includes":
      return list.includes(c.value);
    case "excludes":
      return !list.includes(c.value);
    case "only":
      return list.length === 1 && list[0] === c.value;
    case "notOnly":
      return !(list.length === 1 && list[0] === c.value);
  }
}

export const isVisible = (step: FormStep, answers: Answers) => (step.when ?? []).every((c) => conditionHolds(c, answers));

export const visibleSteps = (def: FormDefinition, answers: Answers) => def.steps.filter((s) => isVisible(s, answers));

/** Stored at all (a skipped optional step is stored as null and counts as answered). */
export const isAnswered = (step: FormStep, answers: Answers) => Object.prototype.hasOwnProperty.call(answers, step.id);

/** Index (among visible steps) of the first unanswered step; equals the visible length when all are done. */
export function currentIndex(def: FormDefinition, answers: Answers): number {
  const steps = visibleSteps(def, answers);
  const i = steps.findIndex((s) => !isAnswered(s, answers));
  return i === -1 ? steps.length : i;
}

export function remainingCount(def: FormDefinition, answers: Answers): number {
  return visibleSteps(def, answers).filter((s) => !isAnswered(s, answers)).length;
}

/** Required visible steps still missing a valid answer (what blocks completion). */
export function missingSteps(def: FormDefinition, answers: Answers): FormStep[] {
  return visibleSteps(def, answers).filter((s) => {
    const v = answers[s.id];
    if (v === undefined || v === null) return !s.optional;
    return !validateAnswer(s, v).ok;
  });
}

/** Drop answers to steps that ended up hidden (changed their mind) and server metadata. */
export function pruneAnswers(def: FormDefinition, answers: Answers): Answers {
  const keep = new Set(visibleSteps(def, answers).map((s) => s.id));
  return Object.fromEntries(Object.entries(answers).filter(([k]) => keep.has(k)));
}

/** Everything but `_meta` & co: what the browser may see. */
export const publicAnswers = (answers: Answers): Answers =>
  Object.fromEntries(Object.entries(answers).filter(([k]) => !k.startsWith("_")));

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PHOTO_ID = /^ph_[A-Za-z0-9_-]{8,40}$/;

function oneOf(values: string[], message = "Please choose one of the options") {
  return z.string().refine((v) => values.includes(v), { message });
}

function manyOf(values: string[], max: number | undefined, min: number) {
  return z
    .array(oneOf(values))
    .min(min, { message: "Pick at least one" })
    .max(max ?? values.length, { message: `Pick up to ${max ?? values.length}` })
    .refine((a) => new Set(a).size === a.length, { message: "Duplicate choice" });
}

/** Zod schema for one step's value (input shape as sent by the client, output as stored). */
export function schemaFor(step: FormStep, now = new Date()): z.ZodType<unknown> {
  switch (step.kind) {
    case "choice": {
      const values = step.options.map((o) => o.value);
      if (!step.multiple) return oneOf(values);
      const exclusive = new Set(step.options.filter((o) => o.exclusive).map((o) => o.value));
      return manyOf(values, step.max, 1).refine((a) => a.length === 1 || !a.some((v) => exclusive.has(v)), {
        message: "“Not sure” can't be combined with other choices",
      });
    }
    case "budget":
      return oneOf(step.options.map((o) => o.value));
    case "date": {
      const today = now.toISOString().slice(0, 10);
      const limit = new Date(now.getTime() + 2 * 365 * 86_400_000).toISOString().slice(0, 10);
      return z
        .object({
          choice: oneOf(step.options.map((o) => o.value)),
          date: z.string().regex(ISO_DATE).optional(),
        })
        .strict()
        .refine((v) => v.choice !== "date" || (step.allowDate && !!v.date), { message: "Pick a date", path: ["date"] })
        .refine((v) => !v.date || (v.date >= today && v.date <= limit), { message: "Pick a date in the next two years", path: ["date"] })
        .transform((v) => (v.choice === "date" ? v : { choice: v.choice }));
    }
    case "timeWindow":
      return z
        .object({
          days: manyOf(step.days.map((o) => o.value), undefined, 1),
          windows: manyOf(step.windows.map((o) => o.value), undefined, 1),
        })
        .strict();
    case "yesno":
      return z.boolean();
    case "text":
      return z.string().trim().min(1, { message: "Please fill this in" }).max(step.maxLength);
    case "longtext":
      return z.string().trim().min(1, { message: "Please add a few words" }).max(step.maxLength);
    case "photos":
      return z
        .array(
          z.object({ id: z.string().regex(PHOTO_ID), width: z.number().int().positive().max(10_000), height: z.number().int().positive().max(10_000) }).strict(),
        )
        .min(1, { message: "Add a photo or skip" })
        .max(step.max, { message: `Up to ${step.max} photos` });
    case "postcode":
      return z
        .object({
          postcode: z.string(),
          area: z.string().max(80).nullable().optional(),
          district: z.string().max(80).nullable().optional(),
          verified: z.boolean().optional(),
          inArea: z.boolean().optional(),
        })
        .transform((v, ctx) => {
          const postcode = normalisePostcode(v.postcode);
          if (!postcode) {
            ctx.addIssue({ code: "custom", message: "That doesn't look like a UK postcode", path: ["postcode"] });
            return z.NEVER;
          }
          return { postcode, area: v.area ?? null, district: v.district ?? null, verified: v.verified ?? false, inArea: v.inArea ?? false };
        });
    case "contact":
      return z
        .object({
          firstName: z.string().trim().min(1, { message: "Your first name, please" }).max(60),
          lastName: z.string().trim().max(60).nullish(),
          phone: z.string().max(40),
          email: z.union([z.email().max(254), z.literal("")]).nullish(),
          consent: z.literal(true, { message: "Please tick so we can get back to you" }),
        })
        .transform((v, ctx) => {
          const phone = normaliseMobile(v.phone);
          if (!phone) {
            ctx.addIssue({ code: "custom", message: "Please check your mobile number", path: ["phone"] });
            return z.NEVER;
          }
          return {
            firstName: v.firstName,
            lastName: v.lastName || null,
            phone,
            email: step.askEmail && v.email ? v.email.toLowerCase() : null,
            consent: true as const,
            consentWording: step.consentText,
          };
        });
  }
}

export type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string; path?: string };

/** Validate (and normalise) one answer. `null` is valid only for optional steps (= skipped). */
export function validateAnswer(step: FormStep, value: unknown, now = new Date()): ValidationResult {
  if (value === null) return step.optional ? { ok: true, value: null } : { ok: false, error: "This one's needed" };
  const parsed = schemaFor(step, now).safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: issue?.message ?? "Please check this answer", path: issue?.path.join(".") || undefined };
}

export function findStep(def: FormDefinition, stepId: string): FormStep | undefined {
  return def.steps.find((s) => s.id === stepId);
}

/** Human label for a stored value (owner summaries, confirmation screen, WhatsApp messages). */
export function describeAnswer(step: FormStep, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v);
  switch (step.kind) {
    case "choice":
      return asList(value).map((v) => label(step.options, v)).join(", ");
    case "budget":
      return label(step.options, value);
    case "date": {
      const d = value as { choice: string; date?: string };
      if (d.choice === "date" && d.date) {
        return new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
      }
      return label(step.options, d.choice);
    }
    case "timeWindow": {
      const t = value as { days: string[]; windows: string[] };
      return `${t.days.map((v) => label(step.days, v)).join(" or ")}, ${t.windows.map((v) => label(step.windows, v).toLowerCase()).join(" or ")}`;
    }
    case "yesno":
      return value ? (step.yes ?? "Yes") : (step.no ?? "No");
    case "text":
    case "longtext":
      return String(value);
    case "photos":
      return `${asList(value).length} photo${asList(value).length === 1 ? "" : "s"}`;
    case "postcode": {
      const p = value as { postcode: string; area: string | null };
      return p.area ? `${p.area} (${p.postcode.split(" ")[0]})` : p.postcode;
    }
    case "contact": {
      const c = value as { firstName: string; lastName: string | null; phone: string };
      return `${[c.firstName, c.lastName].filter(Boolean).join(" ")}, ${c.phone}`;
    }
  }
}

/** Visible, answered steps as label/value pairs, in form order. */
export function summarise(def: FormDefinition, answers: Answers): { id: string; label: string; value: string }[] {
  return visibleSteps(def, answers).flatMap((s) => {
    const value = describeAnswer(s, answers[s.id]);
    return value ? [{ id: s.id, label: s.short ?? s.title, value }] : [];
  });
}
