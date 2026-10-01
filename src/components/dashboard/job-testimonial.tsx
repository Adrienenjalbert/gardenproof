import type { Testimonial } from "@/db/schema";
import { CONSENT_FIELDS, parseConsentWording, type ConsentField } from "@/lib/dashboard/consent-wording";
import { formatDate } from "@/lib/dashboard/logic";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, Fact, cx } from "@/components/ui/primitives";
import { WithdrawConsentButton } from "./withdraw-consent";

const T_STATUS = {
  pending: { label: "Not sent yet", tone: "neutral" },
  sent: { label: "Waiting for homeowner", tone: "amber" },
  responded: { label: "Responded", tone: "leaf" },
  expired: { label: "Expired", tone: "red" },
} as const;

type HistoryItem = { id: string; type: string; actor: string | null; createdAt: Date; data: Record<string, unknown> };

/** Consent must be unmistakable: explicit yes / no / not answered / withdrawn, never implied. */
function ConsentRow({
  label,
  value,
  withdrawn,
  statement,
  shownAs,
  at,
  freeText,
}: {
  label: string;
  value: boolean | null;
  withdrawn: boolean;
  statement: string | null;
  shownAs: string | null;
  at: string | null;
  /** The stored wording is one free-text sentence, not per-item lines. */
  freeText: boolean;
}) {
  const state = withdrawn && value ? "withdrawn" : value === true ? "yes" : value === false ? "no" : "none";
  const tone = {
    yes: ["bg-lime-100 text-lime-800", "text-lime-800", "Yes", "check"],
    no: ["bg-red-100 text-red-700", "text-red-700", "No", "x"],
    withdrawn: ["bg-red-100 text-red-700", "text-red-700", "Withdrawn", "x"],
    none: ["bg-stone-100 text-stone-500", "text-stone-500", "Not answered", "clock"],
  }[state] as [string, string, string, "check" | "x" | "clock"];
  return (
    <li className="flex gap-3 py-3.5">
      <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone[0])}>
        <Icon name={tone[3]} size={15} strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className={cx("text-xs font-semibold tracking-wide uppercase", tone[1])}>{tone[2]}</span>
        </span>
        {statement ? (
          <span className="mt-1 block text-[12.5px] leading-relaxed text-foreground/75">“{statement}”</span>
        ) : (
          <span className="mt-1 block text-[12.5px] text-muted italic">
            {value === null
              ? "Not asked in the recorded wording."
              : freeText
                ? "Covered by the single statement recorded below."
                : "Exact wording not recorded."}
          </span>
        )}
        <span className="mt-1 block text-[11.5px] text-muted">
          {[shownAs, at].filter(Boolean).join(" · ")}
        </span>
      </span>
    </li>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "consent.recorded": "Consent recorded",
  "consent.withdrawn": "Consent withdrawn",
  "consent.changed": "Consent changed",
  "testimonial.requested": "Review request prepared",
  "testimonial.received": "Homeowner responded",
  "testimonial.skipped": "Review request skipped",
  "testimonial.expired": "Review link expired",
  "testimonial.withdrawn": "Review request not sent",
};

export function JobTestimonial({
  t,
  area,
  firstName,
  businessName,
  history,
  hasCustomer,
}: {
  t: Testimonial | null;
  area: string | null;
  firstName: string | null;
  businessName: string;
  history: HistoryItem[];
  hasCustomer: boolean;
}) {
  if (!t) {
    return (
      <EmptyState icon="quote" title="No testimonial request yet">
        {hasCustomer
          ? "The homeowner gets a WhatsApp link to rate the job and choose what we may show once the request is sent."
          : "Add the homeowner above: they'll get a WhatsApp link to rate the job and choose what we may show."}
      </EmptyState>
    );
  }
  const st = T_STATUS[t.status];
  const withdrawn = t.withdrawnAt !== null;
  const { lines } = parseConsentWording(t.consentWording);
  // Older records stored one free-text sentence instead of "[YES] …" lines: point at it rather than guess.
  const structured = Object.keys(lines).length > 0;
  const withdrawEvent = history.find((h) => h.type === "consent.withdrawn");
  const withdrawReason = typeof withdrawEvent?.data.reason === "string" ? withdrawEvent.data.reason : null;
  const anyYes = [t.consentPhotos, t.consentQuote, t.consentArea, t.consentFirstName].some((v) => v === true);
  const shownAs: Record<ConsentField, string | null> = {
    consentPhotos: "Website, ads, videos and social",
    consentQuote: t.quote ? "As written, or shortened without changing the meaning" : null,
    consentArea: area ? `Shown as “${area}” — never the street` : "Neighbourhood only",
    consentFirstName: firstName ? `Shown as “${firstName}”` : "Next to their words",
  };
  const given = t.consentedAt ? `Given ${formatDate(t.consentedAt, true)}` : null;
  const publicName = t.consentFirstName && !withdrawn ? (firstName ?? "Homeowner") : "Homeowner (name not consented)";

  return (
    <div className="space-y-6">
      {withdrawn && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-red-700 px-5 py-4 text-white">
          <Icon name="shield" size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-[18px]">Consent withdrawn {formatDate(t.withdrawnAt, true)}</p>
            <p className="mt-0.5 text-sm text-white/85">
              Nothing from this homeowner — photos, words, area or name — may be used. Public assets for this job are
              taken down automatically.
              {withdrawReason && <> Reason: “{withdrawReason}”.</>}
            </p>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className={cx("p-6 sm:p-8", withdrawn && "opacity-70")}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <Badge tone={withdrawn ? "red" : st.tone}>{withdrawn ? "Withdrawn" : st.label}</Badge>
            {t.rating !== null && (
              <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${t.rating} out of 5 stars`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Icon key={i} name="star" size={18} fill={i < (t.rating ?? 0) ? "currentColor" : "none"} className={i < (t.rating ?? 0) ? "" : "text-stone-300"} />
                ))}
              </span>
            )}
          </div>
          {t.quote ? (
            <blockquote>
              <p className={cx("font-display text-[22px] leading-[1.45] text-olive-dark sm:text-[26px]", withdrawn && "line-through decoration-red-400/60")}>
                “{t.quote}”
              </p>
              <footer className="mt-4 text-sm text-muted">
                — {publicName}
                {t.consentArea && !withdrawn && area ? `, ${area}` : ""}
                {!t.consentQuote && !withdrawn && (
                  <span className="mt-1 block text-xs font-medium text-amber-700">
                    No permission to quote these words publicly — for the owner only.
                  </span>
                )}
              </footer>
            </blockquote>
          ) : (
            <p className="text-sm text-muted">No quote yet.</p>
          )}
          <dl className="mt-8 divide-y divide-line border-t border-line">
            <Fact label="Link sent">{formatDate(t.sentAt, true)}</Fact>
            <Fact label="Responded">{formatDate(t.respondedAt, true)}</Fact>
            <Fact label="Maintenance">
              {t.maintenanceInterest ? <Badge tone="leaf">Interested in maintenance</Badge> : t.maintenanceInterest === false ? "Not interested" : "—"}
            </Fact>
            <Fact label="Public review">{t.reviewLinkClicked ? `Clicked ${t.reviewLinkClicked}` : "—"}</Fact>
          </dl>
          {history.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-2 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">Consent history</h3>
              <ol className="space-y-1.5 text-[13px]">
                {history.map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <span className="w-36 shrink-0 text-muted tabular-nums">{formatDate(h.createdAt, true)}</span>
                    <span>
                      {EVENT_LABEL[h.type] ?? h.type}
                      {h.actor && (
                        <span className="text-muted"> · {h.actor.startsWith("cus_") ? "homeowner" : h.actor}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        <Card className="h-fit p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-display text-[17px]">
                <Icon name="shieldCheck" size={18} className="text-olive" /> Consent
              </h3>
              <p className="mt-1 text-xs text-muted">
                {t.consentedAt ? `Recorded ${formatDate(t.consentedAt, true)}` : "Not recorded yet"} · the address is
                never published.
              </p>
            </div>
            {!withdrawn && t.status === "responded" && anyYes && (
              <WithdrawConsentButton testimonialId={t.id} name={firstName ?? "the homeowner"} />
            )}
          </div>
          <ul className="mt-2 divide-y divide-line">
            {CONSENT_FIELDS.map((f) => (
              <ConsentRow
                key={f.key}
                label={f.label}
                // Withdrawal sets every flag to false; show what was agreed (from the evidence) as "Withdrawn".
                value={withdrawn ? (lines[f.key]?.answer ?? t[f.key]) : t[f.key]}
                withdrawn={withdrawn}
                statement={lines[f.key]?.statement ?? null}
                freeText={!structured && !!t.consentWording}
                shownAs={shownAs[f.key]}
                at={withdrawn ? `Withdrawn ${formatDate(t.withdrawnAt, true)}` : t[f.key] !== null ? given : null}
              />
            ))}
          </ul>
          <details open={!structured} className="mt-3 rounded-xl bg-stone-50 p-3.5 ring-1 ring-line">
            <summary className="cursor-pointer text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
              Full wording shown to the homeowner
            </summary>
            <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-foreground/85">
              {t.consentWording ?? "No wording recorded."}
            </p>
          </details>
          <p className="mt-3 text-[11.5px] text-muted">Asked on behalf of {businessName}.</p>
        </Card>
      </div>
    </div>
  );
}
