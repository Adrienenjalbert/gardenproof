"use client";
/**
 * P1-8: the homeowner asked to take everything down. A deliberate two-step: a modal explains what happens,
 * takes an optional reason for the audit log, then calls withdrawConsent (which queues the take-downs).
 */
import { useId, useRef, useState, useTransition } from "react";
import { withdrawConsentAction } from "@/lib/dashboard/actions";
import { Button, Textarea } from "@/components/ui/primitives";
import { toast } from "./toaster";

export function WithdrawConsentButton({ testimonialId, name }: { testimonialId: string; name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <>
      <Button variant="danger" size="sm" icon="x" onClick={() => ref.current?.showModal()}>
        Withdraw consent
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-t`}
        className="m-auto w-[min(92vw,460px)] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-olive-dark/50"
      >
        <form
          method="dialog"
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await withdrawConsentAction({ testimonialId, reason: reason.trim() });
              toast(r);
              if (r.ok) ref.current?.close();
            });
          }}
        >
          <h2 id={`${id}-t`} className="font-display text-[20px] text-olive-dark">
            Withdraw {name}&apos;s consent?
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/80">
            <li>All four permissions are recorded as withdrawn, with today&apos;s date.</li>
            <li>Everything public for this job (portfolio page, ads, videos, posts) is queued for take-down.</li>
            <li>Their photos and words won&apos;t be used again. This can&apos;t be undone from the dashboard.</li>
          </ul>
          <div>
            <label htmlFor={`${id}-r`} className="mb-1.5 block text-[13px] font-medium">
              Reason <span className="font-normal text-muted">(optional, kept in the audit log)</span>
            </label>
            <Textarea
              id={`${id}-r`}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Asked by phone on 24 Sept — moving house."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Withdrawing…" : "Withdraw and take down"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
