"use client";
/**
 * Tiny toast system: any client component calls `toast(result)`; the single <Toaster/> in the dashboard
 * layout renders it. Errors stay until dismissed; successes fade after a few seconds.
 */
import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/action-result";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";

type ToastItem = { id: number; ok: boolean; text: string };
const EVENT = "gp:toast";
let seq = 0;

export function toast(result: ActionResult) {
  const detail: ToastItem = { id: ++seq, ok: result.ok, text: result.ok ? result.message : result.error };
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastItem>).detail;
      setItems((cur) => [...cur.slice(-3), t]);
      // Long successes (e.g. bulk approve with skip reasons) stay long enough to read.
      if (t.ok) setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.text.length > 120 ? 15_000 : 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.ok ? "status" : "alert"}
          data-toast={t.ok ? "ok" : "error"}
          className={cx(
            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1",
            t.ok ? "bg-olive-dark text-white ring-olive-dark" : "bg-white text-red-800 ring-red-200",
          )}
        >
          <Icon name={t.ok ? "check" : "alert"} size={16} className={cx("mt-0.5 shrink-0", t.ok ? "text-leaf" : "text-red-600")} />
          <p className="flex-1 leading-snug">{t.text}</p>
          <button
            type="button"
            onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}
            className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
