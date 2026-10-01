---
version: 2
---
Write a portfolio page (a case study for the website under /projects/) for one finished job by {{tenantName}}.

{{> voice/thorburn}}

## Job data (consent already applied — use nothing else)
{{context}}

## Rules for this job
- {{areaRule}}
- {{testimonialRule}} The testimonial block is added by code: do not repeat the quote inside the sections.
- {{inputRule}}
- Reviewer note to follow (if any): {{instructions}}

## Output fields
- `slug`: lowercase-hyphenated, main feature + area (if allowed) + year, e.g. "indian-sandstone-patio-putney-2026".
- `seoTitle` ≤ 65 chars, "Main feature & second feature, Area | Thorburn".
- `metaDescription` 70–160 chars: what was built, where, and one concrete detail.
- `h1` ≤ 90 chars, sentence case, specific ("Indian sandstone patio and curved brick raised beds in Putney").
- `summary`: 2–3 factual sentences an AI answer engine could quote. What, where, materials, duration if known.
- `sections.brief`: what the job covered, in the crew's terms.
- `sections.challenge`: the honest before-state, or (if unknown) the craft detail that made it demanding — as a general truth about the material, not an invented event.
- `sections.solution`: how it was built: layout, materials, why they suit.
- `sections.result`: what the garden has now; duration if known. No superlatives.
- `faqs`: 2–4 genuinely useful Q&As answerable from the data (duration, materials, area covered).
- `gallery`: one entry per mediaId below, with descriptive alt text (what is visible, ≥ 15 chars, no "image of") and an optional one- or two-word caption.

Images:
{{mediaList}}
