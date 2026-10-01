"use server";
/** Server Actions for /start (the website set-up flow). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UnauthorisedError, requireAgency } from "@/lib/dashboard/session";
import { OnboardingError, confirmOnboarding } from "@/lib/intel";
import type { BusinessProfile } from "@/lib/intel/types";
import { getTenantBySlug } from "@/lib/tenants";
import type { OwnerResult } from "./actions";
import { ChoicesSchema, applyChoices, type Choices } from "./onboarding-choices";
import { runProfile, sampleProfile, saveConfirmedProfile } from "./onboarding";

/** Profile for the offline path (live reader unavailable). */
export async function sampleProfileAction(): Promise<{
  profile: BusinessProfile;
  sample: boolean;
}> {
  await requireAgency();
  return sampleProfile();
}

/** A live run's draft profile, read on the server. */
export async function runProfileAction(runId: string): Promise<BusinessProfile | null> {
  await requireAgency();
  return runProfile(z.string().min(1).max(100).parse(runId));
}

export async function confirmProfileAction(input: { runId: string | null; choices: Choices }): Promise<OwnerResult> {
  try {
    await requireAgency();
    const v = z
      .object({
        runId: z.string().min(1).max(100).nullable(),
        choices: ChoicesSchema,
      })
      .parse(input);
    const tenant = await getTenantBySlug();
    if (v.runId) {
      // Live run: the intel module confirms it (keeps proof honest, marks the run confirmed) for THIS business.
      const draft = await runProfile(v.runId);
      if (!draft)
        return {
          ok: false,
          error: "We couldn't find what we read from your website. Please try again.",
        };
      const kept = applyChoices(draft, v.choices);
      await confirmOnboarding(
        v.runId,
        {
          services: kept.services,
          areas: kept.areas,
          reviews: {
            sources: kept.reviews.sources,
            featured: kept.reviews.featured,
          },
          projects: kept.projects,
        },
        tenant.id,
      );
    } else {
      await saveConfirmedProfile(tenant.id, applyChoices(sampleProfile().profile, v.choices));
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "All set. Welcome to GardenProof." };
  } catch (err) {
    if (err instanceof UnauthorisedError || err instanceof OnboardingError) return { ok: false, error: err.message };
    console.error("[onboarding confirm]", err);
    return {
      ok: false,
      error: "Something went wrong saving that. Please try again.",
    };
  }
}
