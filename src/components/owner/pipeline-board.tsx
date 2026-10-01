"use client";
/**
 * Pipeline: every job as a board, one column per stage. On desktop, drag a card into another column to move
 * it. On a phone, native drag fights with scrolling the columns, so each card also has a move button that
 * opens a stage picker. Either way it lands on the same confirm sheet the job page's stepper uses — the
 * owner sees what will be sent before anything moves.
 */
import Link from "next/link";
import { useState } from "react";
import type { CrmStage } from "@/lib/crm";
import type { JobListItem } from "@/lib/owner/jobs";
import { STAGE_WORDS } from "@/lib/owner/words";
import { OIcon } from "./icons";
import { Sheet } from "./sheet";
import { FLOW, MoveSheet } from "./stage-stepper";
import { Empty, Thumb, cx } from "./ui";

export function PipelineBoard({ items }: { items: JobListItem[] }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<CrmStage | null>(null);
  const [picking, setPicking] = useState<JobListItem | null>(null);
  const [move, setMove] = useState<{ jobId: string; from: CrmStage; to: CrmStage } | null>(null);

  if (!items.length) {
    return (
      <Empty icon="jobsStack" title="No jobs yet">
        New enquiries will appear here.
      </Empty>
    );
  }

  const byStage = new Map<CrmStage, JobListItem[]>(FLOW.map((s) => [s, []]));
  for (const it of items) byStage.get(it.stage)?.push(it);

  function dropOn(stage: CrmStage) {
    setOverStage(null);
    const jobId = dragging;
    setDragging(null);
    const job = items.find((i) => i.id === jobId);
    if (!job || job.stage === stage) return;
    setMove({ jobId: job.id, from: job.stage, to: stage });
  }

  return (
    <>
      <div className="rail -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        {FLOW.map((stage) => {
          const list = byStage.get(stage) ?? [];
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(stage);
              }}
              className={cx(
                "w-[240px] shrink-0 snap-start rounded-[18px] bg-(--fill) p-2.5 transition-colors",
                overStage === stage && "bg-(--accent-soft) outline outline-2 outline-(--accent)",
              )}
            >
              <p className="mb-2 truncate px-1.5 text-[13px] font-semibold text-(--ink2)">
                {STAGE_WORDS[stage]} <span className="text-(--ink3)">· {list.length}</span>
              </p>
              <div className="min-h-[40px] space-y-2">
                {list.map((j) => (
                  <div
                    key={j.id}
                    draggable
                    onDragStart={(e) => {
                      setDragging(j.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cx(
                      "group flex items-start gap-2 rounded-[14px] bg-(--card) p-2.5 shadow-(--shadow) transition-opacity",
                      dragging === j.id && "opacity-40",
                    )}
                  >
                    <Link href={`/jobs/${j.id}`} className="flex min-w-0 flex-1 items-start gap-2.5">
                      <Thumb src={j.photoUrl} label={j.initials} size={34} radius={9} />
                      <div className="min-w-0 pt-0.5">
                        <p className="truncate text-[14px] leading-snug font-semibold text-(--ink)">
                          {j.name}
                          {j.needsYou && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-(--accent) align-middle" />
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-[12.5px] leading-snug text-(--ink2)">{j.statusLine}</p>
                      </div>
                    </Link>
                    <button
                      type="button"
                      aria-label={`Move ${j.name} to another stage`}
                      onClick={() => setPicking(j)}
                      className="press -mt-0.5 -mr-0.5 grid size-7 shrink-0 place-items-center rounded-full text-(--ink3) active:bg-(--fill2) lg:opacity-0 lg:group-hover:opacity-100"
                    >
                      <OIcon name="swap" size={15} />
                    </button>
                  </div>
                ))}
                {!list.length && <p className="px-1.5 py-2 text-[13px] text-(--ink3)">None</p>}
              </div>
            </div>
          );
        })}
      </div>

      {picking && (
        <Sheet open onClose={() => setPicking(null)} title={`Move ${picking.name}`}>
          <div className="space-y-1 pb-2">
            {FLOW.filter((s) => s !== picking.stage).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setMove({ jobId: picking.id, from: picking.stage, to: s });
                  setPicking(null);
                }}
                className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-[16px] font-medium text-(--ink) active:bg-(--fill2)"
              >
                {STAGE_WORDS[s]}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {move && (
        <MoveSheet jobId={move.jobId} from={move.from} to={move.to} currentAt={null} onClose={() => setMove(null)} />
      )}
    </>
  );
}
