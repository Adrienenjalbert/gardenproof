# WhatsApp Flows for smart forms

Native WhatsApp versions of two smart forms. They ask the same questions as the web form (`/f/<token>`) and write
into the **same** `form_responses` row, so a customer can start in WhatsApp and finish on the web (or the reverse).

| File | Form | Screens |
| --- | --- | --- |
| `enquiry.json` | New-client enquiry | SERVICES → SIZE → BUDGET → TIMING → PLACE → CONTACT → CALL (complete) |
| `maintenance-visit.json` | Feedback after a maintenance visit | FEELING → DETAILS (complete) |

Format: Flow JSON **7.2**, static (no data endpoint): `navigate` between screens and a single `complete` action whose
payload references every field with `${screen.<ID>.form.<field>}`. Field names equal the web form's step ids.

These files are **generated** from the form definitions (`src/lib/forms/definitions/*`, services from the tenant
config). After changing a definition or a tenant's services, regenerate and commit:

```bash
pnpm tsx whatsapp/flows/generate.ts
```

`src/lib/forms/whatsapp-flow.test.ts` fails if the committed JSON drifts from the definitions, and checks the
structure (unique screen ids, one terminal screen, every `navigate` target exists, every payload ref resolves,
label and option length limits).

## What the Flow does not ask (on purpose)

- **Phone number**: taken from the WhatsApp sender.
- **Photos and style cards**: they're optional; the confirmation can point to the web link to add them.
- **Skip logic on a multi-select**: static Flows can't branch on a checkbox group, so "budget" and "how often" sit
  on one screen as optional questions. If a required answer is missing, the form stays open and the handler returns
  `status: "incomplete"` with the web link to finish the last questions.

## 1. Upload to Meta (one time per WhatsApp Business Account)

1. Open **WhatsApp Manager → Account tools → Flows → Create Flow**.
2. Name it `gp_enquiry_v1` (or `gp_maintenance_visit_v1`), category **Lead generation** (enquiry) / **Survey**
   (maintenance visit), template **None**.
3. In the editor, replace the JSON with the contents of the file. The preview on the right should show each screen;
   fix any validation error shown in the editor before going further.
4. **Publish**. Publishing is permanent for that version; later changes need a new Flow (e.g. `_v2`).
5. Copy the **Flow ID**.

Flows can only be sent by a WhatsApp Business Account that has a verified business and an approved display name.

## 2. Link it through Twilio (Content template)

Create a Content template of type **`whatsapp/flows`** in Twilio Console → Messaging → Content Template Builder
(or the Content API):

```json
{
  "friendly_name": "gp_enquiry_flow",
  "language": "en_GB",
  "variables": { "1": "FORM_TOKEN", "2": "Harriet" },
  "types": {
    "whatsapp/flows": {
      "body": "Hi {{2}}, tell us about your garden. It takes about a minute.",
      "button_text": "Start",
      "flow_id": "<FLOW ID FROM META>",
      "flow_token": "{{1}}",
      "flow_first_page_id": "SERVICES",
      "is_flow_first_page_endpoint": false
    }
  }
}
```

Submit it for WhatsApp approval and note its **ContentSid** (`HX…`). Use `flow_first_page_id: "FEELING"` for the
maintenance Flow. (Twilio's field names can change; check the current Content API reference for `whatsapp/flows`.)

**`flow_token` must be the form token** from `createFormLink(...)`: that is how the reply finds its form. Send with:

```ts
const { token, url } = await createFormLink({ tenantId, kind: "enquiry", customerId, source: "whatsapp_flow" });
await sendMessage({
  tenantId, to: phone, audience: "customer",
  body: `Tell us about your garden: ${url}`,            // stored text + fallback link
  template: { sid: process.env.TWILIO_TEMPLATE_ENQUIRY_FLOW!, variables: { "1": token, "2": firstName } },
});
```

## 3. Receive the answers

When the customer taps the final button, Twilio calls the inbound WhatsApp webhook with the Flow reply in
`InteractiveData` (JSON: `{"type":"nfm_reply","nfm_reply":{"response_json":"{\"flow_token\":…}"}}`). The webhook
owner hands it over:

```ts
import { handleFlowCompletion } from "@/lib/forms";

if (params.InteractiveData) {
  const res = await handleFlowCompletion({ interactiveData: params.InteractiveData, from: params.From });
  // res.status: "completed" | "already_completed" | "incomplete" (res.url = web link to finish) | "not_found"
}
```

Every field goes through the same validation as the web form; completion is idempotent (a retried webhook does
nothing twice).

## Reminder template (optional)

Unfinished forms get a WhatsApp nudge at 24h and 72h (see `src/lib/forms/reminders.ts`). Outside the 24-hour
customer-service window WhatsApp needs an approved template: set `TWILIO_TEMPLATE_FORM_REMINDER` to a ContentSid
whose body uses `{{1}}` first name, `{{2}}` form name ("your garden enquiry"), `{{3}}` questions left, `{{4}}` link.
