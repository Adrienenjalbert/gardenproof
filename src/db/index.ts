/**
 * Database access.
 * - DATABASE_URL set  -> Postgres (Supabase in production) via postgres-js.
 * - otherwise         -> embedded PGlite (real Postgres in WASM) stored in .data/pglite.
 *
 * Migrations in ./drizzle run at most once per process on first use, unless MIGRATE_ON_START=off
 * (production: run `pnpm db:migrate` as a release step so several instances never race the migrator).
 * A failed connect is never cached: the next getDb() call tries again.
 */
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
/** The executor inside `db.transaction(async (tx) => …)`; accepted wherever a query may join a transaction. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __gpDb?: Promise<Db>; __gpMigrated?: boolean };

const migrationsFolder = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");
const migrateOnStart = () => (process.env.MIGRATE_ON_START ?? "on") !== "off";

async function create(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(process.env.DATABASE_URL, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    const db = drizzle(client, { schema });
    if (migrateOnStart() && !globalForDb.__gpMigrated) {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      try {
        await migrate(db, { migrationsFolder: migrationsFolder() });
      } catch (err) {
        await client.end({ timeout: 5 }).catch(() => undefined);
        throw err;
      }
      globalForDb.__gpMigrated = true;
    }
    // Same query-builder API as the PGlite driver; typed as one for simplicity.
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "pglite");
  if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  // PGlite is embedded (one process owns the data dir), so there is no multi-instance race: always migrate.
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db, { migrationsFolder: migrationsFolder() });
  globalForDb.__gpMigrated = true;
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__gpDb) {
    const p = create();
    globalForDb.__gpDb = p;
    // Never cache a rejection: a transient connect error must not brick this instance until restart.
    p.catch(() => {
      if (globalForDb.__gpDb === p) globalForDb.__gpDb = undefined;
    });
  }
  return globalForDb.__gpDb;
}

/** Release step (`pnpm db:migrate`): apply pending migrations to DATABASE_URL (or the local PGlite dir). */
export async function runMigrations(): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
    try {
      await migrate(drizzle(client, { schema }), { migrationsFolder: migrationsFolder() });
    } finally {
      await client.end({ timeout: 5 });
    }
    return;
  }
  await getDb(); // PGlite migrates on open
}

/** For tests: reset the singleton (use with PGLITE_DIR=memory://). */
export function __resetDbForTests() {
  globalForDb.__gpDb = undefined;
  globalForDb.__gpMigrated = false;
}

export { schema };
export type { Db, Tx };
