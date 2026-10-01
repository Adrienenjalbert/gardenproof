/**
 * Onboarding runs (onboarding_runs table): start → background pipeline (task "intel.onboard") → owner confirms.
 * The owner app polls `getOnboardingRun` for the step list and the draft profile, which is saved after every step.
 */
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { OnboardingRun } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { enqueueTask } from "@/lib/tasks";
import { applyOwnerEdits, OnboardingEditsSchema, type OnboardingEdits } from "./confirm";
import { createFirecrawl, type Firecrawl } from "./firecrawl";
import { createDownloader, type Downloader } from "./images";
import { buildProfile, ONBOARDING_STEPS, type StepKey, type StepStatus } from "./pipeline";
import { postcodesIo, type PlaceLookup } from "./places";
import { tenantConfigFromProfile } from "./tenant-config";
import { slugify } from "./text";
import { BusinessProfileSchema, type BusinessProfile } from "./types";
import { checkPublicHttpsUrl, normaliseSiteUrl } from "./url";

export class OnboardingError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_url" | "not_found" | "not_ready" | "invalid_edits" | "conflict",
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export type OnboardingStep = OnboardingRun["steps"][number];

export const initialSteps = (): OnboardingStep[] => ONBOARDING_STEPS.map((s) => ({ key: s.key, label: s.label, status: "pending" }));

/** Validate the pasted address (https, public host) and queue the pipeline. Returns at once. */
export async function startOnboarding(
  url: string,
  opts: { tenantId?: string | null; lookup?: (host: string) => Promise<string[]> } = {},
): Promise<{ runId: string }> {
  const normalised = normaliseSiteUrl(url);
  if (!normalised) throw new OnboardingError("That doesn't look like a web address.", "invalid_url");
  const check = await checkPublicHttpsUrl(normalised.replace(/^http:\/\//i, "https://"), opts.lookup);
  if (!check.ok) throw new OnboardingError(check.reason, "invalid_url");
  const db = await getDb();
  const runId = newId("onb");
  await db.transaction(async (tx) => {
    await tx.insert(schema.onboardingRuns).values({ id: runId, url: check.url, tenantId: opts.tenantId ?? null, status: "queued", steps: initialSteps() });
    await enqueueTask({ tenantId: opts.tenantId ?? null, type: "intel.onboard", payload: { runId }, dedupeKey: `intel.onboard:${runId}`, maxAttempts: 2 }, tx);
  });
  return { runId };
}

export async function getOnboardingRun(runId: string): Promise<OnboardingRun | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.onboardingRuns).where(eq(schema.onboardingRuns.id, runId));
  return row ?? null;
}

export type RunDeps = { fc?: Firecrawl; download?: Downloader; places?: PlaceLookup; now?: () => Date };

/**
 * The "intel.onboard" task. Idempotent: a run that is already ready/confirmed is left alone; a retried run starts
 * its steps again (Firecrawl responses are cached, so a retry costs no credits for what already succeeded).
 */
export async function runOnboarding(runId: string, deps: RunDeps = {}): Promise<void> {
  const db = await getDb();
  const run = await getOnboardingRun(runId);
  if (!run) throw new OnboardingError(`Onboarding run ${runId} not found`, "not_found");
  if (run.status === "ready" || run.status === "confirmed") return;

  const steps = initialSteps();
  const save = async (patch: Partial<typeof schema.onboardingRuns.$inferInsert>) => {
    // Never overwrite a run the owner has confirmed in the meantime.
    await db
      .update(schema.onboardingRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.onboardingRuns.id, runId), ne(schema.onboardingRuns.status, "confirmed")));
  };
  await save({ status: "running", steps, error: null });

  const cacheRoot = process.env.INTEL_CACHE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "intel-cache");
  const { profile, failedSteps } = await buildProfile(run.url, {
    fc: deps.fc ?? createFirecrawl({ cacheDir: cacheRoot }),
    download: deps.download ?? createDownloader({ cacheDir: path.join(cacheRoot, "downloads") }),
    places: deps.places ?? postcodesIo(),
    now: deps.now,
    onStep: async (key: StepKey, status: StepStatus, detail?: string) => {
      const step = steps.find((s) => s.key === key);
      if (!step) return;
      step.status = status;
      if (detail) step.detail = detail;
      await save({ steps: [...steps] });
    },
    onDraft: async (draft) => save({ profile: draft }),
  });

  const siteFailed = failedSteps.includes("site");
  await save({
    status: siteFailed ? "failed" : "ready",
    steps: [...steps],
    profile,
    error: siteFailed ? "We couldn't read that website. Check the address, or try again in a few minutes." : null,
  });
}

/** Free tenant slug ("thorburn-landscapes", then "-2"…). Runs on the caller's transaction (PGlite has one connection). */
async function uniqueSlug(ex: Tx, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const [taken] = await ex.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug));
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The owner confirmed (with edits). Writes the profile into tenants.profile — for `tenantId`, the run's tenant, or a
 * new tenant created from the profile (slug from the business name) — and marks the run confirmed.
 */
export async function confirmOnboarding(
  runId: string,
  edits: unknown,
  tenantId?: string | null,
): Promise<{ tenantId: string; slug: string; profile: BusinessProfile }> {
  const parsed = OnboardingEditsSchema.safeParse(edits ?? {});
  if (!parsed.success) throw new OnboardingError(`Some changes couldn't be saved: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`, "invalid_edits");
  const run = await getOnboardingRun(runId);
  if (!run) throw new OnboardingError("Onboarding not found", "not_found");
  if (run.status === "confirmed") throw new OnboardingError("This has already been confirmed.", "conflict");
  if (run.status !== "ready" || !run.profile) throw new OnboardingError("We're still reading your website.", "not_ready");

  const profile = applyOwnerEdits(BusinessProfileSchema.parse(run.profile), parsed.data as OnboardingEdits);
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const targetId = tenantId ?? run.tenantId ?? null;
    let id: string;
    let slug: string;
    if (targetId) {
      const [t] = await tx.update(schema.tenants).set({ profile }).where(eq(schema.tenants.id, targetId)).returning({ id: schema.tenants.id, slug: schema.tenants.slug });
      if (!t) throw new OnboardingError("Business not found", "not_found");
      id = t.id;
      slug = t.slug;
    } else {
      slug = await uniqueSlug(tx, slugify(profile.name));
      id = newId("ten");
      await tx.insert(schema.tenants).values({ id, slug, name: profile.name, config: tenantConfigFromProfile(profile), profile });
    }
    const done = await tx
      .update(schema.onboardingRuns)
      .set({ status: "confirmed", tenantId: id, profile, updatedAt: new Date() })
      .where(and(eq(schema.onboardingRuns.id, runId), eq(schema.onboardingRuns.status, "ready")))
      .returning({ id: schema.onboardingRuns.id });
    if (!done.length) throw new OnboardingError("This has already been confirmed.", "conflict");
    return { tenantId: id, slug };
  });
  await logEvent({ tenantId: result.tenantId, type: "onboarding.confirmed", entity: "onboarding_run", entityId: runId, actor: "owner", data: { url: run.url } });
  return { ...result, profile };
}
