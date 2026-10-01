"use client";
/** Which team looks after this job (their crew lead gets the job notes). */
import { useState } from "react";
import { setJobTeamAction } from "@/lib/owner/actions";
import { useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { Sheet } from "./sheet";
import { cx } from "./ui";

const TEAMS = [
  { value: "landscaping", label: "Landscaping" },
  { value: "maintenance", label: "Maintenance" },
] as const;

export function TeamPicker({ jobId, team, lead }: { jobId: string; team: string; lead: string | null }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useOwnerAction();
  const label = TEAMS.find((t) => t.value === team)?.label ?? team;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors active:bg-(--fill2) lg:hover:bg-(--fill2)"
      >
        <span className="grid size-[30px] shrink-0 place-items-center rounded-[8px] bg-[#5e5ce6] text-white">
          <OIcon name="people" size={18} strokeWidth={1.9} />
        </span>
        <span className="flex-1 text-[17px] text-(--ink)">Team</span>
        <span className="text-[15px] text-(--ink2)">
          {label}
          {lead ? ` · ${lead}` : ""}
        </span>
        <OIcon name="chevronRight" size={17} className="text-(--ink3)" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Which team?">
        <div className="overflow-hidden rounded-[14px] bg-(--fill2)">
          {TEAMS.map((t, i) => (
            <button
              key={t.value}
              type="button"
              disabled={pending}
              onClick={() =>
                t.value === team
                  ? setOpen(false)
                  : run(
                      () => setJobTeamAction({ jobId, team: t.value }),
                      (ok) => ok && setOpen(false),
                    )
              }
              className={cx(
                "flex h-14 w-full items-center justify-between px-4 text-[17px] text-(--ink)",
                i > 0 && "border-t border-(--sep)",
              )}
            >
              {t.label}
              {t.value === team && <OIcon name="check" size={20} strokeWidth={2.4} className="text-(--accent)" />}
            </button>
          ))}
        </div>
        <p className="mt-3 px-1 pb-2 text-[14px] text-(--ink2)">
          The team&rsquo;s crew lead gets the visit and start notes on WhatsApp.
        </p>
      </Sheet>
    </>
  );
}
