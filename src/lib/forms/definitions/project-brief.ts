/** After the site visit: the practical brief the design and the crew need. Asked once, saved step by step. */
import type { FormDefinition } from "../types";
import type { DefinitionContext } from "./context";

export function projectBriefDefinition(ctx: DefinitionContext): FormDefinition {
  return {
    kind: "project_brief",
    version: 1,
    intro: { eyebrow: ctx.businessName, title: "Your project brief", subtitle: "A few details so the design and the team get it right first time." },
    steps: [
      {
        id: "mustHaves", short: "Must-haves",
        kind: "choice",
        layout: "tiles",
        multiple: true,
        title: "What's on your must-have list?",
        subtitle: "Pick everything that matters.",
        options: [
          { value: "dining", label: "Somewhere to sit and eat", glyph: "patio" },
          { value: "lawn", label: "A lawn", glyph: "lawn" },
          { value: "planting", label: "Planting and colour", glyph: "flower" },
          { value: "privacy", label: "Privacy and screening", glyph: "fence" },
          { value: "lighting", label: "Lighting", glyph: "sun" },
          { value: "water", label: "Water feature", glyph: "sparkle" },
          { value: "garden_room", label: "Garden room or studio", glyph: "house" },
          { value: "play", label: "Space for children", glyph: "sprout" },
          { value: "low_maintenance", label: "Low maintenance", glyph: "scissors" },
          { value: "storage", label: "Storage", glyph: "wrench" },
        ],
      },
      ...(ctx.styles.length >= 2
        ? [
            {
              id: "styleRefs", short: "Style references",
              kind: "choice" as const,
              layout: "photo" as const,
              multiple: true,
              optional: true,
              max: 4,
              title: "Anything here you'd like to borrow from?",
              subtitle: "Our own recent gardens. Tap any that feel right.",
              options: ctx.styles,
            },
          ]
        : []),
      {
        id: "inspiration", short: "Inspiration",
        kind: "photos",
        optional: true,
        max: 8,
        title: "Any inspiration of your own?",
        subtitle: "Screenshots from Pinterest, Instagram or magazines are perfect.",
      },
      {
        id: "access", short: "Access",
        kind: "choice",
        layout: "list",
        title: "How do we get into the garden?",
        options: [
          { value: "side_gate", label: "Side gate or side passage", glyph: "gate" },
          { value: "through_house", label: "Through the house", glyph: "house" },
          { value: "rear_access", label: "Rear lane or back gate", glyph: "gate" },
          { value: "unsure", label: "Not sure, let's check on site", glyph: "question" },
        ],
      },
      {
        id: "accessNotes", short: "Access notes",
        kind: "longtext",
        optional: true,
        maxLength: 600,
        voiceHint: true,
        title: "Anything we should know about access?",
        subtitle: "Gate width, steps, keys, neighbours…",
        placeholder: "e.g. the side gate is about 90cm wide and there are three steps down",
      },
      { id: "pets", short: "Pets", kind: "yesno", title: "Any pets at home?", yes: "Yes", no: "No pets" },
      {
        id: "petNotes", short: "About the pets",
        kind: "text",
        optional: true,
        maxLength: 200,
        title: "Tell us about them",
        subtitle: "So the team can keep gates shut and say hello.",
        placeholder: "e.g. two spaniels, Bramble is shy",
        when: [{ step: "pets", op: "eq", value: true }],
      },
      {
        id: "parking", short: "Parking",
        kind: "choice",
        layout: "list",
        title: "Where can the team park?",
        options: [
          { value: "driveway", label: "On the driveway", glyph: "car" },
          { value: "street_free", label: "On the street, free", glyph: "car" },
          { value: "street_permit", label: "Permit or pay and display", glyph: "car" },
          { value: "none", label: "Parking is tricky", glyph: "alert" },
        ],
      },
      {
        id: "anythingElse", short: "Also",
        kind: "longtext",
        optional: true,
        maxLength: 1500,
        voiceHint: true,
        title: "Anything else on your mind?",
        placeholder: "Plants you love, things to keep, dates to work around…",
      },
    ],
  };
}
