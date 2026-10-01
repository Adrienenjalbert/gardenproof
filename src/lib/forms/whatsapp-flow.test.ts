import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { T, seedTenant } from "@/lib/bot/test-fixtures";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { configContext } from "./flow-context";
import { enquiryFlowJson, maintenanceVisitFlowJson, type FlowJson } from "./flow-json";
import { createFormLink, getForm } from "./store";
import { flowDate, handleFlowCompletion, mapFlowResponse, parseFlowReply, replyToFlowCompletion } from "./whatsapp-flow";

beforeAll(() => seedTenant(), 120_000);

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";
const enquiryPayload = {
  services: ["patio_paving", "planting"],
  size: "medium",
  budget: "20_40k",
  frequency: "",
  timing: "date",
  date: "2027-04-01",
  postcode: "sw19 5ab",
  firstName: "Omar",
  lastName: "",
  consent: true,
  callDays: ["weekdays"],
  callWindows: ["evening"],
};

/** Twilio's InteractiveData for a Flow reply: nfm_reply with the completion payload as a JSON string. */
const twilio = (token: string, payload: Record<string, unknown>) =>
  JSON.stringify({ type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ flow_token: token, ...payload }) } });

describe("parseFlowReply", () => {
  it("unwraps every shape Twilio/Meta can deliver", () => {
    const want = { flowToken: TOKEN, response: { size: "small" } };
    expect(parseFlowReply(twilio(TOKEN, { size: "small" }))).toEqual(want);
    expect(parseFlowReply({ response_json: JSON.stringify({ flow_token: TOKEN, size: "small" }) })).toEqual(want);
    expect(parseFlowReply({ flow_token: TOKEN, size: "small" })).toEqual(want);
    expect(parseFlowReply(JSON.stringify({ nfm_reply: { response_json: { flow_token: TOKEN, size: "small" } } }))).toEqual(want);
  });

  it("rejects garbage and bad tokens", () => {
    expect(parseFlowReply("not json")).toBeNull();
    expect(parseFlowReply({ type: "button_reply" })).toBeNull();
    expect(parseFlowReply({ flow_token: "../../x" })).toBeNull();
    expect(parseFlowReply(null)).toBeNull();
  });
});

describe("mapFlowResponse", () => {
  it("maps an enquiry Flow onto form answers, taking the phone from the WhatsApp sender", () => {
    expect(mapFlowResponse("enquiry", enquiryPayload, "whatsapp:+447700900170")).toEqual({
      services: ["patio_paving", "planting"],
      size: "medium",
      budget: "20_40k",
      timing: { choice: "date", date: "2027-04-01" },
      postcode: { postcode: "sw19 5ab" },
      contact: { firstName: "Omar", lastName: null, phone: "+447700900170", consent: true },
      callTime: { days: ["weekdays"], windows: ["evening"] },
    });
  });

  it("leaves out what the Flow didn't collect so the web link can finish it", () => {
    const a = mapFlowResponse("enquiry", { services: ["maintenance"], frequency: "monthly", timing: "asap", firstName: "Omar" }, null);
    expect(a).toEqual({ services: ["maintenance"], frequency: "monthly", timing: { choice: "asap" } });
  });

  it("maps a maintenance visit, treating an empty note as skipped", () => {
    expect(mapFlowResponse("maintenance_visit", { feeling: "issue", issues: ["hedges"], note: "" }, null)).toEqual({ feeling: "issue", issues: ["hedges"], note: null });
    expect(mapFlowResponse("maintenance_visit", { feeling: "great", issues: [] }, null)).toEqual({ feeling: "great", note: null });
  });

  it("reads DatePicker values in both formats", () => {
    expect(flowDate("2027-04-01")).toBe("2027-04-01");
    expect(flowDate(Date.UTC(2027, 3, 1, 12))).toBe("2027-04-01");
    expect(flowDate(String(Date.UTC(2027, 3, 1, 12)))).toBe("2027-04-01");
    expect(flowDate("next tuesday")).toBeUndefined();
  });
});

describe("handleFlowCompletion", () => {
  const fetchImpl = (async () => Response.json({ status: 200, result: { postcode: "SW19 5AB", outcode: "SW19", admin_district: "Merton" } })) as unknown as typeof fetch;

  it("completes the same form_response as the web form, once", async () => {
    const { token, id } = await createFormLink({ tenantId: T, kind: "enquiry", source: "whatsapp" });
    const first = await handleFlowCompletion({ interactiveData: twilio(token, enquiryPayload), from: "whatsapp:+447700900171", fetchImpl });
    expect(first).toMatchObject({ status: "completed", token });
    const again = await handleFlowCompletion({ interactiveData: twilio(token, enquiryPayload), from: "whatsapp:+447700900171", fetchImpl });
    expect(again.status).toBe("already_completed");
    const form = (await getForm(token))!;
    expect(form.answers).toMatchObject({ contact: { firstName: "Omar", phone: "+447700900171" }, postcode: { area: "Wimbledon" }, timing: { choice: "date", date: "2027-04-01" } });
    const db = await getDb();
    const [row] = await db.select().from(schema.formResponses).where(eq(schema.formResponses.id, id));
    expect(row.jobId).toBeTruthy();
    expect(row.source).toBe("whatsapp"); // the original source is kept
  });

  it("keeps the form open (and says what's left) when the Flow left gaps", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    const res = await handleFlowCompletion({ interactiveData: twilio(token, { ...enquiryPayload, consent: false }), from: "+447700900172", fetchImpl });
    expect(res).toMatchObject({ status: "incomplete", url: expect.stringContaining(`/f/${token}`), problems: [{ stepId: "contact" }] });
    expect((await getForm(token))!.answers).toHaveProperty("size", "medium"); // everything valid was saved
  });

  it("ignores replies for unknown forms", async () => {
    expect(await handleFlowCompletion({ interactiveData: twilio("UnknownTokenUnknownToken", {}), from: null })).toEqual({ status: "not_found" });
  });
});

describe("replyToFlowCompletion", () => {
  const fetchImpl = (async () => Response.json({ status: 200, result: { postcode: "SW19 5AB", outcode: "SW19", admin_district: "Merton" } })) as unknown as typeof fetch;
  async function lastMessageTo(phone: string) {
    const db = await getDb();
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.toNumber, phone));
    return rows.at(-1);
  }

  it("thanks the customer once the Flow is fully answered", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    const from = "whatsapp:+447700900271";
    const outcome = await handleFlowCompletion({ interactiveData: twilio(token, enquiryPayload), from, fetchImpl });
    await replyToFlowCompletion(outcome, from);
    expect((await lastMessageTo("+447700900271"))?.body).toMatch(/Thanks — that's everything/);
  });

  it("sends the web link to finish when the Flow left gaps", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    const from = "+447700900272";
    const outcome = await handleFlowCompletion({ interactiveData: twilio(token, { ...enquiryPayload, consent: false }), from, fetchImpl });
    await replyToFlowCompletion(outcome, from);
    const reply = await lastMessageTo("+447700900272");
    expect(reply?.body).toContain(`/f/${token}`);
    expect(reply?.body).toMatch(/question.* left/);
  });

  it("says nothing for a duplicate webhook or an unrecognised payload", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    const from = "whatsapp:+447700900273";
    const first = await handleFlowCompletion({ interactiveData: twilio(token, enquiryPayload), from, fetchImpl });
    await replyToFlowCompletion(first, from);
    const afterFirst = await lastMessageTo("+447700900273");

    const again = await handleFlowCompletion({ interactiveData: twilio(token, enquiryPayload), from, fetchImpl });
    await replyToFlowCompletion(again, from);
    expect(await lastMessageTo("+447700900273")).toEqual(afterFirst); // no second message sent

    await replyToFlowCompletion({ status: "not_found" }, from); // never throws, never sends
    expect(await lastMessageTo("+447700900273")).toEqual(afterFirst);
  });
});

describe("WhatsApp Flow JSON", () => {
  const ctx = configContext(THORBURN_CONFIG);
  const flows: [string, FlowJson][] = [
    ["enquiry.json", enquiryFlowJson(ctx)],
    ["maintenance-visit.json", maintenanceVisitFlowJson(ctx)],
  ];

  it.each(flows)("whatsapp/flows/%s matches the form definitions (run whatsapp/flows/generate.ts)", (file, json) => {
    const committed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "whatsapp", "flows", file), "utf8"));
    expect(committed).toEqual(json);
  });

  it.each(flows)("%s is a valid static Flow: reachable screens, one complete action, payload refs resolve", (_file, json) => {
    expect(json.version).toMatch(/^7\.\d$/);
    const ids = json.screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z_]+$/);
    expect(ids).not.toContain("SUCCESS"); // reserved by Meta
    const fields = new Map<string, Set<string>>();
    const actions: { screen: string; action: Record<string, unknown> }[] = [];
    for (const s of json.screens) {
      const names = new Set<string>();
      for (const c of s.layout.children) {
        if (typeof c.name === "string") names.add(c.name);
        if (c.type === "Footer") actions.push({ screen: s.id, action: c["on-click-action"] as Record<string, unknown> });
        for (const k of ["label"]) if (typeof c[k] === "string" && c.type !== "OptIn" && c.type !== "Footer") expect((c[k] as string).length).toBeLessThanOrEqual(30);
        if (Array.isArray(c["data-source"])) for (const o of c["data-source"] as { title: string }[]) expect(o.title.length).toBeLessThanOrEqual(30);
      }
      fields.set(s.id, names);
    }
    const completes = actions.filter((a) => a.action.name === "complete");
    expect(completes).toHaveLength(1);
    const terminal = json.screens.filter((s) => s.terminal);
    expect(terminal.map((s) => s.id)).toEqual([completes[0].screen]);
    for (const a of actions.filter((x) => x.action.name === "navigate")) {
      expect(ids).toContain((a.action.next as { name: string }).name);
    }
    for (const ref of Object.values(completes[0].action.payload as Record<string, string>)) {
      const m = ref.match(/^\$\{screen\.([A-Z_]+)\.form\.(\w+)\}$/);
      expect(m, ref).not.toBeNull();
      expect(fields.get(m![1])?.has(m![2]), ref).toBe(true);
    }
  });

  it("offers only answers the web form accepts", () => {
    const [, json] = flows[0];
    const size = json.screens.find((s) => s.id === "SIZE")!.layout.children.find((c) => c.name === "size") as { "data-source": { id: string }[] };
    expect(size["data-source"].map((o) => o.id)).toEqual(["small", "medium", "large", "unsure"]);
  });
});
