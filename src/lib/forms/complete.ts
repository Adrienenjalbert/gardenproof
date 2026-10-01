/**
 * What a finished form does. Database writes run inside the completion transaction (all or nothing);
 * notifications and CRM hooks run after commit and never fail the homeowner's submit.
 *
 * - enquiry           -> customer (find-or-create by phone) + job at stage "enquiry" + lead (with attribution),
 *                        owner told instantly ("new_enquiry")
 * - project_brief     -> kept on the form response (the owner app reads it by job); audit event
 * - maintenance_visit -> owner told instantly only when something isn't right ("customer_needs_owner")
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Customer } from "@/db/schema";
import { assetIdCandidates, attributionColumns, attributionJson, TouchSchema, type LeadPayload } from "@/app/api/leads/lead";
import { DEFAULT_NOTIFICATIONS } from "@/lib/crm";
import type { Team } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { newId, newJobCode } from "@/lib/ids";
import { sendMessage } from "@/lib/messaging";
import { MAINTENANCE_SERVICE, VISIT_FEEDBACK_GREAT } from "./definitions";
import { describeAnswer, findStep, pruneAnswers, summarise } from "./engine";
import type { LoadedForm } from "./store";
import type { Answers, CompletionResult, ContactValue, PostcodeValue } from "./types";

type Ctx = { form: LoadedForm; now: Date };

/** "Thorburn Landscapes" -> "TL" (job codes crews can say out loud). */
export const jobCodePrefix = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "GP";

async function uniqueJobCode(tx: Tx, tenantId: string, prefix: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = newJobCode(prefix);
    const [hit] = await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.tenantId, tenantId), eq(schema.jobs.code, code)));
    if (!hit) return code;
  }
  throw new Error("Could not allocate a job code");
}

/** Same find-or-create rule (and advisory lock key) as lib/customers.ts: phones are unique per tenant. */
async function findOrCreateCustomer(tx: Tx, tenantId: string, contact: ContactValue, place: PostcodeValue | null): Promise<Customer> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer:${tenantId}:${contact.phone}`}))`);
  const [existing] = await tx
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, contact.phone)))
    .orderBy(desc(schema.customers.createdAt))
    .limit(1);
  if (existing) {
    const patch: Partial<Customer> = {};
    if (!existing.firstName) patch.firstName = contact.firstName;
    if (!existing.lastName && contact.lastName) patch.lastName = contact.lastName;
    if (!existing.email && contact.email) patch.email = contact.email;
    if (!existing.postcode && place) patch.postcode = place.postcode;
    if (!existing.area && place?.area) patch.area = place.area;
    if (!Object.keys(patch).length) return existing;
    const [row] = await tx.update(schema.customers).set(patch).where(eq(schema.customers.id, existing.id)).returning();
    return row;
  }
  const [row] = await tx
    .insert(schema.customers)
    .values({
      id: newId("cus"),
      tenantId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      email: contact.email,
      postcode: place?.postcode ?? null,
      area: place?.area ?? null,
    })
    .returning();
  return row;
}

function labelOf(form: LoadedForm, answers: Answers, stepId: string): string | null {
  const step = findStep(form.definition, stepId);
  return step ? describeAnswer(step, answers[stepId]) : null;
}

/** Plain-English brief for the job card and the lead message. */
export function enquiryBrief(form: LoadedForm, answers: Answers): string {
  return summarise(form.definition, answers)
    .filter((l) => l.id !== "contact" && l.id !== "postcode")
    .map((l) => `${l.label}: ${l.value}`)
    .join("\n");
}

async function completeEnquiry(tx: Tx, { form, now }: Ctx, answers: Answers): Promise<CompletionResult> {
  const tenantId = form.tenant.id;
  const contact = answers.contact as ContactValue;
  const place = (answers.postcode as PostcodeValue | undefined) ?? null;
  const customer = await findOrCreateCustomer(tx, tenantId, contact, place);

  const services = ((answers.services as string[] | undefined) ?? []).filter((s) => s !== "unsure");
  const team: Team = services.length === 1 && services[0] === MAINTENANCE_SERVICE ? "maintenance" : "landscaping";
  const serviceLabel = labelOf(form, { services }, "services");
  const brief = enquiryBrief(form, answers);

  const jobId = newId("job");
  await tx.insert(schema.jobs).values({
    id: jobId,
    tenantId,
    code: await uniqueJobCode(tx, tenantId, jobCodePrefix(form.tenant.name)),
    customerId: customer.id,
    // Content-pipeline status: "captured" keeps an enquiry out of the crew's open captures ("capturing").
    status: "captured",
    stage: "enquiry",
    valueBand: answers.budget ? labelOf(form, answers, "budget") : null,
    team,
    service: services[0] ?? null,
    postcode: place?.postcode ?? null,
    area: place?.area ?? null,
    title: [serviceLabel || "Garden enquiry", place?.area].filter(Boolean).join(", "),
    brief,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const touches = form.meta.attribution ?? {};
  const first = TouchSchema.safeParse(touches.first ?? undefined);
  const last = TouchSchema.safeParse(touches.last ?? undefined);
  const lead: Pick<LeadPayload, "first" | "last"> = { first: first.success ? first.data : undefined, last: last.success ? last.data : undefined };
  const candidates = assetIdCandidates(lead);
  const matched = candidates.length
    ? await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.tenantId, tenantId), inArray(schema.assets.id, candidates)))
    : [];
  const columns = attributionColumns(lead);
  const leadId = newId("lead");
  await tx.insert(schema.leads).values({
    id: leadId,
    tenantId,
    ...columns,
    // No tracker touch at all: the form's own source ("directory", "gbp", "whatsapp"…) is the best we know.
    source: lead.first || lead.last ? columns.source : (form.row.source ?? columns.source),
    projectSlug: form.meta.projectSlug ?? null,
    assetId: candidates.find((id) => matched.some((m) => m.id === id)) ?? null,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    email: contact.email,
    phone: contact.phone,
    postcode: place?.postcode ?? null,
    service: services[0] ?? null,
    message: brief,
    attribution: { ...attributionJson(lead), formId: form.row.id },
    createdAt: now,
  });
  return { customerId: customer.id, jobId, leadId };
}

export async function applyCompletion(tx: Tx, ctx: Ctx): Promise<{ answers: Answers; result: CompletionResult }> {
  const answers = pruneAnswers(ctx.form.definition, ctx.form.answers);
  switch (ctx.form.kind) {
    case "enquiry":
      return { answers, result: await completeEnquiry(tx, ctx, answers) };
    case "maintenance_visit":
      return { answers, result: { urgent: answers.feeling !== VISIT_FEEDBACK_GREAT } };
    case "project_brief":
      return { answers, result: {} };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// After commit
// ---------------------------------------------------------------------------------------------------------------
async function ownerPhones(tenantId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ phone: schema.crewMembers.phone, teamRole: schema.crewMembers.teamRole, role: schema.crewMembers.role })
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, tenantId), eq(schema.crewMembers.active, true)));
  const owners = rows.filter((r) => r.teamRole === "owner");
  return (owners.length ? owners : rows.filter((r) => r.role === "owner")).slice(0, 1).map((r) => r.phone);
}

type CrmNotify = (tenantId: string, kind: "new_enquiry" | "customer_needs_owner", text: string) => Promise<unknown>;

/**
 * Best effort owner WhatsApp. The CRM engine's `notifyOwner` (instant vs evening digest, per the owner's
 * settings) is used when present; otherwise we honour the "tell me instantly" list ourselves.
 */
export async function notifyOwner(form: Pick<LoadedForm, "tenant">, kind: "new_enquiry" | "customer_needs_owner", body: string, meta: Record<string, unknown>): Promise<void> {
  try {
    const mod = (await import("@/lib/crm-engine")) as Record<string, unknown>;
    if (typeof mod.notifyOwner === "function") {
      await (mod.notifyOwner as CrmNotify)(form.tenant.id, kind, body);
      return;
    }
  } catch (err) {
    console.error("[forms] CRM owner notification failed; sending directly", err);
  }
  const instant = form.tenant.settings?.notifications?.instant ?? DEFAULT_NOTIFICATIONS.instant;
  if (!instant.includes(kind)) return;
  for (const to of await ownerPhones(form.tenant.id)) {
    try {
      await sendMessage({ tenantId: form.tenant.id, to, body, audience: "owner", meta: { kind, ...meta } });
    } catch (err) {
      console.error("[forms] owner notification failed", err);
    }
  }
}

type MoveJobToStage = (jobId: string, stage: "enquiry", actor: string, note?: string | null) => Promise<unknown>;

/**
 * Put the new job through the CRM engine when it offers `moveJobToStage` (it records the stage event, schedules
 * the acknowledgement/follow-ups and tells the owner). Returns false when it isn't available, so the caller
 * records the stage and notifies the owner itself.
 */
async function moveThroughCrm(jobId: string): Promise<boolean> {
  try {
    const mod = (await import("@/lib/crm-engine")) as Record<string, unknown>;
    if (typeof mod.moveJobToStage !== "function") return false;
    await (mod.moveJobToStage as MoveJobToStage)(jobId, "enquiry", "customer", "Enquiry form");
    return true;
  } catch (err) {
    console.error("[forms] CRM engine stage move failed; recording the stage directly", err);
    return false;
  }
}

export async function afterCompletion({ form, result }: { form: LoadedForm; result: CompletionResult }): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(schema.formResponses).where(eq(schema.formResponses.id, form.row.id));
  const answers = row?.answers ?? {};
  const contact = answers.contact as ContactValue | undefined;

  if (form.kind === "enquiry" && result.jobId) {
    const viaCrm = await moveThroughCrm(result.jobId);
    await logEvent({ tenantId: form.tenant.id, type: "lead.received", entity: "lead", entityId: result.leadId ?? undefined, actor: "customer", data: { formId: form.row.id, jobId: result.jobId, source: form.row.source } });
    const place = answers.postcode as PostcodeValue | undefined;
    const who = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ");
    const lines = summarise(form.definition, answers).filter((l) => !["contact", "postcode", "photos"].includes(l.id));
    const body = [
      `New enquiry: ${who}${place?.area ? ` in ${place.area}` : ""}`,
      ...lines.map((l) => `${l.label}: ${l.value}`),
      answers.photos ? `Photos: ${(answers.photos as unknown[]).length} added` : null,
      contact ? `Call ${contact.phone}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    if (!viaCrm) {
      await db.insert(schema.jobStageEvents).values({ id: newId("jse"), tenantId: form.tenant.id, jobId: result.jobId, fromStage: null, toStage: "enquiry", actor: "customer", note: "Enquiry form" });
      await notifyOwner(form, "new_enquiry", body, { jobId: result.jobId, formId: form.row.id });
    }
  }

  if (form.kind === "maintenance_visit" && result.urgent) {
    const [customer] = form.row.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, form.row.customerId)) : [];
    const lines = summarise(form.definition, answers).map((l) => `${l.label}: ${l.value}`);
    const name = customer?.firstName ?? "A customer";
    await notifyOwner(form, "customer_needs_owner", [`${name} isn't happy with today's visit${customer?.area ? ` (${customer.area})` : ""}.`, ...lines, customer?.phone ? `Call ${customer.phone}` : null].filter(Boolean).join("\n"), {
      jobId: form.row.jobId,
      formId: form.row.id,
    });
  }
}
