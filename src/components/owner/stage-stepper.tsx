"use client";
/**
 * Where the job is, as a row of stages. Tap a stage → a sheet says what will happen (which messages go, when),
 * asks for the one date that stage needs, and moves the job on confirm.
 */
import { useEffect, useRef, useState } from "react";
import type { CrmStage } from "@/lib/crm";
import { moveStageAction, previewStageAction, type PlannedPreview } from "@/lib/owner/actions";
import { STAGE_DATE_PROMPT, STAGE_WORDS } from "@/lib/owner/words";
import { Spinner, useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { Sheet } from "./sheet";
import { buttonClass, cx } from "./ui";

export const FLOW: CrmStage[] = ["enquiry", "site_visit", "quoted", "booked", "on_site", "finished", "maintenance"];

/** "2026-09-26T10:00" in the browser's zone (the owner's), for <input type="datetime-local">. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function StageStepper({
  jobId,
  stage,
  nextActionAt,
}: {
  jobId: string;
  stage: CrmStage;
  nextActionAt: string | null;
}) {
  const [target, setTarget] = useState<CrmStage | null>(null);
  const idx = FLOW.indexOf(stage);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the current stage in view (later stages sit off-screen on a phone).
    const el = rail.current?.querySelector<HTMLElement>("[aria-current]");
    if (el && rail.current) rail.current.scrollLeft = el.offsetLeft - (rail.current.clientWidth - el.offsetWidth) / 2;
  }, [stage]);
  return (
    <>
      <div ref={rail} className="rail relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {FLOW.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const on = s === stage;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setTarget(s)}
              aria-current={on ? "step" : undefined}
              className={cx(
                "press flex h-9 shrink-0 snap-start items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium transition-colors",
                on
                  ? "bg-(--accent) text-(--accent-ink) shadow-sm"
                  : done
                    ? "bg-(--accent-soft) text-(--accent)"
                    : "bg-(--card) text-(--ink2) ring-1 ring-(--sep)",
              )}
            >
              {done && <OIcon name="check" size={15} strokeWidth={2.4} />}
              {STAGE_WORDS[s]}
            </button>
          );
        })}
      </div>
      {stage !== "lost" ? (
        <button
          type="button"
          onClick={() => setTarget("lost")}
          className="mt-2 px-1 text-[14px] text-(--ink3) hover:text-(--ink2)"
        >
          Didn&rsquo;t go ahead?
        </button>
      ) : (
        <p className="mt-2 px-1 text-[14px] text-(--ink2)">Marked as not going ahead. Tap a stage to reopen it.</p>
      )}
      {target && (
        <MoveSheet jobId={jobId} from={stage} to={target} currentAt={nextActionAt} onClose={() => setTarget(null)} />
      )}
    </>
  );
}

/** The confirm sheet a stage move goes through everywhere it can happen: the job page's stepper, and the
 *  pipeline board's drag-and-drop or move sheet. Shared so the owner sees the same "what happens next" either way. */
export function MoveSheet({
  jobId,
  from,
  to,
  currentAt,
  onClose,
}: {
  jobId: string;
  from: CrmStage;
  to: CrmStage;
  currentAt: string | null;
  onClose: () => void;
}) {
  const prompt = STAGE_DATE_PROMPT[to];
  const same = from === to;
  const [at, setAt] = useState(same ? localInput(currentAt) : "");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<PlannedPreview[] | null>(null);
  const { pending, run } = useOwnerAction();
  const iso = at ? new Date(at).toISOString() : null;

  useEffect(() => {
    let live = true;
    previewStageAction({ jobId, stage: to, at: prompt ? iso : undefined })
      .then((p) => live && setPlan(p))
      .catch(() => live && setPlan([]));
    return () => {
      live = false;
    };
  }, [jobId, to, iso, prompt]);

  const title =
    to === "lost"
      ? "Mark as not going ahead?"
      : same
        ? prompt
          ? "Change the date?"
          : STAGE_WORDS[to]
        : `Move to ${STAGE_WORDS[to]}?`;
  const confirm = () =>
    run(
      () =>
        moveStageAction({
          jobId,
          stage: to,
          at: prompt ? iso : undefined,
          note: note || undefined,
        }),
      (ok) => ok && onClose(),
    );

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className={buttonClass(to === "lost" ? "danger" : "primary", "lg", true)}
          >
            {pending ? (
              <Spinner />
            ) : to === "lost" ? (
              "Mark as not going ahead"
            ) : same ? (
              "Save"
            ) : (
              `Move to ${STAGE_WORDS[to]}`
            )}
          </button>
          <button type="button" onClick={onClose} className={buttonClass("plain", "md", true)}>
            Cancel
          </button>
        </div>
      }
    >
      {prompt && (
        <label className="mb-5 block">
          <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">{prompt}</span>
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="h-12 w-full rounded-[12px] bg-(--fill2) px-3.5 text-[17px] text-(--ink) outline-none ring-1 ring-(--sep) focus:ring-(--accent)"
          />
        </label>
      )}
      <p className="mb-2 text-[13px] font-medium tracking-wide text-(--ink2) uppercase">What happens next</p>
      {plan === null ? (
        <div className="space-y-2 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="anim-pulse h-12 rounded-[12px] bg-(--fill2)" />
          ))}
        </div>
      ) : plan.length === 0 ? (
        <p className="rounded-[14px] bg-(--fill2) px-4 py-3 text-[15px] text-(--ink2)">
          {to === "lost" ? "Any planned messages are cancelled. Nothing is sent." : "No messages for this stage."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-[14px] bg-(--fill2)">
          {plan.map((p, i) => (
            <li key={i} className={cx("flex items-start gap-3 px-4 py-3", i > 0 && "border-t border-(--sep)")}>
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-(--accent-soft) text-(--accent)">
                <OIcon name="send" size={14} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-(--ink)">
                  {p.label} <span className="font-normal text-(--ink2)">to {p.to}</span>
                </p>
                <p className="text-[14px] text-(--ink2)">
                  {p.when}
                  {p.asks ? " · asks you first" : " · automatic"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-5 block">
        <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">
          Note <span className="font-normal text-(--ink3)">(optional)</span>
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder={to === "lost" ? "e.g. went with another quote" : "Anything to remember"}
          className="h-12 w-full rounded-[12px] bg-(--fill2) px-3.5 text-[17px] text-(--ink) outline-none ring-1 ring-(--sep) placeholder:text-(--ink3) focus:ring-(--accent)"
        />
      </label>
    </Sheet>
  );
}
