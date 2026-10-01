import type { FormKind } from "@/lib/crm";
import type { FormDefinition } from "../types";
import type { DefinitionContext } from "./context";
import { enquiryDefinition } from "./enquiry";
import { maintenanceVisitDefinition } from "./maintenance-visit";
import { projectBriefDefinition } from "./project-brief";

export type { DefinitionContext } from "./context";
export { MAINTENANCE_SERVICE } from "./enquiry";
export { VISIT_FEEDBACK_GREAT } from "./maintenance-visit";

/** Kinds served by the smart-form runner. Reviews keep their own page (/r/[token]). */
export const SMART_FORM_KINDS = ["enquiry", "project_brief", "maintenance_visit"] as const;
export type SmartFormKind = (typeof SMART_FORM_KINDS)[number];
export const isSmartFormKind = (k: FormKind | string): k is SmartFormKind => (SMART_FORM_KINDS as readonly string[]).includes(k);

export function buildDefinition(kind: SmartFormKind, ctx: DefinitionContext): FormDefinition {
  switch (kind) {
    case "enquiry":
      return enquiryDefinition(ctx);
    case "project_brief":
      return projectBriefDefinition(ctx);
    case "maintenance_visit":
      return maintenanceVisitDefinition(ctx);
  }
}
