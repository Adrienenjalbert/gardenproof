/** Full-bleed photo of the finished garden with the page heading. Shared by the server page and the client form. */
export type HeroProps = { heroUrl: string | null; area: string | null; logoPath: string; businessName: string };

export function Hero({ view, heading, eyebrow }: { view: HeroProps; heading: string; eyebrow: string | null }) {
  return (
    <header className="relative isolate overflow-hidden bg-olive-dark">
      {view.heroUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own media route
        <img
          src={view.heroUrl}
          alt={`Your finished garden${view.area ? ` in ${view.area}` : ""}`}
          className="h-[58svh] min-h-[340px] w-full object-cover"
        />
      ) : (
        <div className="h-[34svh] min-h-[240px] w-full bg-olive" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-olive-dark/90" />
      <div className="absolute left-5 top-5 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={view.logoPath} alt={view.businessName} className="h-14 w-14 rounded-full bg-white object-contain p-0.5 shadow-lg ring-1 ring-black/5" />
      </div>
      <div className="absolute inset-x-0 bottom-0 px-6 pb-12 text-white">
        {eyebrow && <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/80">{eyebrow}</p>}
        <h1 className="mt-2 font-display text-[1.9rem] leading-tight text-balance">{heading}</h1>
      </div>
    </header>
  );
}
