/**
 * Page chrome shared by the runner and the confirmation: on desktop, the business's own garden photo fills the
 * left half with its name and one real review; on phones the form has the whole screen.
 */
import type { ReactNode } from "react";
import type { FormBrand } from "@/lib/forms/brand";
import { brandVars, FormStyles } from "./styles";

function Stars({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill={n <= Math.round(value) ? "#f5c451" : "rgba(255,255,255,.35)"} />
        </svg>
      ))}
    </span>
  );
}

const PROVIDERS: Record<string, string> = { google: "Google", which: "Which? Trusted Traders", checkatrade: "Checkatrade", trustmark: "TrustMark", houzz: "Houzz", trustpilot: "Trustpilot", facebook: "Facebook", yell: "Yell", website: "their website", other: "a review site" };

export function FormFrame({ brand, children }: { brand: FormBrand; children: ReactNode }) {
  return (
    <div style={brandVars(brand)} className="min-h-svh w-full bg-[#fbfaf7] text-[#16180f] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <FormStyles />
      <aside className="relative hidden h-svh overflow-hidden bg-[var(--b-dark)] lg:sticky lg:top-0 lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- the business's own project photo */}
        <img src={brand.heroImage} alt="" className="gp-fade absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/80" />
        <div className="absolute left-10 top-10 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logoUrl} alt={brand.name} className="h-14 w-auto max-w-[180px] rounded-xl bg-white object-contain p-2 shadow-lg" />
        </div>
        <div className="absolute inset-x-10 bottom-10 text-white">
          {brand.review ? (
            <figure className="max-w-md">
              {brand.review.rating && <Stars value={brand.review.rating} />}
              <blockquote className="mt-3 font-display text-[21px] leading-snug text-balance">&ldquo;{brand.review.text}&rdquo;</blockquote>
              <figcaption className="mt-3 text-[14px] text-white/75">
                {brand.review.author ?? "A client"}, on {PROVIDERS[brand.review.provider] ?? "a review site"}
              </figcaption>
            </figure>
          ) : (
            <p className="max-w-md font-display text-[26px] leading-snug text-balance">{brand.name}</p>
          )}
          {brand.rating && (
            <p className="mt-6 flex items-center gap-2 text-[13px] text-white/80">
              <Stars value={brand.rating.value} /> {brand.rating.value.toFixed(1)} from {brand.rating.count} reviews
            </p>
          )}
        </div>
      </aside>
      <div className="relative flex min-h-svh flex-col">{children}</div>
    </div>
  );
}
