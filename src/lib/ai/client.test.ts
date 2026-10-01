import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { decideConsent } from "@/lib/content/consent";
import { buildContentContext } from "@/lib/content/context";
import { AiOutputError, generate, setAnthropicClient, toolSchema } from "./client";

const ctx = buildContentContext({
  job: { id: "j", code: "TL-1", service: "patio_paving", completedAt: new Date("2026-05-01"), createdAt: new Date("2026-04-01") },
  enrichment: null,
  media: [{ id: "a", stage: "after", kind: "image", publicKey: "k/a.jpg", blurredKey: null, privacyClearedAt: null, isHero: false, qualityScore: null, qualityNotes: null }],
  crewNotes: "Indian sandstone patio with a red brick band. Two weeks.",
  consent: decideConsent({ job: { area: "Putney", postcode: "SW15 2QT" }, customer: null, testimonial: null, config: THORBURN_CONFIG }),
  config: THORBURN_CONFIG,
});

const Out = z.object({ text: z.string().max(10) });
const input = { prompt: "gbp_post", vars: { context: "{}", areaRule: "", testimonialRule: "", inputRule: "", instructions: "None.", bannedPhrases: "", tenantName: "T", ctaText: "Book", area: "x", mediaList: "" }, data: ctx };

type Msg = { role: string; content: unknown };
function fakeClient(replies: unknown[]) {
  const calls: Msg[][] = [];
  const create = vi.fn(async (req: { messages: Msg[] }) => {
    calls.push(structuredClone(req.messages));
    const input = replies.shift();
    return { content: [{ type: "tool_use", id: `tu_${calls.length}`, name: "submit", input }] };
  });
  return { client: { messages: { create } } as never, calls, create };
}

afterEach(() => {
  setAnthropicClient(null);
  delete process.env.AI_PROVIDER;
});

describe("generate (real provider path, faked transport)", () => {
  it("validates, feeds the zod errors back once, then succeeds", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const fake = fakeClient([{ text: "far too long text" }, { text: "short" }]);
    setAnthropicClient(fake.client);
    const res = await generate("gbp_post", Out, input);
    expect(res).toMatchObject({ data: { text: "short" }, provider: "anthropic", attempts: 2, prompt: "gbp_post", promptVersion: 2 });
    const retry = fake.calls[1].at(-1)!.content as { type: string; is_error: boolean; content: string }[];
    expect(retry[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(retry[0].content).toMatch(/text: .*10/);
  });

  it("gives up after the second invalid answer", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const fake = fakeClient([{ text: 1 }, { nope: true }]);
    setAnthropicClient(fake.client);
    await expect(generate("gbp_post", Out, input)).rejects.toBeInstanceOf(AiOutputError);
    expect(fake.create).toHaveBeenCalledTimes(2);
  });
});

describe("generate (mock provider)", () => {
  it("routes to the deterministic mock and validates its output", async () => {
    process.env.AI_PROVIDER = "mock";
    const res = await generate("gbp_post", z.object({ text: z.string() }), input);
    expect(res.provider).toBe("mock");
    expect(res.data.text).toMatch(/Recently finished in South West London: an Indian sandstone patio/);
  });
});

describe("toolSchema", () => {
  it("emits an object JSON schema without $schema, defaults optional", () => {
    const js = toolSchema(z.object({ a: z.string(), b: z.array(z.string()).default([]) }));
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe("object");
    expect(js.required).toEqual(["a"]);
  });
});
