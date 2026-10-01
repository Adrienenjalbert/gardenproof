/**
 * Standalone task worker (content generation, video renders, publishing, expiry sweep).
 * Run next to the web app with WORKER=off on the web process:  pnpm worker
 * Stops cleanly on SIGINT/SIGTERM: the current task finishes (or is recovered after 30 min if killed).
 */
import { assertProductionConfig } from "@/lib/config";
import { TASK_HANDLERS } from "@/lib/tasks/handlers";
import { startWorker } from "@/lib/tasks/worker";

async function main() {
  assertProductionConfig();
  const worker = await startWorker({
    handlers: TASK_HANDLERS,
    label: "worker",
    pollMs: Number(process.env.WORKER_POLL_MS ?? 2000),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
  });
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) process.exit(1); // second signal: don't wait
    stopping = true;
    console.log(`[worker] ${signal}: finishing the current task…`);
    void worker.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
