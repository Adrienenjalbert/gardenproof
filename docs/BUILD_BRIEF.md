# GardenProof — Phase 1 build brief (read fully before writing code)

## Product in one paragraph
GardenProof turns every finished garden job into premium marketing assets for UK landscapers. Pilot client:
**Thorburn Landscapes** (high-end residential, SW London: Wimbledon, Putney, Clapham, Richmond…). Crews capture
before/after photos + a voice note over **WhatsApp** in under 60 seconds ("the Muddy Boots Problem": wet gloves,
no patience, if capture takes > 60s it stops within a week). The homeowner gets a WhatsApp message with a link to
rate the job, leave a one-line quote and give **granular consent** (photos / area name / first name — never the
address). An AI content engine then drafts: a **portfolio page** (pushed to Thorburn's WordPress under /projects/),
**ad copy** for Meta + Google PMax, **before/after videos** (3 templates × 3 ratios), a **social pack** for
Instagram and a **Google Business Profile post**. The agency operator (Adrien) reviews and approves everything in
a dashboard before anything goes public. A minimal **lead log** proves which content brings new high-ticket clients.

Phase 1 goal: **more high-ticket enquiries from new clients, backed by fresh proof (testimonials + real work).**

## Non-negotiables
- **Real work only.** AI may crop/resize/colour-balance and write copy; it must never invent gardens, materials,
  plants, prices, ratings or quotes. Every factual claim in copy must trace to job data, crew notes or testimonial.
- **Consent first.** Never use testimonial text, first name, area, or customer photos publicly unless the matching
  consent flag is true. Never publish a street address or house number. Log consent with exact wording.
- **Safe mode (default ON).** Outbound messages to customers are stored with status `held` and only sent after
  agency approval. Crew messages may send immediately. Respect `customers.optedOut` and "STOP".
- **Zero-config demo.** `pnpm seed && pnpm dev` must work with NO env vars: mock AI (deterministic, clearly
  labelled), WhatsApp simulator instead of Twilio, local HTML preview instead of WordPress.
- **British English**, premium calm tone. Banned phrases live in `THORBURN_CONFIG.voice.dontSay`.
- Accessibility + mobile first for anything a crew member or homeowner touches.

## Stack & conventions
- Next.js **16** App Router (`src/app`), React 19, TypeScript strict, Tailwind v4. **This Next version has breaking
  changes — read `node_modules/next/dist/docs/` for anything you're unsure of** (e.g. route `params` are Promises,
  `RouteContext<"/path/[id]">` / `PageProps<"/path/[id]">` / `LayoutProps` are global helpers after `next typegen`;
  `middleware` is now `proxy.ts`).
- DB: Drizzle ORM over **PGlite** locally (embedded Postgres) / Postgres via `DATABASE_URL`. `getDb()` from `@/db`.
  Tables in `src/db/schema.ts`. Always `await getDb()`.
- Shared contracts: `src/lib/domain.ts` (enums + zod schemas for every asset content type — assets.content MUST
  validate against `ASSET_CONTENT_SCHEMAS[type]`), `src/lib/tenant.ts` (TenantConfig, THORBURN_CONFIG,
  `areaFromPostcode`), `src/lib/config.ts` (env flags), `src/lib/storage.ts` (putObject/getObject/publicUrl,
  media served at `/api/media/<key>`), `src/lib/ids.ts`, `src/lib/events.ts` (`logEvent` audit log),
  `src/lib/tenants.ts`, `src/lib/pipeline.ts` (orchestration — read it).
- Brand tokens in `src/app/globals.css` (Tailwind colours `olive`, `olive-dark`, `olive-50/100`, `leaf`, `muted`,
  `line`; fonts `font-display` (Arvo, matches Thorburn's ads) and `font-sans` (Inter)).
- Demo data: `scripts/seed.ts` (3 jobs using real Thorburn stills in `public/demo/`; crew phones +447700900001..3;
  customers +447700900101..3). Tenant id `ten_thorburn`.
- Tests: Vitest (`*.test.ts` next to code or in `tests/`). Tests run on in-memory PGlite (`PGLITE_DIR=memory://`);
  call `await getDb()` and seed what you need inside the test.

## Parallel-work rules (several agents are building at the same time in this same folder)
1. **Only touch files you own** (see your module). Foundation files (`src/db/*`, `src/lib/domain.ts`,
   `src/lib/tenant.ts`, `src/lib/config.ts`, `src/lib/storage.ts`, `src/lib/pipeline.ts`, `src/app/layout.tsx`,
   `src/app/globals.css`, `package.json`, `next.config.ts`) are read-only for you. If you truly need a contract
   change, append a note to `docs/contract-requests.md` explaining exactly what and why, and work around it.
2. **Do not install packages** (`pnpm add/install`). Available: next, react, drizzle-orm, @electric-sql/pglite,
   postgres, zod, @anthropic-ai/sdk, nanoid, sharp, remotion + @remotion/{renderer,bundler,cli,google-fonts},
   vitest, tsx, @playwright/test (Chromium at /opt/pw-browsers). Need something else → contract-requests.md.
3. **Isolate runtime state**: always run with your own `PGLITE_DIR=.data/<module>/pglite`
   `STORAGE_DIR=.data/<module>/storage`, and if you start a dev server use your own port and
   `NEXT_DIST_DIR=.next-<module>`. Never use the default `.data/pglite` or `.next`. Seed your own DB with
   `PGLITE_DIR=... STORAGE_DIR=... pnpm seed`.
4. `pnpm typecheck` covers the whole repo; other modules may be mid-flight. Your own files must be error-free.
5. **Do not `git commit`** — the lead integrates and commits per module.
6. Finish with: your files list, how to run/verify, what's stubbed/mocked, known gaps, and any contract requests.

## Quality bar
Best-in-class, not a prototype: typed end to end, validated inputs (zod) at every boundary (webhooks, forms, AI
output), idempotent handlers, clear errors, unit tests for all pure logic (state machines, lint rules, mappers),
no dead code, small readable files, short doc comments explaining *why*. UI: premium, calm, image-first, olive
brand, generous whitespace, mobile-first, no generic "AI SaaS" look.
