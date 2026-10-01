import Link from "next/link";
import type { Overview } from "@/lib/dashboard/queries";
import { timeAgo } from "@/lib/dashboard/logic";
import { Icon, type IconName } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { Card } from "@/components/ui/primitives";
import { ASSET_TYPE_META } from "./asset-meta";

function Row({
  href,
  icon,
  thumb,
  title,
  meta,
  tone = "amber",
}: {
  href: string;
  icon?: IconName;
  thumb?: string;
  title: React.ReactNode;
  meta: React.ReactNode;
  tone?: "amber" | "olive" | "red";
}) {
  const toneCls = { amber: "bg-amber-50 text-amber-700", olive: "bg-olive-50 text-olive", red: "bg-red-50 text-red-600" }[tone];
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-olive-50/60">
        {thumb ? (
          <Photo src={thumb} alt="" className="size-10 shrink-0 rounded-lg" />
        ) : (
          <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${toneCls}`}>
            <Icon name={icon ?? "alert"} size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted">{meta}</span>
        </span>
        <Icon name="chevronRight" size={16} className="shrink-0 text-stone-300 group-hover:text-olive" />
      </Link>
    </li>
  );
}

/** Everything that is blocked on the operator, most valuable first. */
export function NeedsYou({ data }: { data: Overview }) {
  const actionableBlocks = data.blockedJobs.filter((b) => b.block.action);
  const waitingOnHomeowner = data.blockedJobs.filter((b) => !b.block.action);
  const total = data.reviewGroups.length + data.held.length + data.flaggedMedia.length + actionableBlocks.length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-[17px]">Needs you</h2>
        {total > 0 && (
          <span className="rounded-full bg-amber-100 px-2 text-xs leading-5 font-semibold text-amber-900 tabular-nums">
            {total}
          </span>
        )}
      </div>
      {total === 0 && !waitingOnHomeowner.length ? (
        <div className="px-4 py-10 text-center">
          <span className="mx-auto mb-2 grid size-9 place-items-center rounded-full bg-lime-50 text-lime-700">
            <Icon name="check" size={18} />
          </span>
          <p className="text-sm font-medium">You&apos;re all caught up</p>
          <p className="mt-0.5 text-xs text-muted">New drafts and held messages will appear here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {data.reviewGroups.map((g) => (
            <Row
              key={g.jobId ?? "none"}
              href={g.jobId ? `/ops/review#job-${g.jobId}` : "/ops/review"}
              icon="review"
              title={`${g.count} ${g.count === 1 ? "asset" : "assets"} to review`}
              meta={`${g.jobTitle} · ${g.types.map((t) => ASSET_TYPE_META[t].short).join(", ")}`}
            />
          ))}
          {data.held.map((m) => (
            <Row
              key={m.id}
              href="/ops/messages"
              icon="message"
              tone="olive"
              title={`Message to ${m.recipientName ?? m.toNumber ?? "customer"} is held`}
              meta={`${timeAgo(m.createdAt)} · ${m.body ?? ""}`}
            />
          ))}
          {actionableBlocks.map((b) => (
            <Row
              key={b.jobId}
              href={b.block.action?.href ?? `/ops/jobs/${b.jobId}`}
              icon={b.block.kind === "no_customer" ? "user" : "shield"}
              tone="red"
              title={b.block.kind === "no_customer" ? `Add the homeowner to unlock ${b.count} drafts` : b.block.title}
              meta={`${b.jobTitle} · ${b.count} ${b.count === 1 ? "draft" : "drafts"} blocked on consent`}
            />
          ))}
          {data.flaggedMedia.map((m) => (
            <Row
              key={m.id}
              href={`/ops/jobs/${m.jobId}?tab=media`}
              thumb={m.url}
              title={`Photo withheld: ${m.privacy.reason ?? "needs a check"}`}
              meta={`${m.jobTitle} · ${m.stage} · check it and decide`}
            />
          ))}
          {waitingOnHomeowner.map((b) => (
            <Row
              key={b.jobId}
              href={`/ops/jobs/${b.jobId}?tab=testimonial`}
              icon="clock"
              tone="olive"
              title={b.block.title}
              meta={`${b.jobTitle} · ${b.count} ${b.count === 1 ? "draft" : "drafts"} unlock when they reply — nothing to do`}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
