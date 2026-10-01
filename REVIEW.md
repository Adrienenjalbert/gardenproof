# Reviewing Phase 1

A 15-minute review path, then the evidence behind it.

## 1. Run it (2 minutes)

```bash
pnpm install && pnpm seed && pnpm dev   # http://localhost:3000
```

## 2. Walk the journey (10 minutes)

| # | As | Do | Look for |
|---|---|---|---|
| 1 | Crew (Marco) | `/simulator` → paperclip → pick a before still → tap service → tap area → Next → Finish job → after still → Done → Skip | Under 60 seconds, about 6 taps, no typing. The framing guide echoes the before photo. |
| 2 | Agency | `/messages` | The homeowner request is **held** (safe mode). Approve it. |
| 3 | Homeowner | Open the `/r/…` link from the simulator (Harriet) | Premium page, her garden as the hero, 4 separate permissions that default to off, "never your address". |
| 4 | Agency | `/review`, `/jobs/<id>` | Every asset shows automated checks. Photos show privacy status. Consent wording is stored verbatim. |
| 5 | Agency | Open the portfolio page preview | Thorburn brand, before/after slider, facts, story, testimonial only if consented, one CTA. |
| 6 | Agency | Approve → watch "Publishing…" → `/portfolio` | Publishing runs in the background and is retried if it fails. |
| 7 | Agency | `/leads` | Which asset (video, ad, page) brought each enquiry, first vs last touch. |

## 3. Evidence in this repo

| What | Where |
|---|---|
| Whole-journey screenshots (53 steps, phone and desktop) | [`review/journey/`](review/journey) |
| Screens after the fix round (privacy, consent, background work, leads) | [`review/screens/f4-*.jpg`](review/screens) |
| Module screenshots (simulator, homeowner page, portfolio, WordPress templates, dashboard) | [`review/screens/`](review/screens) |
| Sample videos (3 committed; 18 rendered, all listed in `renders.json`) | [`review/videos/`](review/videos): `pond-reveal-9x16.mp4`, `patio-proof-1x1.mp4`, `pond-process-16x9.mp4` + contact sheets |
| Generated content sample (portfolio page + ad copy JSON) | [`review/samples/content-job_patio.json`](review/samples/content-job_patio.json) |
| Content evals: 10 golden cases, rubric 100%, consent 100% | [`evals/report.md`](evals/report.md) |
| Independent QA report (browser journey) | [`review/QA_REPORT.md`](review/QA_REPORT.md) |
| Independent code review (security, privacy, robustness) | [`review/CODE_REVIEW.md`](review/CODE_REVIEW.md) |

Quality gates at the time of this PR: **514 tests passing**, `tsc` strict clean, ESLint clean, production build clean.

## 4. How it was built

1. Shared contracts first: domain types, DB schema, tenant config and the pipeline.
2. Five module agents built in parallel on those contracts: capture and messaging, content engine, video, publishing and website, dashboard.
3. An independent QA agent walked the full journey in a real browser.
4. An independent code reviewer audited security, privacy and robustness. It found **5 P0 and 11 P1** issues.
5. Four fix agents resolved them in parallel. The main fixes:
   - original photos (with GPS) are never served publicly;
   - flagged photos are withheld until cleared;
   - a separate consent for the quote;
   - homeowner capture in the bot and the dashboard;
   - a durable task queue instead of in-request work;
   - idempotent approvals;
   - production config guards;
   - consent withdrawal with unpublish;
   - no truncated quotes;
   - honest thin-input copy;
   - lead attribution per asset;
   - the open-redirect fix.

> The journey screenshots in `review/journey/` were taken **before** the fix round (for example they show 3
> consents; there are now 4). The `f4-*` screenshots show the fixed dashboard.

## 5. Before the Thorburn pilot goes live

| Needed | Owner | Notes |
|---|---|---|
| Twilio WhatsApp sender + Meta-approved review-request template | Adrien | Template text is in `docs/DEPLOY.md`. Business-initiated messages need it. |
| `ANTHROPIC_API_KEY` | Adrien | Real copy **and real privacy screening** (faces, plates, house numbers). Demo mode can't detect them. |
| `OPENAI_API_KEY` (optional) | Adrien | Voice-note transcription. Without it the bot relies on crew notes. |
| Install the WordPress plugin + Application Password | Adrien + Stephen | Tested against a fake WordPress REST server and a stub harness, **not yet on a real WordPress install**. Do a staging run first. |
| Confirm the Which? rating (4.9) and add Google / Which? review URLs | Stephen | `THORBURN_CONFIG.proof`. Review buttons stay hidden until the URLs are set. |
| Hosting | Adrien | Railway, Fly or Render + Supabase (see `docs/DEPLOY.md`). Use a persistent volume for media during the pilot (see known gaps). |
| Privacy notice / PECR check for `gp-track.js` attribution | Stephen | localStorage only, no cookies, but check it against their policy. |

## 6. Known gaps (deliberate, tracked)

- **No automatic blurring.** Flagged photos are withheld until an operator clears them. A real blur step can write `media.blurredKey` later.
- **Supabase Storage** adapter exists, but the video renderer and range-streaming media route still read from local disk. For the pilot, run with a persistent volume, or finish wiring `localObjectPath` in the renderer and a signed-URL path in `/api/media`.
- **One web instance.** The bot's per-phone lock, login throttling and the lead rate limiter are in memory.
- **Posting via API is not built.** GBP, Meta and Google Ads use export files (CSV, text, mp4). Direct API posting is Phase 2.
- **Area SEO articles** are not retracted automatically when a homeowner withdraws consent.
- **Which? rating confirmation** is a manual check (amber until confirmed). A `proof.whichRatingConfirmedAt` setting would close it.
- **Demo stills are 720px**, so 16:9 video crops are soft. Real crew photos fix this.
