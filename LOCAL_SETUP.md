# Running GardenProof on your Mac

This copy is fully set up except for one thing: dependencies were installed from Claude's
sandbox (Linux), so a couple of native packages (sharp, esbuild) need to be reinstalled for
macOS before it'll run from your own Terminal.

```bash
cd "/Users/adrien.enjalbert/garden portfolio and CRM/gardenproof"

# If you don't have pnpm yet:
corepack enable          # ships with Node 16.9+; or: npm install -g pnpm

pnpm install              # reinstalls native deps for macOS (fast, most of the cache is reused)
pnpm dev                  # starts the app at http://localhost:3000
```

The demo database (`.data/`) and your `.env.local` (Firecrawl key) are already in place and
seeded with Thorburn Landscapes demo data. To reset it to a clean seed at any point:

```bash
rm -rf .data
pnpm seed
```

## Where to click around

- **http://localhost:3000/jobs** — the owner app (Stephen's view). Jobs list, job detail with
  the stage stepper, Showcase (approve/hide generated content), More -> Notifications/Team/Business.
- **http://localhost:3000/simulator** — simulate the WhatsApp crew-capture bot without a real
  phone: send photos/taps as a crew member and watch the job move through capture, the
  homeowner-contact step, and (if you keep going) the review request.
- **http://localhost:3000/enquire/thorburn** — the public enquiry form a homeowner would fill in
  (-> `/f/<token>` smart form).
- **http://localhost:3000/ops** — the agency dashboard: review and approve drafted content
  (portfolio pages, ads, social posts, SEO articles, videos) before it "publishes".
- **http://localhost:3000/r/<token>** — the homeowner's review & consent page. Get a token from
  a finished job in the owner app or the simulator flow.

No `TWILIO_*`/`ANTHROPIC_API_KEY` env vars are set, so messaging runs in simulator mode (no real
WhatsApp sends) and AI copy uses the built-in mock generator — good enough to exercise every flow,
just with simpler generated text than you'd get with a real Anthropic key.

See `STATUS.md` for the fuller status/handover notes, and `REVIEW.md` for the Phase 1 review.
