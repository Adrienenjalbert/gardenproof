import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { env } from "@/lib/config";
import { PHONES, T, seedTenant } from "@/lib/bot/test-fixtures";
import { normalisePhone, parseUkMobile, renderWithNumberedOptions } from "./format";
import { twilioProvider } from "./providers";
import { candidateUrls, isValidTwilioSignature, twilioSignature } from "./twilio-signature";
import { approveHeldMessage, cancelHeldMessage, sendMessage } from "./index";


beforeAll(() => seedTenant(), 120_000);
afterEach(() => {
  env.safeMode = true;
  env.twilio = { accountSid: null, authToken: null, whatsappFrom: null, reviewRequestTemplateSid: null };
  vi.restoreAllMocks();
});

const events = async (type: string) => {
  const db = await getDb();
  return db.select().from(schema.events).where(eq(schema.events.type, type));
};

describe("sendMessage rules", () => {
  it("holds customer messages in safe mode", async () => {
    const m = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Hello", audience: "customer" });
    expect(m.status).toBe("held");
    expect(m.direction).toBe("out");
    expect(m.fromNumber).toBe(PHONES.business);
    expect((await events("message.held")).some((e) => e.entityId === m.id)).toBe(true);
  });

  it("sends crew and owner messages immediately, even in safe mode", async () => {
    const crew = await sendMessage({ tenantId: T, to: PHONES.marco, body: "Hi", audience: "crew", options: [{ id: "a", title: "A" }] });
    const owner = await sendMessage({ tenantId: T, to: PHONES.stephen, body: "Hi", audience: "owner" });
    expect(crew.status).toBe("sent");
    expect(crew.channel).toBe("simulator");
    expect(crew.options).toEqual([{ id: "a", title: "A" }]);
    expect(owner.status).toBe("sent");
  });

  it("never delivers to an opted-out customer, whatever the safe mode", async () => {
    env.safeMode = false;
    const m = await sendMessage({ tenantId: T, to: PHONES.otto, body: "Hello", audience: "customer" });
    expect(m.status).toBe("cancelled");
    expect(m.error).toBe("recipient opted out");
  });

  it("sends customer messages directly when safe mode is off", async () => {
    env.safeMode = false;
    const m = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Hello", audience: "customer" });
    expect(m.status).toBe("sent");
  });

  it("validates input", async () => {
    await expect(sendMessage({ tenantId: T, to: "07700", body: "x", audience: "crew" })).rejects.toThrow();
    await expect(sendMessage({ tenantId: T, to: PHONES.marco, body: "", audience: "crew" })).rejects.toThrow();
  });

  it("records a failure when WhatsApp is requested but not configured", async () => {
    const m = await sendMessage({ tenantId: T, to: PHONES.marco, body: "Hi", audience: "crew", channel: "whatsapp" });
    expect(m.status).toBe("failed");
    expect(m.error).toMatch(/not configured/);
  });
});

describe("held message approval", () => {
  it("approves and delivers a held message", async () => {
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Hi Harriet", audience: "customer" });
    const sent = await approveHeldMessage(held.id);
    expect(sent.status).toBe("sent");
    expect((await events("message.approved")).some((e) => e.entityId === held.id)).toBe(true);
    // A second approval is a no-op that returns the current row (no second delivery, no second audit entry).
    const again = await approveHeldMessage(held.id);
    expect(again).toMatchObject({ id: held.id, status: "sent" });
    expect((await events("message.approved")).filter((e) => e.entityId === held.id)).toHaveLength(1);
  });

  it("delivers exactly once on a double click (concurrent approvals)", async () => {
    const provider = await import("./providers");
    const deliver = vi.fn(async () => ({ providerId: null }));
    vi.spyOn(provider, "providerFor").mockReturnValue({ channel: "simulator", deliver });
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Double click", audience: "customer" });
    const [a, b] = await Promise.all([approveHeldMessage(held.id), approveHeldMessage(held.id)]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect([a.status, b.status]).toContain("sent");
    expect((await events("message.approved")).filter((e) => e.entityId === held.id)).toHaveLength(1);
  });

  it("never cancels a message that was already approved, and cancel twice is a no-op", async () => {
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Race", audience: "customer" });
    await approveHeldMessage(held.id);
    expect((await cancelHeldMessage(held.id)).status).toBe("sent");
    const other = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Cancel me", audience: "customer" });
    await cancelHeldMessage(other.id);
    const second = await cancelHeldMessage(other.id);
    expect(second.status).toBe("cancelled");
    expect((await events("message.cancelled")).filter((e) => e.entityId === other.id)).toHaveLength(1);
    expect((await approveHeldMessage(other.id)).status).toBe("cancelled");
  });

  it("keeps meta and a template on the row and delivers the template when approved", async () => {
    const provider = await import("./providers");
    const deliver = vi.fn(async () => ({ providerId: "SMx" }));
    vi.spyOn(provider, "providerFor").mockReturnValue({ channel: "whatsapp", deliver });
    const template = { sid: `HX${"a".repeat(32)}`, variables: { "1": "Harriet" } };
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Hi Harriet", audience: "customer", template, meta: { kind: "test", jobId: "job_1" } });
    expect(held.meta).toMatchObject({ kind: "test", jobId: "job_1", template });
    await approveHeldMessage(held.id);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ template, body: "Hi Harriet" }));
  });

  it("cancels on approval if the customer opted out while it was held", async () => {
    const db = await getDb();
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Hi again", audience: "customer" });
    await db.update(schema.customers).set({ optedOut: true }).where(eq(schema.customers.id, "cus_harriet"));
    const result = await approveHeldMessage(held.id);
    expect(result.status).toBe("cancelled");
    await db.update(schema.customers).set({ optedOut: false }).where(eq(schema.customers.id, "cus_harriet"));
  });

  it("cancels a held message and logs it", async () => {
    const held = await sendMessage({ tenantId: T, to: PHONES.harriet, body: "Never mind", audience: "customer" });
    const c = await cancelHeldMessage(held.id, "adrien");
    expect(c.status).toBe("cancelled");
    const ev = (await events("message.cancelled")).find((e) => e.entityId === held.id);
    expect(ev?.actor).toBe("adrien");
  });
});

describe("Twilio provider", () => {
  it("posts form-encoded WhatsApp messages with basic auth and a numbered fallback", async () => {
    env.twilio = { accountSid: "AC123", authToken: "secret", whatsappFrom: "+447700900000", reviewRequestTemplateSid: null };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const { providerId } = await twilioProvider(fetchMock as unknown as typeof fetch).deliver({
      tenantId: T,
      to: PHONES.marco,
      body: "What's the job?",
      options: [{ id: "svc:a", title: "Patios" }, { id: "svc:b", title: "Fencing" }],
      mediaUrls: ["/api/media/x.jpg"],
      audience: "crew",
    });
    expect(providerId).toBe("SM1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const form = init.body as URLSearchParams;
    expect(form.get("To")).toBe(`whatsapp:${PHONES.marco}`);
    expect(form.get("From")).toBe("whatsapp:+447700900000");
    expect(form.get("Body")).toBe("What's the job?\n\n1. Patios\n2. Fencing\n\nReply with a number.");
    expect(form.get("MediaUrl")).toMatch(/^https?:\/\/.+\/api\/media\/x\.jpg$/);
  });

  it("sends an approved Content template (ContentSid + ContentVariables) instead of Body/MediaUrl", async () => {
    env.twilio = { accountSid: "AC123", authToken: "secret", whatsappFrom: "+447700900000", reviewRequestTemplateSid: null };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM2" }), { status: 201 }));
    await twilioProvider(fetchMock as unknown as typeof fetch).deliver({
      tenantId: T,
      to: PHONES.harriet,
      body: "Hi Harriet, …",
      mediaUrls: ["/api/media/x.jpg"],
      template: { sid: "HX0123", variables: { "1": "Harriet", "3": "https://x/r/tok" } },
      audience: "customer",
    });
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(form.get("ContentSid")).toBe("HX0123");
    expect(JSON.parse(form.get("ContentVariables")!)).toEqual({ "1": "Harriet", "3": "https://x/r/tok" });
    expect(form.get("Body")).toBeNull();
    expect(form.get("MediaUrl")).toBeNull();
  });

  it("throws on Twilio errors so the row is marked failed", async () => {
    env.twilio = { accountSid: "AC123", authToken: "secret", whatsappFrom: "whatsapp:+447700900000", reviewRequestTemplateSid: null };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Invalid To" }), { status: 400 }));
    await expect(
      twilioProvider(fetchMock as unknown as typeof fetch).deliver({ tenantId: T, to: PHONES.marco, body: "x", audience: "crew" }),
    ).rejects.toThrow(/Twilio 400: Invalid To/);
  });
});

describe("format helpers", () => {
  it("leaves bodies without options untouched", () => {
    expect(renderWithNumberedOptions("Hi")).toBe("Hi");
  });
  it("normalises UK and WhatsApp-prefixed numbers", () => {
    expect(normalisePhone("whatsapp:+447700900001")).toBe("+447700900001");
    expect(normalisePhone("07700 900001")).toBe("+447700900001");
    expect(normalisePhone("00447700900001")).toBe("+447700900001");
  });
  it("parses UK mobiles in the formats crews type, and rejects landlines and junk", () => {
    for (const raw of ["07700 900123", "+44 7700 900123", "+44 (0)7700 900123", "0044 7700 900123", "447700900123", "07700-900-123", "whatsapp:+447700900123"]) {
      expect(parseUkMobile(raw)).toBe("+447700900123");
    }
    for (const raw of ["020 7946 0000", "+33 6 12 34 56 78", "0770090012", "hello", ""]) expect(parseUkMobile(raw)).toBeNull();
  });
});

describe("Twilio signature validation", () => {
  const params = new URLSearchParams({ MessageSid: "SM123", From: "whatsapp:+447700900002", Body: "hi", NumMedia: "0" });
  const url = "https://gardenproof.example/api/whatsapp/webhook";

  it("accepts a correctly signed request (sorted key+value, HMAC-SHA1, base64)", async () => {
    const { createHmac } = await import("node:crypto");
    const data = url + "Bodyhi" + "Fromwhatsapp:+447700900002" + "MessageSidSM123" + "NumMedia0";
    const expected = createHmac("sha1", "tok").update(data).digest("base64");
    expect(twilioSignature("tok", url, params)).toBe(expected);
    expect(isValidTwilioSignature("tok", expected, ["https://wrong.example", url], params)).toBe(true);
  });

  it("rejects missing, forged or tampered signatures", () => {
    const sig = twilioSignature("tok", url, params);
    expect(isValidTwilioSignature("tok", null, [url], params)).toBe(false);
    expect(isValidTwilioSignature("other", sig, [url], params)).toBe(false);
    const tampered = new URLSearchParams(params);
    tampered.set("Body", "STOP");
    expect(isValidTwilioSignature("tok", sig, [url], tampered)).toBe(false);
  });

  it("derives the public URL behind a proxy", () => {
    const req = new Request("http://localhost:3000/api/whatsapp/webhook", {
      headers: { "x-forwarded-host": "gardenproof.example", "x-forwarded-proto": "https" },
    });
    expect(candidateUrls(req, "http://localhost:3000")).toContain(url);
  });
});
