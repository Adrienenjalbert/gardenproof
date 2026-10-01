"use client";
/**
 * The confirmation cards: five short, swipeable screens. Tap to deselect what's wrong; everything else is
 * kept. Nothing is saved until the last button.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Badge } from "@/lib/intel/types";
import { reviewKey, type Choices } from "@/lib/owner/onboarding-choices";
import { pickAccent } from "@/lib/owner/brand-color";
import { providerName } from "@/lib/owner/showcase-words";
import { BadgeLogo } from "../badge-logo";
import { Spinner } from "../feedback";
import { OIcon } from "../icons";
import { buttonClass, cx, Pill } from "../ui";
import type { Loaded } from "./reader";

const TITLES = ["Is this you?", "What you do", "Your badges", "Your reviews", "Your projects"];

export function ConfirmCards({
  data,
  saving,
  onConfirm,
  onBack,
}: {
  data: Loaded;
  saving: boolean;
  onConfirm: (c: Choices, runId: string | null) => void;
  onBack: () => void;
}) {
  const p = data.profile;
  const [i, setI] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  const [services, setServices] = useState(() => p.services.map((s) => s.key));
  const [areas, setAreas] = useState(() => p.areas.map((a) => a.name));
  const [favourites, setFavourites] = useState<string[]>(() =>
    [...p.reviews.featured]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 3)
      .map(reviewKey),
  );
  const allImages = useMemo(
    () =>
      p.projects.flatMap((pr) =>
        pr.images.map((img, n) => ({
          ...img,
          title: pr.title,
          caption: n === 0 ? pr.title : null,
        })),
      ),
    [p.projects],
  );
  const [kept, setKept] = useState(() => allImages.map((img) => img.url));

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const go = (n: number) => {
    const el = rail.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    setI(n);
  };
  const last = i === TITLES.length - 1;

  return (
    // From here on the flow wears the business's own colour.
    <div
      className="brand-scope anim-fade mx-auto flex h-dvh max-w-[560px] flex-col"
      style={
        {
          "--brand": pickAccent([p.brand.colors.primary, p.brand.colors.accent, p.brand.colors.secondary]),
        } as CSSProperties
      }
    >
      <header className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          onClick={() => (i ? go(i - 1) : onBack())}
          className="press grid size-10 place-items-center rounded-full text-(--accent)"
          aria-label="Back"
        >
          <OIcon name="chevronLeft" size={24} strokeWidth={2} />
        </button>
        <div className="flex gap-1.5" aria-label={`Step ${i + 1} of ${TITLES.length}`}>
          {TITLES.map((t, n) => (
            <span
              key={t}
              className={cx(
                "h-1.5 rounded-full transition-all duration-300",
                n === i ? "w-6 bg-(--accent)" : n < i ? "w-1.5 bg-(--accent)" : "w-1.5 bg-(--fill)",
              )}
            />
          ))}
        </div>
        <span className="w-10 text-right text-[13px] text-(--ink3) tabular-nums">
          {i + 1}/{TITLES.length}
        </span>
      </header>

      <div
        ref={rail}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / el.clientWidth);
          if (n !== i) setI(n);
        }}
        className="rail flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        <Card title={TITLES[0]} sample={data.sample}>
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="grid h-24 w-40 place-items-center overflow-hidden rounded-[20px] bg-white p-3 shadow-(--shadow) ring-1 ring-black/5">
              {p.brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.brand.logoUrl} alt={`${p.name} logo`} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-[34px] font-bold" style={{ color: p.brand.colors.primary }}>
                  {p.name.slice(0, 1)}
                </span>
              )}
            </span>
            <p className="font-title mt-5 text-[26px] leading-tight font-bold text-(--ink)">{p.name}</p>
            {p.tagline && <p className="mt-1 text-[16px] text-(--ink2)">{p.tagline}</p>}
          </div>
          <dl className="mt-7 overflow-hidden rounded-[18px] bg-(--card) shadow-(--shadow)">
            {[
              ["Phone", p.contact.phone],
              ["Email", p.contact.email],
              ["Based in", [p.contact.address, p.contact.postcode].filter(Boolean).join(", ") || null],
              ["Company", p.companyNumber ? `No. ${p.companyNumber}` : null],
            ]
              .filter(([, v]) => v)
              .map(([k, v], n) => (
                <div
                  key={k}
                  className={cx(
                    "flex items-center justify-between gap-4 px-4 py-3.5",
                    n > 0 && "border-t border-(--sep)",
                  )}
                >
                  <dt className="text-[16px] text-(--ink2)">{k}</dt>
                  <dd className="truncate text-right text-[16px] text-(--ink)">{v}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-6 mb-2.5 px-1 text-[13px] text-(--ink2)">Your colours</p>
          <div className="flex gap-3 px-1">
            {[p.brand.colors.primary, p.brand.colors.secondary, p.brand.colors.accent]
              .filter((c, n, all): c is string => !!c && all.indexOf(c) === n)
              .map((c) => (
                <span
                  key={c}
                  className="size-12 rounded-full shadow-(--shadow) ring-1 ring-black/10"
                  style={{ background: c }}
                />
              ))}
          </div>
        </Card>

        <Card title={TITLES[1]} hint="Tap anything that isn't right.">
          <Chips
            label="Services"
            items={p.services.map((s) => ({ key: s.key, label: s.label }))}
            on={services}
            onToggle={(k) => toggle(services, setServices, k)}
          />
          <Chips
            label="Areas you cover"
            items={p.areas.map((a) => ({ key: a.name, label: a.name }))}
            on={areas}
            onToggle={(k) => toggle(areas, setAreas, k)}
          />
        </Card>

        <Card title={TITLES[2]} hint="We only show a badge once the body itself confirms it's you.">
          <div className="overflow-hidden rounded-[18px] bg-(--card) shadow-(--shadow)">
            {p.badges.length ? (
              p.badges.map((b, n) => <BadgeRow key={b.name} badge={b} first={n === 0} />)
            ) : (
              <p className="px-4 py-4 text-[16px] text-(--ink2)">We didn&rsquo;t find any trade badges.</p>
            )}
          </div>
          {p.warnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {p.warnings.map((w) => (
                <p
                  key={w}
                  className="flex gap-2 rounded-[14px] bg-(--fill2) px-4 py-3 text-[14px] leading-snug text-(--ink2)"
                >
                  <OIcon name="shield" size={17} className="mt-0.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={TITLES[3]}
          hint={p.reviews.featured.length ? "Pick up to three favourites to show first." : undefined}
        >
          <div className="overflow-hidden rounded-[18px] bg-(--card) shadow-(--shadow)">
            {p.reviews.sources.map((s, n) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className={cx("flex items-center gap-3 px-4 py-3.5", n > 0 && "border-t border-(--sep)")}
              >
                <span className="flex-1 text-[17px] text-(--ink)">{providerName(s.provider)}</span>
                {s.rating !== null ? (
                  <span className="text-[16px] font-semibold text-(--ink) tabular-nums">
                    <span className="text-[#f5a623]">★</span> {s.rating.toFixed(1)}
                    {s.count !== null && <span className="font-normal text-(--ink2)"> · {s.count}</span>}
                  </span>
                ) : (
                  <span className="text-[15px] text-(--ink3)">No rating shown</span>
                )}
                <OIcon name="external" size={15} className="text-(--ink3)" />
              </a>
            ))}
            {!p.reviews.sources.length && (
              <p className="px-4 py-4 text-[16px] text-(--ink2)">We didn&rsquo;t find reviews online yet.</p>
            )}
          </div>
          {p.reviews.featured.length > 0 ? (
            <div className="mt-5 space-y-2.5">
              {p.reviews.featured.map((r) => {
                const k = reviewKey(r);
                const pos = favourites.indexOf(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      pos >= 0
                        ? setFavourites(favourites.filter((x) => x !== k))
                        : favourites.length < 3 && setFavourites([...favourites, k])
                    }
                    className={cx(
                      "press w-full rounded-[18px] bg-(--card) p-4 text-left shadow-(--shadow) ring-2 transition-colors",
                      pos >= 0 ? "ring-(--accent)" : "ring-transparent",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-medium text-(--ink2)">
                        {r.author ?? "Customer"} · {providerName(r.provider)}
                      </span>
                      {pos >= 0 ? (
                        <span className="grid size-6 place-items-center rounded-full bg-(--accent) text-[13px] font-bold text-(--accent-ink)">
                          {pos + 1}
                        </span>
                      ) : (
                        <span className="size-6 rounded-full ring-1 ring-(--sep)" />
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-4 text-[15.5px] leading-relaxed text-(--ink)">
                      &ldquo;{r.text}&rdquo;
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-[14px] bg-(--fill2) px-4 py-3 text-[15px] leading-snug text-(--ink2)">
              No written reviews to show yet. After each finished job we&rsquo;ll ask the homeowner and collect fresh
              ones.
            </p>
          )}
        </Card>

        <Card title={TITLES[4]} hint={allImages.length ? "Tap a photo to leave it out." : undefined}>
          {allImages.length ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {allImages.map((img) => {
                const on = kept.includes(img.url);
                return (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => toggle(kept, setKept, img.url)}
                    className="press relative overflow-hidden rounded-[16px] text-left"
                    aria-pressed={on}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.key ? `/api/media/${img.key}` : img.url}
                      alt={img.alt ?? img.title}
                      loading="lazy"
                      className={cx(
                        "aspect-square w-full object-cover transition-all duration-300",
                        !on && "scale-95 opacity-35 grayscale",
                      )}
                    />
                    <span
                      className={cx(
                        "absolute top-2 right-2 grid size-7 place-items-center rounded-full shadow",
                        on ? "bg-(--accent) text-(--accent-ink)" : "bg-white/90 text-black/50",
                      )}
                    >
                      <OIcon name={on ? "check" : "x"} size={15} strokeWidth={2.6} />
                    </span>
                    {img.caption && (
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-2 text-[13px] leading-tight font-medium text-white">
                        {img.caption}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-[14px] bg-(--fill2) px-4 py-3 text-[15px] text-(--ink2)">
              We didn&rsquo;t find project photos. Your crew&rsquo;s photos will fill this up.
            </p>
          )}
        </Card>
      </div>

      <footer className="safe-bottom px-5 pt-3 pb-5">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            last ? onConfirm({ services, areas, favourites, projectImages: kept }, data.runId) : go(i + 1)
          }
          className={buttonClass("primary", "lg", true)}
        >
          {saving ? <Spinner /> : last ? "Confirm & finish" : i === 0 ? "Yes, that's us" : "Looks right"}
        </button>
      </footer>
    </div>
  );
}

function Card({
  title,
  hint,
  sample,
  children,
}: {
  title: string;
  hint?: string;
  sample?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="w-full shrink-0 snap-center overflow-y-auto px-5 pt-4 pb-6">
      <div className="flex items-center gap-2">
        <h1 className="font-title text-[30px] leading-tight font-bold text-(--ink)">{title}</h1>
        {sample && <Pill>Sample</Pill>}
      </div>
      {hint && <p className="mt-1.5 text-[16px] text-(--ink2)">{hint}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Chips({
  label,
  items,
  on,
  onToggle,
}: {
  label: string;
  items: { key: string; label: string }[];
  on: string[];
  onToggle: (k: string) => void;
}) {
  return (
    <div className="mb-7">
      <p className="mb-2.5 px-1 text-[13px] text-(--ink2)">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const sel = on.includes(it.key);
          return (
            <button
              key={it.key}
              type="button"
              aria-pressed={sel}
              onClick={() => onToggle(it.key)}
              className={cx(
                "press inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-colors",
                sel
                  ? "bg-(--accent) text-(--accent-ink)"
                  : "bg-(--card) text-(--ink3) line-through ring-1 ring-(--sep)",
              )}
            >
              {sel && <OIcon name="check" size={15} strokeWidth={2.6} />}
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BadgeRow({ badge, first }: { badge: Badge; first: boolean }) {
  const ok = badge.verified;
  const link = badge.profileUrl ?? badge.evidence[0]?.url ?? null;
  return (
    <div className={cx("flex items-start gap-3.5 px-4 py-3.5", !first && "border-t border-(--sep)")}>
      <BadgeLogo imageKey={badge.imageKey} imageUrl={badge.imageUrl} verified={ok} />
      <div className="min-w-0 flex-1">
        <p className="text-[17px] text-(--ink)">{badge.name}</p>
        <p className={cx("text-[14px]", ok ? "text-(--green)" : "text-(--amber)")}>
          {ok ? "Confirmed" : "We couldn't confirm this"}
          {badge.rating !== null && ok
            ? ` · ★ ${badge.rating.toFixed(1)}${badge.reviewCount !== null ? ` (${badge.reviewCount})` : ""}`
            : ""}
        </p>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-[14px] text-(--accent)"
          >
            {ok ? "See it on their site" : "See what we found"} <OIcon name="external" size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
