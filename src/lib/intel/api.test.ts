/** The owner-app endpoints: input validation, auth, and status codes (the pipeline itself is tested elsewhere). */
import { afterEach, describe, expect, it } from "vitest";
import { POST as start } from "@/app/api/onboarding/route";
import { GET as get } from "@/app/api/onboarding/[runId]/route";
import { POST as confirm } from "@/app/api/onboarding/[runId]/confirm/route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/onboarding", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const params = (runId: string) => ({ params: Promise.resolve({ runId }) });

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
});

describe("POST /api/onboarding", () => {
  it.each([
    [{ url: "http://thorburnlandscapes.co.uk" }, 400, /https/],
    [{ url: "https://127.0.0.1/" }, 400, /public internet/],
    [{ url: "" }, 400, /website address/],
    [{ url: "https://x.co.uk", extra: 1 }, 400, /website address/],
    ["not json", 400, /JSON/],
  ])("rejects %j", async (body, status, message) => {
    const res = await start(post(body));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toMatch(message);
  });

  it("needs the dashboard session when a password is set", async () => {
    process.env.ADMIN_PASSWORD = "secret";
    const res = await start(post({ url: "https://thorburnlandscapes.co.uk" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/onboarding/[runId] and confirm", () => {
  it("404s unknown or malformed ids", async () => {
    expect((await get(new Request("http://localhost/api/onboarding/onb_doesnotexist123"), params("onb_doesnotexist123"))).status).toBe(404);
    expect((await get(new Request("http://localhost/api/onboarding/../../etc"), params("../../etc"))).status).toBe(404);
    const res = await confirm(post({ edits: {} }), params("onb_doesnotexist123"));
    expect(res.status).toBe(404);
  });
});
