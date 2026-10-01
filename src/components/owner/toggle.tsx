"use client";
/** iOS-style switch. */
import { cx } from "./ui";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-[#34c759]" : "bg-(--fill)",
      )}
    >
      <span
        className={cx(
          "absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200",
          checked && "translate-x-[20px]",
        )}
      />
    </button>
  );
}
