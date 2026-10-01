import Link from "next/link";
import type { ConsentBlock } from "@/lib/dashboard/consent-state";
import { Icon } from "@/components/ui/icons";
import { buttonClass, cx } from "@/components/ui/primitives";
import { AddHomeownerForm } from "./add-homeowner";

/**
 * Why this job's drafts can't be approved (QA B12), and the one thing to do about it. For a job with no
 * homeowner the banner IS the fix: it contains the Add homeowner form.
 */
export function ConsentBanner({
  jobId,
  block,
  blockedCount,
  safeMode,
}: {
  jobId: string;
  block: ConsentBlock;
  blockedCount: number;
  safeMode: boolean;
}) {
  const waiting = block.action === null;
  return (
    <section
      id={block.kind === "no_customer" ? "add-homeowner" : undefined}
      aria-labelledby={`consent-${jobId}`}
      className={cx(
        "scroll-mt-24 rounded-2xl p-5 ring-1 sm:p-6",
        waiting ? "bg-white ring-line" : "bg-amber-50/70 ring-amber-200",
      )}
    >
      <div className="flex flex-wrap items-start gap-4">
        <span
          className={cx(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            waiting ? "bg-olive-50 text-olive" : "bg-amber-100 text-amber-800",
          )}
        >
          <Icon name={block.kind === "no_customer" ? "user" : waiting ? "clock" : "shield"} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`consent-${jobId}`} className="font-display text-[18px] leading-snug text-olive-dark">
            {block.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground/80">
            {blockedCount > 0 && (
              <strong className="font-semibold">
                {blockedCount} {blockedCount === 1 ? "draft is" : "drafts are"} blocked on consent.{" "}
              </strong>
            )}
            {block.detail}
          </p>
        </div>
        {block.action && block.kind !== "no_customer" && (
          <Link href={block.action.href} className={buttonClass("primary", "md")}>
            {block.action.label}
            <Icon name="chevronRight" size={16} />
          </Link>
        )}
      </div>
      {block.kind === "no_customer" && (
        <div className="mt-5 border-t border-amber-200/70 pt-5">
          <AddHomeownerForm jobId={jobId} safeMode={safeMode} />
        </div>
      )}
    </section>
  );
}
