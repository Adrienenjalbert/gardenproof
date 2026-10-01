/**
 * Task worker: claims due tasks one at a time, runs the handler with a timeout, records the outcome.
 * Runs in the Next server process (src/instrumentation.ts) and/or standalone (`pnpm worker`); several
 * workers can run side by side because claiming uses FOR UPDATE SKIP LOCKED.
 */
import type { Task } from "@/db/schema";
import { enqueueCrmDispatchSweep, enqueueExpirySweep, enqueueFormsReminderSweep } from "./enqueue";
import { claimNextTask, completeTask, enqueueTask, failTask, recoverStaleTasks, wakeHub } from "./queue";
import { PermanentTaskError, TASK_PAYLOADS, TASK_TIMEOUT_MS, type TaskPayload, type TaskType } from "./types";

export type HandlerContext = { task: Task; signal: AbortSignal };
export type TaskHandlers = { [K in TaskType]: (payload: TaskPayload<K>, ctx: HandlerContext) => Promise<unknown> };

export class TaskTimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TaskTimeoutError";
  }
}

const isReschedule = (v: unknown): v is { rescheduleAt: Date } =>
  typeof v === "object" && v !== null && (v as { rescheduleAt?: unknown }).rescheduleAt instanceof Date;

const describe = (err: unknown) => (err instanceof Error ? err.message || err.name : String(err));

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = run(ac.signal);
  work.catch(() => undefined); // a late rejection after the timeout must not become an unhandled rejection
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new TaskTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type RunOptions = { handlers: TaskHandlers; timeoutMs?: (type: TaskType) => number; now?: () => Date };

/** Run one claimed task to an outcome. Never throws. */
export async function runTask(task: Task, opts: RunOptions): Promise<"done" | "retrying" | "failed" | "lost"> {
  const now = opts.now ?? (() => new Date());
  const type = task.type as TaskType;
  const schema = TASK_PAYLOADS[type];
  if (!schema) return failTask(task, `unknown task type "${task.type}"`, { permanent: true, now: now() });
  const parsed = schema.safeParse(task.payload);
  if (!parsed.success) return failTask(task, `invalid payload: ${parsed.error.message}`, { permanent: true, now: now() });

  const handler = opts.handlers[type] as (payload: unknown, ctx: HandlerContext) => Promise<unknown>;
  const ms = opts.timeoutMs?.(type) ?? TASK_TIMEOUT_MS[type];
  try {
    const result = await withTimeout(ms, (signal) => handler(parsed.data, { task, signal }));
    const finished = await completeTask(task, now());
    if (finished && isReschedule(result)) {
      await enqueueTask({ tenantId: task.tenantId, type, payload: parsed.data as TaskPayload<typeof type>, dedupeKey: task.dedupeKey, runAt: result.rescheduleAt, maxAttempts: task.maxAttempts });
    }
    return finished ? "done" : "lost";
  } catch (err) {
    return failTask(task, describe(err), { permanent: err instanceof PermanentTaskError, now: now() });
  }
}

/** Claim and run the next due task. Returns the task that ran (with its outcome) or null when idle. */
export async function runNextTask(opts: RunOptions): Promise<{ task: Task; outcome: Awaited<ReturnType<typeof runTask>> } | null> {
  const task = await claimNextTask((opts.now ?? (() => new Date()))());
  if (!task) return null;
  return { task, outcome: await runTask(task, opts) };
}

/** Drain everything due now (tests, scripts). Stops after `max` tasks to avoid runaway loops. */
export async function drainTasks(opts: RunOptions & { max?: number }): Promise<Task[]> {
  const ran: Task[] = [];
  for (let i = 0; i < (opts.max ?? 100); i++) {
    const r = await runNextTask(opts);
    if (!r) break;
    ran.push(r.task);
  }
  return ran;
}

// ---------------------------------------------------------------------------
// Long-running loop
// ---------------------------------------------------------------------------
export type WorkerHandle = { stop(): Promise<void> };

export type WorkerOptions = {
  handlers: TaskHandlers;
  /** Idle poll interval. */
  pollMs?: number;
  /** Parallel task slots. Keep 1 where videos render (each render uses every core). */
  concurrency?: number;
  /** Queue the hourly testimonial sweep if none is scheduled. */
  scheduleExpiry?: boolean;
  label?: string;
};

const RECOVER_EVERY_MS = 10 * 60_000;

export async function startWorker(opts: WorkerOptions): Promise<WorkerHandle> {
  const label = opts.label ?? "worker";
  const pollMs = opts.pollMs ?? 1000;
  let stopping = false;
  const sleepers = new Set<() => void>();
  const wake = () => sleepers.forEach((s) => s());
  (wakeHub.__gpTaskWake ??= new Set()).add(wake);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        sleepers.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      sleepers.add(done);
    });

  const recovered = await recoverStaleTasks();
  if (recovered) console.warn(`[${label}] recovered ${recovered} stale task(s)`);
  if (opts.scheduleExpiry !== false) {
    await enqueueExpirySweep();
    await enqueueCrmDispatchSweep();
    await enqueueFormsReminderSweep();
  }
  let lastRecovery = Date.now();

  const loop = async (slot: number) => {
    while (!stopping) {
      try {
        if (slot === 0 && Date.now() - lastRecovery > RECOVER_EVERY_MS) {
          lastRecovery = Date.now();
          await recoverStaleTasks();
        }
        const ran = await runNextTask({ handlers: opts.handlers });
        if (ran) console.log(`[${label}] ${ran.task.type} ${ran.task.id} -> ${ran.outcome}`);
        else await sleep(pollMs);
      } catch (err) {
        // DB unreachable etc.: back off, keep the loop alive.
        console.error(`[${label}] loop error`, err);
        await sleep(pollMs * 10);
      }
    }
  };
  const loops = Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, (_, i) => loop(i));
  console.log(`[${label}] started (${loops.length} slot${loops.length > 1 ? "s" : ""}, poll ${pollMs}ms)`);

  return {
    async stop() {
      stopping = true;
      wakeHub.__gpTaskWake?.delete(wake);
      wake();
      await Promise.all(loops);
    },
  };
}
