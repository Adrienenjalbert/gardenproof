"use client";
/**
 * Jobs, three ways: List (grouped by stage, with Active / Maintenance / All and search), Board (a pipeline you
 * can drag jobs across) and Week (the next 7 days' visits and start dates). List and Board share the same
 * search and filter; Week is date-led, so it sits on its own.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CrmStage } from "@/lib/crm";
import type { JobListItem } from "@/lib/owner/jobs";
import type { WeekPlanner as WeekPlannerData } from "@/lib/owner/planner";
import { STAGE_GROUPS } from "@/lib/owner/words";
import { OIcon } from "./icons";
import { PipelineBoard } from "./pipeline-board";
import { Segmented } from "./segmented";
import { WeekPlanner } from "./week-planner";
import { Empty, Group, RowDivider, Thumb } from "./ui";

type Filter = "active" | "maintenance" | "all";
type View = "list" | "board" | "week";
const ACTIVE: CrmStage[] = ["enquiry", "site_visit", "quoted", "booked", "on_site", "finished"];

/**
 * Below this many active jobs, a kanban board and a week planner are more UI than the business needs —
 * one screen of jobs is easier to just scan. List stays the only view until there's enough in flight for
 * "which stage is everything in" or "what's on this week" to be a real question worth its own view.
 */
const PIPELINE_VIEWS_MIN_ACTIVE_JOBS = 15;

export function JobsList({ items, week }: { items: JobListItem[]; week: WeekPlannerData }) {
  const activeCount = useMemo(() => items.filter((i) => ACTIVE.includes(i.stage)).length, [items]);
  const showPipelineViews = activeCount >= PIPELINE_VIEWS_MIN_ACTIVE_JOBS;
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = items.filter(
      (i) =>
        (filter === "all" || (filter === "maintenance" ? i.stage === "maintenance" : ACTIVE.includes(i.stage))) &&
        (!needle || i.search.includes(needle)),
    );
    const out: { stage: CrmStage; items: JobListItem[] }[] = [];
    for (const i of shown) {
      const g = out.at(-1);
      if (g?.stage === i.stage) g.items.push(i);
      else out.push({ stage: i.stage, items: [i] });
    }
    return out;
  }, [items, filter, q]);

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === "all" || (filter === "maintenance" ? i.stage === "maintenance" : ACTIVE.includes(i.stage))) &&
        (!needle || i.search.includes(needle)),
    );
  }, [items, filter, q]);

  return (
    <div>
      {showPipelineViews && (
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
            { value: "week", label: "Week" },
          ]}
          className="mb-4"
        />
      )}
      {showPipelineViews && view === "week" ? (
        <WeekPlanner data={week} />
      ) : (
        <>
          <label className="mb-3 flex h-10 items-center gap-2 rounded-[12px] bg-(--fill) px-3 text-(--ink2)">
            <OIcon name="search" size={18} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, area or job"
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-(--ink) outline-none placeholder:text-(--ink3)"
              type="search"
              enterKeyHint="search"
            />
          </label>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "maintenance", label: "Maintenance" },
              { value: "all", label: "All" },
            ]}
            className="mb-6"
          />
          {showPipelineViews && view === "board" ? (
            <PipelineBoard items={filteredItems} />
          ) : (
            <JobsListView groups={groups} q={q} filter={filter} />
          )}
        </>
      )}
    </div>
  );
}

function JobsListView({
  groups,
  q,
  filter,
}: {
  groups: { stage: CrmStage; items: JobListItem[] }[];
  q: string;
  filter: Filter;
}) {
  return (
    <>
      {!groups.length ? (
        <Empty
          icon={q ? "search" : "leaf"}
          title={q ? "No matches" : filter === "maintenance" ? "No maintenance clients yet" : "No jobs yet"}
        >
          {q
            ? "Try a first name or an area."
            : filter === "maintenance"
              ? `When a finished job moves to maintenance, it shows here.`
              : "New enquiries will appear here."}
        </Empty>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.stage} className="anim-rise">
              <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">
                {STAGE_GROUPS[g.stage]} <span className="text-(--ink3)">· {g.items.length}</span>
              </p>
              <Group>
                {g.items.map((j, i) => (
                  <div key={j.id}>
                    {i > 0 && <RowDivider inset={82} />}
                    <Link
                      href={`/jobs/${j.id}`}
                      className="flex items-center gap-3.5 px-4 py-3 transition-colors active:bg-(--fill2) lg:hover:bg-(--fill2)"
                    >
                      <Thumb src={j.photoUrl} label={j.initials} size={52} radius={13} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[17px] leading-snug font-semibold text-(--ink)">
                          {j.name}
                          {j.area && <span className="font-normal text-(--ink2)"> · {j.area}</span>}
                        </p>
                        <p className="mt-0.5 truncate text-[15px] text-(--ink2)">{j.statusLine}</p>
                      </div>
                      {j.needsYou && (
                        <span className="size-2.5 shrink-0 rounded-full bg-(--accent)" aria-label="Needs you" />
                      )}
                      <OIcon name="chevronRight" size={17} className="shrink-0 text-(--ink3)" />
                    </Link>
                  </div>
                ))}
              </Group>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
