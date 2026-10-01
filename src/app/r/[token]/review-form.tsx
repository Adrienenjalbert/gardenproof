"use client";
/**
 * The homeowner form: 1-tap stars, one optional line, explicit consent choices (nothing pre-selected:
 * silence is never consent; "Your words" is asked only when there are words that could be published),
 * and a soft maintenance question. Owns the hero so the heading turns into a thank-you on submit.
 */
import { useActionState, useState } from "react";
import { quoteConsentApplies, type ConsentItem, type ConsentKey } from "@/lib/testimonials/consent";
import { submitReviewAction, type ReviewFormState } from "./actions";
import { Hero, type HeroProps } from "./hero";
import { ThankYou } from "./thank-you";

const RATING_WORDS = ["", "Not what we hoped for", "Could have been better", "Good", "Very good", "Wonderful"];
const QUOTE_MAX = 280;

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden>
      <path
        d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9L3.4 9.5l6-.8L12 3.2z"
        fill={filled ? "var(--leaf)" : "none"}
        stroke={filled ? "var(--leaf)" : "#c9c8bb"}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Choice(props: {
  name: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yes?: string;
  no?: string;
  labelledBy: string;
  invalid?: boolean;
}) {
  const opt = (v: boolean, label: string) => {
    const on = props.value === v;
    return (
      <label
        className={`flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full border text-[14px] font-medium transition focus-within:ring-2 focus-within:ring-leaf ${
          on ? (v ? "border-olive bg-olive text-white" : "border-olive-dark/60 bg-olive-100 text-olive-dark") : "border-line bg-white text-foreground/80 hover:border-olive/40"
        }`}
      >
        <input type="radio" className="sr-only" name={props.name} value={v ? "yes" : "no"} checked={on} onChange={() => props.onChange(v)} />
        {label}
      </label>
    );
  };
  return (
    <div role="radiogroup" aria-labelledby={props.labelledBy} aria-invalid={props.invalid || undefined} className="mt-4 flex gap-2">
      {opt(true, props.yes ?? "Yes, that's fine")}
      {opt(false, props.no ?? "No thanks")}
    </div>
  );
}

export function ReviewForm(props: {
  token: string;
  hero: HeroProps;
  eyebrow: string;
  businessName: string;
  firstName: string | null;
  area: string | null;
  ownerFirstName: string | null;
  consent: ConsentItem[];
  reassurance: string;
  website: string;
}) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(submitReviewAction, null);
  const [rating, setRating] = useState(0);
  const [quote, setQuote] = useState("");
  const [answers, setAnswers] = useState<Record<ConsentKey, boolean | null>>({ consentPhotos: null, consentArea: null, consentFirstName: null, consentQuote: null });
  const [maintenance, setMaintenance] = useState<boolean | null>(null);

  if (state?.ok) {
    return (
      <>
        <Hero view={props.hero} heading={props.firstName ? `Thank you, ${props.firstName}` : "Thank you"} eyebrow={props.eyebrow} />
        <ThankYou
          token={props.token}
          rating={state.rating}
          firstName={props.firstName}
          area={props.area}
          ownerFirstName={props.ownerFirstName}
          reviewLinks={state.reviewLinks}
          words={quote}
          maintenanceInterest={maintenance}
        />
      </>
    );
  }

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const askQuote = quoteConsentApplies(rating, quote);
  const visibleConsent = props.consent.filter((c) => c.key !== "consentQuote" || askQuote);
  const unanswered = visibleConsent.filter((c) => answers[c.key] === null).length;
  const ready = rating > 0 && unanswered === 0;
  const low = rating > 0 && rating <= 3;
  const owner = props.ownerFirstName ?? "the owner";

  return (
    <>
    <Hero view={props.hero} heading={props.firstName ? `${props.firstName}, how does your garden feel?` : "How does your garden feel?"} eyebrow={props.eyebrow} />
    <form action={formAction} className="relative -mt-6 rounded-t-[28px] bg-background px-6 pb-14 pt-9">
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="rating" value={rating || ""} />

      {/* Rating */}
      <section aria-labelledby="rating-h">
        <h2 id="rating-h" className="font-display text-xl text-olive-dark">How did we do?</h2>
        <div role="radiogroup" aria-labelledby="rating-h" className="mt-4 flex justify-between gap-1 sm:justify-start sm:gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}: ${RATING_WORDS[n]}`}
              onClick={() => setRating(n)}
              className="flex h-14 w-14 items-center justify-center rounded-2xl transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
            >
              <Star filled={n <= rating} />
            </button>
          ))}
        </div>
        <p className={`mt-2 h-5 text-[14px] ${errors.rating ? "text-red-700" : "text-muted"}`} aria-live="polite">
          {rating ? RATING_WORDS[rating] : errors.rating ? "Please choose a rating" : "Tap a star"}
        </p>
      </section>

      {/* Quote */}
      <section className="mt-9" aria-labelledby="quote-h">
        <div className="flex items-baseline justify-between">
          <h2 id="quote-h" className="font-display text-xl text-olive-dark">
            {low ? "What could we have done better?" : "In your own words"}
          </h2>
          <span className="text-[12px] text-muted">Optional</span>
        </div>
        {low && (
          <p className="mt-2 text-[14px] leading-relaxed text-muted">This goes privately to {owner}. It will never be published.</p>
        )}
        <textarea
          name="quote"
          aria-labelledby="quote-h"
          value={quote}
          maxLength={QUOTE_MAX}
          onChange={(e) => setQuote(e.target.value)}
          rows={3}
          placeholder={
            low
              ? "Tell us what wasn't right and we'll put it right."
              : "What do you love about it now? e.g. “We're out there every evening. The team were tidy and always on time.”"
          }
          className="mt-3 w-full resize-none rounded-2xl border border-line bg-white px-4 py-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted/70 focus:border-olive/50 focus:outline-none focus:ring-2 focus:ring-leaf/40"
        />
        <p className={`mt-1 text-right text-[12px] ${errors.quote ? "text-red-700" : "text-muted"}`}>
          {errors.quote ?? `${quote.length}/${QUOTE_MAX}`}
        </p>
      </section>

      {/* Consent */}
      <section className="mt-8" aria-labelledby="consent-h">
        <h2 id="consent-h" className="font-display text-xl text-olive-dark">May we share your garden?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Your choice for each. Nothing is shared unless you say yes.
        </p>
        <div className="mt-5 space-y-3">
          {visibleConsent.map((c) => (
            <div key={c.key} className={`rounded-3xl border bg-white p-5 ${errors[c.key] ? "border-red-300" : "border-line"}`}>
              <p id={`${c.key}-h`} className="text-[15px] font-semibold text-olive-dark">{c.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">{c.statement}</p>
              <Choice
                name={c.key}
                labelledBy={`${c.key}-h`}
                value={answers[c.key]}
                invalid={Boolean(errors[c.key])}
                onChange={(v) => setAnswers((a) => ({ ...a, [c.key]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-3 rounded-2xl bg-olive-50 px-4 py-3.5 text-[13px] leading-relaxed text-olive-dark">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 118 0v3" />
          </svg>
          <p>{props.reassurance}</p>
        </div>
      </section>

      {/* Maintenance (soft) */}
      <section className="mt-9" aria-labelledby="maint-h">
        <h2 id="maint-h" className="font-display text-xl text-olive-dark">Would you like us to keep it looking like this?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">Seasonal maintenance visits. No obligation, we&apos;d simply get in touch.</p>
        <Choice name="maintenanceInterest" labelledBy="maint-h" value={maintenance} onChange={setMaintenance} yes="Yes, please" no="Not for now" />
      </section>

      {state && !state.ok && state.reason !== "validation" && (
        <p className="mt-8 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-800" role="alert">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={!ready || pending}
        className="mt-10 flex h-14 w-full items-center justify-center rounded-full bg-olive text-[16px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(47,50,34,0.7)] transition hover:bg-olive-dark disabled:cursor-not-allowed disabled:bg-olive/35 disabled:shadow-none"
      >
        {pending ? "Sending…" : `Send to ${props.businessName.split(" ")[0]}`}
      </button>
      <p className="mt-3 text-center text-[13px] text-muted" aria-live="polite">
        {!rating ? "Choose a rating to continue" : unanswered ? `${unanswered} sharing question${unanswered > 1 ? "s" : ""} left to answer` : "Takes a second. Thank you."}
      </p>

      <footer className="mt-14 border-t border-line pt-6 text-center text-[12px] text-muted">
        {props.businessName} ·{" "}
        <a href={props.website} className="underline-offset-2 hover:underline">
          {props.website.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      </footer>
    </form>
    </>
  );
}
