import { describe, expect, it } from "vitest";
import { assertProductionConfig, productionConfigProblems } from "./config";

const prod = { NODE_ENV: "production", ADMIN_PASSWORD: "s3cret", APP_URL: "https://app.example" };

describe("production config guard", () => {
  it("allows anything outside production (zero-config demo)", () => {
    expect(productionConfigProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionConfigProblems({})).toEqual([]);
  });

  it("requires ADMIN_PASSWORD unless DEMO_MODE=on", () => {
    expect(productionConfigProblems({ NODE_ENV: "production" }).join()).toMatch(/ADMIN_PASSWORD/);
    expect(productionConfigProblems({ NODE_ENV: "production", DEMO_MODE: "on" })).toEqual([]);
    expect(productionConfigProblems(prod)).toEqual([]);
  });

  it("requires TWILIO_AUTH_TOKEN whenever Twilio is configured", () => {
    expect(productionConfigProblems({ ...prod, TWILIO_ACCOUNT_SID: "AC1", TWILIO_WHATSAPP_FROM: "+44" }).join()).toMatch(/TWILIO_AUTH_TOKEN/);
    expect(productionConfigProblems({ ...prod, TWILIO_ACCOUNT_SID: "AC1", TWILIO_WHATSAPP_FROM: "+44", TWILIO_AUTH_TOKEN: "t" })).toEqual([]);
  });

  it("rejects half-configured Supabase storage and a non-https APP_URL", () => {
    expect(productionConfigProblems({ ...prod, SUPABASE_URL: "https://x.supabase.co" }).join()).toMatch(/SUPABASE_BUCKET/);
    expect(productionConfigProblems({ ...prod, APP_URL: "http://app.example" }).join()).toMatch(/https/);
  });

  it("assertProductionConfig throws with every problem listed", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production", TWILIO_ACCOUNT_SID: "AC1" })).toThrow(/ADMIN_PASSWORD[\s\S]*TWILIO_AUTH_TOKEN/);
    expect(() => assertProductionConfig({ ...prod, CRON_SECRET: "c" })).not.toThrow();
  });
});
