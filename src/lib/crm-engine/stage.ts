/**
 * Moving a job between CRM stages: record who moved it, then bring the job's planned messages in line with
 * the new situation (cancel what no longer applies, schedule what now does). Safe to call repeatedly.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job, JobStageEvent, ScheduledMessage } from "@/db/schema";
import { CRM_STAGES, type CrmStage } from "@/lib/crm";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { cancelHeldMessage } from "@/lib/messaging";
import { loadRuleContext } from "./context";
import { projectFormLink } from "./forms-link";
import { notifyOwner } from "./notify";
import { planMessages, type Planned } from "./plan";

export class StageError extends Error {}

/** Statuses a plan may still change. Sent and skipped rows are history: never touched again. */
const OPEN = ["scheduled", "awaiting_approval"] as const;

export type MoveResult = {
  job: Job;
  event: JobStageEvent | null;
  planned: Planned[];
  cancelled: number;
};

export type MoveOptions = {
  now?: Date;
  /**
   * The date that matters in the new stage: site visit, start date or next maintenance visit.
   * Omit to keep the current one when re-planning the same stage; `null` clears it.
   */
  at?: Date | null;
};

export async function moveJobToStage(
  jobId: string,
  stage: CrmStage,
  actor: string,
  note?: string | null,
  opts: MoveOptions = {},
): Promise<MoveResult> {
  if (!CRM_STAGES.includes(stage)) throw new StageError(`Unknown stage "${stage}"`);
  const now = opts.now ?? new Date();
  const db = await getDb();
  const [before] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!before) throw new StageError("Job not found");

  const changed = before.stage !== stage;
  const hasHistory =
    (
      await db
        .select({ id: schema.jobStageEvents.id })
        .from(schema.jobStageEvents)
        .where(eq(schema.jobStageEvents.jobId, jobId))
        .limit(1)
    ).length > 0;
  const nextActionAt = opts.at !== undefined ? opts.at : changed ? null : before.nextActionAt;

  const [job] = await db
    .update(schema.jobs)
    .set({ stage, nextActionAt, updatedAt: now })
    .where(eq(schema.jobs.id, jobId))
    .returning();

  let event: JobStageEvent | null = null;
  if (changed || !hasHistory) {
    [event] = await db
      .insert(schema.jobStageEvents)
      .values({
        id: newId("jse"),
        tenantId: job.tenantId,
        jobId,
        fromStage: hasHistory || changed ? before.stage : null,
        toStage: stage,
        actor,
        note: note?.trim() || null,
        createdAt: now,
      })
      .returning();
    await logEvent({
      tenantId: job.tenantId,
      type: "job.stage_changed",
      entity: "job",
      entityId: jobId,
      actor,
      data: { from: before.stage, to: stage },
    });
  }

  const { planned, cancelled } = await replan(job, now, event ? now : undefined);
  if (event) await announce(job, before.stage, actor);
  return { job, event, planned, cancelled };
}

/** Recompute the job's planned messages (e.g. after its visit date changed). */
export async function replan(
  job: Job,
  now: Date,
  enteredAt?: Date,
): Promise<{ planned: Planned[]; cancelled: number }> {
  const db = await getDb();
  const existing = await db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.jobId, job.id));
  const needsForm = job.stage === "enquiry" && !existing.some((r) => r.ruleKey === "enquiry_ack");
  const ctx = await loadRuleContext(job, {
    now,
    enteredAt,
    projectForm: needsForm ? await projectFormLink(job) : existingFormLink(existing),
  });
  const planned = planMessages(ctx);
  const keep = planned.map((p) => p.ruleKey);

  // 1. Cancel open messages that no longer apply (and pull back any that are held in the outbox).
  const stale = await db
    .update(schema.scheduledMessages)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.scheduledMessages.jobId, job.id),
        inArray(schema.scheduledMessages.status, [...OPEN]),
        keep.length ? notInArray(schema.scheduledMessages.ruleKey, keep) : undefined,
      ),
    )
    .returning();
  for (const row of stale) if (row.messageId) await cancelHeldMessage(row.messageId, "crm").catch(() => undefined);

  // 2. Schedule (or reschedule) what applies now. Sent/skipped/awaiting rows keep their decision.
  for (const p of planned) {
    await db
      .insert(schema.scheduledMessages)
      .values({
        id: newId("sch"),
        tenantId: job.tenantId,
        jobId: job.id,
        customerId: p.customerId,
        crewId: p.crewId,
        audience: p.audience,
        ruleKey: p.ruleKey,
        trustTier: p.trustTier,
        sendAt: p.sendAt,
        status: "scheduled",
        reason: p.reason,
        body: p.body,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.scheduledMessages.jobId, schema.scheduledMessages.ruleKey],
        set: {
          sendAt: p.sendAt,
          body: p.body,
          reason: p.reason,
          trustTier: p.trustTier,
          status: "scheduled",
          messageId: null,
          customerId: p.customerId,
          crewId: p.crewId,
        },
        setWhere: sql`${schema.scheduledMessages.status} in ('scheduled', 'cancelled')`,
      });
  }
  return { planned, cancelled: stale.length };
}

/** Keep the same form link in a re-planned acknowledgement (never mint a second form). */
function existingFormLink(rows: ScheduledMessage[]): string | null {
  const ack = rows.find((r) => r.ruleKey === "enquiry_ack");
  return ack?.body?.match(/https?:\/\/\S+\/f\/[A-Za-z0-9_-]+/)?.[0] ?? null;
}

/** Instant owner notifications for stage changes someone else made. */
async function announce(job: Job, from: CrmStage, actor: string): Promise<void> {
  if (actor === "owner") return;
  const db = await getDb();
  const [c] = job.customerId
    ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
    : [];
  const who = c?.firstName ?? "Someone";
  if (job.stage === "enquiry") {
    await notifyOwner(
      job.tenantId,
      "new_enquiry",
      `New enquiry from ${who}${job.area ? ` in ${job.area}` : ""}. Open GardenProof to reply.`,
    );
  } else if (job.stage === "booked" && from === "quoted" && actor === "customer") {
    await notifyOwner(job.tenantId, "quote_accepted", `${who} accepted the quote${job.area ? ` (${job.area})` : ""}.`);
  }
}

/**
 * What moving a job would plan, without changing anything (the owner sees this before confirming).
 * The enquiry form link is not minted for a preview.
 */
export async function previewStageMove(
  jobId: string,
  stage: CrmStage,
  at: Date | null | undefined,
  now = new Date(),
): Promise<Planned[]> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new StageError("Job not found");
  const changed = job.stage !== stage;
  const draft: Job = {
    ...job,
    stage,
    nextActionAt: at !== undefined ? at : changed ? null : job.nextActionAt,
  };
  const ctx = await loadRuleContext(draft, {
    now,
    enteredAt: changed ? now : undefined,
  });
  return planMessages(ctx);
}
