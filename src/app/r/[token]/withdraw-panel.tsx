"use client";
/**
 * "Changed your mind?" on the reopened homeowner link. Two steps (reveal, then confirm) so a stray tap
 * can't withdraw, and one clear result. Withdrawing is as easy as giving consent (UK GDPR).
 */
import { useActionState, useState } from "react";
import { withdrawConsentAction, type WithdrawState } from "./actions";

export function WithdrawPanel(props: { token: string; businessName: string; canWithdraw: boolean; withdrawn: boolean }) {
  const [state, formAction, pending] = useActionState<WithdrawState, FormData>(withdrawConsentAction, null);
  const [confirming, setConfirming] = useState(false);

  if (props.withdrawn || state?.ok) {
    return (
      <section className="mx-6 mb-16 rounded-3xl border border-line bg-white p-6 text-center" aria-live="polite">
        <p className="font-display text-lg text-olive-dark">Permission withdrawn</p>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {state?.message ?? `${props.businessName} won't use your photos, words, name or area. Anything already online is being taken down.`}
        </p>
      </section>
    );
  }
  if (!props.canWithdraw) return null;

  return (
    <section className="mx-6 mb-16 rounded-3xl border border-line bg-white p-6" aria-labelledby="withdraw-h">
      <h2 id="withdraw-h" className="font-display text-lg text-olive-dark">Changed your mind?</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        You can withdraw your permission at any time. {props.businessName} will stop using your photos, words, first name and area, and take down anything already online.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-full border border-olive/30 text-[15px] font-medium text-olive transition hover:bg-olive-50"
        >
          Withdraw my permission
        </button>
      ) : (
        <form action={formAction} className="mt-5 rounded-2xl bg-olive-50 p-4">
          <input type="hidden" name="token" value={props.token} />
          <p className="text-[14px] font-medium text-olive-dark">Withdraw permission for everything you agreed to share?</p>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex h-11 flex-1 items-center justify-center rounded-full bg-olive text-[14px] font-medium text-white transition hover:bg-olive-dark disabled:bg-olive/40"
            >
              {pending ? "Withdrawing…" : "Yes, withdraw"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="flex h-11 flex-1 items-center justify-center rounded-full border border-line bg-white text-[14px] font-medium text-foreground/80 transition hover:border-olive/40"
            >
              Keep sharing
            </button>
          </div>
          {state && !state.ok && (
            <p className="mt-3 text-[13px] text-red-800" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
