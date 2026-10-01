/**
 * Background-task state from the durable queue: "Generating content…", "Rendering 9:16…",
 * "Publishing failed — retry" with a Retry button. Server-component safe; the retry button is a client island.
 */
import type { TaskState } from "@/lib/dashboard/task-view";
import { retryTaskAction } from "@/lib/dashboard/actions";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { ActionButton } from "./action-button";

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

/** One line per task; `tone="dark"` for use over photos (job header). */
export function TaskLine({ task, tone = "light" }: { task: Pick<TaskState, "taskId" | "status" | "label" | "error" | "retrying">; tone?: "light" | "dark" }) {
  const failed = task.status === "failed";
  return (
    <div
      role="status"
      className={cx(
        "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl px-3 py-2 text-[13px]",
        tone === "dark"
          ? failed
            ? "bg-red-600/90 text-white"
            : "bg-white/15 text-white backdrop-blur"
          : failed
            ? "bg-red-50 text-red-800 ring-1 ring-red-200"
            : "bg-olive-50 text-olive-dark ring-1 ring-olive-100",
      )}
    >
      {failed ? <Icon name="alert" size={15} /> : <Spinner className={task.status === "queued" ? "opacity-50" : ""} />}
      <span className="font-medium">{task.label}</span>
      {task.error && (
        <span className={cx("min-w-0 basis-full truncate text-xs sm:basis-auto sm:flex-1", tone === "dark" ? "text-white/80" : "opacity-80")} title={task.error}>
          {task.error}
        </span>
      )}
      {failed && (
        <ActionButton
          action={retryTaskAction.bind(null, task.taskId)}
          size="sm"
          variant={tone === "dark" ? "secondary" : "danger"}
          icon="refresh"
          pendingLabel="Queuing…"
          className="ml-auto"
        >
          Retry
        </ActionButton>
      )}
    </div>
  );
}

export function TaskLines({ tasks, tone }: { tasks: Pick<TaskState, "taskId" | "status" | "label" | "error" | "retrying">[]; tone?: "light" | "dark" }) {
  if (!tasks.length) return null;
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskLine key={t.taskId} task={t} tone={tone} />
      ))}
    </div>
  );
}
