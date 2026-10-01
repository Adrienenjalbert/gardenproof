/** After a maintenance visit: one tap when all is well; a little more only when something isn't. */
import type { FormDefinition } from "../types";
import type { DefinitionContext } from "./context";

export const VISIT_FEEDBACK_GREAT = "great";

export function maintenanceVisitDefinition(ctx: DefinitionContext): FormDefinition {
  const notGreat = [{ step: "feeling", op: "neq" as const, value: VISIT_FEEDBACK_GREAT }];
  return {
    kind: "maintenance_visit",
    version: 1,
    intro: { eyebrow: ctx.businessName, title: "How was today's visit?", subtitle: "One tap is plenty." },
    steps: [
      {
        id: "feeling", short: "Visit",
        kind: "choice",
        layout: "list",
        title: "How does the garden look?",
        options: [
          { value: VISIT_FEEDBACK_GREAT, label: "Looks great", glyph: "thumbs-up" },
          { value: "fine", label: "Mostly fine", glyph: "meh" },
          { value: "issue", label: "Something's not right", glyph: "alert" },
        ],
      },
      {
        id: "issues", short: "To look at",
        kind: "choice",
        layout: "tiles",
        multiple: true,
        title: "What should we look at?",
        when: notGreat,
        options: [
          { value: "lawn", label: "Lawn", glyph: "lawn" },
          { value: "hedges", label: "Hedges", glyph: "scissors" },
          { value: "borders", label: "Borders and beds", glyph: "flower" },
          { value: "tidy", label: "Left untidy", glyph: "leaf" },
          { value: "missed", label: "Something was missed", glyph: "question" },
          { value: "other", label: "Something else", glyph: "sparkle" },
        ],
      },
      {
        id: "note", short: "Note",
        kind: "longtext",
        optional: true,
        maxLength: 800,
        voiceHint: true,
        title: "Anything for next time?",
        placeholder: "e.g. please leave the foxgloves to seed",
      },
      { id: "photo", short: "Photos", kind: "photos", optional: true, max: 3, title: "Can you show us?", subtitle: "A quick photo helps the team put it right.", when: notGreat },
    ],
  };
}
