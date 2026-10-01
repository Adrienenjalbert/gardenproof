/**
 * Pure mapping from rows in the `tasks` table (the durable background queue) to what the operator sees:
 * "Generating…", "Rendering 9:16…", "Publishing failed — retry". No DB or React, so it is unit-tested and shared
 * by server components and the client poller.
 */

export type TaskStatus = "queued" | "running" | "done" | "failed";

export type TaskLike = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/** A task the operator should see: in flight, or the latest attempt at something that failed. */
export type TaskState = {
  taskId: string;
  type: string;
  status: Exclude<TaskStatus, "done">;
  jobId: string | null;
  assetId: string | null;
  label: string;
  error: string | null;
  /** True for a queued task that already failed once and is waiting for its automatic retry. */
  retrying: boolean;
  createdAt: Date;
};

const NOUNS: Record<string, { active: string; noun: string }> = {
  "pipeline.ready_for_content": { active: "Generating content", noun: "Content generation" },
  "video.render_job": { active: "Rendering videos", noun: "Video rendering" },
  "video.render_asset": { active: "Rendering video", noun: "Video render" },
  "content.regenerate": { active: "Regenerating draft", noun: "Regeneration" },
  "asset.publish": { active: "Publishing", noun: "Publishing" },
  "asset.unpublish": { active: "Taking down", noun: "Take-down" },
};

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function taskTarget(t: Pick<TaskLike, "payload">): { jobId: string | null; assetId: string | null } {
  return { jobId: str(t.payload.jobId), assetId: str(t.payload.assetId) };
}

/**
 * Human label for a task. `ratio` names the video format for asset renders ("Rendering 9:16…").
 */
export function taskLabel(
  t: Pick<TaskLike, "type" | "status" | "attempts" | "maxAttempts" | "lastError">,
  ctx: { ratio?: string | null } = {},
): string {
  const n = NOUNS[t.type] ?? { active: "Working", noun: t.type };
  const active = t.type === "video.render_asset" && ctx.ratio ? `Rendering ${ctx.ratio}` : n.active;
  switch (t.status) {
    case "running":
      return `${active}…`;
    case "queued":
      return t.attempts > 0 && t.lastError
        ? `${active} — retrying (attempt ${t.attempts + 1} of ${t.maxAttempts})…`
        : `${n.noun} queued…`;
    case "failed":
      return `${t.type === "video.render_asset" && ctx.ratio ? `${ctx.ratio} render` : n.noun} failed — retry`;
    default:
      return `${n.noun} done`;
  }
}

/**
 * Visible task states: the latest task per (type, target). A failure that was followed by a successful run of
 * the same work is history, not something to show; a newer queued/running task replaces an older failure.
 */
export function visibleTaskStates(
  tasks: readonly TaskLike[],
  ratios: Readonly<Record<string, string>> = {},
): TaskState[] {
  const latest = new Map<string, TaskLike>();
  for (const t of tasks) {
    const { jobId, assetId } = taskTarget(t);
    const key = `${t.type}:${assetId ?? jobId ?? t.id}`;
    const prev = latest.get(key);
    if (!prev || t.createdAt > prev.createdAt) latest.set(key, t);
  }
  const out: TaskState[] = [];
  for (const t of latest.values()) {
    if (t.status === "done") continue;
    const { jobId, assetId } = taskTarget(t);
    out.push({
      taskId: t.id,
      type: t.type,
      status: t.status,
      jobId,
      assetId,
      label: taskLabel(t, { ratio: assetId ? ratios[assetId] : null }),
      error: t.status === "failed" || t.attempts > 0 ? t.lastError : null,
      retrying: t.status === "queued" && t.attempts > 0,
      createdAt: t.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type BackgroundSummary<T extends TaskState = TaskState> = { running: number; queued: number; failed: T[] };

export function summariseBackground<T extends TaskState>(states: readonly T[]): BackgroundSummary<T> {
  return {
    running: states.filter((s) => s.status === "running").length,
    queued: states.filter((s) => s.status === "queued").length,
    failed: states.filter((s) => s.status === "failed"),
  };
}

/** True while something on the page is still moving, so the client poller keeps refreshing. */
export function hasActiveWork(states: readonly Pick<TaskState, "status">[]): boolean {
  return states.some((s) => s.status === "queued" || s.status === "running");
}
