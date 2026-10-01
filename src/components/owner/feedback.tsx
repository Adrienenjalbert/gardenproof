"use client";
/**
 * Instant feedback: a small toast above the tab bar, and a hook that runs a Server Action with a pending state
 * and turns its result into that toast. Every tap gets an answer.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import type { OwnerResult } from "@/lib/owner/actions";
import { OIcon } from "./icons";

type Toast = { id: number; text: string; tone: "ok" | "error" };
const EVENT = "owner:toast";

export function toast(text: string, tone: Toast["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { text, tone } }));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const t = { ...(e as CustomEvent<Omit<Toast, "id">>).detail, id: ++n };
      setItems((xs) => [...xs.slice(-1), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === "error" ? 5200 : 2600);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-8"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="anim-pop flex max-w-[420px] items-center gap-2.5 rounded-full bg-[#1c1d1a]/92 py-2.5 pr-5 pl-3 text-[15px] font-medium text-white shadow-(--shadow-lg) backdrop-blur-xl"
        >
          <span
            className={`grid size-6 place-items-center rounded-full ${t.tone === "ok" ? "bg-[#34c759]" : "bg-[#ff5f52]"}`}
          >
            <OIcon name={t.tone === "ok" ? "check" : "x"} size={14} strokeWidth={2.6} />
          </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Run a Server Action, show its sentence, report success to the caller. */
export function useOwnerAction() {
  const [pending, start] = useTransition();
  const run = useCallback(
    (fn: () => Promise<OwnerResult>, onDone?: (ok: boolean) => void) =>
      start(async () => {
        try {
          const r = await fn();
          toast(r.ok ? r.message : r.error, r.ok ? "ok" : "error");
          onDone?.(r.ok);
        } catch {
          toast("No connection. Please try again.", "error");
          onDone?.(false);
        }
      }),
    [],
  );
  return { pending, run };
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="anim-spin inline-block rounded-full border-2 border-current border-r-transparent"
      style={{ width: size, height: size }}
    />
  );
}
