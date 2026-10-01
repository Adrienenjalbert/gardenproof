import { describe, expect, it } from "vitest";
import { buildDefinition, type DefinitionContext } from "./definitions";
import {
  conditionHolds,
  currentIndex,
  describeAnswer,
  findStep,
  missingSteps,
  normaliseMobile,
  normalisePostcode,
  pruneAnswers,
  publicAnswers,
  remainingCount,
  summarise,
  validateAnswer,
  visibleSteps,
} from "./engine";
import type { FormStep } from "./types";

const ctx: DefinitionContext = {
  businessName: "Thorburn Landscapes",
  ownerFirstName: "Stephen",
  services: [
    { key: "full_design", label: "Garden design & build" },
    { key: "patio_paving", label: "Patios & paving" },
    { key: "maintenance", label: "Garden maintenance" },
  ],
  styles: [
    { value: "pond", label: "Pond garden", image: "/demo/pond-garden-after.jpg" },
    { value: "patio", label: "Sandstone patio", image: "/demo/sandstone-patio-after.jpg" },
  ],
};
const enquiry = buildDefinition("enquiry", ctx);
const brief = buildDefinition("project_brief", ctx);
const visit = buildDefinition("maintenance_visit", ctx);
const step = (id: string, def = enquiry) => findStep(def, id) as FormStep;
const ids = (steps: FormStep[]) => steps.map((s) => s.id);
const NOW = new Date("2026-09-24T10:00:00Z");

const complete = {
  services: ["patio_paving"],
  size: "medium",
  style: ["pond"],
  budget: "20_40k",
  timing: { choice: "asap" },
  photos: null,
  postcode: { postcode: "SW19 5AB", area: "Wimbledon", district: "Merton", verified: true, inArea: true },
  contact: { firstName: "Harriet", lastName: null, phone: "+447700900150", email: null, consent: true, consentWording: "x" },
  callTime: { days: ["weekdays"], windows: ["morning"] },
};

describe("skip logic", () => {
  it("evaluates every condition operator", () => {
    const a = { services: ["maintenance"], pets: true, size: "small" };
    expect(conditionHolds({ step: "services", op: "only", value: "maintenance" }, a)).toBe(true);
    expect(conditionHolds({ step: "services", op: "notOnly", value: "maintenance" }, a)).toBe(false);
    expect(conditionHolds({ step: "services", op: "includes", value: "maintenance" }, a)).toBe(true);
    expect(conditionHolds({ step: "services", op: "excludes", value: "maintenance" }, a)).toBe(false);
    expect(conditionHolds({ step: "pets", op: "eq", value: true }, a)).toBe(true);
    expect(conditionHolds({ step: "size", op: "neq", value: "small" }, a)).toBe(false);
    expect(conditionHolds({ step: "missing", op: "answered" }, a)).toBe(false);
    expect(conditionHolds({ step: "missing", op: "notOnly", value: "x" }, a)).toBe(true);
  });

  it("asks maintenance-only enquiries how often instead of style and budget", () => {
    const maint = ids(visibleSteps(enquiry, { services: ["maintenance"] }));
    expect(maint).toContain("frequency");
    expect(maint).not.toContain("budget");
    expect(maint).not.toContain("style");
    const project = ids(visibleSteps(enquiry, { services: ["maintenance", "patio_paving"] }));
    expect(project).toEqual(expect.arrayContaining(["style", "budget"]));
    expect(project).not.toContain("frequency");
  });

  it("only asks about pets when there are pets, and about problems only when a visit wasn't great", () => {
    expect(ids(visibleSteps(brief, { pets: false }))).not.toContain("petNotes");
    expect(ids(visibleSteps(brief, { pets: true }))).toContain("petNotes");
    expect(ids(visibleSteps(visit, { feeling: "great" }))).toEqual(["feeling", "note"]);
    expect(ids(visibleSteps(visit, { feeling: "issue" }))).toEqual(["feeling", "issues", "note", "photo"]);
  });

  it("omits the portfolio step when the business has fewer than two project photos", () => {
    expect(ids(buildDefinition("enquiry", { ...ctx, styles: [] }).steps)).not.toContain("style");
  });

  it("tracks progress, remaining questions and what blocks completion", () => {
    expect(currentIndex(enquiry, {})).toBe(0);
    // The mobile is asked third: the first unanswered step after services is the postcode, even with size filled in.
    const partial = { services: ["patio_paving"], size: "small" };
    expect(currentIndex(enquiry, partial)).toBe(1);
    expect(remainingCount(enquiry, partial)).toBe(visibleSteps(enquiry, partial).length - 2);
    expect(ids(missingSteps(enquiry, partial))).toEqual(["postcode", "contact", "budget", "timing", "callTime"]); // style + photos optional
    expect(missingSteps(enquiry, complete)).toEqual([]);
    expect(currentIndex(enquiry, complete)).toBe(visibleSteps(enquiry, complete).length);
  });

  it("drops answers to steps that became hidden, and never exposes server metadata", () => {
    const changedMind = { ...complete, services: ["maintenance"], frequency: "monthly" };
    const pruned = pruneAnswers(enquiry, changedMind);
    expect(pruned).not.toHaveProperty("budget");
    expect(pruned).not.toHaveProperty("style");
    expect(pruned).toHaveProperty("frequency", "monthly");
    expect(publicAnswers({ _meta: { prefill: {} }, size: "small" })).toEqual({ size: "small" });
  });
});

describe("validation", () => {
  it("accepts only listed options and keeps 'Not sure' exclusive", () => {
    expect(validateAnswer(step("services"), ["patio_paving", "full_design"]).ok).toBe(true);
    expect(validateAnswer(step("services"), ["unsure"]).ok).toBe(true);
    expect(validateAnswer(step("services"), ["unsure", "patio_paving"]).ok).toBe(false);
    expect(validateAnswer(step("services"), ["hot_tub"]).ok).toBe(false);
    expect(validateAnswer(step("services"), []).ok).toBe(false);
    expect(validateAnswer(step("services"), ["patio_paving", "patio_paving"]).ok).toBe(false);
    expect(validateAnswer(step("size"), "medium")).toEqual({ ok: true, value: "medium" });
    expect(validateAnswer(step("size"), ["medium"]).ok).toBe(false);
    expect(validateAnswer(step("style"), ["pond", "patio", "unsure"]).ok).toBe(false);
  });

  it("treats null as 'skipped' for optional steps only", () => {
    expect(validateAnswer(step("photos"), null)).toEqual({ ok: true, value: null });
    expect(validateAnswer(step("size"), null).ok).toBe(false);
  });

  it("validates timing, with a real future date when 'By a certain date' is picked", () => {
    expect(validateAnswer(step("timing"), { choice: "asap", date: "2026-10-01" }, NOW)).toEqual({ ok: true, value: { choice: "asap" } });
    expect(validateAnswer(step("timing"), { choice: "date" }, NOW).ok).toBe(false);
    expect(validateAnswer(step("timing"), { choice: "date", date: "2026-01-01" }, NOW).ok).toBe(false);
    expect(validateAnswer(step("timing"), { choice: "date", date: "2027-03-15" }, NOW)).toEqual({ ok: true, value: { choice: "date", date: "2027-03-15" } });
    expect(validateAnswer(step("timing"), { choice: "yesterday" }, NOW).ok).toBe(false);
  });

  it("normalises UK postcodes and rejects anything else", () => {
    expect(normalisePostcode("sw195ab")).toBe("SW19 5AB");
    expect(normalisePostcode(" tw9 1aa ")).toBe("TW9 1AA");
    expect(normalisePostcode("EC1A 1BB")).toBe("EC1A 1BB");
    expect(normalisePostcode("12345")).toBeNull();
    const r = validateAnswer(step("postcode"), { postcode: "sw19 5ab" });
    expect(r).toEqual({ ok: true, value: { postcode: "SW19 5AB", area: null, district: null, verified: false, inArea: false } });
    expect(validateAnswer(step("postcode"), { postcode: "nowhere" })).toMatchObject({ ok: false, path: "postcode" });
  });

  it("requires a mobile and explicit consent on the contact step, recording the exact wording", () => {
    const c = step("contact");
    const ok = validateAnswer(c, { firstName: " Harriet ", lastName: "", phone: "07700 900150", email: "x@y.com", consent: true });
    expect(ok).toEqual({
      ok: true,
      value: { firstName: "Harriet", lastName: null, phone: "+447700900150", email: null, consent: true, consentWording: "Thorburn Landscapes may contact me by phone or WhatsApp about this enquiry." },
    });
    expect(validateAnswer(c, { firstName: "H", phone: "07700 900150", consent: false })).toMatchObject({ ok: false, path: "consent" });
    expect(validateAnswer(c, { firstName: "H", phone: "020 8064 1303", consent: true })).toMatchObject({ ok: false, path: "phone" });
    expect(validateAnswer(c, { firstName: "", phone: "07700 900150", consent: true })).toMatchObject({ ok: false, path: "firstName" });
    expect(normaliseMobile("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("validates time windows, photos and free text", () => {
    expect(validateAnswer(step("callTime"), { days: ["weekdays"], windows: ["morning", "evening"] }).ok).toBe(true);
    expect(validateAnswer(step("callTime"), { days: [], windows: ["morning"] }).ok).toBe(false);
    expect(validateAnswer(step("photos"), [{ id: "ph_abcdefghijklmnop", width: 2000, height: 1500 }]).ok).toBe(true);
    expect(validateAnswer(step("photos"), [{ id: "../../etc/passwd", width: 1, height: 1 }]).ok).toBe(false);
    expect(validateAnswer(step("photos"), Array.from({ length: 7 }, (_, i) => ({ id: `ph_abcdefgh${i}`, width: 1, height: 1 }))).ok).toBe(false);
    expect(validateAnswer(step("accessNotes", brief), "  ").ok).toBe(false);
    expect(validateAnswer(step("accessNotes", brief), "x".repeat(601)).ok).toBe(false);
    expect(validateAnswer(step("pets", brief), "yes").ok).toBe(false);
  });
});

describe("summaries", () => {
  it("describes answers in plain English, in form order, skipping skipped steps", () => {
    expect(describeAnswer(step("callTime"), { days: ["weekdays", "saturday"], windows: ["morning"] })).toBe("Weekdays or Saturday, morning");
    expect(describeAnswer(step("timing"), { choice: "date", date: "2027-03-15" })).toBe("Mon 15 March");
    expect(summarise(enquiry, complete).map((l) => `${l.label}: ${l.value}`)).toEqual([
      "Work: Patios & paving",
      "Area: Wimbledon (SW19)",
      "Contact: Harriet, +447700900150",
      "Garden size: Medium",
      "Style: Pond garden",
      "Budget: £20k – £40k",
      "Timing: As soon as possible",
      "Best time to call: Weekdays, morning",
    ]);
  });
});
