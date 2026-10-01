# Deploying GardenProof (pilot)

## Recommended shape

| Piece | Recommendation | Why |
|---|---|---|
| App + worker | One Docker image (`Dockerfile`) on a **long-running container host**: Railway, Fly.io or Render. Run it as two services: **web** (`pnpm start`, `WORKER=off`) and **worker** (`pnpm worker`). | Video renders take 45–90 s each (6–9 per job) and need headless Chromium; content generation takes a minute of AI calls. These need a process that stays up. |
| Database | **Supabase Postgres** (`DATABASE_URL`). | Managed Postgres with backups. The task queue lives in the same database, so there is nothing else to run. |
| Media | **Supabase Storage**, private bucket (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`). | Containers have ephemeral disks. The bucket stays private: browsers only ever get media through `/api/media/…`, which decides what may be served. |
| WhatsApp | Twilio WhatsApp sender + one approved Content template. | See below. |
| Website | Client's WordPress + the `gardenproof-portfolio` plugin. | See below. |

For a small pilot, a single service with the in-process worker (leave `WORKER` unset) is fine. Split out the
worker when renders start slowing the dashboard.

### Why not Vercel serverless
The earlier `vercel.json` cron setup has been removed. Serverless functions are the wrong home for this pipeline:
- Remotion renders need Chromium, a webpack bundle and several minutes of CPU per job, which is beyond function
  limits (size, duration, memory). Work started in `after()` is killed at the time limit and nothing retries it.
- The local disk is read-only or ephemeral, so crew photos written there are lost.
- The durable queue needs a worker that polls continuously. Vercel can still host the **web** part if you want,
  but it then needs a separate always-on worker (container) and Supabase Storage. One container host running both
  services is simpler.

## How background work runs
Nothing slow runs inside a request. Webhooks, forms, the dashboard and cron only **enqueue** rows in the `tasks`
table. The worker claims them (`FOR UPDATE SKIP LOCKED`, so several workers are safe), runs them with a timeout,
retries with exponential backoff (30 s, 1 min, 2 min…, 3 attempts by default) and records failures in the
audit log (`task.failed`). A task left `running` for more than 30 minutes (a crashed worker) goes back to the queue.

| Task | Queued by | Does |
|---|---|---|
| `pipeline.job_completed` | Crew taps Done (runs after the homeowner-contact step, or 15 min later) | Enrich photos + voice notes, request the testimonial (or go straight to content) |
| `pipeline.ready_for_content` | Homeowner submits, request cancelled, 48 h expiry, dashboard "Generate" | Draft text assets, then queue the renders |
| `video.render_job` / `video.render_asset` | After content / dashboard re-render | Remotion renders |
| `content.regenerate` | Dashboard "Regenerate with note" | New draft version |
| `asset.publish` / `asset.unpublish` | Dashboard approve / consent withdrawn | WordPress / exports |
| `testimonials.expire` | The worker itself, hourly (reschedules itself) | 48 h unanswered links → content without a testimonial |

The dashboard lists failed tasks and can retry them. `GET/POST /api/cron/testimonials` (Bearer `CRON_SECRET`)
only pulls the next expiry sweep forward. You don't need an external cron at all.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | set by the image | `production` switches on the startup safety checks below. |
| `APP_URL` | **yes** | Public https URL, e.g. `https://app.gardenproof.co.uk`. Used for homeowner links, Twilio signature checks and media URLs. |
| `ADMIN_PASSWORD` | **yes** | Dashboard password. The app refuses to start without it, unless `DEMO_MODE=on`. |
| `DEMO_MODE` | no | `on` only for a public demo with no real data (allows no admin password). |
| `DATABASE_URL` | **yes** | Supabase Postgres. `prepare: false` is set, so the transaction pooler (port 6543) works; the session pooler or a direct connection are fine too. |
| `DATABASE_POOL_MAX` | no | Connections per process (default 5). |
| `MIGRATE_ON_START` | recommended `off` | Run `pnpm db:migrate` as the release step instead, so instances never race the migrator. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | **yes** (all three) | Private bucket for media. The service-role key is server-only; never expose it. |
| `WORKER` | on web when a worker service runs | `off` disables the in-process worker. |
| `WORKER_CONCURRENCY`, `WORKER_POLL_MS` | no | Default 1 slot (each render uses every core) and 1–2 s polling. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | yes for real copy | Without a key the AI is a clearly labelled mock. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_TRANSCRIBE_MODEL` | optional | Voice-note transcription (any OpenAI-compatible Whisper endpoint). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | yes for WhatsApp | If any Twilio value is set, `TWILIO_AUTH_TOKEN` is mandatory; unsigned webhooks are rejected in production. |
| `TWILIO_TEMPLATE_REVIEW_REQUEST` | yes for WhatsApp | Content SID (`HX…`) of the approved homeowner template (below). |
| `SAFE_MODE` | no (default `on`) | Customer messages wait for agency approval. Leave it on for the pilot. |
| `SIMULATOR` | no | `off` hides the simulator. It's off automatically once Twilio is configured, unless set to `on`. |
| `CRON_SECRET` | optional | Enables `/api/cron/testimonials`. In production the route is disabled without it. |
| `WORDPRESS_BASE_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD` | yes for publishing | See WordPress below. Without them, publishing writes local previews. |
| `REMOTION_BROWSER_EXECUTABLE` | no | Use your own Chromium; the image already ships Remotion's headless shell. |
| `SESSION_VERSION` | no | Increase it to log out every dashboard session. |
| `DEFAULT_TENANT` | no | Tenant slug (default `thorburn`). |

The server and the worker both call `assertProductionConfig()` at start and refuse to run with an unsafe setup:
no admin password, Twilio without its auth token, half-configured Supabase storage, or a non-https `APP_URL`.

## First deploy (Railway / Fly / Render)
1. Create the Supabase project. Copy the pooled connection string into `DATABASE_URL`. In Storage, create a
   **private** bucket (e.g. `gardenproof-media`) and set `SUPABASE_*`.
2. Build the image from this repo (the platforms build the `Dockerfile` automatically).
3. Release command (Railway "pre-deploy", Fly `release_command`, Render "pre-deploy"): `pnpm db:migrate`.
   Set `MIGRATE_ON_START=off` on both services.
4. **web** service: default command (`pnpm start`), port 3000, health check `/login`, `WORKER=off`.
5. **worker** service: same image, command `pnpm worker`, no public port, at least 2 GB RAM and 2 vCPU (renders).
   Give it a stop grace period of 2+ minutes so the current task can finish on redeploy.
6. Provision the tenant (crew phones, config). Note that `pnpm seed` is demo-only: it wipes the tenant and
   refuses to run in production unless `ALLOW_DEMO_SEED=yes`.

Run only **one web instance** for now. The capture bot serialises each phone's messages in memory, so a burst
of photos can't create two jobs. Media keys are random, so nothing is ever overwritten.

## Twilio WhatsApp
1. Twilio Console → Messaging → Senders → WhatsApp senders: register the business number (Meta Business
   verification), display name "Thorburn Landscapes".
2. Sender webhook "When a message comes in": `POST {APP_URL}/api/whatsapp/webhook`. Leave the status callback
   empty. Every request is signature-checked against `TWILIO_AUTH_TOKEN` and `APP_URL`, so `APP_URL` must be
   exactly the public URL Twilio calls.
3. Put the sender number in `tenants.whatsapp_number` (E.164) and `TWILIO_WHATSAPP_FROM` (`whatsapp:+44…`).
4. Crew phones must be in `crew_members` (E.164). Other numbers get one polite reply a day.
5. Inbound media is downloaded only from Twilio hosts (`api.twilio.com`, `*.twilio.com`, `*.twiliocdn.com`),
   with a 15 s timeout, a 20 MB cap and a content-type allow-list: photos, voice notes, videos and contact cards.

### Homeowner review template (submit to Meta via Twilio Content Template Builder)
The homeowner has never messaged the business, so the request is **business-initiated**. WhatsApp only
delivers it as an approved template (otherwise Twilio error 63016). Create one template:

- **Name:** `gardenproof_review_request` · **Category:** Utility · **Language:** English (UK) · **Type:** Text
- **Body** (exactly; variables are numbered):

```
Hi {{1}}, it's {{2}}. Thank you for having us in your garden, it was a real pleasure to work on. Would you tell us how it feels now? It takes about 30 seconds: {{3}}

Thank you.
```

- **Sample values:** `{{1}}` = `Harriet`, `{{2}}` = `Stephen at Thorburn Landscapes`,
  `{{3}}` = `https://app.gardenproof.co.uk/r/Ql-z77N2jbazM4vUEOZbVFjl`
- Once approved, copy its Content SID (`HX…`) into `TWILIO_TEMPLATE_REVIEW_REQUEST`.

GardenProof stores the same rendered text on the message, so what the agency approves in safe mode is what the
homeowner reads. With the template, the after-photo is not attached (text templates carry no media). When no
first name is known, `{{1}}` is "there".

Replies inside the 24-hour window (crew conversations, owner notifications) are free-form and need no template.
Customers can reply STOP (and START) at any time. Homeowners become customers when the crew shares their
contact card or types their mobile after Done, or when the agency adds them on the job page.

## WordPress
Install the plugin from `wordpress/gardenproof-portfolio` (zip with `pnpm plugin:zip`). The full steps are in
`wordpress/gardenproof-portfolio/readme.txt`:
1. Plugins → Add New → Upload → activate, then Settings → Permalinks → Save.
2. Create a user `gardenproof` with the **Editor** role, then add an Application Password for it (needs HTTPS).
3. Set `WORDPRESS_BASE_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD`.
4. Settings → GardenProof: set the app URL and the tenant slug to switch on lead tracking.

## Consent and privacy operations
- Homeowners give four separate permissions: photos, area, first name and their words (quote). The exact
  wording they saw is stored with their answers.
- They can withdraw consent from the same `/r/<token>` link. The agency can also withdraw it from the job page.
  Withdrawal clears every flag, rejects drafts and queues an `asset.unpublish` for everything published.
- Photo originals are stored under `private/…` with EXIF intact. Only EXIF-stripped copies are ever served.

## Checklist before go-live
- [ ] `ADMIN_PASSWORD`, `APP_URL` (https), `DATABASE_URL`, `SUPABASE_*` set; `pnpm db:migrate` ran.
- [ ] Twilio webhook points at `/api/whatsapp/webhook`; template approved and SID set; test from a crew phone.
- [ ] `SAFE_MODE` on; first homeowner message approved in /messages.
- [ ] Worker running (dashboard shows no failed tasks); one test job renders videos end to end.
- [ ] WordPress user + Application Password; a test page published and unpublished.
