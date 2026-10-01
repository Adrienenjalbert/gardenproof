/**
 * Types for the crew capture bot. The reducer is pure: everything it needs from the database is
 * pre-loaded into `BotContext`, and everything it wants done comes back as `BotEffect`s.
 */
import type { MediaKind, MediaStage, Team } from "@/lib/domain";
import type { MessageOption } from "@/lib/messaging/types";

export type BotStep =
  | "idle" // nothing in flight
  | "pick_job" // choosing which job to work on
  | "service" // what kind of job is this?
  | "postcode" // where is it? (area tap or typed postcode)
  | "before" // collecting BEFORE photos (+ optional brief voice note)
  | "working" // job under way: progress photos welcome, "Finish job" when done
  | "after" // collecting AFTER photos (+ optional materials voice note), then "Done"
  | "homeowner"; // job wrapped: optional homeowner contact (card or typed mobile) for the review request, or Skip

export type BotState = {
  v: 1;
  step: BotStep;
  jobId: string | null;
  /** Options last shown, so "1"/"2" and typed titles map back to ids. */
  lastOptions: MessageOption[];
  /** Photos arrive as a burst of separate WhatsApp messages; only the first in a burst gets a reply. */
  lastMediaAckAt: number | null;
  /** Unknown numbers get one polite reply per day, not one per message. */
  unknownRepliedAt: number | null;
  /** The just-wrapped job we're asking the homeowner's contact for (step "homeowner"). */
  homeowner: { jobId: string; code: string } | null;
};

export const initialBotState = (): BotState => ({
  v: 1,
  step: "idle",
  jobId: null,
  lastOptions: [],
  lastMediaAckAt: null,
  unknownRepliedAt: null,
  homeowner: null,
});

/** A contact shared as a WhatsApp contact card (vCard), already parsed; the phone is as written on the card. */
export type SharedContact = { firstName: string | null; lastName: string | null; phone: string };

export type InboundEvent = {
  text: string;
  /** Button payload (Twilio ButtonPayload / simulator tap). */
  choiceId: string | null;
  media: { kind: MediaKind }[];
  /** Contact cards in this message (crew sharing the homeowner's details). */
  contacts?: SharedContact[];
};

export type JobSummary = {
  id: string;
  code: string;
  service: string | null;
  serviceLabel: string | null;
  postcode: string | null;
  area: string | null;
  counts: { before: number; progress: number; after: number; audio: number };
  /** Public URL of the first BEFORE photo — sent back as a framing guide for matching angles. */
  firstBeforeUrl: string | null;
};

export type BotContext = {
  now: number;
  role: "crew" | "customer" | "unknown";
  tenantName: string;
  tenantWebsite: string;
  crewName: string | null;
  team: Team;
  /** Tenant services, already ordered for this crew member's team, max 7. */
  services: { key: string; label: string }[];
  /** Area shortcuts for the postcode question (outward code + neighbourhood), max 6. */
  areas: { postcode: string; label: string }[];
  /** Open (capturing) jobs, newest first, max 5. */
  openJobs: JobSummary[];
  activeJob: JobSummary | null;
  /** Pre-generated so the reducer stays pure. Used only if a job is created. */
  newJob: { id: string; code: string };
  /** For customers: the job we last messaged them about (context for the owner notification). */
  customerJobCode: string | null;
  customerName: string | null;
};

export type BotEffect =
  | { type: "reply"; body: string; options?: MessageOption[]; mediaUrls?: string[] }
  | { type: "createJob"; jobId: string; code: string }
  | { type: "updateJob"; jobId: string; patch: { service?: string; postcode?: string | null } }
  | { type: "storeMedia"; jobId: string; stage: MediaStage }
  | { type: "deleteJob"; jobId: string }
  | { type: "completeJob"; jobId: string }
  /** Link the homeowner to the job (find-or-create customer; asks for the review if the job is finished). */
  | { type: "attachCustomer"; jobId: string; contact: { firstName: string | null; lastName: string | null; phone: string } }
  /** Homeowner question answered or skipped: run the job-completed pipeline now rather than after the grace period. */
  | { type: "homeownerStepDone"; jobId: string }
  | { type: "setOptOut"; optedOut: boolean }
  | { type: "notifyOwner"; body: string };

export type ReduceResult = { state: BotState; effects: BotEffect[] };
