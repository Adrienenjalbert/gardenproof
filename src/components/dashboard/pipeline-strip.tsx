import Link from "next/link";
import type { JobStatus } from "@/lib/domain";
import { JOB_STATUS_META } from "@/components/ui/status-pill";
import { cx } from "@/components/ui/primitives";

/** Horizontal pipeline of job counts per status; each step links to the filtered jobs list. */
export function PipelineStrip({ steps }: { steps: { status: JobStatus; count: number }[] }) {
  return (
    <ol className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 lg:grid-cols-7">
      {steps.map((s, i) => {
        const meta = JOB_STATUS_META[s.status];
        const active = s.count > 0;
        return (
          <li key={s.status} className="min-w-[136px] snap-start sm:min-w-0">
            <Link
              href={`/ops/jobs?status=${s.status}`}
              className={cx(
                "flex h-full flex-col rounded-xl px-3.5 py-3 ring-1 transition-colors",
                active ? "bg-white ring-line hover:ring-olive/40" : "bg-transparent ring-line/70 hover:bg-white",
              )}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
                <span className="tabular-nums text-stone-400">{i + 1}</span>
                {meta.label}
              </span>
              <span className={cx("mt-1.5 font-display text-2xl tabular-nums", active ? "text-foreground" : "text-stone-300")}>
                {s.count}
              </span>
              <span className="mt-0.5 text-[11.5px] leading-snug text-stone-400">{meta.hint}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
