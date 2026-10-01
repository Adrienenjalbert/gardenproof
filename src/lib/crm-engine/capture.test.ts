import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { coerceState } from "@/lib/bot/reducer";
import { advanceFromCapture, dispatchDueMessages, moveJobToStage } from "./index";
import { PH, TEN, seedCrmJob, seedCrmTenant } from "./test-fixtures";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T11:00:00Z"));
  await seedCrmTenant();
}, 120_000);
afterAll(() => vi.useRealTimers());

async function marcoConversation() {
  const [c] = await (await getDb())
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, TEN), eq(schema.conversations.phone, PH.marco)));
  return c ?? null;
}

describe("crew capture prompts", () => {
  it("on the start morning, asks the crew lead for before photos and points their WhatsApp at the job", async () => {
    const job = await seedCrmJob({ status: "captured" });
    await moveJobToStage(job.id, "booked", "owner", null, { at: new Date("2026-09-24T12:00:00Z") });
    await dispatchDueMessages(new Date("2026-09-24T11:50:00Z"), { digest: false });

    const [row] = await (await getDb())
      .select()
      .from(schema.scheduledMessages)
      .where(and(eq(schema.scheduledMessages.jobId, job.id), eq(schema.scheduledMessages.ruleKey, "capture_before:2026-09-24")));
    expect(row.status).toBe("sent");

    const conv = await marcoConversation();
    expect(conv?.activeJobId).toBe(job.id);
    expect(coerceState(conv?.state)).toMatchObject({ step: "before", jobId: job.id });
    const [after] = await (await getDb()).select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(after.status).toBe("capturing"); // open for the crew's photos
  });

  it("moves the job along from the crew's photos: before photos → On site, Done → Finished, never backwards", async () => {
    const job = await seedCrmJob({ stage: "booked" });
    expect(await advanceFromCapture(job.id, "before_photos")).toBe("on_site");
    expect(await advanceFromCapture(job.id, "before_photos")).toBeNull();
    expect(await advanceFromCapture(job.id, "crew_done")).toBe("finished");
    expect(await advanceFromCapture(job.id, "crew_done")).toBeNull();

    const maintenance = await seedCrmJob({ stage: "maintenance" });
    expect(await advanceFromCapture(maintenance.id, "crew_done")).toBeNull();

    const planned = await (await getDb())
      .select({ ruleKey: schema.scheduledMessages.ruleKey })
      .from(schema.scheduledMessages)
      .where(eq(schema.scheduledMessages.jobId, job.id));
    expect(planned.map((p) => p.ruleKey)).toContain("review_request");
  });
});
