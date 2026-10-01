
## Module E (dashboard) — ignore per-module build dirs in Tailwind source scanning
Tailwind v4 auto-detects class candidates from every non-gitignored file. `.next-<module>/` dist dirs and `.data/`
are not in `.gitignore`, so Tailwind scans compiled chunks/binary caches and can emit garbage candidates that break
CSS parsing (seen: `padding-bottom: env(safe-area-K G 0)` → "Parsing CSS source code failed" 500 on every page).
Request: add `/.next-*/` and `/.data/` to `.gitignore` (or `@source not "../../.next-*";` + `@source not "../../.data";`
in `globals.css`). Module E worked around it by not using arbitrary `env()` classes.

## Module E (dashboard) — re-run checks after a manual edit
The dashboard lets the operator edit asset content (structured fields or JSON, validated with ASSET_CONTENT_SCHEMAS,
version bumped). `assets.checks` then describes the *previous* text. Request: content engine exports
`recheckAsset(assetId: string): Promise<void>` that re-lints the stored content (banned phrases, limits, consent,
fact tracing) and writes `assets.checks`. The dashboard already calls it if present (`recheckAssetOptional` in
src/lib/dashboard/optional.ts) and silently skips it otherwise. Likewise `regenerateAsset(assetId, instructions?)`
from @/lib/content and `renderVideoAsset(assetId)` from @/lib/video are called via guarded dynamic import.

## Module B (content engine) — notes for other modules
- **Publisher (D) should hold assets with a failing `consent-photos` check.** When the homeowner has not responded
  (or the request expired), module B still drafts content (generic area, no name/quote) as the pipeline requires, but
  adds `{ id: "consent-photos", ok: false }` to `assets.checks`. Publishing those photos would breach "consent first".
  Suggest `publishAsset` refuses while any check with id `consent-photos` or `privacy` is `ok: false`.
- **Video (C):** hooks for burned-in text are at `ad_copy.content.meta.hooks` (≤ 6 words each, lint-enforced).
  Hero media ids are in `jobs.enrichment.heroBeforeMediaId/heroAfterMediaId` and `media.isHero`.
  Images whose `media.qualityNotes` contain "needs blur" must not be used until a blurred `publicKey` exists.
- **Dashboard (E):** `recheckAsset(assetId)` and `regenerateAsset(assetId, instructions?)` are exported from
  `@/lib/content` (recheck returns the new checks array; it is safe to ignore).
- **package.json (lead):** please add `"content:demo": "tsx scripts/generate-demo-content.ts"` and
  `"eval": "tsx evals/run.ts"`.

## Module A (capture bot / testimonials / messaging)
1. **`messages.meta jsonb` (e.g. `{ testimonialId, jobId }`)** — the testimonial loop links a held homeowner message to its
   testimonial by parsing `/r/<token>` out of `messages.body` (`syncTestimonialWithMessage`). Works, but a typed link is cleaner.
2. **`TenantConfig.areas` should be an ordered array** (`{ outward, name }[]`) — `tenants.config` is jsonb, which re-orders
   object keys, so the "preferred" area order is lost. The bot now orders area shortcuts by job/customer frequency, then name.
3. **Scheduler for `expireStaleTestimonials(now)`** (48h no reply -> expired -> `onReadyForContent`). Needs a cron route
   (e.g. `/api/cron/testimonials`, hourly) owned by whoever owns cron/ops. The /r page already shows lapsed links as expired.
4. **WhatsApp templates**: business-initiated messages outside the 24h window (the homeowner request) need an approved
   Twilio Content template (`ContentSid` + variables). `sendMessage` currently sends free-form `Body`; add
   `templateSid?`/`templateVars?` to `OutboundMessage` once templates are approved in Meta.
5. **Dashboard**: `approveHeldMessage(id, actor)` / `cancelHeldMessage(id, actor)` from `@/lib/messaging` are the calls for the
   "held messages" queue. `/api/simulator/*` is (correctly) behind the dashboard login when ADMIN_PASSWORD is set, while the
   `/simulator` page itself is public in `isPublicPath`; consider making `/simulator` private too.

## Module C (video) — requests and notes
1. **package.json scripts (lead):** `"video:samples": "tsx scripts/render-samples.ts"` and
   `"video:studio": "remotion studio video/index.ts"` (Remotion Studio preview of the three compositions).
2. **`review/videos/*.mp4` size:** the 18 sample renders are ~2–4 MB each (~50 MB). Commit them for the client review
   or add `/review/videos/*.mp4` to `.gitignore` and share the folder separately — lead's call.
3. **Chromium:** renders use `REMOTION_BROWSER_EXECUTABLE`, else `/opt/pw-browsers/chromium_headless_shell-*/…/headless_shell`,
   else Remotion downloads its own (blocked in this sandbox). Production render workers should set the env var or allow
   the download once. No tsconfig change needed: `video/**` is inside the TS project and typechecks.
4. **Check ids:** video assets use the same `consent-photos` check id as module B (ok:false until the homeowner consents),
   so the publisher's hold rule covers videos too. Other ids: `public-derivative`, `which-rating`, `hook-source`,
   `fallback`, `low-rating`, `render`.
5. **Fonts:** Arvo + Nunito Sans woff2 (SIL OFL) are bundled in `video/fonts/` instead of loading
   `@remotion/google-fonts` at render time — headless Chromium could not reach fonts.gstatic.com here (proxy), and a
   silent fallback font is worse than no render. `@remotion/google-fonts` is therefore unused by module C.
6. **Dashboard (E):** `renderVideoAsset(assetId)` is exported from `@/lib/video`; it applies an edited `content.hook`
   (which wins over `content.props.hook`) and returns the id of the row holding the new render (a new version when
   the asset was approved/published). Rendering takes minutes — call it from a background job, not a request handler.

## Module D (publishing / website) — requests and notes
1. **leads table (schema):** add `attribution jsonb` holding both touches (`{ first: Touch, last: Touch }`). Today the
   columns store the FIRST touch (source/medium/campaign/content/term/landing/referrer) and the LAST touch's click ids
   (gclid/fbclid, what Google/Meta offline-conversion import needs). The full last touch is currently dropped.
2. **Root layout (`src/app/layout.tsx`):** set `metadataBase: new URL(env.appUrl)` — Next warns on every preview page
   that OG image URLs are resolved against localhost.
3. **Dashboard (E):** `publishAsset(id)` now returns `{ assetId, status, mode: "wordpress"|"local"|"export",
   externalId, externalUrl }` and throws `PublishError` (clean message; details also appended to `reviewNotes` as a
   `Publish failed: …` line, removed on the next success). It accepts `approved` and `published` (re-sync) assets and
   HOLDS any asset with a failing `consent-photos` or `privacy` check (module B's request). Export links
   (`/api/export/<assetId>`) stay behind the dashboard login; `/api/export/portfolio.json`, `/preview/*`,
   `/portfolio`, `/api/leads` and `/gp-track.js` are public (already covered by `isPublicPath` / the proxy matcher).
4. **Media safety:** the publisher never uses a photo whose `qualityNotes` says "needs blur" until its `publicKey`
   differs from `storageKey` (module B's note). Module B/C should write the blurred derivative to a new key.
5. **package.json (lead), optional:** `"plugin:zip": "cd wordpress && zip -rq ../public/gardenproof-portfolio.zip gardenproof-portfolio"`
   so the dashboard can offer the plugin download; and `"sample:publish": "tsx tests/fixtures/insert-mod-d-sample.ts"`.
6. **`next dev` rewrites tsconfig.json** when started with `NEXT_DIST_DIR=.next-<module>` (adds `.next-<module>/types`
   to `include`). Module D reverted its own addition; the lead may see the same from other modules.

## v2 Smart forms — requests and notes
1. **Public paths (`src/lib/dashboard/auth.ts`, PUBLIC_PREFIXES):** add `"/f/"`, `"/enquire/"` and `"/api/forms/"`.
   Homeowners and website visitors must reach the form without a dashboard login; every forms API call is scoped by
   its unguessable token, same-origin checked and rate-limited. Without this, with ADMIN_PASSWORD set, enquiry links
   redirect to /login.
2. **WhatsApp webhook (bot/owner of `src/app/api/whatsapp`):** when an inbound message carries `InteractiveData`
   (a WhatsApp Flow reply), call `handleFlowCompletion({ interactiveData, from })` from `@/lib/forms` and, for
   `status: "incomplete"`, reply with `res.url` ("Nearly there, just finish the last questions here: …").
3. **Env (optional):** `TWILIO_TEMPLATE_FORM_REMINDER` (HX… ContentSid) for business-initiated form reminders outside
   the 24h window; see whatsapp/flows/README.md. Read with `process.env` inside `src/lib/forms/reminders.ts` because
   `config.ts` is read-only for this module; the lead may move it into `env.twilio`.
4. **Enquiry jobs use `jobs.status = "captured"`** (content pipeline) with `stage = "enquiry"`. The default
   `"capturing"` would make an enquiry look like an open crew capture in `bot/context.ts`. A dedicated status (e.g.
   `"lead"`) in `JOB_STATUSES` would be cleaner; until then, anything that lists `captured` jobs as "ready for review
   request" should also check `stage` (the dashboard / `attachCustomerToJob` REQUESTABLE list).

## Intel (onboarding from a website URL) — requests and notes
1. **Public media for intel images (`src/lib/publish/access.ts` → `isPublicStorageKey`):** onboarding stores the logo,
   badge logos (as shown on the business's own site), project photos and a homepage screenshot under
   `intel/<tenant-slug>/{brand,badges,projects,shell}/…`. Directory pages on the-dude.ai need `brand/`, `badges/` and
   `projects/` to be publicly servable via `/api/media/<key>` (they are already public on the business's website).
   `shell/homepage.jpg` should stay operator-only. Until then only the dashboard session can load them; prototypes can use
   the copies in `public/intel/thorburn-landscapes/…` (same relative paths as the storage keys).
2. **Shell CSS:** `profile.shell.css` starts with a Google Fonts `@import`, so it must be the first thing in its `<style>`
   element. Header/footer HTML is already sanitised (only `gp-` classes, no scripts/styles/forms) and can be inserted as-is.
3. **Google reviews:** Maps gives the star rating and count only (no review text, sometimes no count). A Google Business
   Profile connection is needed to import Google reviews; the profile carries a warning saying so.
4. **Optional env:** `INTEL_CACHE_DIR` (default `.data/intel-cache`) for the Firecrawl/download cache; `FIRECRAWL_API_KEY`
   is required for real runs (server only). No schema or types.ts change was needed.

## v2 Owner app + CRM engine — requests and notes
1. **`tenants.settings` type (schema, lead):** the owner app stores two more keys next to `notifications`:
   `messageStyle: { tone: "warm" | "professional" | "brief"; signOff: string | null }` and `autoSendRoutine: boolean`
   (routine customer messages skip the safe-mode hold). Read/written only through `src/lib/crm-engine/settings.ts`
   (one cast). Please widen the `$type<…>` in `src/db/schema.ts` to include them.
2. **WhatsApp bot (capture/bot owner):** owner notifications carry quick-reply buttons `crm_send_all` and `crm_open_app`
   (`OWNER_BUTTONS` in `@/lib/crm-engine`). When the owner taps **Send all**, call
   `approveAllAwaiting(tenantId, "owner")` (sends every quick-yes message waiting; never the "always ask" ones).
   `crm_open_app` → reply with the app link.
3. **Stage changes from other modules:** call `moveJobToStage(jobId, stage, actor)` from `@/lib/crm-engine`:
   - smart forms / enquiry page creating a job → `moveJobToStage(jobId, "enquiry", "customer")` (records the event,
     plans the acknowledgement with a project-form link, notifies the owner instantly if he asked for that);
   - crew tapping **Done** in the bot → `moveJobToStage(jobId, "finished", crewId)` (plans the review request and the
     aftercare offer; `requestTestimonial` stays idempotent so the v1 pipeline path can't double-ask);
   - a customer accepting a quote → `moveJobToStage(jobId, "booked", "customer", null, { at: startDate })`.
4. **Testimonials (low ratings):** `notifyOwner` in `src/lib/testimonials/owner.ts` always messages the owner. To honour
   the owner's notification settings use `notifyOwner(tenantId, "low_review", text)` from `@/lib/crm-engine` instead
   (instant when switched on, else in the evening digest).
5. **Maintenance renewal date:** derived as one year after the job entered `maintenance` (no column). If contracts
   have explicit dates, a `jobs.renewal_at` column would make the renewal rule exact.
6. **`next dev` + tsconfig:** as noted by module D, `next dev` with `NEXT_DIST_DIR=.next-owner` adds include lines;
   reverted after each run.
