/**
 * Smart-form persistence. One form_responses row per link; every answer is saved the moment it is given, so the
 * same link resumes on any device. Tokens are the only credential: unguessable, scoped to one response.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FormResponse, Tenant } from "@/db/schema";
import { env } from "@/lib/config";
import type { FormKind } from "@/lib/crm";
import { logEvent } from "@/lib/events";
import { newId, newToken } from "@/lib/ids";
import { getTenant } from "@/lib/tenants";
import { profileFor, resolveBrand, type FormBrand } from "./brand";
import { afterCompletion, applyCompletion } from "./complete";
import { buildDefinition, isSmartFormKind, type SmartFormKind } from "./definitions";
import { currentIndex, findStep, missingSteps, normalisePostcode, publicAnswers, remainingCount, validateAnswer, visibleSteps } from "./engine";
import { formPhotoExists } from "./photos";
import { resolvePostcode } from "./postcode";
import type { Answers, CompletionResult, FormDefinition, FormMeta, Prefill } from "./types";

export type FormErrorCode = "not_found" | "completed" | "invalid" | "unknown_step" | "incomplete" | "unsupported";

export class FormError extends Error {
  constructor(
    readonly code: FormErrorCode,
    message: string,
    readonly details: { stepId?: string; path?: string } = {},
  ) {
    super(message);
    this.name = "FormError";
  }
}

export const formUrl = (token: string) => `${env.appUrl.replace(/\/$/, "")}/f/${token}`;

const metaOf = (answers: Answers): FormMeta => (answers._meta && typeof answers._meta === "object" ? (answers._meta as FormMeta) : {});

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------
export type CreateFormLinkInput = {
  tenantId: string;
  kind: FormKind;
  customerId?: string | null;
  jobId?: string | null;
  /** Anything already known (WhatsApp profile name, phone, postcode, service from the link). */
  prefill?: Prefill;
  /** "whatsapp" | "web" | "directory" | "gbp" | utm source… */
  source?: string | null;
  attribution?: FormMeta["attribution"];
  projectSlug?: string | null;
};

export async function createFormLink(input: CreateFormLinkInput): Promise<{ id: string; token: string; url: string }> {
  if (!isSmartFormKind(input.kind)) throw new FormError("unsupported", "Reviews use their own link (/r/<token>)");
  const db = await getDb();
  let prefill: Prefill = { ...(input.prefill ?? {}) };
  if (input.customerId) {
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, input.customerId));
    if (!c || c.tenantId !== input.tenantId) throw new FormError("invalid", "Unknown customer");
    // What we hold on file fills gaps; an explicit prefill (fresher, from the chat) wins.
    prefill = {
      firstName: prefill.firstName ?? c.firstName,
      lastName: prefill.lastName ?? c.lastName,
      phone: prefill.phone ?? c.phone,
      email: prefill.email ?? c.email,
      postcode: prefill.postcode ?? c.postcode,
      service: prefill.service ?? null,
    };
  }
  if (input.jobId) {
    const [j] = await db.select({ tenantId: schema.jobs.tenantId, postcode: schema.jobs.postcode }).from(schema.jobs).where(eq(schema.jobs.id, input.jobId));
    if (!j || j.tenantId !== input.tenantId) throw new FormError("invalid", "Unknown job");
    prefill.postcode = prefill.postcode ?? j.postcode;
  }
  const meta: FormMeta = {
    prefill: Object.fromEntries(Object.entries(prefill).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Prefill,
    attribution: input.attribution ?? null,
    projectSlug: input.projectSlug ?? null,
  };
  const id = newId("frm");
  const token = newToken();
  await db.insert(schema.formResponses).values({
    id,
    tenantId: input.tenantId,
    kind: input.kind,
    token,
    customerId: input.customerId ?? null,
    jobId: input.jobId ?? null,
    answers: { _meta: meta },
    source: input.source ?? null,
  });
  await logEvent({ tenantId: input.tenantId, type: "form.created", entity: "form", entityId: id, data: { kind: input.kind, source: input.source ?? null } });
  return { id, token, url: formUrl(token) };
}

// ---------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------
export type LoadedForm = {
  row: FormResponse;
  tenant: Tenant;
  kind: SmartFormKind;
  definition: FormDefinition;
  brand: FormBrand;
  answers: Answers; // public answers only
  meta: FormMeta;
  index: number;
  remaining: number;
  completed: boolean;
};

async function rowByToken(token: string): Promise<FormResponse | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.formResponses).where(eq(schema.formResponses.token, token));
  return row ?? null;
}

async function load(row: FormResponse): Promise<LoadedForm> {
  if (!isSmartFormKind(row.kind)) throw new FormError("unsupported", "Not a smart form");
  const tenant = await getTenant(row.tenantId);
  const { brand, context } = await resolveBrand(tenant);
  const definition = buildDefinition(row.kind, context);
  const answers = publicAnswers(row.answers);
  return {
    row,
    tenant,
    kind: row.kind,
    definition,
    brand,
    answers,
    meta: metaOf(row.answers),
    index: currentIndex(definition, answers),
    remaining: remainingCount(definition, answers),
    completed: row.completedAt !== null,
  };
}

export async function getForm(token: string): Promise<LoadedForm | null> {
  const row = await rowByToken(token);
  if (!row || !isSmartFormKind(row.kind)) return null;
  return load(row);
}

async function mustLoad(token: string): Promise<LoadedForm> {
  const form = await getForm(token);
  if (!form) throw new FormError("not_found", "This link doesn't look right");
  return form;
}

/** Starting values for the runner (never stored as answers until the person confirms them). */
export function initialValues(form: Pick<LoadedForm, "definition" | "meta">): Answers {
  const p = form.meta.prefill ?? {};
  const out: Answers = {};
  for (const step of form.definition.steps) {
    if (step.kind === "contact" && (p.firstName || p.phone)) {
      out[step.id] = { firstName: p.firstName ?? "", lastName: p.lastName ?? "", phone: p.phone ?? "", email: p.email ?? "", consent: false };
    }
    if (step.kind === "postcode" && p.postcode) out[step.id] = { postcode: normalisePostcode(p.postcode) ?? p.postcode };
    if (step.kind === "choice" && step.id === "services" && p.service) {
      const picks = p.service.split(",").filter((v) => step.options.some((o) => o.value === v && !o.exclusive));
      if (picks.length) out[step.id] = step.multiple ? picks : picks[0];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Save one answer
// ---------------------------------------------------------------------------------------------------------------
export type SaveResult = { value: unknown; answers: Answers; index: number; remaining: number; total: number };

/** Server-side enrichment + validation of one answer (postcode lookup, photo ownership). */
async function normaliseValue(form: LoadedForm, stepId: string, value: unknown, fetchImpl?: typeof fetch): Promise<unknown> {
  const step = findStep(form.definition, stepId);
  if (!step) throw new FormError("unknown_step", "Unknown question", { stepId });
  if (step.kind === "postcode" && value !== null) {
    const raw = typeof value === "string" ? value : typeof value === "object" && value && "postcode" in value ? String((value as { postcode: unknown }).postcode) : "";
    if (!normalisePostcode(raw)) throw new FormError("invalid", "That doesn't look like a UK postcode", { stepId, path: "postcode" });
    const resolved = await resolvePostcode(raw, form.tenant.config, profileFor(form.tenant), fetchImpl);
    if (!resolved) throw new FormError("invalid", "We couldn't find that postcode. Could you check it?", { stepId, path: "postcode" });
    value = resolved;
  }
  const checked = validateAnswer(step, value);
  if (!checked.ok) throw new FormError("invalid", checked.error, { stepId, path: checked.path });
  if (step.kind === "photos" && Array.isArray(checked.value)) {
    for (const p of checked.value as { id: string }[]) {
      if (!(await formPhotoExists(form.row.id, p.id))) throw new FormError("invalid", "A photo didn't finish uploading", { stepId });
    }
  }
  return checked.value;
}

export async function saveAnswer(token: string, stepId: string, value: unknown, opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<SaveResult> {
  if (stepId.startsWith("_")) throw new FormError("unknown_step", "Unknown question", { stepId });
  const form = await mustLoad(token);
  if (form.completed) throw new FormError("completed", "This form has already been sent");
  const stored = await normaliseValue(form, stepId, value, opts.fetchImpl);

  const db = await getDb();
  const merged = await db.transaction(async (tx) => {
    // Row lock: two quick taps from two tabs must not lose each other's answers.
    const [row] = await tx.select().from(schema.formResponses).where(eq(schema.formResponses.id, form.row.id)).for("update");
    if (!row || row.completedAt) throw new FormError("completed", "This form has already been sent");
    const answers = { ...row.answers, [stepId]: stored };
    await tx
      .update(schema.formResponses)
      .set({ answers, step: currentIndex(form.definition, publicAnswers(answers)), updatedAt: opts.now ?? new Date() })
      .where(eq(schema.formResponses.id, row.id));
    return publicAnswers(answers);
  });
  return {
    value: stored,
    answers: merged,
    index: currentIndex(form.definition, merged),
    remaining: remainingCount(form.definition, merged),
    total: visibleSteps(form.definition, merged).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------------------------------------------
export type CompleteResult = { alreadyCompleted: boolean; result: CompletionResult };

/** Idempotent: a second call (double tap, WhatsApp Flow + web) returns the first result and does nothing. */
export async function completeForm(token: string, opts: { now?: Date; source?: string } = {}): Promise<CompleteResult> {
  const form = await mustLoad(token);
  if (form.completed) return { alreadyCompleted: true, result: form.meta.result ?? {} };
  const missing = missingSteps(form.definition, form.answers);
  if (missing.length) throw new FormError("incomplete", "A couple of questions still need an answer", { stepId: missing[0].id });

  const now = opts.now ?? new Date();
  const db = await getDb();
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.formResponses).where(eq(schema.formResponses.id, form.row.id)).for("update");
    if (!row) throw new FormError("not_found", "This link doesn't look right");
    if (row.completedAt) return { already: true as const, result: metaOf(row.answers).result ?? {} };
    const applied = await applyCompletion(tx, { form: { ...form, row }, now });
    const answers = { ...applied.answers, _meta: { ...metaOf(row.answers), result: applied.result } };
    await tx
      .update(schema.formResponses)
      .set({
        answers,
        completedAt: now,
        updatedAt: now,
        customerId: applied.result.customerId ?? row.customerId,
        jobId: applied.result.jobId ?? row.jobId,
        step: currentIndex(form.definition, applied.answers),
        ...(opts.source && !row.source ? { source: opts.source } : {}),
      })
      .where(eq(schema.formResponses.id, row.id));
    return { already: false as const, result: applied.result };
  });
  if (outcome.already) return { alreadyCompleted: true, result: outcome.result };

  await logEvent({ tenantId: form.tenant.id, type: "form.completed", entity: "form", entityId: form.row.id, actor: "customer", data: { kind: form.kind, ...outcome.result } });
  await afterCompletion({ form, result: outcome.result });
  return { alreadyCompleted: false, result: outcome.result };
}
