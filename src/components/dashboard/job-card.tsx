import Link from "next/link";
import type { JobCard as JobCardData } from "@/lib/dashboard/queries";
import { timeAgo } from "@/lib/dashboard/logic";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { StatusPill } from "@/components/ui/status-pill";

const STAGE_LABEL = { before: "Before", progress: "In progress", after: "After" } as const;

/** Image-first job card: the finished garden is the hero, metadata stays quiet. */
export function JobCard({ job }: { job: JobCardData }) {
  return (
    <Link
      href={`/ops/jobs/${job.id}`}
      className="group block overflow-hidden rounded-2xl bg-white ring-1 ring-line transition-shadow hover:shadow-[0_8px_30px_rgba(47,50,34,0.10)] focus-visible:outline-2 focus-visible:outline-olive"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Photo
          src={job.coverUrl}
          alt={job.title}
          className="size-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <StatusPill kind="job" status={job.status} className="bg-white/95 shadow-sm backdrop-blur" />
          {job.coverStage && (
            <span className="rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              {STAGE_LABEL[job.coverStage]}
            </span>
          )}
        </div>
        {job.assetsInReview > 0 ? (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 shadow-sm">
            <Icon name="review" size={13} />
            {job.assetsInReview} to review
          </span>
        ) : (
          job.assetsBlocked > 0 && (
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11.5px] font-semibold text-stone-700 shadow-sm">
              <Icon name="shield" size={13} />
              {job.assetsBlocked} waiting on consent
            </span>
          )
        )}
      </div>
      <div className="px-4 pt-3.5 pb-4">
        <h3 className="line-clamp-1 font-display text-[16px] text-foreground">{job.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
          <span className="font-mono text-[12px] text-olive">{job.code}</span>
          {job.area && (
            <>
              <span aria-hidden>·</span>
              <span>{job.area}</span>
            </>
          )}
          {job.crewName && (
            <>
              <span aria-hidden>·</span>
              <span>{job.crewName}</span>
            </>
          )}
          <span className="ml-auto text-xs text-stone-400">{timeAgo(job.updatedAt)}</span>
        </p>
      </div>
    </Link>
  );
}
