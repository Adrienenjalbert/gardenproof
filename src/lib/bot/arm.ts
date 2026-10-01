/**
 * Point a crew lead's WhatsApp conversation at a CRM job, so the photos they send next land on that job.
 *
 * The CRM knows when a job starts and should finish; the capture prompts ("send the before photos") are sent
 * on those days. Arming the conversation means the reply needs no "which job?" and never opens a new job code.
 * A crew lead who is mid-capture on another job is left alone: they can still type the job code to switch.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { coerceState } from "./reducer";
import { initialBotState, type BotState } from "./types";

export type ArmResult = "armed" | "busy" | "skipped";

/** Content-pipeline statuses a job can be (re)opened for capture from. Later ones are already in the pipeline. */
const REOPENABLE = new Set(["capturing", "captured"]);

export async function armCrewCapture(args: {
  jobId: string;
  crewId: string;
  stage: "before" | "after";
}): Promise<ArmResult> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, args.jobId));
  const [crew] = await db.select().from(schema.crewMembers).where(eq(schema.crewMembers.id, args.crewId));
  if (!job || !crew || !REOPENABLE.has(job.status)) return "skipped";

  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, job.tenantId), eq(schema.conversations.phone, crew.phone)));
  const current = existing ? coerceState(existing.state) : initialBotState();
  const busyElsewhere =
    current.jobId !== null && current.jobId !== job.id && current.step !== "idle" && current.step !== "pick_job";
  if (busyElsewhere) return "busy";

  if (job.status !== "capturing") {
    await db.update(schema.jobs).set({ status: "capturing", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  }
  const state: BotState = { ...initialBotState(), step: args.stage, jobId: job.id };
  if (existing) {
    await db
      .update(schema.conversations)
      .set({ role: "crew", state: state as unknown as Record<string, unknown>, activeJobId: job.id, updatedAt: new Date() })
      .where(eq(schema.conversations.id, existing.id));
  } else {
    await db.insert(schema.conversations).values({
      id: newId("cnv"),
      tenantId: job.tenantId,
      phone: crew.phone,
      role: "crew",
      state: state as unknown as Record<string, unknown>,
      activeJobId: job.id,
    });
  }
  await logEvent({
    tenantId: job.tenantId,
    type: "bot.capture_armed",
    entity: "job",
    entityId: job.id,
    actor: "crm",
    data: { crewId: crew.id, stage: args.stage },
  });
  return "armed";
}
