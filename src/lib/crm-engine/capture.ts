/**
 * The crew's photos move the job along, so nobody has to tap the stage stepper for the common path:
 *   before photos arrive on a Booked job   ─► On site
 *   crew taps Done on a Booked/On site job ─► Finished (plans the review request and aftercare)
 * Never moves a job backwards, and never fails the crew's message: errors are logged and swallowed.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CrmStage } from "@/lib/crm";
import { moveJobToStage } from "./stage";

export type CaptureSignal = "before_photos" | "crew_done";

const MOVES: Record<CaptureSignal, { from: readonly CrmStage[]; to: CrmStage; note: string }> = {
  before_photos: { from: ["booked"], to: "on_site", note: "Before photos from the crew" },
  crew_done: { from: ["booked", "on_site"], to: "finished", note: "Crew tapped Done" },
};

export async function advanceFromCapture(
  jobId: string,
  signal: CaptureSignal,
  opts: { actor?: string | null; now?: Date } = {},
): Promise<CrmStage | null> {
  try {
    const db = await getDb();
    const [job] = await db.select({ stage: schema.jobs.stage }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
    const move = MOVES[signal];
    if (!job || !move.from.includes(job.stage)) return null;
    // Moving to Finished clears the stage date; On site keeps none until the owner sets a finish date.
    await moveJobToStage(jobId, move.to, opts.actor ?? "crew", move.note, { now: opts.now, at: null });
    return move.to;
  } catch (err) {
    console.error("[crm] advanceFromCapture failed", jobId, signal, err);
    return null;
  }
}
