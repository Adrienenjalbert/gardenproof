"use client";
/**
 * Thank-you state. Ratings of 4+ are offered public review links; 3 or below never are.
 *
 * For a happy homeowner the public review is the main thing we ask for: a Google review is worth more to the
 * business than anything on its own site. Their own words are shown back and copied as they tap, so posting
 * is a paste rather than a blank box.
 */
import { useState } from "react";
import type { ReviewLinks } from "@/lib/testimonials";

export function ThankYou(props: {
  token: string;
  rating: number;
  firstName: string | null;
  area: string | null;
  ownerFirstName: string | null;
  reviewLinks: ReviewLinks;
  /** What they wrote, if anything (their own words, shown only to them). */
  words?: string | null;
  maintenanceInterest?: boolean | null;
}) {
  const happy = props.rating >= 4;
  const words = props.words?.trim() || null;
  const [copied, setCopied] = useState(false);
  const owner = props.ownerFirstName ?? "Our owner";
  const googleHref = `/r/${props.token}/go/google`;

  async function copyWords() {
    if (!words) return;
    try {
      await navigator.clipboard.writeText(words);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (in-app browsers); the words are on screen to copy by hand.
    }
  }

  return (
    <section className="relative -mt-6 rounded-t-[28px] bg-background px-6 pb-16 pt-10" aria-live="polite">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-olive-50 text-olive">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {happy ? (
        <>
          <h2 className="mt-6 text-center font-display text-2xl text-olive-dark">That means a great deal</h2>
          {props.reviewLinks.google ? (
            <div className="mt-8 rounded-3xl border border-line bg-white p-6">
              <p className="font-display text-xl text-olive-dark">Would you say that on Google?</p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                It&apos;s how other families{props.area ? ` in ${props.area}` : ""} find a team they can trust. It takes a minute.
              </p>
              {words && (
                <figure className="mt-5 rounded-2xl bg-olive-50 px-5 py-4">
                  <blockquote className="text-[15px] leading-relaxed text-olive-dark">&ldquo;{words}&rdquo;</blockquote>
                  <figcaption className="mt-2 text-[12px] text-muted">
                    {copied ? "Copied. Just paste it on Google." : "Your words. We'll copy them for you, ready to paste."}
                  </figcaption>
                </figure>
              )}
              <a
                href={googleHref}
                target="_blank"
                rel="noopener"
                onClick={copyWords}
                className="mt-5 flex h-12 items-center justify-center rounded-full bg-olive text-[15px] font-medium text-white transition hover:bg-olive-dark"
              >
                {words ? "Copy my words and open Google" : "Leave a Google review"}
              </a>
              {props.reviewLinks.which && (
                <a
                  href={`/r/${props.token}/go/which`}
                  className="mt-3 flex h-11 items-center justify-center rounded-full text-[14px] font-medium text-olive transition hover:bg-olive-50"
                >
                  Or review us on Which? Trusted Traders
                </a>
              )}
            </div>
          ) : props.reviewLinks.which ? (
            <div className="mt-8 rounded-3xl border border-line bg-white p-6">
              <p className="font-display text-lg text-olive-dark">One small favour?</p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                A public review helps other families{props.area ? ` in ${props.area}` : ""} find a team they can trust.
              </p>
              <a
                href={`/r/${props.token}/go/which`}
                className="mt-5 flex h-12 items-center justify-center rounded-full bg-olive text-[15px] font-medium text-white transition hover:bg-olive-dark"
              >
                Review us on Which? Trusted Traders
              </a>
            </div>
          ) : (
            <p className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-muted">
              We&apos;ll pass your words on to the team who built your garden. Enjoy every evening out there.
            </p>
          )}
        </>
      ) : (
        <>
          <h2 className="mt-6 text-center font-display text-2xl text-olive-dark">Thank you for being honest</h2>
          <p className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-muted">
            {owner} has your message and will be in touch personally to put things right. Your feedback stays private.
          </p>
        </>
      )}
      {props.maintenanceInterest && (
        <p className="mx-auto mt-8 max-w-sm rounded-2xl bg-olive-50 px-5 py-4 text-center text-[14px] text-olive-dark">
          We&apos;ll be in touch about seasonal visits to keep it looking like this.
        </p>
      )}
    </section>
  );
}
