/**
 * v2 CRM demo data for Thorburn (called by scripts/seed.ts after the v1 demo jobs exist).
 * Every job is walked through its real history with the CRM engine itself (moveJobToStage at past times), and
 * messages that fell due along the way are recorded as sent at that time, so timelines, "Recently" and the
 * planned messages look exactly like a few weeks of real use. The last step is one real dispatch at "now".
 * Ofcom drama-range numbers (07700 900xxx) only.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CrmStage } from "@/lib/crm";
import { DEFAULT_NOTIFICATIONS } from "@/lib/crm";
import { dispatchDueMessages, londonAt, moveJobToStage, saveSettings } from "@/lib/crm-engine";
import { env } from "@/lib/config";
import { enrichJob, generateContentForJob } from "@/lib/content";
import { VIDEO_RATIOS, VIDEO_TEMPLATES } from "@/lib/domain";
import { newId, newToken } from "@/lib/ids";
import { BusinessProfileSchema } from "@/lib/intel/types";
import { putObject } from "@/lib/storage";
import { reviewRequestText, reviewRequestVariables } from "@/lib/testimonials";
import { buildVideoPlan } from "@/lib/video/props";

type Step = {
  stage: CrmStage;
  day: number;
  hour?: number;
  actor?: string;
  at?: Date | null;
  note?: string;
};
type DemoJob = {
  id: string;
  code: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    postcode: string;
    area: string;
  };
  team?: "landscaping" | "maintenance";
  service: string;
  title: string;
  valueBand?: string;
  steps: Step[];
  /** Rule keys the owner skipped along the way. */
  skipped?: string[];
};

const HOUR = 3600_000;

export async function seedCrmDemo(T: string): Promise<{ customers: number; jobs: number; summary: string }> {
  const db = await getDb();
  const now = new Date();
  /** London wall time `day` days from today (negative = past). */
  const d = (day: number, hour = 10, minute = 0) => londonAt(now, day, hour, minute);

  // --- Business profile (from the intel pipeline's output, when present) and owner settings -----------------
  const profileFile = path.join(process.cwd(), "data", "profiles", "thorburn-landscapes.json");
  let profileNote = "no business profile file (data/profiles/thorburn-landscapes.json) — using tenant config";
  if (fs.existsSync(profileFile)) {
    const parsed = BusinessProfileSchema.safeParse(JSON.parse(fs.readFileSync(profileFile, "utf8")));
    if (parsed.success) {
      await db.update(schema.tenants).set({ profile: parsed.data }).where(eq(schema.tenants.id, T));
      // The intel run exported its stored images to public/<key>; put them back in this storage under the same keys.
      const p = parsed.data;
      const keys = [
        p.brand.logoKey,
        ...p.badges.map((b) => b.imageKey),
        ...p.projects.flatMap((pr) => pr.images.map((i) => i.key)),
      ];
      for (const key of keys) {
        const file = key ? path.join(process.cwd(), "public", key) : null;
        if (key && file && fs.existsSync(file)) await putObject(key, fs.readFileSync(file));
      }
      // Verified review pages from the profile fill the tenant's review links when none were typed in, so a
      // happy homeowner is offered "Post it on Google" in the demo too.
      const [t] = await db.select({ config: schema.tenants.config }).from(schema.tenants).where(eq(schema.tenants.id, T));
      const source = (provider: string) => p.reviews.sources.find((r) => r.provider === provider)?.url ?? null;
      if (t) {
        const proof = {
          ...t.config.proof,
          googleReviewUrl: t.config.proof.googleReviewUrl ?? source("google"),
          whichUrl: t.config.proof.whichUrl ?? source("which"),
        };
        await db.update(schema.tenants).set({ config: { ...t.config, proof } }).where(eq(schema.tenants.id, T));
      }
      profileNote = `business profile loaded (${parsed.data.badges.length} badges, ${parsed.data.projects.length} projects)`;
    } else {
      profileNote = `business profile file did not validate: ${parsed.error.issues[0]?.message}`;
    }
  }
  // Stephen chose: routine reminders go automatically; the evening summary at 18:00; quick-yes auto after 30 days.
  await saveSettings(T, {
    notifications: { ...DEFAULT_NOTIFICATIONS, digestHour: 18 },
    style: { tone: "warm", signOff: null },
    autoSendRoutine: true,
    // Thorburn runs Google Ads and wants area pages on its site; social captions and extra video shapes stay off.
    outputs: { ads: true, social: false, areaArticles: true, allVideoFormats: false },
  });

  // --- History of the three v1 demo jobs (ids unchanged) -------------------------------------------------------
  const v1: Array<{ id: string; steps: Step[] }> = [
    {
      id: "job_pond",
      steps: [
        { stage: "enquiry", day: -62 },
        { stage: "site_visit", day: -58, at: d(-55, 10) },
        { stage: "quoted", day: -52 },
        { stage: "booked", day: -41, at: d(-24, 8) },
        { stage: "on_site", day: -24, hour: 8, actor: "crw_marco" },
        { stage: "finished", day: -2, hour: 16, actor: "crw_marco" },
      ],
    },
    {
      id: "job_patio",
      steps: [
        { stage: "enquiry", day: -71 },
        { stage: "site_visit", day: -67, at: d(-64, 11) },
        { stage: "quoted", day: -60 },
        { stage: "booked", day: -47, at: d(-30, 8) },
        { stage: "on_site", day: -30, hour: 8, actor: "crw_marco" },
        { stage: "finished", day: -6, hour: 15, actor: "crw_marco" },
      ],
    },
    {
      id: "job_room",
      steps: [
        { stage: "enquiry", day: -40 },
        { stage: "site_visit", day: -37, at: d(-35, 9) },
        { stage: "quoted", day: -31 },
        { stage: "booked", day: -12, at: d(-3, 8) },
        { stage: "on_site", day: -3, hour: 8, actor: "crw_marco" },
      ],
    },
  ];

  // --- New CRM demo clients --------------------------------------------------------------------------------------
  const demo: DemoJob[] = [
    {
      id: "job_amelia",
      code: "TL-7104",
      customer: {
        id: "cus_amelia",
        firstName: "Amelia",
        lastName: "Hart",
        phone: "+447700900104",
        postcode: "SW13 0AA",
        area: "Barnes",
      },
      service: "full_design",
      title: "Garden design, Barnes",
      steps: [{ stage: "enquiry", day: 0, hour: -2, actor: "customer" }],
    },
    {
      id: "job_tom",
      code: "TL-7112",
      customer: {
        id: "cus_tom",
        firstName: "Tom",
        lastName: "Reid",
        phone: "+447700900105",
        postcode: "SW18 3PL",
        area: "Wandsworth",
      },
      service: "patio_paving",
      title: "Patio, Wandsworth",
      steps: [
        { stage: "enquiry", day: -4, hour: 12, actor: "customer" },
        { stage: "site_visit", day: -3, hour: 9, at: d(1, 10) },
      ],
    },
    {
      id: "job_charlotte",
      code: "TL-7086",
      customer: {
        id: "cus_charlotte",
        firstName: "Charlotte",
        lastName: "Webb",
        phone: "+447700900106",
        postcode: "SW14 7QD",
        area: "East Sheen",
      },
      service: "planting",
      title: "Planting scheme, East Sheen",
      valueBand: "£10–20k",
      steps: [
        { stage: "enquiry", day: -15, actor: "customer" },
        { stage: "site_visit", day: -14, at: d(-12, 14) },
        { stage: "quoted", day: -6, hour: 17 },
      ],
    },
    {
      id: "job_ben",
      code: "TL-7061",
      customer: {
        id: "cus_ben",
        firstName: "Ben",
        lastName: "Osei",
        phone: "+447700900107",
        postcode: "SW11 5TR",
        area: "Battersea",
      },
      service: "patio_paving",
      title: "Porcelain terrace, Battersea",
      valueBand: "£20–40k",
      steps: [
        { stage: "enquiry", day: -18, actor: "customer" },
        { stage: "site_visit", day: -17, at: d(-15, 11) },
        { stage: "quoted", day: -8, hour: 16 },
      ],
    },
    {
      id: "job_priya",
      code: "TL-7020",
      customer: {
        id: "cus_priya",
        firstName: "Priya",
        lastName: "Shah",
        phone: "+447700900108",
        postcode: "SW20 8LN",
        area: "Raynes Park",
      },
      service: "structures",
      title: "Pergola & raised beds, Raynes Park",
      valueBand: "£20–40k",
      steps: [
        { stage: "enquiry", day: -30, actor: "customer" },
        { stage: "site_visit", day: -28, at: d(-26, 10) },
        { stage: "quoted", day: -21 },
        { stage: "booked", day: -2, hour: 11, actor: "customer", at: d(4, 8) },
      ],
    },
    {
      id: "job_eleanor",
      code: "TL-6630",
      customer: {
        id: "cus_eleanor",
        firstName: "Eleanor",
        lastName: "Price",
        phone: "+447700900110",
        postcode: "SW19 4QR",
        area: "Wimbledon",
      },
      team: "maintenance",
      service: "maintenance",
      title: "Fortnightly garden care, Wimbledon",
      steps: [
        { stage: "finished", day: -152 },
        { stage: "maintenance", day: -150, at: d(2, 9) },
      ],
    },
    {
      id: "job_george",
      code: "TL-5902",
      customer: {
        id: "cus_george",
        firstName: "George",
        lastName: "Lund",
        phone: "+447700900111",
        postcode: "TW10 6AB",
        area: "Richmond",
      },
      team: "maintenance",
      service: "maintenance",
      title: "Monthly garden care, Richmond",
      steps: [
        { stage: "finished", day: -342 },
        { stage: "maintenance", day: -340, at: d(1, 8, 30) },
      ],
    },
    {
      id: "job_mark",
      code: "TL-7033",
      customer: {
        id: "cus_mark",
        firstName: "Mark",
        lastName: "Doyle",
        phone: "+447700900112",
        postcode: "SW12 8EE",
        area: "Balham",
      },
      service: "fencing",
      title: "Fencing & screening, Balham",
      steps: [
        { stage: "enquiry", day: -25, actor: "customer" },
        { stage: "site_visit", day: -24, at: d(-22, 15) },
        { stage: "quoted", day: -17 },
        { stage: "lost", day: -9, note: "Went with a cheaper quote" },
      ],
      skipped: ["quote_follow_up"],
    },
  ];

  await db.insert(schema.customers).values(demo.map((j) => ({ ...j.customer, tenantId: T })));
  for (const j of demo) {
    const first = j.steps[0];
    await db.insert(schema.jobs).values({
      id: j.id,
      tenantId: T,
      code: j.code,
      customerId: j.customer.id,
      status: "capturing",
      stage: first.stage,
      team: j.team ?? "landscaping",
      service: j.service,
      postcode: j.customer.postcode,
      area: j.customer.area,
      title: j.title,
      valueBand: j.valueBand ?? null,
      createdByCrewId: j.team === "maintenance" ? "crw_jake" : "crw_marco",
      startedAt: stepTime(first),
      createdAt: stepTime(first),
      updatedAt: stepTime(first),
    });
  }

  function stepTime(s: Step): Date {
    return s.day === 0 && (s.hour ?? 0) < 0 ? new Date(now.getTime() + (s.hour ?? 0) * HOUR) : d(s.day, s.hour ?? 10);
  }

  const businessPhone = "+447700900000";
  /** Messages that fell due before `until` are recorded as sent then (the owner said yes at the time). */
  async function settle(jobId: string, until: Date, skipped: string[] = []) {
    const due = await db
      .select()
      .from(schema.scheduledMessages)
      .where(
        and(
          eq(schema.scheduledMessages.jobId, jobId),
          eq(schema.scheduledMessages.status, "scheduled"),
          lte(schema.scheduledMessages.sendAt, until),
        ),
      );
    for (const r of due) {
      if (skipped.some((k) => r.ruleKey.startsWith(k))) {
        await db
          .update(schema.scheduledMessages)
          .set({ status: "skipped" })
          .where(eq(schema.scheduledMessages.id, r.id));
        continue;
      }
      const to =
        r.audience === "customer" && r.customerId
          ? (await db.select().from(schema.customers).where(eq(schema.customers.id, r.customerId)))[0]?.phone
          : r.crewId
            ? (await db.select().from(schema.crewMembers).where(eq(schema.crewMembers.id, r.crewId)))[0]?.phone
            : null;
      if (!to || !r.body || r.ruleKey === "review_request") continue;
      const msgId = newId("msg");
      await db.insert(schema.messages).values({
        id: msgId,
        tenantId: T,
        direction: "out",
        channel: "simulator",
        fromNumber: businessPhone,
        toNumber: to,
        body: r.body,
        status: "sent",
        meta: { kind: "crm", ruleKey: r.ruleKey, scheduledId: r.id, jobId },
        createdAt: r.sendAt,
      });
      await db
        .update(schema.scheduledMessages)
        .set({ status: "sent", messageId: msgId })
        .where(eq(schema.scheduledMessages.id, r.id));
    }
  }

  async function walk(jobId: string, steps: Step[], skipped: string[] = []) {
    for (const [i, s] of steps.entries()) {
      const t = stepTime(s);
      await moveJobToStage(jobId, s.stage, s.actor ?? "owner", s.note ?? null, {
        now: t,
        at: s.at ?? (s.stage === "site_visit" || s.stage === "booked" || s.stage === "maintenance" ? null : undefined),
      });
      const next = steps[i + 1];
      if (next) await settle(jobId, stepTime(next), skipped);
    }
  }

  // v1 jobs start from their first step (their stage column defaults to on_site).
  for (const j of v1) {
    await db.update(schema.jobs).set({ stage: j.steps[0].stage }).where(eq(schema.jobs.id, j.id));
    await walk(j.id, j.steps);
  }
  for (const j of demo) await walk(j.id, j.steps, j.skipped);

  // James's review request went out 5 days ago through the real homeowner flow (tst_patio already responded).
  const [patioReq] = await db
    .select()
    .from(schema.scheduledMessages)
    .where(
      and(eq(schema.scheduledMessages.jobId, "job_patio"), eq(schema.scheduledMessages.ruleKey, "review_request")),
    );
  const [tst] = await db.select().from(schema.testimonials).where(eq(schema.testimonials.id, "tst_patio"));
  if (patioReq && tst) {
    const msgId = newId("msg");
    const body = reviewRequestText(
      reviewRequestVariables({
        firstName: "James",
        from: "Stephen at Thorburn Landscapes",
        link: `${env.appUrl}/r/${tst.token}`,
      }),
    );
    await db.insert(schema.messages).values({
      id: msgId,
      tenantId: T,
      direction: "out",
      channel: "simulator",
      fromNumber: businessPhone,
      toNumber: "+447700900102",
      body,
      status: "sent",
      meta: {
        kind: "review_request",
        testimonialId: tst.id,
        jobId: "job_patio",
      },
      createdAt: tst.sentAt ?? d(-5),
    });
    await db
      .update(schema.scheduledMessages)
      .set({ status: "sent", messageId: msgId, sendAt: tst.sentAt ?? d(-5) })
      .where(eq(schema.scheduledMessages.id, patioReq.id));
  }
  // Priya's prep checklist was approved by Natalia yesterday.
  await settle("job_priya", d(-1, 12));
  // Eleanor's last visit reminder, two weeks ago (the plan only holds the next one).
  const eleanorMsg = newId("msg");
  await db.insert(schema.messages).values({
    id: eleanorMsg,
    tenantId: T,
    direction: "out",
    channel: "simulator",
    fromNumber: businessPhone,
    toNumber: "+447700900110",
    body: "Hi Eleanor,\n\nJake will be with you tomorrow for your garden visit. Nothing you need to do.\n\nThanks,\nStephen, Thorburn Landscapes",
    status: "sent",
    meta: { kind: "crm", ruleKey: "maintenance_visit", jobId: "job_eleanor" },
    createdAt: d(-13, 18),
  });
  await db.insert(schema.messages).values({
    id: newId("msg"),
    tenantId: T,
    direction: "in",
    channel: "simulator",
    fromNumber: "+447700900110",
    toNumber: businessPhone,
    body: "Lovely, thank you. The side gate will be open.",
    status: "sent",
    meta: {},
    createdAt: d(-13, 19),
  });

  // Amelia filled in the enquiry form on the website.
  await db.insert(schema.formResponses).values({
    id: newId("frm"),
    tenantId: T,
    kind: "enquiry",
    token: newToken(),
    customerId: "cus_amelia",
    jobId: "job_amelia",
    answers: {
      service: "full_design",
      budget: "20_40k",
      timing: "spring",
      about: "A long, bare lawn. We'd love a terrace for dinners outside and softer planting.",
    },
    step: 6,
    source: "web",
    completedAt: new Date(now.getTime() - 2 * HOUR),
    createdAt: new Date(now.getTime() - 2 * HOUR - 6 * 60_000),
    updatedAt: new Date(now.getTime() - 2 * HOUR),
  });

  // Draft the pages (mock AI in demo) so Showcase has something real to show.
  let content = "content drafting skipped (SEED_CONTENT=off)";
  if (process.env.SEED_CONTENT !== "off") {
    try {
      for (const jobId of ["job_patio", "job_pond"]) {
        await enrichJob(jobId);
        await generateContentForJob(jobId);
      }
      content = `pages drafted, ${await seedVideos(T)} videos attached, ${await seedLeads(T, now)} tracked enquiries`;
    } catch (err) {
      content = `content drafting failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const s = await dispatchDueMessages(now, { digest: false });
  const rows = await db
    .select({ status: schema.scheduledMessages.status })
    .from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.tenantId, T));
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  return {
    customers: demo.length,
    jobs: demo.length,
    summary: [
      `CRM: ${rows.length} planned messages — ${count("scheduled")} scheduled, ${count("awaiting_approval")} waiting for Stephen, ${count("sent")} sent, ${count("skipped")} skipped, ${count("cancelled")} cancelled (dispatch now: ${s.sent} sent).`,
      profileNote,
      content,
    ].join("\n"),
  };
}

/**
 * The Putney patio has real renders in review/videos (made from this very job by scripts/render-samples.ts).
 * Attach them as the job's videos, with the exact props the video module plans for it.
 */
async function seedVideos(T: string): Promise<number> {
  const dir = path.join(process.cwd(), "review", "videos");
  if (!fs.existsSync(dir)) return 0;
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_patio"));
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, T));
  const media = await db.select().from(schema.media).where(eq(schema.media.jobId, "job_patio"));
  const [testimonial] = await db.select().from(schema.testimonials).where(eq(schema.testimonials.id, "tst_patio"));
  const plan = buildVideoPlan(
    {
      config: tenant.config,
      job,
      media,
      testimonial: testimonial ?? null,
      customerFirstName: "James",
      customerLastName: "Patel",
      adCopy: null,
    },
    {
      formats: {
        reveal: [...VIDEO_RATIOS],
        proof: [...VIDEO_RATIOS],
        process: [...VIDEO_RATIOS],
      },
    },
  );
  let n = 0;
  for (const spec of plan.specs) {
    if (!VIDEO_TEMPLATES.includes(spec.template)) continue;
    const base = `patio-${spec.template}-${spec.ratio.replace(":", "x")}`;
    const mp4 = path.join(dir, `${base}.mp4`);
    const jpg = path.join(dir, `${base}.jpg`);
    if (!fs.existsSync(mp4)) continue;
    const fileKey = await putObject(`thorburn/job_patio/videos/${base}.mp4`, fs.readFileSync(mp4));
    const thumbnailKey = fs.existsSync(jpg)
      ? await putObject(`thorburn/job_patio/videos/${base}.jpg`, fs.readFileSync(jpg))
      : null;
    await db.insert(schema.assets).values({
      id: newId("ast"),
      tenantId: T,
      jobId: "job_patio",
      type: "video",
      status: "in_review",
      title: spec.title,
      content: {
        template: spec.template,
        ratio: spec.ratio,
        hook: spec.hook,
        props: spec.props as unknown as Record<string, unknown>,
        durationSec: null,
      },
      fileKey,
      thumbnailKey,
      checks: spec.checks,
    });
    n++;
  }
  return n;
}

/**
 * Demo enquiries that came through the patio job's page and video (what gp-track.js + /api/leads record on a real
 * site), so Today's "Working for you" has something to show. Demo tenant only.
 */
async function seedLeads(T: string, now: Date): Promise<number> {
  const db = await getDb();
  const assets = await db
    .select({ id: schema.assets.id, type: schema.assets.type })
    .from(schema.assets)
    .where(eq(schema.assets.jobId, "job_patio"));
  const page = assets.find((a) => a.type === "portfolio_page");
  const video = assets.find((a) => a.type === "video");
  const rows = [
    { assetId: page?.id, source: "google", medium: "organic", daysAgo: 3, name: "Amelia" },
    { assetId: page?.id, source: "google", medium: "organic", daysAgo: 12, name: "Tom" },
    { assetId: video?.id, source: "instagram", medium: "social", daysAgo: 19, name: "Charlotte" },
  ].filter((r) => r.assetId);
  for (const r of rows) {
    await db.insert(schema.leads).values({
      id: newId("lead"),
      tenantId: T,
      source: r.source,
      medium: r.medium,
      content: r.assetId,
      assetId: r.assetId,
      name: r.name,
      createdAt: new Date(now.getTime() - r.daysAgo * 86_400_000),
    });
  }
  return rows.length;
}
