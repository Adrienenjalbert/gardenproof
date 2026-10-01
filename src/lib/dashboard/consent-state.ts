/**
 * Why a job's drafts are blocked on consent, in plain English, and what (if anything) the operator can do.
 * QA B12: crew-only jobs used to show "9 assets to review" that could never be approved. Now each blocked job
 * gets one explanation, and only genuinely actionable assets count as "waiting for you".
 */

export type ConsentBlockKind =
  | "no_customer"
  | "opted_out"
  | "request_held"
  | "request_pending"
  | "awaiting_reply"
  | "declined"
  | "needs_edit"
  | "withdrawn"
  | "expired";

export type ConsentBlock = {
  kind: ConsentBlockKind;
  title: string;
  detail: string;
  /** What the operator can do now; null when the ball is in the homeowner's court. */
  action: { label: string; href: string } | null;
};

export type ConsentInputs = {
  jobId: string;
  customer: { firstName: string | null; optedOut: boolean } | null;
  testimonial: {
    status: "pending" | "sent" | "responded" | "expired";
    consentPhotos: boolean | null;
    withdrawnAt: Date | null;
  } | null;
  /** A review-request message for this job is held in the safe-mode outbox. */
  requestHeld: boolean;
  /** Messages of the failing consent checks on the blocked drafts. */
  failedChecks?: string[];
};

export function consentBlock(i: ConsentInputs): ConsentBlock {
  const name = i.customer?.firstName ?? "the homeowner";
  const t = i.testimonial;
  if (!i.customer) {
    return {
      kind: "no_customer",
      title: "No homeowner on this job",
      detail:
        "Nobody has been asked for consent, so these drafts can't go public. Add the homeowner's first name and mobile and we'll prepare a review request.",
      action: { label: "Add homeowner", href: `/ops/jobs/${i.jobId}?tab=testimonial#add-homeowner` },
    };
  }
  if (t?.withdrawnAt) {
    return {
      kind: "withdrawn",
      title: `${name} withdrew consent`,
      detail: "Anything public for this job has been taken down. Reject the remaining drafts.",
      action: { label: "Review drafts", href: `/ops/jobs/${i.jobId}?tab=assets` },
    };
  }
  if (t?.status === "responded" && t.consentPhotos === false) {
    return {
      kind: "declined",
      title: `${name} said no to photos`,
      detail: "These drafts use their garden photos, so they can't be published. Reject them to clear the queue.",
      action: { label: "Review drafts", href: `/ops/jobs/${i.jobId}?tab=assets` },
    };
  }
  if (t?.status === "responded") {
    const why = [...new Set(i.failedChecks ?? [])].join("; ");
    return {
      kind: "needs_edit",
      title: `Drafts use something ${name} didn't agree to`,
      detail: `${why ? `${why}. ` : ""}Edit or regenerate the drafts so they only use what was consented.`,
      action: { label: "Review drafts", href: `/ops/jobs/${i.jobId}?tab=assets` },
    };
  }
  if (i.customer.optedOut) {
    return {
      kind: "opted_out",
      title: `${name} opted out of messages`,
      detail:
        "They replied STOP, so we can't ask for consent on WhatsApp. Drafts stay blocked unless they give consent another way.",
      action: null,
    };
  }
  if (i.requestHeld) {
    return {
      kind: "request_held",
      title: "Review request is held for your approval",
      detail: `Safe mode is on: approve the message so ${name} gets the link to rate the job and choose what we may show.`,
      action: { label: "Open messages", href: "/ops/messages" },
    };
  }
  if (!t || t.status === "pending") {
    return {
      kind: "request_pending",
      title: "Review request being prepared",
      detail: `A request to ${name} is being prepared. It will appear in Messages for approval shortly.`,
      action: null,
    };
  }
  if (t.status === "expired") {
    return {
      kind: "expired",
      title: `${name} didn't reply in time`,
      detail: "The review link lapsed after 48 hours. Contact them directly; drafts stay blocked until consent is recorded.",
      action: null,
    };
  }
  return {
    kind: "awaiting_reply",
    title: `Waiting for ${name}`,
    detail: "The review link has been sent. Drafts unlock as soon as they say yes to photos — nothing to do yet.",
    action: null,
  };
}

/** Blocks where the operator can do something now (add a homeowner, approve a message, clear dead drafts). */
export function isActionable(b: Pick<ConsentBlock, "action">): boolean {
  return b.action !== null;
}
