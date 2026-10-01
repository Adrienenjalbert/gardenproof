/** The warm "thank you": what happens next, the business's phone, and what they told us. */
import type { FormBrand } from "@/lib/forms/brand";
import type { SmartFormKind } from "@/lib/forms/definitions";
import { Glyph } from "./glyphs";

export type ConfirmationProps = {
  brand: FormBrand;
  kind: SmartFormKind;
  firstName: string | null;
  summary: { id: string; label: string; value: string }[];
  /** Maintenance feedback: all good (no follow-up needed). */
  happy?: boolean;
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "").replace(/^0/, "+44")}`;

function nextSteps(p: ConfirmationProps): { title: string; body: string }[] {
  const owner = p.brand.ownerFirstName ?? "The team";
  const call = p.summary.find((s) => s.id === "callTime")?.value;
  if (p.kind === "enquiry") {
    return [
      { title: `${owner} reads your answers`, body: p.summary.some((s) => s.id === "photos") ? "Your ideas and photos are with them now." : "Your ideas are with them now." },
      { title: "We give you a call", body: call ? `${call.charAt(0).toUpperCase()}${call.slice(1)}, as you asked.` : "At a time that suits you." },
      { title: "We come and see the garden", body: "To measure up and talk ideas through, whenever suits you." },
    ];
  }
  if (p.kind === "project_brief") {
    return [
      { title: "It goes into your design", body: `${owner} and the designers work from exactly this.` },
      { title: "The team arrives prepared", body: "Access, parking and pets all noted before day one." },
    ];
  }
  return p.happy
    ? [{ title: "Lovely to hear", body: "We'll keep it looking this way." }]
    : [
        { title: `${owner} has been told`, body: "They'll be in touch to put it right." },
        { title: "Next visit", body: "The team will see your note before they arrive." },
      ];
}

export function Confirmation(props: ConfirmationProps) {
  const { brand } = props;
  const heading = props.kind === "maintenance_visit" && props.happy ? "Thank you" : props.firstName ? `Thank you, ${props.firstName}` : "Thank you";
  const lead =
    props.kind === "enquiry"
      ? `Your enquiry is with ${brand.name}.`
      : props.kind === "project_brief"
        ? "Your brief is saved."
        : props.happy
          ? "Glad the garden's looking good."
          : "Sorry it wasn't quite right. We'll sort it.";
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5 pb-16 pt-10 sm:px-8 lg:justify-center lg:pt-16">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto max-w-[150px] self-start object-contain lg:hidden" />
      <div className="gp-pop mt-10 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[var(--b)] text-[var(--b-ink)] shadow-[0_18px_40px_-16px_var(--b)] lg:mt-0">
        <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path className="gp-draw" d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h1 className="gp-rise mt-7 font-display text-[34px] leading-[1.1] tracking-tight text-balance sm:text-[40px]">{heading}</h1>
      <p className="gp-rise mt-3 text-[17px] leading-relaxed text-black/60">{lead}</p>

      <section className="mt-9" aria-labelledby="next-h">
        <h2 id="next-h" className="text-[12px] font-semibold uppercase tracking-[0.16em] text-black/45">
          What happens next
        </h2>
        <ol className="gp-stagger mt-4">
          {nextSteps(props).map((s, i, all) => (
            <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
              {i < all.length - 1 && <span className="absolute left-[15px] top-9 h-[calc(100%-36px)] w-px bg-black/10" aria-hidden />}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--b-soft)] text-[14px] font-bold text-[var(--b)]">{i + 1}</span>
              <span className="pt-1">
                <span className="block text-[16.5px] font-semibold leading-snug">{s.title}</span>
                <span className="mt-0.5 block text-[15px] leading-relaxed text-black/55">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        {brand.phone && (
          <a
            href={telHref(brand.phone)}
            className="gp-press flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-[var(--b)] sm:flex-1 px-6 text-[16px] font-semibold text-[var(--b-ink)] shadow-[0_14px_30px_-16px_var(--b)] transition hover:brightness-110"
          >
            <Glyph name="phone" className="h-5 w-5" /> Call {brand.phone}
          </a>
        )}
        <a
          href={brand.website}
          className="gp-press flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border-[1.5px] sm:flex-1 border-black/10 bg-white px-6 text-[16px] font-semibold transition hover:border-black/25"
        >
          See more of our gardens <Glyph name="arrow-right" className="h-4 w-4" />
        </a>
      </div>

      {props.summary.length > 0 && (
        <details className="group mt-10 rounded-[20px] border border-black/[0.07] bg-white px-5 py-1 open:pb-4">
          <summary className="flex h-12 cursor-pointer list-none items-center justify-between text-[15px] font-semibold marker:hidden">
            What you told us
            <Glyph name="chevron-left" className="h-4 w-4 -rotate-90 text-black/40 transition group-open:rotate-90" />
          </summary>
          <dl className="divide-y divide-black/[0.06]">
            {props.summary.map((s) => (
              <div key={s.id} className="flex gap-4 py-2.5 text-[14.5px]">
                <dt className="w-32 shrink-0 text-black/50">{s.label}</dt>
                <dd className="min-w-0 flex-1 break-words">{s.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </main>
  );
}
