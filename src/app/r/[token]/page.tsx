/**
 * Homeowner page (/r/<token>): rate the job, one optional line, granular consent.
 * Image-first and calm: it should feel like a note from the business, not a form.
 * Reopening the link after answering shows the thank-you and a way to withdraw permission.
 */
import type { Metadata } from "next";
import { consentItems, ADDRESS_REASSURANCE } from "@/lib/testimonials/consent";
import { getTestimonialView, type TestimonialView } from "@/lib/testimonials";
import { Hero } from "./hero";
import { ReviewForm } from "./review-form";
import { ThankYou } from "./thank-you";
import { WithdrawPanel } from "./withdraw-panel";

export const metadata: Metadata = {
  title: "Your garden",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-lg flex-1 bg-background shadow-[0_0_80px_rgba(47,50,34,0.08)]">{children}</main>;
}

function Notice({ title, body, view }: { title: string; body: string; view: TestimonialView | null }) {
  return (
    <Shell>
      <div className="flex min-h-svh flex-col items-center justify-center px-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={view?.logoPath ?? "/thorburn-logo.jpg"} alt={view?.businessName ?? ""} className="h-20 w-20 rounded-full object-contain" />
        <h1 className="mt-8 font-display text-2xl text-olive-dark">{title}</h1>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>
        {view && (
          <a href={view.website} className="mt-8 rounded-full border border-olive/30 px-6 py-3 text-sm font-medium text-olive transition hover:bg-olive-50">
            Visit {view.businessName}
          </a>
        )}
      </div>
    </Shell>
  );
}

export default async function ReviewPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const view = await getTestimonialView(token);

  if (!view) {
    return <Notice view={null} title="This link doesn't look quite right" body="Please check you've opened the full link from our WhatsApp message." />;
  }
  if (view.state === "expired") {
    return (
      <Notice
        view={view}
        title="This link has now closed"
        body={`We'd still love to hear how your garden is getting on. Just reply to our WhatsApp message and ${view.ownerFirstName ?? "the team"} will see it.`}
      />
    );
  }

  const eyebrow = view.area ? `Your garden in ${view.area}` : "Your garden";
  const hero = { heroUrl: view.heroUrl, area: view.area, logoPath: view.logoPath, businessName: view.businessName };

  if (view.state === "responded") {
    return (
      <Shell>
        <Hero view={hero} heading={view.firstName ? `Thank you, ${view.firstName}` : "Thank you"} eyebrow={eyebrow} />
        <ThankYou
          token={view.token}
          rating={view.rating ?? 5}
          firstName={view.firstName}
          area={view.area}
          ownerFirstName={view.ownerFirstName}
          reviewLinks={view.reviewLinks}
          words={view.quote}
        />
        <WithdrawPanel token={view.token} businessName={view.businessName} canWithdraw={view.canWithdraw} withdrawn={view.withdrawn} />
      </Shell>
    );
  }

  return (
    <Shell>
      <ReviewForm
        token={view.token}
        hero={hero}
        eyebrow={eyebrow}
        businessName={view.businessName}
        firstName={view.firstName}
        area={view.area}
        ownerFirstName={view.ownerFirstName}
        consent={consentItems(view.businessName, view.area)}
        reassurance={ADDRESS_REASSURANCE}
        website={view.website}
      />
    </Shell>
  );
}
