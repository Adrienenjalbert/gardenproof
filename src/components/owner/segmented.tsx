"use client";
/** iOS-style segmented control with a sliding thumb. */
import { cx } from "./ui";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const i = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      role="tablist"
      className={cx("relative grid h-9 rounded-[10px] bg-(--fill) p-[2px]", className)}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      <span
        aria-hidden
        className="absolute top-[2px] bottom-[2px] rounded-[8px] bg-(--card) shadow-[0_2px_8px_rgba(0,0,0,0.12),0_0_1px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1)] dark:bg-[#636366]"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${i * 100}%)`,
          left: 2,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative z-[1] truncate px-2 text-[14px] transition-colors",
            o.value === value ? "font-semibold text-(--ink)" : "font-medium text-(--ink)/80",
          )}
        >
          {o.label}
          {o.count ? <span className="ml-1 text-(--ink2) tabular-nums">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
