# GardenProof v2 — build brief (read with docs/BUILD_BRIEF.md, which still applies)

Read the "v2 review and plan" decisions summarised here. v1 built a solid engine (WhatsApp capture, consent, content
engine, videos, durable task queue, privacy rules). v2 rebuilds everything a person touches.

## Product decisions (from Adrien)
- The real user is the **owner** (Stephen, Thorburn Landscapes) with two teams (landscaping, maintenance). He manages
  team, jobs, portfolio, comms and reminders himself. Adrien (agency) keeps an ops view as backup.
- **UX is critical: Apple-clean, purified, no text overload, easy learning curve.** Phone-first. Words the owner uses
  (page, video, review, message, job) — never "asset", "check", "task", "pipeline", ids or status codes.
- **CRM is simple and WhatsApp-driven**, not enterprise. A job moves through stages; stage changes schedule timed
  messages (review request when the work is finished, quote follow-ups, visit reminders, maintenance renewals).
- **Notifications:** Stephen only gets important things instantly (new enquiry, review ≤3★, customer needs him, quote
  accepted); the rest goes in one evening digest; failures/retries go to the agency ops view only.
- **Trust tiers** replace approve-everything: automatic / quick yes (one tap on WhatsApp, auto after 30 days) / always ask.
- **Smart forms**: WhatsApp Flows first, web fallback; one question per screen, tap don't type, prefill what we know,
  save every step, resume by link, reminders at 24h and 72h then stop.
- **Onboarding from a website URL**: Firecrawl pulls brand, logo, header/footer, services, areas, projects & photos;
  web search finds every review provider and trust badge (Which?, Checkatrade, TrustMark/APL, HTA, BALI…), verified on
  the body's own site with entity matching (name + postcode/phone/company number). Owner confirms on one screen.
- **Portfolio lives on Adrien's directory domain `the-dude.ai`** (monetisable), each business page wearing the client's
  own cloned header/footer and brand so it feels like their site. Area hubs are under the-dude.ai's own brand.
- **Creative v2**: real crew walk-through clips + 2.5D depth parallax on stills (no AI-invented content), a verified
  trust strip (real badges only) and one clear CTA on every ad.

## Contracts added for v2 (read them)
- `src/lib/intel/types.ts` — `BusinessProfile` (zod) incl. badges with evidence + verification status, review sources,
  featured public reviews, scraped projects, brand tokens, sanitised site shell. Stored in `tenants.profile`.
- `src/lib/crm.ts` — CRM stages + labels, trust tiers, team roles, notification settings, form kinds.
- `src/db/schema.ts` — new: `tenants.profile`, `tenants.settings`, `crew_members.team_role`, `jobs.stage/value_band/
  next_action_at`, tables `job_stage_events`, `scheduled_messages`, `form_responses` (migration drizzle/0002).

## Real data we already found for Thorburn (verify in the pipeline, don't hard-code)
- Site https://thorburnlandscapes.co.uk — brand green #2A7D2E, sand #F1D2A9, dark green #0B3D2C, Montserrat/Roboto,
  logo https://thorburnlandscapes.co.uk/wp-content/uploads/2014/09/logo-header1.png, phone 020 8064 1303,
  info@thorburnlandscapes.co.uk, Wimbledon SW19 3NW, portfolio at /portfolio/..., services at /service/...
- Which? Trusted Traders profile https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/ (5.0, 9 reviews
  at time of search); Checkatrade https://www.checkatrade.com/trades/thorburnlandscapesltd ; TrustMark (APL)
  https://www.trustmark.org.uk/firms/Thorburn%20Landscapes-999505-SW19%203NW?id=80d35511-7f0d-43b9-b8ee-f460b934a09d ;
  London Stone listing; Companies House 09013186; Instagram thorburn.landscapes.
- **Entity-matching trap:** "Thorburn Garden Services | Duns" on Facebook is a DIFFERENT business (Scotland). Must be rejected.
- Note the ads used olive #464A33 but the website brand is green #2A7D2E — directory pages use the website brand.

## Secrets
`FIRECRAWL_API_KEY` is in `.env.local` (gitignored). Never print it, commit it, or put it in client code. Load it via
`process.env` in server code only (for tsx scripts use `node --env-file=.env.local` or `dotenv`-free manual parsing).
