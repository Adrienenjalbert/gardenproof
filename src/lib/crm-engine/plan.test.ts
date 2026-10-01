import { describe, expect, it } from "vitest";
import { planMessages, quickYesEarned, sendTimeFor } from "./plan";
import { RULES_BY_KEY, instanceKey, letter, type RuleContext } from "./rules";
import { isQuietHour, londonAt, londonDateKey, outsideQuietHours } from "./time";

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

function ctx(
  over: Omit<Partial<RuleContext>, "job"> & {
    job?: Partial<RuleContext["job"]>;
  } = {},
): RuleContext {
  const now = over.now ?? new Date("2026-09-24T11:00:00Z"); // 12:00 BST
  return {
    now,
    stageEnteredAt: over.stageEnteredAt ?? now,
    job: {
      id: "j1",
      stage: "enquiry",
      area: "Barnes",
      postcode: "SW13 9AA",
      serviceLabel: "Garden design & build",
      nextActionAt: null,
      ...over.job,
    },
    customer:
      over.customer === undefined
        ? {
            id: "c1",
            firstName: "Amelia",
            phone: "+447700900601",
            optedOut: false,
          }
        : over.customer,
    crewLead: over.crewLead === undefined ? { id: "k1", name: "Marco", phone: "+447700900502" } : over.crewLead,
    business: over.business ?? {
      name: "Thorburn Landscapes",
      ownerName: "Stephen",
      phone: "020 8064 1303",
    },
    style: over.style ?? { tone: "warm", signOff: null },
    links: over.links ?? { projectForm: null },
  };
}

describe("London time", () => {
  it("places local wall times correctly in summer (BST) and winter (GMT)", () => {
    expect(iso(londonAt(new Date("2026-07-01T12:00:00Z"), -1, 18))).toBe("2026-06-30T17:00:00.000Z");
    expect(iso(londonAt(new Date("2026-12-10T12:00:00Z"), -1, 18))).toBe("2026-12-09T18:00:00.000Z");
  });

  it("handles the day the clocks go back", () => {
    // 25 Oct 2026: BST ends at 02:00. 08:30 that morning is GMT.
    expect(iso(londonAt(new Date("2026-10-25T12:00:00Z"), 0, 8, 30))).toBe("2026-10-25T08:30:00.000Z");
    // The evening before is still BST.
    expect(iso(londonAt(new Date("2026-10-25T12:00:00Z"), -1, 18))).toBe("2026-10-24T17:00:00.000Z");
  });

  it("keeps customer messages out of 20:00–08:00 and moves them to 08:30", () => {
    expect(isQuietHour(new Date("2026-09-24T19:30:00Z"))).toBe(true); // 20:30 BST
    expect(isQuietHour(new Date("2026-09-24T06:59:00Z"))).toBe(true); // 07:59 BST
    expect(isQuietHour(new Date("2026-09-24T07:05:00Z"))).toBe(false); // 08:05 BST
    expect(iso(outsideQuietHours(new Date("2026-09-24T20:00:00Z")))).toBe("2026-09-25T07:30:00.000Z"); // 21:00 → 08:30 next day
    expect(iso(outsideQuietHours(new Date("2026-09-24T02:00:00Z")))).toBe("2026-09-24T07:30:00.000Z"); // 03:00 → 08:30 same day
    const midday = new Date("2026-09-24T11:00:00Z");
    expect(outsideQuietHours(midday)).toBe(midday);
  });

  it("formats the London calendar day", () => {
    expect(londonDateKey(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-25");
  });
});

describe("planMessages", () => {
  it("acknowledges an enquiry at once, with the form link when there is one", () => {
    const [ack, ...rest] = planMessages(ctx({ links: { projectForm: "https://app.example/f/abc123" } }));
    expect(rest).toHaveLength(0);
    expect(ack).toMatchObject({
      ruleKey: "enquiry_ack",
      audience: "customer",
      trustTier: "automatic",
      customerId: "c1",
    });
    expect(iso(ack.sendAt)).toBe("2026-09-24T11:00:00.000Z");
    expect(ack.body).toContain("Hi Amelia");
    expect(ack.body).toContain("https://app.example/f/abc123");
    expect(ack.body).toContain("Stephen, Thorburn Landscapes");
    expect(ack.reason).toMatch(/Thanks Amelia/);
  });

  it("waits until 08:30 for an enquiry that arrives late at night", () => {
    const late = new Date("2026-09-24T21:40:00Z"); // 22:40 BST
    const [ack] = planMessages(ctx({ now: late, stageEnteredAt: late }));
    expect(iso(ack.sendAt)).toBe("2026-09-25T07:30:00.000Z");
  });

  it("follows up a quote after five days at 10:00", () => {
    const entered = new Date("2026-09-18T14:12:00Z");
    const [f] = planMessages(ctx({ stageEnteredAt: entered, job: { stage: "quoted" } }));
    expect(f).toMatchObject({
      ruleKey: "quote_follow_up",
      trustTier: "quick_yes",
    });
    expect(iso(f.sendAt)).toBe("2026-09-24T11:00:00.000Z"); // due now (23 Sep 10:00 BST has passed → now)
    const fresh = planMessages(ctx({ job: { stage: "quoted" } }))[0];
    expect(iso(fresh.sendAt)).toBe("2026-09-29T09:00:00.000Z");
    expect(fresh.body).toContain("020 8064 1303");
  });

  it("reminds the customer the evening before a site visit and the crew lead that morning", () => {
    const visit = new Date("2026-09-26T09:00:00Z"); // Sat 10:00 BST
    const plan = planMessages(ctx({ job: { stage: "site_visit", nextActionAt: visit } }));
    expect(plan.map((p) => [p.ruleKey, iso(p.sendAt)])).toEqual([
      ["site_visit_reminder:2026-09-26", "2026-09-25T17:00:00.000Z"],
      ["site_visit_crew:2026-09-26", "2026-09-26T06:30:00.000Z"],
    ]);
    expect(plan[0].body).toContain("tomorrow at 10:00");
    expect(plan[1]).toMatchObject({ audience: "crew", crewId: "k1" });
  });

  it("drops a reminder that could only arrive after the visit", () => {
    const now = new Date("2026-09-24T20:30:00Z"); // 21:30, quiet
    const visit = new Date("2026-09-25T07:00:00Z"); // 08:00 next morning
    const keys = planMessages(ctx({ now, job: { stage: "site_visit", nextActionAt: visit } })).map((p) => p.ruleKey);
    expect(keys).toEqual(["site_visit_crew:2026-09-25"]);
    const past = planMessages(
      ctx({
        now,
        job: {
          stage: "site_visit",
          nextActionAt: new Date("2026-09-24T10:00:00Z"),
        },
      }),
    );
    expect(past).toEqual([]);
  });

  it("plans prep, start reminders and the crew heads-up when booked", () => {
    const start = new Date("2026-09-29T07:00:00Z");
    const plan = planMessages(ctx({ job: { stage: "booked", nextActionAt: start } }));
    expect(plan.map((p) => p.ruleKey)).toEqual([
      "booked_prep",
      "start_reminder:2026-09-29",
      "start_crew:2026-09-29",
      "capture_before:2026-09-29",
    ]);
    expect(plan[0].body).toContain("Tuesday 29 September");
    expect(plan[2].body).toContain("Marco, tomorrow you start Amelia's garden design & build in Barnes");
    // The before-photo prompt goes on the start morning: 07:30 London, or 15 minutes before an earlier start.
    expect(plan[3]).toMatchObject({ audience: "crew", trustTier: "automatic", rule: { arm: "before" } });
    expect(plan[3].sendAt.toISOString()).toBe("2026-09-29T06:30:00.000Z");
    expect(plan[3].body).toContain("send 2 or 3 before photos here");
  });

  it("asks for after photos on the finish day only when a finish date is set", () => {
    expect(planMessages(ctx({ job: { stage: "on_site", nextActionAt: null } })).map((p) => p.ruleKey)).toEqual([]);
    const plan = planMessages(ctx({ job: { stage: "on_site", nextActionAt: new Date("2026-09-30T00:00:00+01:00") } }));
    expect(plan.map((p) => p.ruleKey)).toEqual(["capture_after:2026-09-30"]);
    expect(plan[0].sendAt.toISOString()).toBe("2026-09-30T14:30:00.000Z");
  });

  it("asks for a review the next morning and offers maintenance a week after finishing", () => {
    const plan = planMessages(ctx({ job: { stage: "finished" } }));
    expect(plan.map((p) => [p.ruleKey, p.trustTier, iso(p.sendAt)])).toEqual([
      ["review_request", "quick_yes", "2026-09-25T09:00:00.000Z"],
      ["aftercare_offer", "quick_yes", "2026-10-01T09:00:00.000Z"],
    ]);
    expect(plan[0].body).toContain("Stephen at Thorburn Landscapes");
  });

  it("reminds maintenance clients before each visit and asks the owner about renewals 30 days ahead", () => {
    const since = new Date("2025-10-20T09:00:00Z");
    const visit = new Date("2026-09-30T08:00:00Z");
    const plan = planMessages(
      ctx({
        stageEnteredAt: since,
        job: { stage: "maintenance", nextActionAt: visit },
      }),
    );
    expect(plan.map((p) => [p.ruleKey, p.trustTier])).toEqual([
      ["maintenance_visit:2026-09-30", "automatic"],
      ["maintenance_renewal:2026-10-20", "always_ask"],
    ]);
    expect(iso(plan[1].sendAt)).toBe("2026-09-24T11:00:00.000Z"); // renewal window already open → now
    expect(plan[1].reason).toContain("renews on Tue 20 Oct");
  });

  it("never plans customer messages for someone who opted out or has no number, nor crew notes without a lead", () => {
    const visit = new Date("2026-09-26T09:00:00Z");
    expect(
      planMessages(
        ctx({
          customer: {
            id: "c",
            firstName: "Otto",
            phone: "+447700900699",
            optedOut: true,
          },
          job: { stage: "site_visit", nextActionAt: visit },
        }),
      ).map((p) => p.audience),
    ).toEqual(["crew"]);
    expect(
      planMessages(
        ctx({
          customer: { id: "c", firstName: "Nia", phone: null, optedOut: false },
        }),
      ),
    ).toEqual([]);
    expect(
      planMessages(
        ctx({
          crewLead: null,
          job: { stage: "site_visit", nextActionAt: visit },
        }),
      ).map((p) => p.audience),
    ).toEqual(["customer"]);
  });

  it("plans nothing for lost jobs or jobs on site", () => {
    expect(planMessages(ctx({ job: { stage: "lost" } }))).toEqual([]);
    expect(planMessages(ctx({ job: { stage: "on_site" } }))).toEqual([]);
  });

  it("shapes greetings and sign-offs by tone", () => {
    const c = {
      business: {
        name: "Thorburn Landscapes",
        ownerName: "Stephen",
        phone: null,
      },
    };
    expect(letter({ ...c, style: { tone: "professional", signOff: null } }, "Amelia", "Body.")).toBe(
      "Dear Amelia,\n\nBody.\n\nKind regards,\nStephen, Thorburn Landscapes",
    );
    expect(letter({ ...c, style: { tone: "brief", signOff: "Steve" } }, "Amelia", "body.")).toBe(
      "Hi Amelia, body.\n\nSteve",
    );
  });

  it("names one instance per anchor date", () => {
    const rule = RULES_BY_KEY.get("maintenance_visit")!;
    expect(
      instanceKey(
        rule,
        ctx({
          job: {
            stage: "maintenance",
            nextActionAt: new Date("2026-10-02T08:00:00Z"),
          },
        }),
      ),
    ).toBe("maintenance_visit:2026-10-02");
    expect(sendTimeFor(rule, ctx({ job: { stage: "maintenance", nextActionAt: null } }))).toBeNull();
  });
});

describe("quickYesEarned", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  it("needs a yes at least N days ago and no skips since", () => {
    expect(quickYesEarned([{ status: "sent", createdAt: daysAgo(31) }], 30, now)).toBe(true);
    expect(quickYesEarned([{ status: "sent", createdAt: daysAgo(10) }], 30, now)).toBe(false);
    expect(
      quickYesEarned(
        [
          { status: "sent", createdAt: daysAgo(40) },
          { status: "skipped", createdAt: daysAgo(3) },
        ],
        30,
        now,
      ),
    ).toBe(false);
    expect(quickYesEarned([{ status: "sent", createdAt: daysAgo(40) }], null, now)).toBe(false);
  });
});
