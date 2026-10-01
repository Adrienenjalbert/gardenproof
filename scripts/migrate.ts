/**
 * Release step: apply database migrations once, before new app/worker instances start.
 * Pair with MIGRATE_ON_START=off on the app and worker.  Run: pnpm db:migrate
 */
import { runMigrations } from "@/db";

runMigrations()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
