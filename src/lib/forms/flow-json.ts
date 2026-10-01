/**
 * Meta WhatsApp Flow JSON (v7.2, no endpoint: static screens, `navigate` between them, `complete` at the end)
 * generated from the same definitions as the web form, so both channels ask the same questions and the
 * completion payload maps 1:1 onto form answers (see whatsapp-flow.ts). whatsapp/flows/*.json are generated
 * from here (whatsapp/flows/generate.ts) and kept in sync by a unit test.
 *
 * WhatsApp Flows can't branch on a multi-select without an endpoint, so "budget" and "how often" sit on one
 * screen as optional questions; anything left unanswered is picked up on the web link (same token).
 */
import type { DefinitionContext } from "./definitions";
import { buildDefinition } from "./definitions";
import type { ChoiceStep, FormDefinition, FormOption, FormStep } from "./types";

export const FLOW_JSON_VERSION = "7.2";

type Component = Record<string, unknown>;
type Screen = { id: string; title: string; terminal?: boolean; success?: boolean; layout: { type: "SingleColumnLayout"; children: Component[] } };
export type FlowJson = { version: string; screens: Screen[] };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const source = (options: FormOption[]) => options.map((o) => ({ id: o.value, title: clip(o.label, 30), ...(o.hint ? { description: clip(o.hint, 300) } : {}) }));

function step<K extends FormStep["kind"]>(def: FormDefinition, id: string, kind: K): Extract<FormStep, { kind: K }> {
  const s = def.steps.find((x) => x.id === id);
  if (!s || s.kind !== kind) throw new Error(`Flow builder: step ${id} (${kind}) missing`);
  return s as Extract<FormStep, { kind: K }>;
}

const heading = (text: string): Component => ({ type: "TextHeading", text: clip(text, 80) });
const body = (text: string): Component => ({ type: "TextBody", text: clip(text, 4096) });
const radio = (name: string, label: string, options: FormOption[], required = true): Component => ({
  type: "RadioButtonsGroup",
  name,
  label: clip(label, 30),
  required,
  "data-source": source(options),
});
const checkbox = (name: string, label: string, options: FormOption[], required = true, max?: number): Component => ({
  type: "CheckboxGroup",
  name,
  label: clip(label, 30),
  required,
  ...(required ? { "min-selected-items": 1 } : {}),
  ...(max ? { "max-selected-items": max } : {}),
  "data-source": source(options),
});
const next = (label: string, screen: string): Component => ({
  type: "Footer",
  label,
  "on-click-action": { name: "navigate", next: { type: "screen", name: screen }, payload: {} },
});
const complete = (label: string, fields: Record<string, string>): Component => ({
  type: "Footer",
  label,
  "on-click-action": {
    name: "complete",
    payload: Object.fromEntries(Object.entries(fields).map(([k, screen]) => [k, `\${screen.${screen}.form.${k}}`])),
  },
});
const screen = (id: string, title: string, children: Component[], terminal = false): Screen => ({
  id,
  title: clip(title, 30),
  ...(terminal ? { terminal: true, success: true } : {}),
  layout: { type: "SingleColumnLayout", children },
});

export function enquiryFlowJson(ctx: DefinitionContext): FlowJson {
  const def = buildDefinition("enquiry", ctx);
  const services = step(def, "services", "choice");
  const size = step(def, "size", "choice");
  const budget = step(def, "budget", "budget");
  const frequency = step(def, "frequency", "choice");
  const timing = step(def, "timing", "date");
  const contact = step(def, "contact", "contact");
  const call = step(def, "callTime", "timeWindow");
  return {
    version: FLOW_JSON_VERSION,
    screens: [
      screen("SERVICES", "Your garden", [heading(services.title), body(services.subtitle ?? ""), checkbox("services", "Choose all that apply", services.options), next("Continue", "SIZE")]),
      screen("SIZE", "Your garden", [heading(size.title), radio("size", "Roughly", size.options), next("Continue", "BUDGET")]),
      screen("BUDGET", "Budget", [
        heading(budget.title),
        body(budget.subtitle ?? ""),
        radio("budget", "Budget", budget.options, false),
        body("Only after garden maintenance? Tell us how often instead."),
        { type: "Dropdown", name: "frequency", label: "How often", required: false, "data-source": source(frequency.options) },
        next("Continue", "TIMING"),
      ]),
      screen("TIMING", "Timing", [
        heading(timing.title),
        radio("timing", "When", timing.options),
        { type: "DatePicker", name: "date", label: "Date (if you have one)", required: false, "helper-text": "Only if you chose “By a certain date”" },
        next("Continue", "PLACE"),
      ]),
      screen("PLACE", "Where", [
        heading(step(def, "postcode", "postcode").title),
        body("So we know it's in our patch. We never publish addresses."),
        { type: "TextInput", name: "postcode", label: "Postcode", "input-type": "text", required: true, "max-chars": 8, "helper-text": "e.g. SW19 5AB" },
        next("Continue", "CONTACT"),
      ]),
      screen("CONTACT", "About you", [
        heading(contact.title),
        { type: "TextInput", name: "firstName", label: "First name", "input-type": "text", required: true, "max-chars": 60 },
        { type: "TextInput", name: "lastName", label: "Last name", "input-type": "text", required: false, "max-chars": 60 },
        { type: "OptIn", name: "consent", label: clip(contact.consentText, 120), required: true },
        next("Continue", "CALL"),
      ]),
      screen(
        "CALL",
        "Best time to call",
        [
          heading(call.title),
          checkbox("callDays", "Days", call.days),
          checkbox("callWindows", "Times", call.windows.map((w) => ({ ...w, label: w.hint ? `${w.label} (${w.hint})` : w.label, hint: undefined }))),
          complete("Send enquiry", {
            services: "SERVICES",
            size: "SIZE",
            budget: "BUDGET",
            frequency: "BUDGET",
            timing: "TIMING",
            date: "TIMING",
            postcode: "PLACE",
            firstName: "CONTACT",
            lastName: "CONTACT",
            consent: "CONTACT",
            callDays: "CALL",
            callWindows: "CALL",
          }),
        ],
        true,
      ),
    ],
  };
}

export function maintenanceVisitFlowJson(ctx: DefinitionContext): FlowJson {
  const def = buildDefinition("maintenance_visit", ctx);
  const feeling = step(def, "feeling", "choice");
  const issues = step(def, "issues", "choice") as ChoiceStep;
  const note = step(def, "note", "longtext");
  return {
    version: FLOW_JSON_VERSION,
    screens: [
      screen("FEELING", "Today's visit", [heading(feeling.title), radio("feeling", "One tap", feeling.options), next("Continue", "DETAILS")]),
      screen(
        "DETAILS",
        "Today's visit",
        [
          heading("Anything we should look at?"),
          body("Leave blank if all is well."),
          checkbox("issues", "What to look at", issues.options, false),
          { type: "TextArea", name: "note", label: "Note", required: false, "max-length": note.maxLength, "helper-text": clip(note.placeholder ?? "", 80) },
          complete("Send", { feeling: "FEELING", issues: "DETAILS", note: "DETAILS" }),
        ],
        true,
      ),
    ],
  };
}
