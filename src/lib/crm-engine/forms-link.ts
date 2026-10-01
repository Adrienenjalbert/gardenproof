/**
 * Project-brief form link for the enquiry acknowledgement (smart forms module). If a link can't be made the
 * acknowledgement simply goes without one: no placeholder URL is ever sent to a customer.
 */
import type { Job } from "@/db/schema";
import { createFormLink } from "@/lib/forms";

export async function projectFormLink(job: Job): Promise<string | null> {
  try {
    const { url } = await createFormLink({
      tenantId: job.tenantId,
      kind: "project_brief",
      jobId: job.id,
      customerId: job.customerId ?? undefined,
      source: "crm",
    });
    return url;
  } catch (err) {
    console.error("[crm] project form link unavailable", err);
    return null;
  }
}
