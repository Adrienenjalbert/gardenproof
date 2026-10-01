/**
 * Intel: onboarding a business from its website URL.
 *
 *   startOnboarding(url)          → { runId }   (validates the URL, queues task "intel.onboard")
 *   getOnboardingRun(runId)       → row with plain-English steps + draft profile (poll this)
 *   confirmOnboarding(runId, edits, tenantId?) → writes tenants.profile (creates the tenant if needed)
 *   runOnboarding(runId)          → the queue handler
 *
 * Rendering the cloned shell: `profile.shell.css` starts with a Google Fonts @import, so put it FIRST in a <style>
 * element (or its own <style>), then insert headerHtml / footerHtml as-is (already sanitised, gp- classes only).
 * Stored images (logo, badges, project photos, homepage screenshot) are storage keys under intel/<slug>/…
 */
export { startOnboarding, getOnboardingRun, confirmOnboarding, runOnboarding, OnboardingError, initialSteps } from "./runs";
export type { OnboardingStep } from "./runs";
export { OnboardingEditsSchema, applyOwnerEdits } from "./confirm";
export type { OnboardingEdits } from "./confirm";
export { ONBOARDING_STEPS } from "./pipeline";
export { BusinessProfileSchema } from "./types";
export type { BusinessProfile, Badge, ReviewSource, PublicReview, ScrapedProject } from "./types";
