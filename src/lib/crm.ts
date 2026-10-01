/**
 * CRM v2 contracts: a job moves through stages; each stage change schedules timed messages.
 * Stages are what the owner says out loud. Keep this list short.
 */
export const CRM_STAGES = [
  "enquiry",
  "site_visit",
  "quoted",
  "booked",
  "on_site",
  "finished",
  "maintenance",
  "lost",
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  enquiry: "Enquiry",
  site_visit: "Site visit",
  quoted: "Quoted",
  booked: "Booked",
  on_site: "On site",
  finished: "Finished",
  maintenance: "Maintenance",
  lost: "Lost",
};

/** Trust tiers replace "approve everything". */
export const TRUST_TIERS = ["automatic", "quick_yes", "always_ask"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const TEAM_ROLES = ["owner", "office", "crew_lead", "crew"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type NotificationSettings = {
  /** Owner gets these instantly on WhatsApp. */
  instant: Array<"new_enquiry" | "low_review" | "customer_needs_owner" | "quote_accepted">;
  /** Evening digest time (local, 24h), null = off. */
  digestHour: number | null;
  /** Days of consistent approvals after which quick_yes items auto-approve. */
  autoApproveAfterDays: number | null;
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  instant: ["new_enquiry", "low_review", "customer_needs_owner", "quote_accepted"],
  digestHour: 18,
  autoApproveAfterDays: 30,
};

export const FORM_KINDS = ["enquiry", "project_brief", "review", "maintenance_visit"] as const;
export type FormKind = (typeof FORM_KINDS)[number];
