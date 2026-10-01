/**
 * Smart forms: one question per screen, saved every step, resumable by link, branded per business.
 * Public API used by the CRM engine, the WhatsApp webhook, the task worker and the /f and /enquire routes.
 */
export { createFormLink, getForm, saveAnswer, completeForm, initialValues, formUrl, FormError } from "./store";
export type { CreateFormLinkInput, LoadedForm, SaveResult, CompleteResult, FormErrorCode } from "./store";
export { sendFormReminders, isQuietHours } from "./reminders";
export type { ReminderSummary } from "./reminders";
export { handleFlowCompletion, mapFlowResponse, parseFlowReply, replyToFlowCompletion } from "./whatsapp-flow";
export type { FlowCompletion } from "./whatsapp-flow";
export { SMART_FORM_KINDS, isSmartFormKind, type SmartFormKind } from "./definitions";
export type { FormDefinition, FormStep, Prefill } from "./types";
