"use client";
/**
 * Bottom sheet on phones, centred card on desktop. Closes on backdrop tap, Escape, or the grabber.
 * Uses a portal-free fixed layer so it works inside any page without extra providers.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="anim-fade absolute inset-0 bg-black/35 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          "anim-sheet relative flex max-h-[88dvh] w-full flex-col rounded-t-[28px] bg-(--card) shadow-(--shadow-lg) outline-none",
          "lg:max-w-[480px] lg:rounded-[28px]",
        )}
      >
        <div className="flex justify-center pt-2 pb-1 lg:hidden">
          <span className="h-[5px] w-9 rounded-full bg-(--fill)" />
        </div>
        {title && (
          <div className="px-6 pt-3 pb-1 text-center text-[17px] font-semibold text-(--ink) lg:pt-6">{title}</div>
        )}
        <div className="overflow-y-auto px-6 pt-3 pb-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-(--sep) px-6 pt-3 pb-4">{footer}</div>}
      </div>
    </div>
  );
}
