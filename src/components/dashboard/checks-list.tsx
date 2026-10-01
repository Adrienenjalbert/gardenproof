import type { Check } from "@/lib/dashboard/logic";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";

/** Automated checks (assets.checks). Consent checks are labelled because a failure blocks approval. */
export function ChecksList({ checks }: { checks: Check[] }) {
  if (!checks.length) return <p className="text-xs text-muted">No automated checks recorded for this version.</p>;
  const sorted = [...checks].sort((a, b) => Number(a.ok) - Number(b.ok));
  return (
    <ul className="space-y-1.5">
      {sorted.map((c) => {
        const consent = c.id.startsWith("consent");
        return (
          <li key={c.id} className="flex items-start gap-2 text-[13px] leading-snug">
            <span
              className={cx(
                "mt-px grid size-4 shrink-0 place-items-center rounded-full",
                c.ok ? "bg-lime-100 text-lime-700" : consent ? "bg-red-600 text-white" : "bg-amber-100 text-amber-700",
              )}
            >
              <Icon name={c.ok ? "check" : consent ? "x" : "alert"} size={10} strokeWidth={3} />
            </span>
            <span className={cx("flex-1", c.ok ? "text-foreground/75" : consent ? "font-medium text-red-800" : "text-amber-900")}>
              {c.message}
              {consent && <span className="ml-1.5 text-[10.5px] tracking-wide text-muted uppercase">consent</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
