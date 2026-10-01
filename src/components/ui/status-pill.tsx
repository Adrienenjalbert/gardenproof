/**
 * Status pills for jobs, assets and messages: one place that maps every status to a label and tone,
 * so the same status looks the same on every screen.
 */
import type { AssetStatus, JobStatus, MessageStatus } from "@/lib/domain";
import { Dot, cx, type Tone } from "./primitives";

export const JOB_STATUS_META: Record<JobStatus, { label: string; tone: Tone; hint: string }> = {
  capturing: { label: "Capturing", tone: "blue", hint: "Crew is sending photos" },
  captured: { label: "Captured", tone: "neutral", hint: "Crew tapped Done" },
  awaiting_testimonial: { label: "Awaiting homeowner", tone: "amber", hint: "Review link sent" },
  ready_for_content: { label: "Ready for content", tone: "leaf", hint: "Testimonial in or timed out" },
  content_draft: { label: "Drafts ready", tone: "olive", hint: "Assets generated" },
  in_review: { label: "In review", tone: "amber", hint: "Waiting for you" },
  published: { label: "Published", tone: "dark", hint: "Live" },
};

export const ASSET_STATUS_META: Record<AssetStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "amber" },
  approved: { label: "Approved", tone: "leaf" },
  rejected: { label: "Rejected", tone: "red" },
  published: { label: "Published", tone: "dark" },
};

export const MESSAGE_STATUS_META: Record<MessageStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  held: { label: "Held", tone: "amber" },
  approved: { label: "Approved", tone: "leaf" },
  sent: { label: "Sent", tone: "olive" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const PILL: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  olive: "bg-olive-50 text-olive-dark",
  leaf: "bg-lime-50 text-lime-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-800",
  dark: "bg-olive-dark text-white",
};

function Pill({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap",
        PILL[tone],
        className,
      )}
    >
      <Dot tone={tone === "dark" ? "leaf" : tone} />
      {label}
    </span>
  );
}

type StatusPillProps =
  | { kind: "job"; status: JobStatus; className?: string }
  | { kind: "asset"; status: AssetStatus; className?: string }
  | { kind: "message"; status: MessageStatus; className?: string };

export function StatusPill(props: StatusPillProps) {
  const meta =
    props.kind === "job"
      ? JOB_STATUS_META[props.status]
      : props.kind === "asset"
        ? ASSET_STATUS_META[props.status]
        : MESSAGE_STATUS_META[props.status];
  return <Pill tone={meta?.tone ?? "neutral"} label={meta?.label ?? props.status} className={props.className} />;
}
