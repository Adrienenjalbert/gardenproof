import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { T, seedTenant } from "@/lib/bot/test-fixtures";
import { enqueueExpirySweep } from "./enqueue";
import { STALE_LOCK_MS, backoffMs, claimNextTask, enqueueTask, getTask, listTasks, recoverStaleTasks, retryTask } from "./queue";
import { PermanentTaskError, TASK_TYPES } from "./types";
import { drainTasks, runNextTask, startWorker, type TaskHandlers } from "./worker";

beforeAll(() => seedTenant(), 120_000);
beforeEach(async () => {
  await (await getDb()).delete(schema.tasks);
});

/** Handlers that record calls; individual tests swap in failures. */
function handlers(over: Partial<TaskHandlers> = {}): TaskHandlers & { calls: string[] } {
  const calls: string[] = [];
  const rec = (type: string) => async (p: unknown) => {
    calls.push(`${type}:${JSON.stringify(p)}`);
  };
  const base = Object.fromEntries(TASK_TYPES.map((t) => [t, rec(t)])) as unknown as TaskHandlers;
  return Object.assign({ ...base, ...over }, { calls });
}

const job = (jobId: string, extra: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}) =>
  enqueueTask({ tenantId: T, type: "pipeline.job_completed", payload: { jobId }, ...extra });

describe("enqueueTask", () => {
  it("de-duplicates on dedupeKey while queued or running, and pulls runAt forward", async () => {
    const later = new Date(Date.now() + 3600_000);
    const a = await job("job_1", { dedupeKey: "k1", runAt: later });
    const b = await job("job_1", { dedupeKey: "k1", runAt: later });
    expect(a.deduped).toBe(false);
    expect(b).toEqual({ id: a.id, deduped: true });
    expect((await getTask(a.id))?.runAt.getTime()).toBe(later.getTime());
    const now = new Date();
    await job("job_1", { dedupeKey: "k1", runAt: now });
    expect((await getTask(a.id))?.runAt.getTime()).toBe(now.getTime());
    const other = await job("job_1", { dedupeKey: "k2" });
    expect(other.id).not.toBe(a.id);
  });

  it("frees the key when the task finishes, so the same work can be queued again", async () => {
    const a = await job("job_2", { dedupeKey: "k-free" });
    await drainTasks({ handlers: handlers() });
    expect(await getTask(a.id)).toMatchObject({ status: "done", dedupeKey: null });
    const b = await job("job_2", { dedupeKey: "k-free" });
    expect(b.deduped).toBe(false);
  });

  it("validates payloads", async () => {
    await expect(enqueueTask({ tenantId: T, type: "asset.unpublish", payload: { assetId: "a" } as never })).rejects.toThrow();
  });

  it("joins a transaction: rolled back with it", async () => {
    const db = await getDb();
    await expect(
      db.transaction(async (tx) => {
        await enqueueTask({ tenantId: T, type: "pipeline.ready_for_content", payload: { jobId: "job_tx" }, dedupeKey: "k-tx2" }, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.dedupeKey, "k-tx2"));
    expect(rows).toHaveLength(0);
  });
});

describe("claiming", () => {
  it("claims only due tasks, oldest first, each exactly once under concurrency", async () => {
    const now = Date.now();
    await job("late", { runAt: new Date(now + 60_000) });
    const first = await job("first", { runAt: new Date(now - 3000) });
    await job("second", { runAt: new Date(now - 2000) });
    await job("third", { runAt: new Date(now - 1000) });
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimNextTask(new Date(now))));
    const got = claims.filter(Boolean).map((t) => (t!.payload as { jobId: string }).jobId);
    expect(got.sort()).toEqual(["first", "second", "third"]);
    const [claimedFirst] = claims.filter((t) => t?.id === first.id);
    expect(claimedFirst).toMatchObject({ status: "running", attempts: 1 });
    expect(await claimNextTask(new Date(now))).toBeNull();
  });
});

describe("running", () => {
  it("retries failures with exponential backoff, then fails and logs an event", async () => {
    const { id } = await job("job_fail", { maxAttempts: 2, dedupeKey: "k-fail" });
    const h = handlers({ "pipeline.job_completed": async () => Promise.reject(new Error("AI down")) });
    const t0 = new Date();
    expect((await runNextTask({ handlers: h, now: () => t0 }))?.outcome).toBe("retrying");
    const retry = await getTask(id);
    expect(retry).toMatchObject({ status: "queued", attempts: 1, lastError: "AI down", dedupeKey: "k-fail" });
    expect(retry!.runAt.getTime()).toBe(t0.getTime() + backoffMs(1));
    const t1 = new Date(retry!.runAt.getTime() + 1);
    expect((await runNextTask({ handlers: h, now: () => t1 }))?.outcome).toBe("failed");
    expect(await getTask(id)).toMatchObject({ status: "failed", attempts: 2, dedupeKey: null });
    const events = await (await getDb()).select().from(schema.events).where(eq(schema.events.entityId, id));
    expect(events.map((e) => e.type).sort()).toEqual(["task.failed", "task.retrying"]);
  });

  it("backs off 30s, 1m, 2m… capped at an hour", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(3600_000);
  });

  it("fails permanently on PermanentTaskError or an invalid stored payload", async () => {
    const a = await job("job_perm");
    await runNextTask({ handlers: handlers({ "pipeline.job_completed": async () => Promise.reject(new PermanentTaskError("Job not found")) }) });
    expect(await getTask(a.id)).toMatchObject({ status: "failed", attempts: 1, lastError: "Job not found" });

    const db = await getDb();
    const b = await job("job_bad");
    await db.update(schema.tasks).set({ payload: { nope: 1 } }).where(eq(schema.tasks.id, b.id));
    await runNextTask({ handlers: handlers() });
    expect((await getTask(b.id))?.lastError).toMatch(/invalid payload/);
  });

  it("times a handler out and retries it", async () => {
    const { id } = await job("job_slow");
    let aborted = false;
    const h = handlers({
      "pipeline.job_completed": (_p, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => (aborted = true));
          setTimeout(resolve, 5_000);
        }),
    });
    expect((await runNextTask({ handlers: h, timeoutMs: () => 30 }))?.outcome).toBe("retrying");
    expect(aborted).toBe(true);
    expect((await getTask(id))?.lastError).toMatch(/timed out/);
  });

  it("reschedules itself when the handler asks (hourly expiry sweep)", async () => {
    const { id } = await enqueueExpirySweep();
    const at = new Date(Date.now() + 3600_000);
    await runNextTask({ handlers: handlers({ "testimonials.expire": async () => ({ rescheduleAt: at }) }) });
    expect(await getTask(id)).toMatchObject({ status: "done", dedupeKey: null });
    const next = await (await getDb()).select().from(schema.tasks).where(eq(schema.tasks.dedupeKey, "testimonials.expire"));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ status: "queued", tenantId: null });
    expect(next[0].runAt.getTime()).toBe(at.getTime());
    // The cron route enqueues the same key: it pulls the scheduled sweep forward instead of adding one.
    expect((await enqueueExpirySweep()).deduped).toBe(true);
  });
});

describe("recovery and retry", () => {
  it("re-queues tasks stuck in running past the stale threshold (or fails them when out of attempts)", async () => {
    const db = await getDb();
    const a = await job("stuck");
    const b = await job("stuck-exhausted", { maxAttempts: 1 });
    const c = await job("fresh");
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000);
    await db.update(schema.tasks).set({ status: "running", lockedAt: old, attempts: 1 }).where(eq(schema.tasks.id, a.id));
    await db.update(schema.tasks).set({ status: "running", lockedAt: old, attempts: 1 }).where(eq(schema.tasks.id, b.id));
    await db.update(schema.tasks).set({ status: "running", lockedAt: new Date(), attempts: 1 }).where(eq(schema.tasks.id, c.id));
    expect(await recoverStaleTasks()).toBe(2);
    expect(await getTask(a.id)).toMatchObject({ status: "queued", lockedAt: null });
    expect(await getTask(b.id)).toMatchObject({ status: "failed" });
    expect(await getTask(c.id)).toMatchObject({ status: "running" });
  });

  it("a recovered task can't be clobbered by the worker that lost it", async () => {
    const db = await getDb();
    await job("lost");
    const claimed = (await claimNextTask())!;
    await db.update(schema.tasks).set({ lockedAt: new Date(Date.now() - STALE_LOCK_MS - 1) }).where(eq(schema.tasks.id, claimed.id));
    await recoverStaleTasks();
    const reclaimed = (await claimNextTask())!;
    expect(reclaimed.id).toBe(claimed.id);
    const { completeTask } = await import("./queue");
    expect(await completeTask(claimed)).toBe(false); // stale claim
    expect(await completeTask(reclaimed)).toBe(true);
  });

  it("retryTask re-queues a failed task with a fresh budget; other statuses are left alone", async () => {
    const { id } = await job("job_retry", { maxAttempts: 1 });
    await runNextTask({ handlers: handlers({ "pipeline.job_completed": async () => Promise.reject(new Error("x")) }) });
    expect((await getTask(id))?.status).toBe("failed");
    expect(await retryTask(id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await retryTask(id)).toMatchObject({ status: "queued" });
    expect(await retryTask("tsk_missing")).toBeNull();
  });

  it("listTasks returns the tenant's and system tasks, filterable by status", async () => {
    await job("l1");
    await enqueueExpirySweep();
    const all = await listTasks({ tenantId: T });
    expect(all.map((t) => t.type).sort()).toEqual(["pipeline.job_completed", "testimonials.expire"]);
    expect(await listTasks({ tenantId: T, status: "failed" })).toHaveLength(0);
    expect(await listTasks({ tenantId: "ten_other" })).toHaveLength(1); // only the system sweep
  });
});

describe("startWorker", () => {
  it("processes queued work promptly, schedules the expiry sweep and stops cleanly", async () => {
    const h = handlers();
    const worker = await startWorker({ handlers: h, pollMs: 20, label: "test" });
    await job("w1");
    await vi.waitFor(() => expect(h.calls).toContain('pipeline.job_completed:{"jobId":"w1"}'), { timeout: 5_000 });
    await worker.stop();
    const sweep = await (await getDb()).select().from(schema.tasks).where(eq(schema.tasks.type, "testimonials.expire"));
    expect(sweep.length).toBeGreaterThanOrEqual(1);
  });
});

describe("handler registry", () => {
  it("has a production handler for every task type", async () => {
    vi.doMock("@/lib/video", () => ({ renderVideosForJob: vi.fn(), renderVideoAsset: vi.fn() }));
    const { TASK_HANDLERS } = await import("./handlers");
    expect(Object.keys(TASK_HANDLERS).sort()).toEqual([...TASK_TYPES].sort());
  });
});
