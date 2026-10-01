"use client";
/**
 * Keyboard-first review queue: j/k to move, a to approve, r to reject (with note), o/Enter to open.
 * Bulk approve only ever touches assets whose automated checks ALL pass; the server re-checks and reports every
 * skipped asset with its reason. Approval queues publishing in the background.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AssetType } from "@/lib/domain";
import { approveAssetAction, bulkApproveAction, rejectAssetAction } from "@/lib/dashboard/actions";
import { allChecksPass, approvalBlockers, checkSummary, type Check } from "@/lib/dashboard/logic";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { Button, Kbd, Textarea, cx } from "@/components/ui/primitives";
import { ASSET_TYPE_META } from "./asset-meta";
import { toast } from "./toaster";

export type QueueItem = {
  id: string;
  type: AssetType;
  title: string;
  excerpt: string;
  checks: Check[];
  jobId: string | null;
  jobTitle: string;
  jobCode: string | null;
  coverUrl: string | null;
  version: number;
};

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const groups = useMemo(() => {
    const map = new Map<string, { jobId: string | null; jobTitle: string; jobCode: string | null; coverUrl: string | null; items: QueueItem[] }>();
    for (const it of items) {
      const key = it.jobId ?? "_none";
      const g = map.get(key) ?? { jobId: it.jobId, jobTitle: it.jobTitle, jobCode: it.jobCode, coverUrl: it.coverUrl, items: [] };
      g.items.push(it);
      map.set(key, g);
    }
    return [...map.values()];
  }, [items]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const passing = useMemo(() => flat.filter((i) => allChecksPass(i.checks)).map((i) => i.id), [flat]);
  // Items leave the queue as they're approved, so the cursor is clamped on read rather than synced in an effect.
  const index = Math.min(cursor, Math.max(flat.length - 1, 0));
  const current = flat[index];

  const approve = useCallback(
    (it: QueueItem) => {
      const blockers = approvalBlockers(it.checks);
      if (blockers.length) {
        toast({ ok: false, error: `Can't approve: ${blockers.map((b) => b.message).join("; ")}. Open the asset to fix it.` });
        return;
      }
      setBusy(it.id);
      start(async () => {
        toast(await approveAssetAction(it.id));
        setBusy(null);
      });
    },
    [start],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!flat.length) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor(Math.min(index + 1, flat.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor(Math.max(index - 1, 0));
      } else if (e.key === "a" && current) {
        e.preventDefault();
        approve(current);
      } else if (e.key === "r" && current) {
        e.preventDefault();
        setRejecting(current.id);
      } else if ((e.key === "o" || e.key === "Enter") && current?.jobId) {
        e.preventDefault();
        router.push(`/ops/jobs/${current.jobId}?tab=assets#asset-${current.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, index, current, approve, router]);

  // Keep the selected row visible as the cursor moves.
  useEffect(() => {
    if (current) rowRefs.current[current.id]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-line">
        <p className="hidden items-center gap-3 text-xs text-muted md:flex">
          <Icon name="keyboard" size={15} />
          <span className="flex items-center gap-1">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>a</Kbd> approve
          </span>
          <span className="flex items-center gap-1">
            <Kbd>r</Kbd> reject
          </span>
          <span className="flex items-center gap-1">
            <Kbd>o</Kbd> open
          </span>
        </p>
        <Button
          variant="primary"
          icon="check"
          disabled={!passing.length || pending}
          onClick={() => {
            const held = flat.length - passing.length;
            const note = held ? `\n\n${held} with a failing check will be left for you to review one by one.` : "";
            if (!window.confirm(`Approve and publish ${passing.length} assets whose checks all pass?${note}`)) return;
            start(async () => toast(await bulkApproveAction(passing)));
          }}
          className="w-full sm:w-auto"
        >
          Approve {passing.length} passing checks
        </Button>
      </div>

      {groups.map((g) => (
        <section key={g.jobId ?? "none"} id={g.jobId ? `job-${g.jobId}` : undefined} className="scroll-mt-24">
          <header className="mb-3 flex items-center gap-3">
            <Photo src={g.coverUrl} alt="" className="size-10 rounded-lg" />
            <div className="min-w-0">
              <h2 className="truncate font-display text-[17px]">
                {g.jobId ? <Link href={`/ops/jobs/${g.jobId}?tab=assets`} className="hover:underline">{g.jobTitle}</Link> : g.jobTitle}
              </h2>
              <p className="text-xs text-muted">
                {g.jobCode && <span className="font-mono">{g.jobCode} · </span>}
                {g.items.length} waiting
              </p>
            </div>
          </header>
          <ul className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            {g.items.map((it) => {
              const selected = current?.id === it.id;
              const s = checkSummary(it.checks);
              const blocked = approvalBlockers(it.checks).length > 0;
              const meta = ASSET_TYPE_META[it.type];
              return (
                <li
                  key={it.id}
                  ref={(el) => {
                    rowRefs.current[it.id] = el;
                  }}
                  onClick={() => setCursor(flat.indexOf(it))}
                  aria-current={selected ? "true" : undefined}
                  className={cx(
                    "relative border-b border-line px-4 py-3.5 transition-colors last:border-b-0 sm:px-5",
                    selected ? "bg-olive-50/80" : "hover:bg-stone-50/60",
                    busy === it.id && "opacity-50",
                  )}
                >
                  {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-olive" />}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-olive-50 text-olive">
                        <Icon name={meta.icon} size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                          {it.title}
                          <span className="text-xs font-normal text-muted">
                            {meta.label} · v{it.version}
                          </span>
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{it.excerpt}</p>
                        <p
                          className={cx(
                            "mt-1.5 inline-flex items-center gap-1 text-xs font-medium",
                            blocked ? "text-red-700" : s.failed ? "text-amber-700" : "text-lime-700",
                          )}
                        >
                          <Icon name={blocked ? "x" : s.failed ? "alert" : "check"} size={12} strokeWidth={2.5} />
                          {blocked
                            ? "Privacy or consent check failed — can't approve"
                            : s.failed
                              ? s.failed === 1 ? "1 check needs a look" : `${s.failed} checks need a look`
                              : `All ${s.total} checks pass`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
                      <Button size="sm" variant="primary" icon="check" disabled={blocked || busy === it.id} onClick={() => approve(it)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" icon="x" onClick={() => setRejecting(it.id)}>
                        Reject
                      </Button>
                      {it.jobId && (
                        <Link
                          href={`/ops/jobs/${it.jobId}?tab=assets#asset-${it.id}`}
                          className="grid size-8 place-items-center rounded-lg text-muted ring-1 ring-line hover:bg-white hover:text-foreground"
                          aria-label="Open asset"
                        >
                          <Icon name="chevronRight" size={16} />
                        </Link>
                      )}
                    </div>
                  </div>
                  {rejecting === it.id && (
                    <form
                      className="mt-3 sm:ml-11"
                      onSubmit={(e) => {
                        e.preventDefault();
                        start(async () => {
                          const r = await rejectAssetAction({ assetId: it.id, note });
                          toast(r);
                          if (r.ok) {
                            setRejecting(null);
                            setNote("");
                          }
                        });
                      }}
                    >
                      <Textarea
                        autoFocus
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRejecting(null);
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder="Why? The note goes to the next draft. Enter to reject, Esc to cancel."
                        aria-label="Rejection note"
                      />
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
