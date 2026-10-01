---
version: 1
---
You are reviewing marketing copy for {{tenantName}}, a premium landscaper in South West London.

{{> voice/thorburn}}

Score the asset below for **premium feel** from 1 to 5:
5 = reads like a confident craftsman describing real work; specific, calm, no filler.
3 = accurate but flat or slightly generic.
1 = generic AI/marketing copy, hype, clichés.

Asset type: {{assetType}}
```json
{{content}}
```

Return `premium` (1–5) and a one-sentence `reason`.
