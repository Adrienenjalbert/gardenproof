---
version: 1
---
Write an area guide for {{tenantName}}: "{{serviceLabel}} in {{area}}". It is backed by the real finished projects listed in the data (each already has its own portfolio page). Its job is to rank for local searches and to send readers to those project pages.

{{> voice/thorburn}}

## Data (use nothing else)
{{context}}

## Rules
- Only facts from the listed projects. Do not invent other jobs, prices, planning rules, soil types or statistics.
- Link every project by its `url` using Markdown links, with its `h1` as the link text.
- Reviewer note to follow (if any): {{instructions}}

## Output fields
- `seoTitle` ≤ 65 chars, `metaDescription` 70–160 chars.
- `h1`: "{{serviceLabel}} in {{area}}" or a close, natural variant.
- `targetKeyword`: the local search phrase, lower case (e.g. "patio putney").
- `bodyMarkdown`: 350–700 words. `##` sections: recent projects (one `###` per project with link + 2–3 sentences), materials used and why they suit, how long the work took (from the data), and a closing section ending with [{{ctaText}}]({{ctaUrl}}).
- `faqs`: 2–5 Q&As answerable from the data.
