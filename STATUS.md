# GardenProof: status and handover (updated 30 Sep 2026)

Everything below is committed on `main` locally. The repo is still not pushed to GitHub — the Claude
session can't authorize `Adrienenjalbert/gardenproof` and the device bridge to Adrien's Mac has been too
flaky to transfer a bundle reliably. Not blocking: this archive is a full, tested, ready-to-run copy.

## Done

### Phase 1 (complete, reviewed, fixed)
- WhatsApp capture bot for crews (about 6 taps), with the homeowner contact step.
- Homeowner review page with 4 separate consents and withdrawal.
- AI content engine (portfolio page, ad copy, social, Google Business Profile post, SEO area articles) with lint checks and evals (10 cases, 100% consent compliance).
- Remotion before/after videos (3 templates x 3 ratios).
- Publishing: WordPress plugin, ad export bundles, lead tracking script, lead log.
- Durable background task queue, privacy rules (originals never public, flagged photos withheld), production config guards.
- Independent QA + code review; 5 P0 and 11 P1 issues fixed.

### v2 (built, not yet integration-tested together)
| Module | What works | Where |
|---|---|---|
| Onboarding from a website URL | Paste a URL: Firecrawl reads brand, logo, header/footer, services, areas, projects and photos. Web search finds review providers and badges, checks each against the business (name, phone, postcode, company number) and rejects look-alikes. | `src/lib/intel/`, `scripts/onboard.ts`, `/api/onboarding` |
| Thorburn profile (real data) | Which? 5.0 (9), Google 5.0 (46), Checkatrade (27 reviews, no rating), aggregate 5.0 from 55. Badges: Which?, TrustMark, Checkatrade, APL verified; HTA, SafeContractor, Jacksons claimed. 5 projects, 30 photos. A same-name Scottish business correctly rejected. | `data/profiles/thorburn-landscapes.json`, `public/intel/thorburn-landscapes/` |
| Owner app (the new `/`) | Today (at most 3 decisions), Jobs by stage with timeline and stage stepper, Showcase (approve/hide pages, videos, reviews), More (team roles, business, message style, notifications), `/start` onboarding flow with confirmation cards. Light and dark mode. | `src/app/(owner)/`, `src/components/owner/`, `src/lib/owner/` |
| CRM engine | Job stages drive timed WhatsApp messages (enquiry reply, site-visit reminders, quote follow-up, prep, review request on finish, aftercare, maintenance visits and renewal). Quiet hours, trust tiers, owner instant alerts and evening digest. | `src/lib/crm-engine/` |
| Smart forms | Enquiry, project brief and maintenance-visit forms: one question per screen, branded, saved every step, resume by link, reminders at 24h/72h then stop. WhatsApp Flow JSON for enquiry and visit. | `src/lib/forms/`, `/enquire/[slug]`, `/f/[token]`, `whatsapp/flows/` |
| v1 agency dashboard | Moved to `/ops`, still working | `src/app/ops/` |

Screens to review: `review/v2/` (owner app at phone and desktop sizes incl. dark mode, onboarding steps, every
form step). Phase 1 screens and videos: `review/`.

Latest test run (30 Sep): **761 tests passing, 0 failing**. Typecheck clean, lint clean, eval 100% (10/10
cases), production build clean (`pnpm build`). Dev server smoke-tested: `/`, `/jobs`, `/more/notifications`
all return 200 on a freshly reseeded database.

## Still to do

### Integration (next session, first)
1. ~~Fix the failing intel entity test and run the full suite, typecheck, lint and production build together.~~ Done 28 Sep — see test run above.
2. ~~Add `/f/`, `/enquire/`, `/api/forms/` to the public paths in `src/lib/dashboard/auth.ts`, and let `/api/media` serve `intel/<slug>/{brand,badges,projects}/` images publicly.~~ Done 28 Sep.
3. ~~Give enquiry jobs a proper status.~~ Traced 28 Sep: not actually a bug. `status: "captured"` on an enquiry job never triggers a review request in practice — that only fires from the `pipeline.job_completed` task, which is queued by the crew-capture bot flow (`onJobCompleted` in `src/lib/pipeline.ts`), and nothing enqueues that task for form-created jobs. Left as-is; the inline comment in `src/lib/forms/complete.ts` explains it. Worth a second pair of eyes at QA time in case a future change makes this assumption stale.
4. ~~Call `moveJobToStage` from the bot (crew taps Done) and when a quote is accepted. Route the WhatsApp `crm_send_all` button to `approveAllAwaiting`. Route inbound WhatsApp Flow replies to `handleFlowCompletion`. Send low-review alerts through `notifyOwner`.~~ Done 29–30 Sep:
   - "Crew taps Done" already moved the job to Finished via `advanceFromCapture` → `moveJobToStage` (traced, not new); "quote accepted" fires `notifyOwner("quote_accepted", …)` from `stage.ts` whenever something calls `moveJobToStage(..., "booked", "customer", ...)` — nothing in this build does that yet (Thorburn takes quote replies by phone/email, not in-app), so there's no in-app trigger to wire until that exists.
   - `crm_send_all`/`crm_open_app` now route to `approveAllAwaiting` and an app-link reply, intercepted in `bot/index.ts` before the crew capture state machine (3 tests).
   - WhatsApp Flow replies (`InteractiveData` on the inbound webhook) now call `handleFlowCompletion` and reply to the customer — a "thanks" when it completed, the web link when gaps remain. Previously dead code: fully built and unit-tested, never wired into the webhook (`src/lib/forms/whatsapp-flow.ts`, `src/app/api/whatsapp/webhook/route.ts`; 3 new tests).
   - Low-review alerts (and the "wants maintenance" note) went through a separate, always-instant send that bypassed Stephen's Settings → Notifications toggle entirely — turning "A review of 3★ or less" off did nothing. Now routed through the CRM engine's settings-aware `notifyOwner`, so the toggle actually works (1 new test).
5. Widen `tenants.settings` type (`messageStyle`, `autoSendRoutine`). Decide the maintenance renewal date (1 year after entering maintenance, or a `renewal_at` column).
6. Independent QA of the full v2 journey plus a code review, then a fix round (same process as Phase 1).
7. Board and Week views on Jobs are gated behind 15+ active jobs (`PIPELINE_VIEWS_MIN_ACTIVE_JOBS` in `jobs-list.tsx`) so a small pilot only ever sees List — revisit the threshold once real usage data exists.

### Not built yet (from the v2 plan)
- **Directory on the-dude.ai:** business homepage and project pages wearing the client's cloned header/footer (the shell is already extracted), area hubs, embed script.
- **Creative v2:**
  - crew 10-second walk-through capture and the matched-frame transformation cut;
  - 2.5D depth parallax on stills;
  - trust strip using the verified badges;
  - CTA setting;
  - new templates.
- **Posting:** direct posting to Instagram, Facebook and Google Business Profile through a posting API.
- **Owner app extras:** an "add job/enquiry" button, and "seen N times" view tracking.
- **Deploy:** a hosted preview for review (container host + Supabase).

## What Adrien needs to provide
| Item | Why |
|---|---|
| Get `Adrienenjalbert/gardenproof` added to this Claude session's authorized repos, or push it yourself from a terminal you control | The session's git proxy still refuses this repo, and the device bridge to your Mac has been dropping mid-transfer |
| Rotate the Firecrawl key later (it was shared in chat) | It is stored only in `.env.local`, never committed |
| Google Maps Platform key (optional) and a Google Business Profile connection from Stephen | Import Google review text, not just the rating |
| Twilio WhatsApp sender, Meta-approved templates, and the two WhatsApp Flows published | Real messages and in-chat forms (steps in `docs/DEPLOY.md` and `whatsapp/flows/README.md`) |
| `ANTHROPIC_API_KEY` | Real copy and real photo privacy screening |
| Stephen: confirm the company number and the HTA / SafeContractor memberships; pick the default offer (e.g. "Free design visit") | Badges and CTA must be accurate |
| Hosting choice (Railway / Fly / Render) + Supabase | To share a live prototype |

## How to run locally
```bash
pnpm install
cp .env.example .env.local   # add FIRECRAWL_API_KEY (not included in this archive)
pnpm seed && pnpm dev        # owner app at /, agency view at /ops, forms at /enquire/thorburn
```
