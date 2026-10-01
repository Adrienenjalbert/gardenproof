"use client";
/** Jobs list filters. Plain GET form (works without JS); with JS each change applies immediately. */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { JOB_STATUSES } from "@/lib/domain";
import { JOB_STATUS_META } from "@/components/ui/status-pill";
import { ButtonLink, Select, cx } from "@/components/ui/primitives";

export function JobFilters({
  services,
  areas,
}: {
  services: { key: string; label: string }[];
  areas: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const active = ["status", "service", "area"].some((k) => params.get(k));

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  const select = (name: string, label: string, options: { value: string; label: string }[]) => (
    <label className="min-w-0 flex-1 sm:max-w-56">
      <span className="sr-only">{label}</span>
      <Select name={name} value={params.get(name) ?? ""} onChange={(e) => update(name, e.target.value)}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <form method="get" className={cx("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      {select(
        "status",
        "All statuses",
        JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_META[s].label })),
      )}
      {select("service", "All services", services.map((s) => ({ value: s.key, label: s.label })))}
      {select("area", "All areas", areas.map((a) => ({ value: a, label: a })))}
      <noscript>
        <button type="submit">Apply</button>
      </noscript>
      {active && (
        <ButtonLink href={pathname} variant="ghost" size="sm" icon="x">
          Clear
        </ButtonLink>
      )}
    </form>
  );
}
