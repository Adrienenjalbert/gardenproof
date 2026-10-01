/**
 * Smart-form contracts. A form definition is plain JSON (no functions) so the same object drives the server
 * (validation, skip logic, completion) and the client runner (one question per screen), and can be mirrored
 * as a WhatsApp Flow. Answers live in form_responses.answers keyed by step id; keys starting with "_" are
 * reserved for server metadata (prefill, attribution, completion result) and are never shown to the client.
 */
import type { FormKind } from "@/lib/crm";

/** Icons the runner knows how to draw (kept small on purpose; see components/forms/glyphs.tsx). */
export type FormGlyph =
  | "sprout"
  | "ruler-s"
  | "ruler-m"
  | "ruler-l"
  | "question"
  | "sun"
  | "calendar"
  | "sparkle"
  | "leaf"
  | "house"
  | "gate"
  | "car"
  | "paw"
  | "check"
  | "wrench"
  | "thumbs-up"
  | "meh"
  | "alert"
  | "flower"
  | "patio"
  | "fence"
  | "lawn"
  | "pergola"
  | "scissors";

export type FormOption = {
  value: string;
  label: string;
  hint?: string;
  /** Real photo of the business's own work (never stock). */
  image?: string | null;
  glyph?: FormGlyph;
  /** Picking this clears every other choice ("Not sure yet"). */
  exclusive?: boolean;
};

/** Skip logic: a step is shown only when every condition holds. */
export type Condition = {
  step: string;
  op: "eq" | "neq" | "includes" | "excludes" | "only" | "notOnly" | "answered";
  value?: string | boolean;
};

type StepBase = {
  id: string;
  title: string;
  subtitle?: string;
  /** Two-word label for summaries (owner WhatsApp, confirmation screen). Defaults to the title. */
  short?: string;
  /** Optional steps show a quiet "Skip" and are stored as null when skipped. */
  optional?: boolean;
  when?: Condition[];
};

export type ChoiceStep = StepBase & {
  kind: "choice";
  multiple?: boolean;
  max?: number;
  /** photo: big image cards; tiles: 2-up glyph tiles; list: full-width rows. */
  layout: "photo" | "tiles" | "list";
  options: FormOption[];
};
export type BudgetStep = StepBase & { kind: "budget"; options: FormOption[]; note?: string };
/** Timing: quick answers plus an optional specific date (`value: "date"` option opens the calendar). */
export type DateStep = StepBase & { kind: "date"; options: FormOption[]; allowDate: boolean };
export type TimeWindowStep = StepBase & { kind: "timeWindow"; days: FormOption[]; windows: FormOption[] };
export type YesNoStep = StepBase & { kind: "yesno"; yes?: string; no?: string };
export type TextStep = StepBase & {
  kind: "text";
  placeholder?: string;
  maxLength: number;
  inputMode?: "text" | "numeric" | "tel" | "email";
  autoComplete?: string;
};
export type LongTextStep = StepBase & { kind: "longtext"; placeholder?: string; maxLength: number; voiceHint?: boolean };
export type PhotosStep = StepBase & { kind: "photos"; max: number; tips?: string[] };
export type PostcodeStep = StepBase & { kind: "postcode" };
export type ContactStep = StepBase & { kind: "contact"; askEmail: boolean; consentText: string };

export type FormStep =
  | ChoiceStep
  | BudgetStep
  | DateStep
  | TimeWindowStep
  | YesNoStep
  | TextStep
  | LongTextStep
  | PhotosStep
  | PostcodeStep
  | ContactStep;
export type StepKind = FormStep["kind"];

export type FormDefinition = {
  kind: Exclude<FormKind, "review">;
  version: number;
  /** Shown on the first screen above the first question. */
  intro: { eyebrow: string; title: string; subtitle?: string };
  steps: FormStep[];
};

// ---------------------------------------------------------------------------------------------------------------
// Stored answer values (validated by engine.ts)
// ---------------------------------------------------------------------------------------------------------------
export type DateValue = { choice: string; date?: string };
export type TimeWindowValue = { days: string[]; windows: string[] };
export type PhotoValue = { id: string; width: number; height: number };
export type PostcodeValue = {
  postcode: string;
  /** Public neighbourhood name (tenant area map first, then the local authority). */
  area: string | null;
  district: string | null;
  /** Confirmed by postcodes.io (false when the lookup was unavailable: format-checked only). */
  verified: boolean;
  /** Inside the business's usual areas. */
  inArea: boolean;
};
export type ContactValue = {
  firstName: string;
  lastName: string | null;
  phone: string; // E.164
  email: string | null;
  consent: true;
  consentWording: string;
};

export type Answers = Record<string, unknown>;

/** Server-only metadata kept under answers._meta. */
export type FormMeta = {
  prefill?: Prefill;
  attribution?: { first?: Record<string, unknown>; last?: Record<string, unknown> } | null;
  projectSlug?: string | null;
  result?: CompletionResult;
};

export type Prefill = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  postcode?: string | null;
  /** Tenant service key(s) to preselect on the first question (e.g. from ?service=patio_paving). */
  service?: string | null;
};

export type CompletionResult = { customerId?: string | null; jobId?: string | null; leadId?: string | null; urgent?: boolean };
