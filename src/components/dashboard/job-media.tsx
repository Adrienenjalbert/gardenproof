import { clearMediaPrivacyAction, keepMediaWithheldAction, setHeroMediaAction } from "@/lib/dashboard/actions";
import { groupByStage } from "@/lib/dashboard/logic";
import type { PrivacyView } from "@/lib/dashboard/media-privacy";
import type { MediaView } from "@/lib/dashboard/queries";
import { NEEDS_BLUR } from "@/lib/privacy";
import { MEDIA_STAGES } from "@/lib/domain";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { Badge, EmptyState, cx } from "@/components/ui/primitives";
import { ActionButton } from "./action-button";

const STAGE_TITLE = { before: "Before", progress: "In progress", after: "After" } as const;

const CLEAR_CONFIRM =
  "Open the full photo first. Confirm there are no faces, number plates or house numbers visible — this photo will then be usable on the website, ads and videos.";

function qualityTone(score: number | null) {
  if (score === null) return "neutral" as const;
  return score >= 0.75 ? ("leaf" as const) : score >= 0.6 ? ("amber" as const) : ("red" as const);
}

/** Overlay badge on the photo itself, so a withheld image is unmistakable at a glance. */
function PrivacyOverlay({ p }: { p: PrivacyView }) {
  if (p.kind === "withheld" || p.kind === "kept_withheld") {
    return (
      <span className="absolute inset-x-2.5 bottom-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-700/95 px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-sm">
        <Icon name="shield" size={14} /> Withheld from public use
      </span>
    );
  }
  if (p.kind === "not_checked") {
    return (
      <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-stone-700 shadow-sm">
        <Icon name="eye" size={12} /> Not checked
      </span>
    );
  }
  return null;
}

function PrivacyPanel({ m }: { m: MediaView }) {
  const p = m.privacy;
  const clear = (
    <ActionButton
      action={clearMediaPrivacyAction.bind(null, m.id)}
      size="sm"
      variant={p.kind === "withheld" ? "primary" : "secondary"}
      icon="shieldCheck"
      pendingLabel="Saving…"
      confirm={CLEAR_CONFIRM}
    >
      I&apos;ve checked — safe to publish
    </ActionButton>
  );
  const withhold = (label: string) => (
    <ActionButton action={keepMediaWithheldAction.bind(null, m.id)} size="sm" variant="ghost" icon="shield" pendingLabel="Saving…">
      {label}
    </ActionButton>
  );

  switch (p.kind) {
    case "withheld":
    case "kept_withheld":
      return (
        <div className="space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-[13px] leading-snug text-red-900">
            <strong className="font-semibold">Needs blur: {p.reason}.</strong>{" "}
            {p.kind === "kept_withheld"
              ? "You chose to keep it withheld. It won't appear on the website, in ads or videos."
              : "Not used on the website, in ads or videos until you check it."}
          </p>
          <div className="flex flex-wrap gap-2">
            {clear}
            {p.kind === "withheld" && withhold("Keep withheld")}
          </div>
        </div>
      );
    case "cleared":
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-lime-50 px-3 py-2 ring-1 ring-lime-200">
          <p className="text-[12.5px] text-lime-900">
            <Icon name="shieldCheck" size={13} className="mr-1 inline" />
            {p.reason ? `Flagged (${p.reason}), checked by you` : "Checked by you"}
            {m.privacyClearedAt && ` · ${m.privacyClearedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
          </p>
          {withhold("Withhold again")}
        </div>
      );
    case "blurred":
      return (
        <p className="rounded-xl bg-lime-50 px-3 py-2 text-[12.5px] text-lime-900 ring-1 ring-lime-200">
          Flagged ({p.reason}) — a blurred copy is used publicly.
        </p>
      );
    case "not_checked":
      return (
        <div className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-line">
          <p className="text-[12.5px] leading-snug text-foreground/80">
            Not screened for faces, number plates or house numbers yet.
          </p>
          {clear}
        </div>
      );
    default:
      return null;
  }
}

function MediaTile({ m }: { m: MediaView }) {
  if (m.kind === "audio") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 ring-1 ring-line sm:col-span-2">
        <p className="flex items-center justify-between gap-2 text-[13px] font-medium">
          <span className="flex items-center gap-2">
            <Icon name="mic" size={15} className="text-olive" /> Voice note
          </span>
          <Badge tone="neutral" icon="shield">
            Private — never published
          </Badge>
        </p>
        <audio controls src={m.url} className="w-full" preload="none" />
        {m.transcript && <p className="text-sm leading-relaxed text-foreground/80 italic">“{m.transcript}”</p>}
      </div>
    );
  }
  const withheld = m.privacy.kind === "withheld" || m.privacy.kind === "kept_withheld";
  const otherFlags = m.flags.filter((f) => !NEEDS_BLUR.test(f));
  return (
    <figure className={cx("group overflow-hidden rounded-2xl bg-white", withheld ? "ring-2 ring-red-300" : "ring-1 ring-line")}>
      <div className="relative aspect-[4/3]">
        {m.kind === "video" ? (
          <video src={m.url} controls preload="metadata" className="size-full bg-black object-cover" />
        ) : (
          <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${STAGE_TITLE[m.stage].toLowerCase()} photo`}>
            <Photo src={m.url} alt={`${STAGE_TITLE[m.stage]} photo`} className={cx("size-full", withheld && "saturate-50")} />
          </a>
        )}
        {m.isHero && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-leaf px-2 py-0.5 text-[11px] font-semibold text-olive-dark shadow-sm">
            <Icon name="star" size={11} /> Hero
          </span>
        )}
        {m.qualityScore !== null && (
          <span className="absolute top-2.5 right-2.5">
            <Badge tone={qualityTone(m.qualityScore)} className="shadow-sm">
              Quality {Math.round(m.qualityScore * 100)}
            </Badge>
          </span>
        )}
        <PrivacyOverlay p={m.privacy} />
      </div>
      <figcaption className="space-y-2.5 p-3">
        <PrivacyPanel m={m} />
        {otherFlags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {otherFlags.map((f) => (
              <Badge key={f} tone="amber" icon="alert">
                {f}
              </Badge>
            ))}
          </div>
        )}
        {m.kind === "image" && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
            <dt>Public file</dt>
            <dd className={cx("truncate", m.publicUrl ? "text-foreground/80" : "font-medium text-red-700")}>
              {m.publicUrl ? (
                <a href={m.publicUrl} target="_blank" rel="noreferrer" className="hover:underline" title={m.privacy.publicKey ?? undefined}>
                  {m.privacy.publicLabel}
                </a>
              ) : (
                m.privacy.publicLabel
              )}
            </dd>
            <dt>Original</dt>
            <dd className="truncate">
              <a href={m.originalUrl} target="_blank" rel="noreferrer" className="hover:underline">
                Full resolution · private
              </a>
            </dd>
          </dl>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>{m.width && m.height ? `${m.width}×${m.height}` : m.kind}</span>
          {m.kind === "image" && !m.isHero && (
            <ActionButton action={setHeroMediaAction.bind(null, m.id)} size="sm" variant="ghost" icon="star" pendingLabel="Saving…">
              Set as hero
            </ActionButton>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

export function JobMedia({ media }: { media: MediaView[] }) {
  if (!media.length) {
    return (
      <EmptyState icon="image" title="No photos yet">
        The crew&apos;s WhatsApp photos land here as they send them.
      </EmptyState>
    );
  }
  const groups = groupByStage(media);
  const withheld = media.filter((m) => m.privacy.kind === "withheld").length;
  return (
    <div className="space-y-10">
      {withheld > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-red-200">
          <Icon name="shield" size={17} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">
              {withheld} {withheld === 1 ? "photo is" : "photos are"} withheld from public use
            </strong>{" "}
            because the AI spotted a face, number plate or house number. Check each one and decide.
          </span>
        </p>
      )}
      {MEDIA_STAGES.map((stage) => (
        <section key={stage}>
          <h3 className="mb-3 flex items-baseline gap-2 font-display text-[17px]">
            {STAGE_TITLE[stage]}
            <span className="font-sans text-sm text-muted tabular-nums">{groups[stage].length}</span>
          </h3>
          {groups[stage].length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groups[stage].map((m) => (
                <MediaTile key={m.id} m={m} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-5 text-sm text-muted">
              No {STAGE_TITLE[stage].toLowerCase()} media.
              {stage === "before" && " Before photos make the strongest ads — ask the crew next time."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
