"use client";
/** Team: tap someone to edit, + to add. Name, mobile, which team, and what they do. */
import { useState } from "react";
import type { TeamRole } from "@/lib/crm";
import { removeMemberAction, saveMemberAction } from "@/lib/owner/actions";
import type { TeamMemberView } from "@/lib/owner/team";
import { Spinner, useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { buttonClass, cx, Group, RowDivider, Thumb } from "./ui";

type Draft = {
  id?: string;
  name: string;
  phone: string;
  team: "landscaping" | "maintenance";
  teamRole: TeamRole;
};
const ROLES: { value: TeamRole; label: string; hint: string }[] = [
  {
    value: "owner",
    label: "Owner",
    hint: "Gets the important things and the evening summary",
  },
  {
    value: "office",
    label: "Office",
    hint: "Sees everything and can send messages",
  },
  {
    value: "crew_lead",
    label: "Crew lead",
    hint: "Gets job notes and sends photos",
  },
  { value: "crew", label: "Crew", hint: "Sends photos from site" },
];

export function TeamEditor({ members }: { members: TeamMemberView[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const teams = [
    { key: "landscaping", label: "Landscaping" },
    { key: "maintenance", label: "Maintenance" },
  ] as const;
  return (
    <>
      <div className="space-y-7">
        {teams.map((t) => {
          const people = members.filter((m) => m.team === t.key);
          return (
            <section key={t.key}>
              <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">{t.label}</p>
              <Group>
                {people.map((m, i) => (
                  <div key={m.id}>
                    {i > 0 && <RowDivider inset={72} />}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          id: m.id,
                          name: m.name,
                          phone: m.phonePretty,
                          team: m.team,
                          teamRole: m.teamRole,
                        })
                      }
                      className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-(--fill2) lg:hover:bg-(--fill2)"
                    >
                      <Thumb src={null} label={m.name.slice(0, 1)} size={42} radius={21} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[17px] text-(--ink)">{m.name}</p>
                        <p className="truncate text-[14px] text-(--ink2)">
                          {m.roleLabel} · {m.phonePretty}
                        </p>
                      </div>
                      <OIcon name="chevronRight" size={17} className="text-(--ink3)" />
                    </button>
                  </div>
                ))}
                {people.length > 0 && <RowDivider inset={72} />}
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      name: "",
                      phone: "",
                      team: t.key,
                      teamRole: "crew",
                    })
                  }
                  className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-[17px] text-(--accent)"
                >
                  <span className="grid size-[42px] place-items-center rounded-full bg-(--accent-soft)">
                    <OIcon name="plus" size={20} strokeWidth={2.2} />
                  </span>
                  Add someone
                </button>
              </Group>
            </section>
          );
        })}
      </div>
      {draft && <MemberSheet draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

function MemberSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const save = useOwnerAction();
  const remove = useOwnerAction();
  const input =
    "h-12 w-full rounded-[12px] bg-(--fill2) px-3.5 text-[17px] text-(--ink) outline-none ring-1 ring-(--sep) placeholder:text-(--ink3) focus:ring-(--accent)";
  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? draft.name : "New team member"}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={save.pending || !d.name.trim() || !d.phone.trim()}
            onClick={() =>
              save.run(
                () => saveMemberAction(d),
                (ok) => ok && onClose(),
              )
            }
            className={buttonClass("primary", "lg", true)}
          >
            {save.pending ? <Spinner /> : "Save"}
          </button>
          {draft.id && draft.teamRole !== "owner" && (
            <button
              type="button"
              disabled={remove.pending}
              onClick={() =>
                remove.run(
                  () => removeMemberAction(draft.id!),
                  (ok) => ok && onClose(),
                )
              }
              className={buttonClass("plain", "md", true) + " !text-(--red)"}
            >
              Remove from team
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">Name</span>
          <input
            className={input}
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="First name"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">Mobile</span>
          <input
            className={input}
            value={d.phone}
            onChange={(e) => setD({ ...d, phone: e.target.value })}
            placeholder="07700 900123"
            inputMode="tel"
            autoComplete="off"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">Team</span>
          <Segmented
            value={d.team}
            onChange={(team) => setD({ ...d, team })}
            options={[
              { value: "landscaping", label: "Landscaping" },
              { value: "maintenance", label: "Maintenance" },
            ]}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-[15px] font-medium text-(--ink)">Role</span>
          <div className="overflow-hidden rounded-[14px] bg-(--fill2)">
            {ROLES.map((r, i) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setD({ ...d, teamRole: r.value })}
                className={cx("flex w-full items-center gap-3 px-4 py-3 text-left", i > 0 && "border-t border-(--sep)")}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] text-(--ink)">{r.label}</p>
                  <p className="text-[13px] text-(--ink2)">{r.hint}</p>
                </div>
                {d.teamRole === r.value && (
                  <OIcon name="check" size={20} strokeWidth={2.4} className="text-(--accent)" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
