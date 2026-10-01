/**
 * Server startup hook (Next calls register() once per server instance, before serving requests).
 * - Refuses to start with an unsafe production configuration.
 * - Starts the in-process task worker (Node runtime only). Set WORKER=off when a separate `pnpm worker`
 *   process owns the queue (recommended once videos render in production).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionConfig } = await import("@/lib/config");
  assertProductionConfig();

  if (process.env.WORKER === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const flag = globalThis as unknown as { __gpWorkerStarted?: boolean };
  if (flag.__gpWorkerStarted) return; // dev hot reloads re-run register()
  flag.__gpWorkerStarted = true;

  const [{ startWorker }, { TASK_HANDLERS }] = await Promise.all([import("@/lib/tasks/worker"), import("@/lib/tasks/handlers")]);
  // Not awaited: a slow database must not hold up the web server; the loop retries on its own.
  startWorker({
    handlers: TASK_HANDLERS,
    label: "worker:in-process",
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1000),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
  }).catch((err) => {
    flag.__gpWorkerStarted = false;
    console.error("[instrumentation] task worker failed to start", err);
  });
}
