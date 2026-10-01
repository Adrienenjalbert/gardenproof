import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown, runEvals, type EvalReport } from "./run";

describe("content eval (mock mode)", () => {
  let report: EvalReport;
  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    report = await runEvals();
  });

  it("runs every golden case", () => {
    expect(report.provider).toBe("mock");
    expect(report.cases).toHaveLength(10);
  });

  it("passes ≥ 90% of the rubric", () => {
    expect(report.rubricPassRate).toBeGreaterThanOrEqual(0.9);
  });

  it("is 100% consent-compliant", () => {
    expect(report.consentCompliance).toBe(1);
    const refused = report.cases.find((c) => c.id === "fencing-clapham-photos-refused")!;
    expect(refused.generated).toBe(false);
    expect(Object.keys(refused.assets)).toHaveLength(0);
    const withdrawn = report.cases.find((c) => c.id === "lawn-wandsworth-withdrawn")!;
    expect(withdrawn.generated).toBe(false);
  });

  it("uses photos but no quote, rating or stars when the quote is not consented", () => {
    const c = report.cases.find((x) => x.id === "terrace-putney-quote-not-consented")!;
    expect(c.generated).toBe(true);
    expect((c.assets.portfolio_page!.content as { testimonial: unknown }).testimonial).toBeNull();
    expect(JSON.stringify(c.assets)).not.toMatch(/Private note|5\/5|out of 5/);
  });

  it("never uses a flagged photo that has not been cleared, but does use a cleared one", () => {
    const c = report.cases.find((x) => x.id === "pergola-clapham-flagged-photo")!;
    const json = JSON.stringify(Object.values(c.assets).map((a) => a!.content));
    expect(json).not.toContain("m9_after_front");
    expect(json).toContain("m9_after_cleared");
  });

  it("thin input: short honest copy, flagged for crew notes, no tautologies", () => {
    const c = report.cases.find((x) => x.id === "garden-design-wimbledon-thin")!;
    for (const a of Object.values(c.assets)) {
      expect(a!.checks.find((k) => k.id === "thin-input")).toMatchObject({ ok: false });
      expect(a!.checks.find((k) => k.id === "repetition")).toMatchObject({ ok: true });
    }
    expect(JSON.stringify(c.assets)).not.toMatch(/built around a|dead level|well-compacted/);
  });

  it("renders a readable markdown report", () => {
    const md = renderMarkdown(report);
    expect(md).toMatch(/Rubric pass rate/);
    expect(md).toMatch(/\| patio-putney-full-consent \|/);
  });
});
