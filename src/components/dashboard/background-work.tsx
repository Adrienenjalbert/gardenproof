import Link from "next/link";
import type { Overview } from "@/lib/dashboard/queries";
import { retryTaskAction } from "@/lib/dashboard/actions";
import { timeAgo } from "@/lib/dashboard/logic";
import { Icon } from "@/components/ui/icons";
import { Card, cx } from "@/components/ui/primitives";
import { ActionButton } from "./action-button";

function Stat({ n, label, tone }: { n: number; label: string; tone: "olive" | "stone" | "red" }) {
  return (
    <div className="px-4 py-3">
      <p
        className={cx(
          "font-display text-[22px] leading-none tabular-nums",
          n === 0 ? "text-stone-300" : tone === "red" ? "text-red-700" : tone === "olive" ? "text-olive-dark" : "text-foreground",
        )}
      >
        {n}
      </p>
      <p className="mt-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{label}</p>
    </div>
  );
}

/** Durable queue at a glance: what's running, what's waiting, and failures with a Retry button. */
export function BackgroundWork({ bg }: { bg: Overview["background"] }) {
  const idle = bg.running + bg.queued + bg.failed.length === 0;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-[17px]">Background work</h2>
        {bg.running > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-olive">
            <span className="size-2 animate-pulse rounded-full bg-leaf" aria-hidden /> Working
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <Stat n={bg.running} label="Running" tone="olive" />
        <Stat n={bg.queued} label="Queued" tone="stone" />
        <Stat n={bg.failed.length} label="Failed" tone="red" />
      </div>
      {idle ? (
        <p className="px-4 py-4 text-xs text-muted">
          Nothing in progress. Content generation, video renders and publishing run here, so pages never wait on them.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {bg.active.slice(0, 4).map((t) => (
            <li key={t.taskId} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              {t.status === "running" ? (
                <span aria-hidden className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-olive border-r-transparent" />
              ) : (
                <Icon name="clock" size={14} className="shrink-0 text-stone-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.label}</span>
                {t.jobTitle && <span className="block truncate text-xs text-muted">{t.jobTitle}</span>}
              </span>
            </li>
          ))}
          {bg.failed.map((t) => (
            <li key={t.taskId} className="flex items-center gap-3 bg-red-50/50 px-4 py-2.5 text-[13px]">
              <Icon name="alert" size={15} className="shrink-0 text-red-600" />
              <span className="min-w-0 flex-1">
                {t.href ? (
                  <Link href={t.href} className="block truncate font-medium text-red-800 hover:underline">
                    {t.label}
                  </Link>
                ) : (
                  <span className="block truncate font-medium text-red-800">{t.label}</span>
                )}
                <span className="block truncate text-xs text-muted" title={t.error ?? undefined}>
                  {[t.jobTitle, t.error, timeAgo(t.createdAt)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <ActionButton action={retryTaskAction.bind(null, t.taskId)} size="sm" variant="danger" icon="refresh" pendingLabel="…">
                Retry
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
