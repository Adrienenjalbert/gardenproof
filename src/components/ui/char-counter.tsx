import { limitState, wordCount } from "@/lib/dashboard/logic";
import { cx } from "./primitives";

/** "38/40" counter that turns amber near the limit and red over it. Counts words when `words` is set. */
export function CharCounter({ value, max, words }: { value: string; max: number; words?: boolean }) {
  const n = words ? wordCount(value) : value.length;
  const state = limitState(n, max);
  return (
    <span
      className={cx(
        "shrink-0 font-mono text-[11px] tabular-nums",
        state === "over" ? "font-semibold text-red-600" : state === "near" ? "text-amber-700" : "text-stone-400",
      )}
      title={state === "over" ? `Over the ${max}${words ? "-word" : "-character"} limit` : undefined}
    >
      {n}/{max}
      {words ? "w" : ""}
    </span>
  );
}
