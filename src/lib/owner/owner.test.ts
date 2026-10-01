/** Owner read models and team/profile writes against a real (in-memory) database, driven by the CRM engine. */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { moveJobToStage, dispatchDueMessages } from "@/lib/crm-engine";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { THORBURN_FIXTURE } from "./fixtures/thorburn-profile";
import { getOwnerJob, listOwnerJobs } from "./jobs";
import { applyChoices } from "./onboarding-choices";
import { saveConfirmedProfile } from "./onboarding";
import { getShowcase } from "./showcase";
import { TeamError, listTeam, removeMember, saveMember } from "./team";
import { brandOf } from "./tenant";
import { getToday } from "./today";

const T = "ten_owner";
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.tenants).values({ id: T, slug: "thorburn", name: "Thorburn Landscapes", whatsappNumber: "+447700900700", config: THORBURN_CONFIG });
  await db.insert(schema.crewMembers).values([
    { id: "o_stephen", tenantId: T, name: "Stephen", phone: "+447700900701", role: "owner", teamRole: "owner" },
    { id: "o_marco", tenantId: T, name: "Marco", phone: "+447700900702", role: "foreman", teamRole: "crew_lead" },
  ]);
  await db.insert(schema.customers).values([
    { id: "o_amelia", tenantId: T, firstName: "Amelia", lastName: "Hart", phone: "+447700900711", area: "Barnes" },
    { id: "o_ben", tenantId: T, firstName: "Ben", phone: "+447700900712", area: "Battersea" },
    { id: "o_james", tenantId: T, firstName: "James", phone: "+447700900713", area: "Putney" },
  ]);
  await db.insert(schema.jobs).values([
    { id: "oj_amelia", tenantId: T, code: "OW-1", customerId: "o_amelia", stage: "enquiry", service: "full_design", area: "Barnes" },
    { id: "oj_ben", tenantId: T, code: "OW-2", customerId: "o_ben", stage: "site_visit", service: "patio_paving", area: "Battersea" },
    { id: "oj_james", tenantId: T, code: "OW-3", customerId: "o_james", stage: "on_site", service: "patio_paving", area: "Putney", title: "Patio, Putney" },
  ]);
  await moveJobToStage("oj_amelia", "enquiry", "customer", null, { now: new Date(now.getTime() - 2 * 3600_000) });
  await moveJobToStage("oj_ben", "quoted", "owner", null, { now: daysAgo(6) });
  await moveJobToStage("oj_james", "finished", "crew", null, { now: daysAgo(2) });
  await db.insert(schema.media).values({ id: "om_after", tenantId: T, jobId: "oj_james", stage: "after", kind: "image", storageKey: "t/a.jpg", publicKey: "t/a.jpg", qualityScore: 0.9, qualityNotes: "clear" });
  await db.insert(schema.testimonials).values({ id: "ot_james", tenantId: T, jobId: "oj_james", customerId: "o_james", token: "tok_owner_test_123", status: "responded", rating: 5, quote: "Lovely work.", consentPhotos: true, consentArea: true, consentFirstName: true, consentQuote: true, respondedAt: daysAgo(1) });
  await db.insert(schema.assets).values({ id: "oa_page", tenantId: T, jobId: "oj_james", type: "portfolio_page", status: "in_review", title: "Portfolio page — Patio", content: { h1: "Sandstone patio, Putney", slug: "sandstone-patio-putney" }, checks: [{ id: "consent-photos", ok: true, message: "ok" }] });
  await db.insert(schema.leads).values({ id: "ol_1", tenantId: T, projectSlug: "sandstone-patio-putney", name: "Someone" });
  await dispatchDueMessages(now, { digest: false });
}, 120_000);

describe("jobs", () => {
  it("lists jobs by stage with plain status lines and who needs a yes", async () => {
    const jobs = await listOwnerJobs(now);
    expect(jobs.map((j) => [j.name, j.stage, j.statusLine])).toEqual([
      ["Amelia", "enquiry", "New enquiry · 2 hours ago"],
      ["Ben", "quoted", "Quote sent 6 days ago"],
      ["James", "finished", "Finished 2 days ago · rated 5★"],
    ]);
    expect(jobs.find((j) => j.name === "Ben")?.needsYou).toBe(true);
    expect(jobs.find((j) => j.name === "James")?.photoUrl).toBe("/api/media/t/a.jpg");
    expect(jobs[0]).toMatchObject({ initials: "AH", search: expect.stringContaining("barnes") });
  });

  it("builds the job page: next message first, a timeline in plain words", async () => {
    const job = await getOwnerJob("oj_ben", now);
    expect(job?.next).toMatchObject({ label: "Quote follow-up", to: "Ben", status: "awaiting_approval", whenText: "Waiting for your OK", canEdit: true });
    expect(job?.whatsapp).toBe("https://wa.me/447700900712");
    expect(job?.timeline.map((t) => t.title)).toContain("Quote sent");
    const words = JSON.stringify(job);
    for (const banned of ["asset", "pipeline", "rule_key", "awaiting_testimonial"]) expect(words).not.toContain(banned);
    expect(await getOwnerJob("nope", now)).toBeNull();
  });
});

describe("today", () => {
  it("ranks decisions and fills the week ahead and recent activity", async () => {
    const t = await getToday(now);
    expect(t.greeting).toMatch(/^Good (morning|afternoon|evening), Stephen$/);
    expect(t.cards.map((c) => c.eyebrow)).toEqual(expect.arrayContaining(["New enquiry", "Quotes", "Showcase"]));
    expect(t.cards[0].eyebrow).toBe("New enquiry");
    expect(t.recent.map((r) => r.text)).toEqual(expect.arrayContaining(["James left a 5★ review", "New enquiry from Amelia"]));
  });
});

describe("showcase", () => {
  it("shows pages with plain states and numbers, and reviews with consent respected", async () => {
    const s = await getShowcase();
    expect(s.pages).toEqual([expect.objectContaining({ title: "Sandstone patio, Putney", state: "ready", stateLabel: "Ready to check", numbers: "1 enquiry from this page", problem: null })]);
    expect(s.reviews).toEqual([expect.objectContaining({ who: "James, Putney", rating: 5, isPrivate: false })]);
  });
});

describe("team", () => {
  it("adds, edits and removes people with friendly errors", async () => {
    const jake = await saveMember(T, { name: "Jake", phone: "07700 900703", team: "maintenance", teamRole: "crew" });
    expect(jake).toMatchObject({ phone: "+447700900703", phonePretty: "07700 900703", roleLabel: "Crew" });
    await expect(saveMember(T, { name: "Dup", phone: "+447700900703", team: "landscaping", teamRole: "crew" })).rejects.toThrow("Jake already uses that number.");
    await expect(saveMember(T, { name: "X", phone: "0208 111 2222", team: "landscaping", teamRole: "crew" })).rejects.toBeInstanceOf(TeamError);
    await saveMember(T, { id: jake.id, name: "Jake", phone: "07700 900703", team: "maintenance", teamRole: "crew_lead" });
    const [row] = await (await getDb()).select().from(schema.crewMembers).where(eq(schema.crewMembers.id, jake.id));
    expect(row).toMatchObject({ teamRole: "crew_lead", role: "foreman" }); // the WhatsApp bot still reads the v1 role
    await expect(removeMember(T, "o_stephen")).rejects.toThrow("The owner can't be removed.");
    await removeMember(T, jake.id);
    expect((await listTeam(T)).map((m) => m.name)).toEqual(["Stephen", "Marco"]);
  });
});

describe("business profile", () => {
  it("keeps only what the owner kept and turns the app into their brand", async () => {
    const p = THORBURN_FIXTURE;
    const kept = applyChoices(p, {
      services: ["full_design", "patio_paving"],
      areas: ["Wimbledon"],
      favourites: [],
      projectImages: [p.projects[0].images[0].url],
    });
    expect(kept.services.map((s) => s.key)).toEqual(["full_design", "patio_paving"]);
    expect(kept.areas).toEqual([{ name: "Wimbledon", outward: "SW19" }]);
    expect(kept.projects).toHaveLength(1);
    expect(kept.badges).toEqual(p.badges); // proof is never edited here
    await saveConfirmedProfile(T, kept);
    const [tenant] = await (await getDb()).select().from(schema.tenants).where(eq(schema.tenants.id, T));
    expect(brandOf(tenant)).toMatchObject({ name: "Thorburn Landscapes", accent: "#2A7D2E", logoUrl: p.brand.logoUrl, displayFont: "Montserrat" });
  });
});
