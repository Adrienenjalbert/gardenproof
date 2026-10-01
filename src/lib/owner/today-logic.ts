/**
 * Pure logic for Today: which decisions to put in front of the owner, in what order, and how the week ahead
 * reads. No DB, so the ranking is unit-tested.
 */
import type { CrmStage, TrustTier } from "@/lib/crm";
import { ruleOf } from "@/lib/crm-engine/rules";
import { ago, calendarDaysBetween, capitalise, clockTime, when } from "./words";

export type CardAction =
  | { kind: "link"; label: string; href: string; external?: boolean }
  | { kind: "approve"; label: string; ids: string[]; done: string }
  | { kind: "approve_page"; label: string; assetId: string; done: string };

export type DecisionCard = {
  /** Stable per subject, so "Later" hides the same card until tomorrow. */
  id: string;
  score: number;
  eyebrow: string;
  title: string;
  detail: string;
  photo: string | null;
  /** Initial shown when there is no photo. */
  monogram: string;
  /** Symbol for grouped cards (several people), instead of a monogram. */
  icon?: "chat" | "star" | "calendar" | "send";
  preview?: string;
  href: string | null;
  primary: CardAction;
  secondary?: { label: string; href: string; icon: "phone" | "chat" };
};

export type EnquiryIn = {
  jobId: string;
  name: string;
  area: string | null;
  service: string | null;
  since: Date;
  whatsapp: string | null;
  phone: string | null;
};
export type ApprovalIn = {
  id: string;
  ruleKey: string;
  trustTier: TrustTier;
  jobId: string | null;
  name: string;
  body: string;
  since: Date;
  stageSince: Date;
};
export type PageIn = {
  assetId: string;
  jobId: string | null;
  name: string;
  photo: string | null;
  title: string;
};
export type LowReviewIn = {
  id: string;
  jobId: string;
  name: string;
  rating: number;
  phone: string | null;
};

export function joinNames(names: string[]): string {
  const u = [...new Set(names)];
  if (u.length <= 1) return u[0] ?? "";
  if (u.length <= 3) return `${u.slice(0, -1).join(", ")} and ${u.at(-1)}`;
  return `${u.slice(0, 2).join(", ")} and ${u.length - 2} others`;
}

const both = (n: number) => (n === 2 ? "both" : `all ${n}`);
const firstLine = (s: string) =>
  s
    .replace(/^(Hi|Dear) [^,\n]+,\s*/i, "")
    .split("\n")
    .find((l) => l.trim()) ?? "";

function approvalCards(
  approvals: ApprovalIn[],
  now: Date,
  photoFor: (jobId: string | null) => string | null,
): DecisionCard[] {
  const groups = new Map<string, ApprovalIn[]>();
  for (const a of approvals) {
    const base = a.ruleKey.split(":")[0];
    const key = ["quote_follow_up", "review_request", "maintenance_renewal", "aftercare_offer"].includes(base)
      ? base
      : "other";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const cards: DecisionCard[] = [];
  for (const [key, rows] of groups) {
    const names = joinNames(rows.map((r) => r.name));
    const one = rows.length === 1 ? rows[0] : null;
    const ids = rows.map((r) => r.id);
    const icon =
      key === "quote_follow_up"
        ? "chat"
        : key === "review_request"
          ? "star"
          : key === "maintenance_renewal"
            ? "calendar"
            : "send";
    const common = {
      photo: one ? photoFor(one.jobId) : null,
      monogram: (one?.name ?? "•")[0],
      icon: one ? undefined : (icon as DecisionCard["icon"]),
      href: one?.jobId ? `/jobs/${one.jobId}` : null,
      preview: one ? firstLine(one.body) : undefined,
    };
    if (key === "quote_follow_up") {
      const minDays = Math.min(...rows.map((r) => calendarDaysBetween(r.stageSince, now)));
      cards.push({
        ...common,
        id: `quotes:${ids.sort().join(",")}`,
        score: 80 + Math.min(10, minDays),
        eyebrow: "Quotes",
        title: one ? `${one.name}'s quote is ${minDays} days old` : `${rows.length} quotes waiting ${minDays}+ days`,
        detail: one
          ? "A friendly nudge is ready to go."
          : `${names} haven't replied yet. A friendly nudge is ready for each.`,
        primary: {
          kind: "approve",
          label: one ? "Send the nudge" : `Nudge ${both(rows.length)}`,
          ids,
          done: one ? `Nudge sent to ${one.name}` : `${rows.length} nudges sent`,
        },
      });
    } else if (key === "review_request") {
      cards.push({
        ...common,
        id: `reviews:${ids.sort().join(",")}`,
        score: 76,
        eyebrow: "Reviews",
        title: one ? `Ask ${one.name} for a review?` : `Ask ${rows.length} customers for a review?`,
        detail: one
          ? "The work is finished. Their answer unlocks the page and videos."
          : `${names}: the work is finished.`,
        preview: undefined,
        primary: {
          kind: "approve",
          label: one ? `Ask ${one.name}` : `Ask ${both(rows.length)}`,
          ids,
          done: "Review request on its way",
        },
      });
    } else if (key === "maintenance_renewal") {
      cards.push({
        ...common,
        id: `renewals:${ids.sort().join(",")}`,
        score: 62,
        eyebrow: "Maintenance",
        title: one ? `${one.name}'s plan renews soon` : "Maintenance renewals due",
        detail: one
          ? "A renewal message is ready. Have a look before it goes."
          : `${names}: renewal messages are ready.`,
        primary: one?.jobId
          ? { kind: "link", label: "Look & send", href: `/jobs/${one.jobId}` }
          : {
              kind: "approve",
              label: `Send ${both(rows.length)}`,
              ids,
              done: "Renewal messages sent",
            },
      });
    } else {
      const label = one ? (ruleOf(one.ruleKey)?.label ?? "Message") : null;
      cards.push({
        ...common,
        id: `${key}:${ids.sort().join(",")}`,
        score: key === "aftercare_offer" ? 58 : 70,
        eyebrow: "Messages",
        title: one ? `${label} for ${one.name}` : `${rows.length} messages ready to go`,
        detail: one ? "Ready when you are." : `To ${names}.`,
        primary: {
          kind: "approve",
          label: one ? "Send" : `Send ${both(rows.length)}`,
          ids,
          done: one ? `Sent to ${one.name}` : `${rows.length} messages sent`,
        },
      });
    }
  }
  return cards;
}

/** All decisions, most important first. The UI shows the first three that aren't snoozed. */
export function rankCards(input: {
  now: Date;
  enquiries: EnquiryIn[];
  approvals: ApprovalIn[];
  readyPages: PageIn[];
  lowReviews: LowReviewIn[];
  photoFor: (jobId: string | null) => string | null;
}): DecisionCard[] {
  const { now } = input;
  const cards: DecisionCard[] = [];
  for (const r of input.lowReviews) {
    cards.push({
      id: `low:${r.id}`,
      score: 110,
      eyebrow: "Needs you",
      title: `${r.name} rated the job ${r.rating}★`,
      detail: "Worth a personal call today. It stays private.",
      photo: input.photoFor(r.jobId),
      monogram: r.name[0] ?? "•",
      href: `/jobs/${r.jobId}`,
      primary: r.phone
        ? { kind: "link", label: `Call ${r.name}`, href: `tel:${r.phone}` }
        : { kind: "link", label: "Open job", href: `/jobs/${r.jobId}` },
    });
  }
  for (const e of input.enquiries) {
    const hours = (now.getTime() - e.since.getTime()) / 3600_000;
    cards.push({
      id: `enq:${e.jobId}`,
      score: 100 - Math.min(20, hours / 6),
      eyebrow: "New enquiry",
      title: `${e.name}${e.area ? ` · ${e.area}` : ""}`,
      detail: [e.service, capitalise(ago(e.since, now))].filter(Boolean).join(" · "),
      photo: null,
      monogram: e.name[0] ?? "•",
      href: `/jobs/${e.jobId}`,
      primary: e.whatsapp
        ? { kind: "link", label: "Reply", href: e.whatsapp, external: true }
        : { kind: "link", label: "Open", href: `/jobs/${e.jobId}` },
      secondary: e.phone ? { label: "Call", href: `tel:${e.phone}`, icon: "phone" } : undefined,
    });
  }
  cards.push(...approvalCards(input.approvals, now, input.photoFor));
  for (const p of input.readyPages) {
    cards.push({
      id: `page:${p.assetId}`,
      score: 72,
      eyebrow: "Showcase",
      title: `${p.name}'s page is ready`,
      detail: p.title,
      photo: p.photo,
      monogram: p.name[0] ?? "•",
      href: `/showcase#${p.assetId}`,
      primary: {
        kind: "link",
        label: "Look & approve",
        href: `/showcase#${p.assetId}`,
      },
    });
  }
  return cards.sort((a, b) => b.score - a.score);
}

export type UpcomingIn = {
  jobId: string;
  stage: CrmStage;
  team: "landscaping" | "maintenance";
  name: string;
  area: string | null;
  at: Date | null;
  since: Date;
};
export type UpcomingItem = {
  jobId: string;
  title: string;
  subtitle: string;
  when: string;
};
export type UpcomingGroup = {
  team: string;
  lead: string | null;
  items: UpcomingItem[];
};
export type RecentItem = {
  id: string;
  icon: "star" | "page" | "send" | "flag";
  text: string;
  when: string;
  href: string | null;
};

const WHAT: Partial<Record<CrmStage, string>> = {
  site_visit: "Site visit",
  booked: "Start",
  maintenance: "Maintenance visit",
  on_site: "On site",
};

export function groupUpcoming(items: UpcomingIn[], leads: Map<string, string>, now: Date): UpcomingGroup[] {
  const groups: UpcomingGroup[] = [];
  for (const team of ["landscaping", "maintenance"] as const) {
    const rows = items
      .filter((i) => i.team === team)
      .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
      .map((i) => ({
        jobId: i.jobId,
        title: i.name,
        subtitle: [WHAT[i.stage] ?? "Job", i.area].filter(Boolean).join(" · "),
        when: i.stage === "on_site" ? `Day ${calendarDaysBetween(i.since, now) + 1}` : i.at ? whenShort(i.at, now) : "",
      }));
    if (rows.length)
      groups.push({
        team: team === "landscaping" ? "Landscaping" : "Maintenance",
        lead: leads.get(team) ?? null,
        items: rows,
      });
  }
  return groups;
}

/** "Today 10:00", "Tomorrow", "Fri 18:00". */
export function whenShort(d: Date, now: Date): string {
  const days = calendarDaysBetween(now, d);
  const t = clockTime(d) === "00:00" ? "" : ` ${clockTime(d)}`;
  if (days === 0) return `Today${t}`;
  if (days === 1) return `Tomorrow${t}`;
  return capitalise(when(d, now)).replace(" at ", " ");
}

// ---------------------------------------------------------------------------
// What's working: enquiries the business's own content brought in
// ---------------------------------------------------------------------------

export type LeadIn = { assetId: string | null; projectSlug: string | null };
export type ContentAssetIn = { id: string; jobId: string | null; type: string; slug: string | null };
export type ContentWin = { jobId: string | null; label: string; via: string; count: number };
export type ContentWins = { total: number; days: number; top: ContentWin[] };

const VIA: Record<string, string> = {
  portfolio_page: "project page",
  video: "video",
  ad_copy: "ad",
  gbp_post: "Google post",
  social_pack: "social post",
  seo_article: "area article",
};

/**
 * Enquiries in the window that came through a piece of content (a tracked asset, or a project page seen first),
 * grouped by the job the content shows. Null when nothing came through content: the owner sees no empty box.
 */
export function summariseContentWins(input: {
  leads: LeadIn[];
  assets: ContentAssetIn[];
  jobLabel: (jobId: string | null) => string | null;
  days: number;
  limit?: number;
}): ContentWins | null {
  const byId = new Map(input.assets.map((a) => [a.id, a]));
  const bySlug = new Map(input.assets.filter((a) => a.slug).map((a) => [a.slug!, a]));
  const groups = new Map<string, { jobId: string | null; label: string; kinds: Set<string>; count: number }>();
  let total = 0;
  for (const lead of input.leads) {
    const asset = (lead.assetId ? byId.get(lead.assetId) : undefined) ?? (lead.projectSlug ? bySlug.get(lead.projectSlug) : undefined);
    if (!asset) continue;
    total++;
    const key = asset.jobId ?? `asset:${asset.id}`;
    const label = input.jobLabel(asset.jobId) ?? "Your content";
    const g = groups.get(key) ?? { jobId: asset.jobId, label, kinds: new Set<string>(), count: 0 };
    g.kinds.add(VIA[asset.type] ?? "content");
    g.count++;
    groups.set(key, g);
  }
  if (total === 0) return null;
  const top = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, input.limit ?? 3)
    .map((g) => ({ jobId: g.jobId, label: g.label, via: joinNames([...g.kinds]), count: g.count }));
  return { total, days: input.days, top };
}
