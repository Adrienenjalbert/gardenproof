/**
 * Durable task queue on the `tasks` table (works on Postgres and PGlite; no extra infrastructure).
 *
 * - Enqueue is idempotent by `dedupeKey`: while a task with that key is queued or running, enqueueing again
 *   returns it (and pulls its runAt forward if the new request is due sooner). The key is cleared when the
 *   task finishes, so the same work can be queued again later.
 * - Claiming is atomic: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) — safe with several workers.
 * - Failures retry with exponential backoff up to maxAttempts; stale "running" rows (crashed worker) are recovered.
 */
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/db";
import type { Task } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { TASK_PAYLOADS, type TaskPayload, type TaskStatus, type TaskType } from "./types";

/** The DB or an open transaction: enqueue inside a transaction to make it atomic with other writes. */
export type Executor = Db | Tx;

export const STALE_LOCK_MS = 30 * 60_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 60 * 60_000;

export type EnqueueInput<T extends TaskType> = {
  tenantId: string | null;
  type: T;
  payload: TaskPayload<T>;
  dedupeKey?: string | null;
  runAt?: Date;
  maxAttempts?: number;
};

/** In-process workers register a wake-up here so a fresh enqueue runs without waiting for the next poll. */
export const wakeHub = globalThis as unknown as { __gpTaskWake?: Set<() => void> };

/** Backoff after the n-th failed attempt (1-based): 30s, 1m, 2m, 4m … capped at 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

async function findActiveByKey(ex: Executor, dedupeKey: string): Promise<Task | undefined> {
  const [row] = await ex
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.dedupeKey, dedupeKey), inArray(schema.tasks.status, ["queued", "running"])));
  return row;
}

/**
 * Queue a task. Pass `executor` (a transaction) to make the enqueue atomic with other writes.
 * Returns the task id and whether an existing task was reused.
 */
export async function enqueueTask<T extends TaskType>(
  input: EnqueueInput<T>,
  executor?: Executor,
): Promise<{ id: string; deduped: boolean }> {
  const payload = TASK_PAYLOADS[input.type].parse(input.payload) as Record<string, unknown>;
  const ex = executor ?? (await getDb());
  const runAt = input.runAt ?? new Date();
  const dedupeKey = input.dedupeKey ?? null;

  // Two passes: a concurrent finisher may clear the key between our insert conflict and the lookup.
  for (let pass = 0; pass < 2; pass++) {
    const [inserted] = await ex
      .insert(schema.tasks)
      .values({
        id: newId("tsk"),
        tenantId: input.tenantId,
        type: input.type,
        payload,
        dedupeKey,
        status: "queued",
        runAt,
        maxAttempts: input.maxAttempts ?? 3,
      })
      .onConflictDoNothing()
      .returning({ id: schema.tasks.id });
    if (inserted) {
      if (runAt.getTime() <= Date.now()) wakeHub.__gpTaskWake?.forEach((wake) => wake());
      return { id: inserted.id, deduped: false };
    }
    if (!dedupeKey) break;

    const existing = await findActiveByKey(ex, dedupeKey);
    if (existing) {
      if (existing.status === "queued" && existing.runAt > runAt) {
        await ex
          .update(schema.tasks)
          .set({ runAt })
          .where(and(eq(schema.tasks.id, existing.id), eq(schema.tasks.status, "queued")));
      }
      return { id: existing.id, deduped: true };
    }
  }
  throw new Error(`Could not enqueue ${input.type} (dedupe key ${dedupeKey ?? "none"})`);
}

/** Re-queue a failed task now, with a fresh attempt budget (dashboard "Retry"). No-op for other statuses. */
export async function retryTask(id: string): Promise<Task | null> {
  const db = await getDb();
  const [row] = await db
    .update(schema.tasks)
    .set({ status: "queued", attempts: 0, runAt: new Date(), lockedAt: null, finishedAt: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.status, "failed")))
    .returning();
  if (row) return row;
  const [current] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return current ?? null;
}

/** Recent tasks for a tenant (plus system-wide tasks such as the expiry sweep), newest first. */
export async function listTasks(opts: { tenantId: string; status?: TaskStatus | TaskStatus[]; limit?: number }): Promise<Task[]> {
  const db = await getDb();
  const statuses = opts.status === undefined ? null : Array.isArray(opts.status) ? opts.status : [opts.status];
  return db
    .select()
    .from(schema.tasks)
    .where(
      and(
        or(eq(schema.tasks.tenantId, opts.tenantId), isNull(schema.tasks.tenantId)),
        statuses ? inArray(schema.tasks.status, statuses) : undefined,
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 500));
}

export async function getTask(id: string): Promise<Task | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row ?? null;
}

/**
 * Atomically claim the next due task (oldest runAt first). Null when nothing is due.
 * `id = (scalar subquery)` on purpose: Postgres runs it once as an InitPlan. With `id IN (subquery … LIMIT 1
 * FOR UPDATE SKIP LOCKED)` the planner may rescan the subquery per row and claim several tasks at once.
 */
export async function claimNextTask(now: Date = new Date()): Promise<Task | null> {
  const db = await getDb();
  const next = db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "queued"), lte(schema.tasks.runAt, now)))
    .orderBy(asc(schema.tasks.runAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const [claimed] = await db
    .update(schema.tasks)
    .set({ status: "running", lockedAt: now, attempts: sql`${schema.tasks.attempts} + 1` })
    .where(and(eq(schema.tasks.id, sql`(${next})`), eq(schema.tasks.status, "queued")))
    .returning();
  return claimed ?? null;
}

/** Only the worker holding this claim (same lockedAt) may finish it: a recovered-and-reclaimed task is left alone. */
const ownClaim = (task: Task) =>
  and(eq(schema.tasks.id, task.id), eq(schema.tasks.status, "running"), task.lockedAt ? eq(schema.tasks.lockedAt, task.lockedAt) : undefined);

export async function completeTask(task: Task, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(schema.tasks)
    .set({ status: "done", finishedAt: now, lockedAt: null, dedupeKey: null, lastError: null })
    .where(ownClaim(task))
    .returning({ id: schema.tasks.id });
  return rows.length > 0;
}

/** Record a failed attempt: retry later with backoff, or give up (permanent error / attempts exhausted). */
export async function failTask(
  task: Task,
  error: string,
  opts: { permanent?: boolean; now?: Date } = {},
): Promise<"retrying" | "failed" | "lost"> {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const final = opts.permanent || task.attempts >= task.maxAttempts;
  const lastError = error.length > 2000 ? `${error.slice(0, 1997)}…` : error;
  const rows = await db
    .update(schema.tasks)
    .set(
      final
        ? { status: "failed", finishedAt: now, lockedAt: null, dedupeKey: null, lastError }
        : { status: "queued", lockedAt: null, runAt: new Date(now.getTime() + backoffMs(task.attempts)), lastError },
    )
    .where(ownClaim(task))
    .returning({ id: schema.tasks.id });
  if (!rows.length) return "lost";

  const data = { taskId: task.id, type: task.type, attempt: task.attempts, maxAttempts: task.maxAttempts, error: lastError, payload: task.payload };
  if (task.tenantId) {
    await logEvent({ tenantId: task.tenantId, type: final ? "task.failed" : "task.retrying", entity: "task", entityId: task.id, data });
  }
  console.error(`[tasks] ${task.type} ${task.id} attempt ${task.attempts}/${task.maxAttempts} ${final ? "FAILED" : "will retry"}: ${lastError}`);
  return final ? "failed" : "retrying";
}

/**
 * A worker died mid-task: rows stuck in "running" past the stale threshold go back to the queue
 * (or to failed if they have used all attempts). Returns how many were recovered.
 */
export async function recoverStaleTasks(now: Date = new Date(), staleMs = STALE_LOCK_MS): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = and(eq(schema.tasks.status, "running"), lt(schema.tasks.lockedAt, cutoff));
  const exhausted = await db
    .update(schema.tasks)
    .set({ status: "failed", finishedAt: now, lockedAt: null, dedupeKey: null, lastError: "worker stopped while running (stale lock)" })
    .where(and(stale, sql`${schema.tasks.attempts} >= ${schema.tasks.maxAttempts}`))
    .returning();
  const requeued = await db
    .update(schema.tasks)
    .set({ status: "queued", lockedAt: null, runAt: now, lastError: "recovered after stale lock" })
    .where(stale)
    .returning({ id: schema.tasks.id });
  for (const t of exhausted) {
    if (t.tenantId) await logEvent({ tenantId: t.tenantId, type: "task.failed", entity: "task", entityId: t.id, data: { type: t.type, error: t.lastError } });
  }
  return exhausted.length + requeued.length;
}
