/**
 * Owner side of "set up from your website": what the owner kept on the confirmation cards is applied to the
 * profile the website reader found, then stored as the tenant's profile. The pure part lives in ./onboarding-choices.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/intel/types";
import { THORBURN_FIXTURE } from "./fixtures/thorburn-profile";

/** The profile to show when the live reader isn't available: the intel output file if present, else the fixture. */
export function sampleProfile(): { profile: BusinessProfile; sample: boolean } {
  const file = path.join(process.cwd(), "data", "profiles", "thorburn-landscapes.json");
  try {
    if (fs.existsSync(file)) {
      const parsed = BusinessProfileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      if (parsed.success) return { profile: parsed.data, sample: false };
    }
  } catch {
    /* fall through to the fixture */
  }
  return { profile: THORBURN_FIXTURE, sample: true };
}

/** The draft profile of a live onboarding run (read from the DB, never trusted from the browser). */
export async function runProfile(runId: string): Promise<BusinessProfile | null> {
  const db = await getDb();
  const [run] = await db.select().from(schema.onboardingRuns).where(eq(schema.onboardingRuns.id, runId));
  return run?.profile ?? null;
}

/** Offline path only (sample profile): live runs are confirmed by the intel module's confirmOnboarding. */
export async function saveConfirmedProfile(tenantId: string, profile: BusinessProfile): Promise<void> {
  const clean = BusinessProfileSchema.parse(profile);
  const db = await getDb();
  await db.update(schema.tenants).set({ profile: clean }).where(eq(schema.tenants.id, tenantId));
  await logEvent({
    tenantId,
    type: "profile.confirmed",
    entity: "tenant",
    entityId: tenantId,
    actor: "owner",
    data: {
      sample: true,
      services: clean.services.length,
      areas: clean.areas.length,
      projects: clean.projects.length,
    },
  });
}
