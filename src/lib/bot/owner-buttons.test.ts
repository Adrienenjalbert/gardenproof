/**
 * The owner's own WhatsApp buttons ("Send all N" / "Look first") never touch the crew capture state
 * machine — they're intercepted in processInbound and routed straight to the CRM engine. Uses the
 * crm-engine fixtures (not bot/test-fixtures) because they pair moveJobToStage with real trust tiers,
 * which is what actually produces an awaiting-approval quick_yes message to approve.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { dispatchDueMessages, moveJobToStage, OWNER_BUTTONS } from "@/lib/crm-engine";
import { PH, TEN, seedCrmJob, seedCrmTenant, setTenantSettings } from "@/lib/crm-engine/test-fixtures";
import { handleInbound } from "./index";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T11:00:00Z"));
  await seedCrmTenant();
  await setTenantSettings({
    notifications: { instant: [], digestHour: null, autoApproveAfterDays: 30 },
  });
}, 120_000);
afterAll(() => vi.useRealTimers());

const at = (s: string) => new Date(s);
async function lastOut(phone: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.toNumber, phone), eq(schema.messages.direction, "out")));
  return rows.at(-1);
}
async function statusOf(jobId: string, prefix: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.jobId, jobId));
  return rows.find((r) => r.ruleKey.startsWith(prefix))?.status;
}

describe("owner WhatsApp buttons", () => {
  it("crm_send_all approves everything awaiting and confirms by WhatsApp", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(job.id, "quoted", "owner", null, { now: at("2026-09-24T11:00:00Z") });
    expect(await statusOf(job.id, "quote_follow_up")).toBe("scheduled");

    // The quick_yes follow-up falls due and, with no auto-approve yet earned, sits waiting for the owner.
    await dispatchDueMessages(at("2026-09-30T09:00:00Z"), { digest: false });
    expect(await statusOf(job.id, "quote_follow_up")).toBe("awaiting_approval");

    const res = await handleInbound(
      { tenantId: TEN, from: PH.stephen, body: "", choiceId: OWNER_BUTTONS.sendAll, channel: "simulator" },
      { now: at("2026-09-30T09:05:00Z") },
    );
    expect(res.duplicate).toBe(false);

    expect(await statusOf(job.id, "quote_follow_up")).toBe("sent");
    const reply = await lastOut(PH.stephen);
    expect(reply?.body).toMatch(/1 message is on their way/);
  });

  it("crm_send_all says so when nothing is waiting", async () => {
    const res = await handleInbound(
      { tenantId: TEN, from: PH.stephen, body: "", choiceId: OWNER_BUTTONS.sendAll, channel: "simulator" },
      { now: at("2026-09-24T13:00:00Z") },
    );
    expect(res.duplicate).toBe(false);
    const reply = await lastOut(PH.stephen);
    expect(reply?.body).toMatch(/all caught up/);
  });

  it("crm_open_app replies with the app link and doesn't fall into crew capture", async () => {
    const res = await handleInbound(
      { tenantId: TEN, from: PH.stephen, body: "", choiceId: OWNER_BUTTONS.openApp, channel: "simulator" },
      { now: at("2026-09-24T13:05:00Z") },
    );
    expect(res.duplicate).toBe(false);
    const reply = await lastOut(PH.stephen);
    expect(reply?.body).toMatch(/^Here you go: http/);
  });
});
