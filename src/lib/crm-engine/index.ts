/**
 * CRM engine: a job moves through stages; each stage change plans timed WhatsApp messages (rules.ts), which the
 * every-minute sweep sends or queues for a one-tap yes according to their trust tier (dispatch.ts).
 *
 *   owner/customer/system moves a job ─► moveJobToStage ─► job_stage_events + scheduled_messages
 *   task "crm.dispatch_due" (every minute) ─► dispatchDueMessages ─► @/lib/messaging (safe mode, opt-out)
 *                                                              └─► owner batch / evening digest
 *   owner taps Send / Skip / Edit ─► approvals.ts
 */
export { dispatchDueMessages } from "./dispatch";
export type { DispatchSummary, DispatchOptions } from "./dispatch";
export { moveJobToStage, previewStageMove, replan, StageError } from "./stage";
export type { MoveResult, MoveOptions } from "./stage";
export { advanceFromCapture } from "./capture";
export type { CaptureSignal } from "./capture";
export {
  approveScheduledMessage,
  skipScheduledMessage,
  editScheduledMessage,
  approveAllAwaiting,
  ApprovalError,
} from "./approvals";
export { notifyOwner, OWNER_BUTTONS } from "./notify";
export { RULES, ruleOf, instanceKey } from "./rules";
export type { Rule, RuleContext } from "./rules";
export { planMessages, quickYesEarned } from "./plan";
export { loadSettings, saveSettings, readSettings, TONES, INSTANT_KINDS, OutputsInput } from "./settings";
export type { OwnerSettings, MessageStyle, Tone, InstantKind } from "./settings";
export { findOwner, findCrewLead } from "./context";
export { isQuietHour, outsideQuietHours, londonAt, londonDateKey } from "./time";
