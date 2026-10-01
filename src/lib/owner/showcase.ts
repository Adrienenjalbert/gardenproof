/**
 * Showcase: the project pages, videos and reviews the business has, in plain words. Problems are explained as
 * a sentence with (when there is one) a single fix. Check ids never reach the owner.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Customer, Job, Message, Testimonial } from "@/db/schema";
import { consentBlock } from "@/lib/dashboard/consent-state";
import { approvalBlockers } from "@/lib/dashboard/logic";
import { publicUrl } from "@/lib/storage";
import { getTenantBySlug } from "@/lib/tenants";
import { coverOf, photoUrl } from "./photos";
import { providerName } from "./showcase-words";
import { plural } from "./words";

export type ShowState = "ready" | "going_live" | "live" | "hidden" | "making" | "blocked";

export type Fix =
  | { kind: "send_request"; label: string; messageId: string }
  | { kind: "approve_scheduled"; label: string; scheduledId: string }
  | { kind: "open_job"; label: string; href: string };

export type ShowPage = {
  id: string;
  jobId: string | null;
  title: string;
  photo: string | null;
  state: ShowState;
  stateLabel: string;
  numbers: string | null;
  problem: string | null;
  fix: Fix | null;
  previewHref: string;
  liveUrl: string | null;
};

export type ShowVideo = {
  id: string;
  ids: string[];
  title: string;
  style: string;
  poster: string | null;
  src: string | null;
  state: ShowState;
  stateLabel: string;
  problem: string | null;
};

export type ShowReview = {
  id: string;
  who: string;
  rating: number | null;
  text: string | null;
  source: string;
  isPrivate: boolean;
  note: string | null;
};

export type Showcase = {
  pages: ShowPage[];
  videos: ShowVideo[];
  reviews: ShowReview[];
};

const STYLE_WORDS: Record<string, string> = {
  reveal: "Before & after reveal",
  proof: "Review & proof",
  process: "How we did it",
};

function stateOf(a: Pick<Asset, "status">, blocked: boolean): { state: ShowState; stateLabel: string } {
  if (a.status === "published") return { state: "live", stateLabel: "Live" };
  if (a.status === "approved") return { state: "going_live", stateLabel: "Going live" };
  if (a.status === "rejected") return { state: "hidden", stateLabel: "Hidden" };
  if (a.status === "draft") return { state: "making", stateLabel: "Being made" };
  return blocked ? { state: "blocked", stateLabel: "On hold" } : { state: "ready", stateLabel: "Ready to check" };
}

/** Keep the newest row per (job, type, key) so regenerated versions don't show twice. */
function latest<T extends Asset>(rows: T[], key: (a: T) => string): T[] {
  const m = new Map<string, T>();
  for (const a of [...rows].sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime()))
    if (!m.has(key(a))) m.set(key(a), a);
  return [...m.values()];
}

export async function getShowcase(): Promise<Showcase> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const T = tenant.id;
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.tenantId, T), inArray(schema.assets.type, ["portfolio_page", "video"])))
    .orderBy(desc(schema.assets.updatedAt));
  const jobIds = [...new Set(assets.map((a) => a.jobId).filter((x): x is string => !!x))];
  const [jobs, media, testimonials, leads, held, waitingAsks] = await Promise.all([
    jobIds.length ? db.select().from(schema.jobs).where(inArray(schema.jobs.id, jobIds)) : Promise.resolve([] as Job[]),
    jobIds.length ? db.select().from(schema.media).where(inArray(schema.media.jobId, jobIds)) : Promise.resolve([]),
    db
      .select()
      .from(schema.testimonials)
      .where(eq(schema.testimonials.tenantId, T))
      .orderBy(desc(schema.testimonials.createdAt)),
    db
      .select({
        assetId: schema.leads.assetId,
        projectSlug: schema.leads.projectSlug,
      })
      .from(schema.leads)
      .where(eq(schema.leads.tenantId, T)),
    db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.tenantId, T), eq(schema.messages.status, "held"))),
    db
      .select({
        id: schema.scheduledMessages.id,
        jobId: schema.scheduledMessages.jobId,
      })
      .from(schema.scheduledMessages)
      .where(
        and(
          eq(schema.scheduledMessages.tenantId, T),
          eq(schema.scheduledMessages.ruleKey, "review_request"),
          inArray(schema.scheduledMessages.status, ["awaiting_approval", "scheduled"]),
        ),
      ),
  ]);
  const custIds = [
    ...new Set(
      [...jobs.map((j) => j.customerId), ...testimonials.map((t) => t.customerId)].filter((x): x is string => !!x),
    ),
  ];
  const customers = custIds.length
    ? await db.select().from(schema.customers).where(inArray(schema.customers.id, custIds))
    : [];
  const cust = new Map<string, Customer>(customers.map((c) => [c.id, c]));
  const jobMap = new Map<string, Job>(jobs.map((j) => [j.id, j]));

  const problemFor = (a: Asset): { problem: string | null; fix: Fix | null } => {
    if (!approvalBlockers(a.checks).length || !a.jobId) return { problem: null, fix: null };
    const job = jobMap.get(a.jobId);
    const c = job?.customerId ? cust.get(job.customerId) : undefined;
    const t = testimonials.find((x) => x.jobId === a.jobId) ?? null;
    const heldRequest = held.find(
      (m) =>
        (m.meta as { kind?: string; jobId?: string }).kind === "review_request" &&
        (m.meta as { jobId?: string }).jobId === a.jobId,
    ) as Message | undefined;
    const b = consentBlock({
      jobId: a.jobId,
      customer: c ? { firstName: c.firstName, optedOut: c.optedOut } : null,
      testimonial: t
        ? {
            status: t.status,
            consentPhotos: t.consentPhotos,
            withdrawnAt: t.withdrawnAt,
          }
        : null,
      requestHeld: !!heldRequest,
    });
    const name = c?.firstName ?? "the homeowner";
    const planned = waitingAsks.find((w) => w.jobId === a.jobId);
    if (planned && !t) {
      return {
        problem: `${name} hasn't been asked yet. The review request is ready to go.`,
        fix: {
          kind: "approve_scheduled",
          label: `Ask ${name} now`,
          scheduledId: planned.id,
        },
      };
    }
    const problem =
      b.kind === "no_customer"
        ? "We don't have the homeowner's number, so we can't ask if we may show their garden."
        : b.kind === "request_held"
          ? `${name} hasn't been asked yet. The request is ready to send.`
          : b.kind === "awaiting_reply"
            ? `Waiting for ${name} to say yes to photos.`
            : b.kind === "declined"
              ? `${name} would rather we didn't show their garden. We'll keep it private.`
              : b.kind === "withdrawn"
                ? `${name} changed their mind, so it's been taken down.`
                : b.kind === "opted_out"
                  ? `${name} asked not to be messaged, so we can't ask about photos.`
                  : b.kind === "expired"
                    ? `${name} didn't reply in time. A quick call might help.`
                    : b.kind === "needs_edit"
                      ? "It mentions something the homeowner didn't agree to. We're fixing the wording."
                      : `We're asking ${name} if we may show it.`;
    const fix: Fix | null =
      b.kind === "request_held" && heldRequest
        ? {
            kind: "send_request",
            label: `Ask ${name} now`,
            messageId: heldRequest.id,
          }
        : b.kind === "no_customer"
          ? {
              kind: "open_job",
              label: "Add their number",
              href: `/jobs/${a.jobId}`,
            }
          : null;
    return { problem, fix };
  };

  const coverFor = (jobId: string | null) => {
    const c = jobId ? coverOf(media.filter((m) => m.jobId === jobId)) : null;
    return c ? photoUrl(c) : null;
  };

  const pages: ShowPage[] = latest(
    assets.filter((a) => a.type === "portfolio_page"),
    (a) => a.jobId ?? a.id,
  ).map((a) => {
    const { problem, fix } = problemFor(a);
    const slug = typeof a.content.slug === "string" ? a.content.slug : null;
    const enquiries = leads.filter((l) => l.assetId === a.id || (slug && l.projectSlug === slug)).length;
    return {
      id: a.id,
      jobId: a.jobId,
      title: typeof a.content.h1 === "string" ? a.content.h1 : a.title.replace(/^Portfolio page\s*[—-]\s*/i, ""),
      photo: coverFor(a.jobId),
      ...stateOf(a, !!problem),
      numbers: enquiries ? `${plural(enquiries, "enquiry", "enquiries")} from this page` : null,
      problem,
      fix,
      previewHref: `/preview/${a.id}`,
      liveUrl: a.externalUrl,
    };
  });

  const videoRows = assets.filter((a) => a.type === "video");
  const byStyle = new Map<string, Asset[]>();
  for (const v of videoRows) {
    const key = `${v.jobId}:${String(v.content.template ?? "video")}`;
    byStyle.set(key, [...(byStyle.get(key) ?? []), v]);
  }
  const videos: ShowVideo[] = [...byStyle.values()].map((rows) => {
    const main = rows.find((r) => r.content.ratio === "9:16") ?? rows[0];
    const job = main.jobId ? jobMap.get(main.jobId) : undefined;
    const blocked = rows.some((r) => approvalBlockers(r.checks).length > 0);
    const rendered = rows.filter((r) => r.fileKey);
    const s = rendered.length ? stateOf(main, blocked) : { state: "making" as const, stateLabel: "Being made" };
    return {
      id: main.id,
      ids: rows.filter((r) => r.status === "in_review").map((r) => r.id),
      title: job?.title ?? main.title,
      style: STYLE_WORDS[String(main.content.template)] ?? "Video",
      poster: main.thumbnailKey ? publicUrl(main.thumbnailKey) : coverFor(main.jobId),
      src: main.fileKey ? publicUrl(main.fileKey) : null,
      ...s,
      problem: blocked ? problemFor(main).problem : null,
    };
  });

  const reviews: ShowReview[] = testimonials
    .filter((t: Testimonial) => t.status === "responded")
    .map((t) => {
      const c = t.customerId ? cust.get(t.customerId) : undefined;
      const job = jobMap.get(t.jobId);
      const canQuote = !!t.consentQuote && !t.withdrawnAt && (t.rating ?? 0) >= 4;
      const who = [
        t.consentFirstName && c?.firstName ? c.firstName : "A homeowner",
        t.consentArea && job?.area ? job.area : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        id: t.id,
        who,
        rating: t.rating,
        text: t.quote,
        source: "Via GardenProof",
        isPrivate: !canQuote,
        note: canQuote ? null : (t.rating ?? 0) <= 3 ? "Private: sent to you only" : "Private: not for quoting",
      };
    });
  for (const r of tenant.profile?.reviews.featured ?? []) {
    reviews.push({
      id: r.url + r.text.slice(0, 12),
      who: r.author ?? "Customer",
      rating: r.rating,
      text: r.text,
      source: providerName(r.provider),
      isPrivate: false,
      note: null,
    });
  }
  return { pages, videos, reviews };
}
