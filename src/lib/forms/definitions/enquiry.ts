/**
 * New-client enquiry: two easy taps (what, where), then who to speak to, then the details that help the visit.
 * Asking for the mobile third (not last) means someone who stops half way is still a lead: the save & resume
 * reminders can reach them, and the owner hears about it if they never finish (see reminders.ts).
 * Photo cards use the business's own project photos, never stock.
 */
import type { FormDefinition, FormOption } from "../types";
import type { DefinitionContext } from "./context";

export const MAINTENANCE_SERVICE = "maintenance";

export function enquiryDefinition(ctx: DefinitionContext): FormDefinition {
  const notJustMaintenance = [{ step: "services", op: "notOnly" as const, value: MAINTENANCE_SERVICE }];
  const services: FormOption[] = [
    ...ctx.services.map((s) => ({ value: s.key, label: s.label, image: s.image ?? null, glyph: s.glyph })),
    { value: "unsure", label: "Not sure yet", hint: "Happy to talk it through", glyph: "question" as const, exclusive: true },
  ];
  return {
    kind: "enquiry",
    version: 1,
    intro: {
      eyebrow: ctx.businessName,
      title: "Tell us about your garden",
      subtitle: "About a minute, mostly taps. Everything saves as you go.",
    },
    steps: [
      { id: "services", short: "Work", kind: "choice", layout: "photo", multiple: true, title: "What would you like done?", subtitle: "Pick as many as you like.", options: services },
      { id: "postcode", short: "Area", kind: "postcode", title: "What's the garden's postcode?", subtitle: "So we know it's in our patch. We never publish addresses." },
      {
        id: "contact", short: "Contact",
        kind: "contact",
        askEmail: false,
        title: "Who should we speak to?",
        subtitle: "So we can pick up where you left off if you're interrupted. A few quick taps to go after this.",
        consentText: `${ctx.businessName} may contact me by phone or WhatsApp about this enquiry.`,
      },
      {
        id: "size", short: "Garden size",
        kind: "choice",
        layout: "tiles",
        title: "How big is the garden?",
        subtitle: "A rough idea is perfect.",
        options: [
          { value: "small", label: "Small", hint: "Courtyard or town garden, up to 50 m²", glyph: "ruler-s" },
          { value: "medium", label: "Medium", hint: "Family garden, 50–150 m²", glyph: "ruler-m" },
          { value: "large", label: "Large", hint: "Over 150 m²", glyph: "ruler-l" },
          { value: "unsure", label: "Not sure", hint: "We'll measure up", glyph: "question" },
        ],
      },
      ...(ctx.styles.length >= 2
        ? [
            {
              id: "style", short: "Style",
              kind: "choice" as const,
              layout: "photo" as const,
              multiple: true,
              optional: true,
              max: 3,
              title: "Which of our gardens feels closest?",
              subtitle: "Tap any that catch your eye, up to three.",
              when: notJustMaintenance,
              options: [...ctx.styles, { value: "unsure", label: "None of these, I have my own ideas", glyph: "sparkle" as const, exclusive: true }],
            },
          ]
        : []),
      {
        id: "budget", short: "Budget",
        kind: "budget",
        title: "Roughly what budget do you have in mind?",
        subtitle: "It helps us suggest ideas that fit. It's not a commitment.",
        when: notJustMaintenance,
        options: [
          { value: "under_10k", label: "Under £10k" },
          { value: "10_20k", label: "£10k – £20k" },
          { value: "20_40k", label: "£20k – £40k" },
          { value: "40_75k", label: "£40k – £75k" },
          { value: "75k_plus", label: "£75k +" },
          { value: "guidance", label: "I'd like guidance" },
        ],
      },
      {
        id: "frequency", short: "Visits",
        kind: "choice",
        layout: "list",
        title: "How often would you like us?",
        when: [{ step: "services", op: "only", value: MAINTENANCE_SERVICE }],
        options: [
          { value: "weekly", label: "Every week" },
          { value: "fortnightly", label: "Every two weeks" },
          { value: "monthly", label: "Once a month" },
          { value: "seasonal", label: "Seasonal visits", hint: "Spring, summer and autumn" },
          { value: "one_off", label: "A one-off tidy" },
        ],
      },
      {
        id: "timing", short: "Timing",
        kind: "date",
        allowDate: true,
        title: "When would you like it done?",
        options: [
          { value: "asap", label: "As soon as possible", glyph: "sun" },
          { value: "3_months", label: "In the next 3 months", glyph: "leaf" },
          { value: "6_months", label: "In 3 to 6 months", glyph: "sprout" },
          { value: "planning", label: "Just planning ahead", glyph: "sparkle" },
          { value: "date", label: "By a certain date", glyph: "calendar" },
        ],
      },
      {
        id: "photos", short: "Photos",
        kind: "photos",
        optional: true,
        max: 6,
        title: "Got a few photos of the garden?",
        subtitle: "Optional, but it helps us come prepared.",
        tips: ["Wide shots from the house work best", "The garden as it is today is perfect"],
      },
      {
        id: "callTime", short: "Best time to call",
        kind: "timeWindow",
        title: "When's best for a quick call?",
        subtitle: `${ctx.ownerFirstName ?? "We"}'ll call to talk through your ideas.`,
        days: [
          { value: "weekdays", label: "Weekdays" },
          { value: "saturday", label: "Saturday" },
        ],
        windows: [
          { value: "morning", label: "Morning", hint: "8–12" },
          { value: "afternoon", label: "Afternoon", hint: "12–5" },
          { value: "evening", label: "Early evening", hint: "5–7" },
        ],
      },
    ],
  };
}
