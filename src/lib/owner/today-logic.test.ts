import { describe, expect, it } from "vitest";
import { groupUpcoming, joinNames, rankCards, type ApprovalIn } from "./today-logic";

const now = new Date("2026-09-24T11:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const approval = (over: Partial<ApprovalIn>): ApprovalIn => ({
  id: "s1",
  ruleKey: "quote_follow_up",
  trustTier: "quick_yes",
  jobId: "j1",
  name: "Charlotte",
  body: "Hi Charlotte,\n\nI hope you've had a chance to look over our quote.",
  since: now,
  stageSince: daysAgo(6),
  ...over,
});

describe("rankCards", () => {
  it("puts a low review first, then new enquiries, then things to send", () => {
    const cards = rankCards({
      now,
      enquiries: [{ jobId: "e1", name: "Amelia", area: "Barnes", service: "Garden design & build", since: new Date(now.getTime() - 2 * 3600_000), whatsapp: "https://wa.me/1", phone: "+1" }],
      approvals: [approval({}), approval({ id: "s2", jobId: "j2", name: "Ben", stageSince: daysAgo(8) }), approval({ id: "s3", ruleKey: "maintenance_renewal:2026-10-20", trustTier: "always_ask", jobId: "j3", name: "George" })],
      readyPages: [{ assetId: "a1", jobId: "j4", name: "James", photo: "/p.jpg", title: "Patio, Putney" }],
      lowReviews: [{ id: "t1", jobId: "j5", name: "Mark", rating: 3, phone: "+2" }],
      photoFor: () => null,
    });
    expect(cards.map((c) => c.eyebrow)).toEqual(["Needs you", "New enquiry", "Quotes", "Showcase", "Maintenance"]);
    const [, enquiry, quotes] = cards;
    expect(enquiry).toMatchObject({ title: "Amelia · Barnes", detail: "Garden design & build · 2 hours ago", primary: { kind: "link", label: "Reply", external: true }, secondary: { label: "Call" } });
    expect(quotes).toMatchObject({ title: "2 quotes waiting 6+ days", detail: expect.stringContaining("Charlotte and Ben"), primary: { kind: "approve", label: "Nudge both", ids: ["s1", "s2"] }, icon: "chat" });
    // Renewals are "always ask": the card opens the job rather than sending blind.
    expect(cards[4].primary).toEqual({ kind: "link", label: "Look & send", href: "/jobs/j3" });
  });

  it("uses the person's name and a preview for a single message", () => {
    const [card] = rankCards({ now, enquiries: [], approvals: [approval({})], readyPages: [], lowReviews: [], photoFor: () => "/c.jpg" });
    expect(card).toMatchObject({ title: "Charlotte's quote is 6 days old", preview: "I hope you've had a chance to look over our quote.", photo: "/c.jpg", primary: { label: "Send the nudge" } });
  });

  it("is empty when nothing needs the owner", () => {
    expect(rankCards({ now, enquiries: [], approvals: [], readyPages: [], lowReviews: [], photoFor: () => null })).toEqual([]);
  });
});

describe("groupUpcoming / joinNames", () => {
  it("groups the week ahead by team with the crew lead's name", () => {
    const g = groupUpcoming(
      [
        { jobId: "a", stage: "site_visit", team: "landscaping", name: "Tom", area: "Wandsworth", at: new Date("2026-09-25T09:00:00Z"), since: daysAgo(3) },
        { jobId: "b", stage: "on_site", team: "landscaping", name: "Olivia", area: "Clapham", at: null, since: daysAgo(3) },
        { jobId: "c", stage: "maintenance", team: "maintenance", name: "George", area: "Richmond", at: new Date("2026-09-24T14:00:00Z"), since: daysAgo(300) },
      ],
      new Map([["landscaping", "Marco"]]),
      now,
    );
    expect(g).toEqual([
      { team: "Landscaping", lead: "Marco", items: [{ jobId: "b", title: "Olivia", subtitle: "On site · Clapham", when: "Day 4" }, { jobId: "a", title: "Tom", subtitle: "Site visit · Wandsworth", when: "Tomorrow 10:00" }] },
      { team: "Maintenance", lead: null, items: [{ jobId: "c", title: "George", subtitle: "Maintenance visit · Richmond", when: "Today 15:00" }] },
    ]);
  });

  it("joins names naturally", () => {
    expect(joinNames(["Ben"])).toBe("Ben");
    expect(joinNames(["Ben", "Charlotte", "Ben"])).toBe("Ben and Charlotte");
    expect(joinNames(["A", "B", "C", "D", "E"])).toBe("A, B and 3 others");
  });
});
