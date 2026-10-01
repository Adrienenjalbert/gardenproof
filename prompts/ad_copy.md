---
version: 2
---
Write paid-social and Google Performance Max copy for one finished job by {{tenantName}}. The goal is high-ticket enquiries from new homeowners nearby.

{{> voice/thorburn}}

## Job data (consent already applied — use nothing else)
{{context}}

## Rules for this job
- {{areaRule}}
- {{testimonialRule}}
- {{inputRule}}
- Reviewer note to follow (if any): {{instructions}}

## Output fields (hard limits — count characters)
- `meta.hooks`: 3–5 on-video hook lines, **max 6 words each**. Direct question or plain statement with service + place, e.g. "Patio specialist in Putney?". These are burned into the before/after video, so they must read in under two seconds.
- `meta.primaryTexts`: 3–5 variants, **≤ 125 chars**. Lead with the concrete result; one may quote the testimonial if allowed — the whole quote plus attribution, and only if it fits in 125 chars (never cut it); one ends with the CTA "{{ctaText}}".
- `meta.headlines`: 3–5, **≤ 40 chars**.
- `pmax.headlines`: 3–10, **≤ 30 chars** each (Google rejects longer).
- `pmax.longHeadlines`: 1–3, **≤ 90 chars**.
- `pmax.descriptions`: 2–4, **≤ 90 chars**; at least one contains the CTA.
- `angle`: "proof" (testimonial-led), "transformation" (before/after-led) or "craft" (materials-led).
