import type { Asset } from "@/db/schema";
import { approvalBlockers, checkSummary, formatDate, timeAgo } from "@/lib/dashboard/logic";
import type { TaskState } from "@/lib/dashboard/task-view";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { AssetActions } from "./asset-actions";
import { ASSET_TYPE_META } from "./asset-meta";
import { AssetPreview } from "./asset-previews";
import { ChecksList } from "./checks-list";
import { TaskLines } from "./task-status";

/** One asset: type-specific preview on the left, checks + review actions on the right. */
export function AssetCard({
  asset,
  mediaUrls,
  tasks = [],
}: {
  asset: Asset;
  mediaUrls: Record<string, string>;
  /** Background work on this asset (publishing, rendering, regenerating). */
  tasks?: TaskState[];
}) {
  const meta = ASSET_TYPE_META[asset.type];
  const blockers = approvalBlockers(asset.checks);
  const consentBlocked = blockers.some((b) => b.id.startsWith("consent"));
  const summary = checkSummary(asset.checks);
  const blockedReason = blockers.length ? `Blocked: ${blockers.map((b) => b.message).join("; ")}` : null;
  const active = tasks.find((t) => t.status !== "failed");

  return (
    <Card id={`asset-${asset.id}`} className="scroll-mt-24 overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-olive-50 text-olive">
          <Icon name={meta.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase">{meta.label}</p>
          <h3 className="text-[15px] leading-snug font-medium text-foreground sm:truncate">{asset.title}</h3>
        </div>
        <div className="flex w-full items-center gap-2 pl-12 sm:w-auto sm:pl-0">
          <span className="text-xs text-muted tabular-nums" title={`Updated ${formatDate(asset.updatedAt, true)}`}>
            v{asset.version} · {timeAgo(asset.updatedAt)}
          </span>
          <StatusPill kind="asset" status={asset.status} />
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 p-4 sm:p-5">
          <AssetPreview asset={asset} mediaUrls={mediaUrls} />
        </div>
        <aside className="space-y-4 border-t border-line bg-[#fbfaf5] p-4 sm:p-5 lg:border-t-0 lg:border-l">
          <div>
            <p className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
              Checks
              <span className={cx("normal-case tracking-normal", summary.failed ? "text-amber-700" : "text-lime-700")}>
                {summary.total ? `${summary.passed}/${summary.total} passing` : ""}
              </span>
            </p>
            <ChecksList checks={asset.checks} />
          </div>
          <TaskLines tasks={tasks} />
          {blockedReason && (
            <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] leading-snug text-red-800 ring-1 ring-red-200">
              <strong className="font-semibold">Approval blocked.</strong>{" "}
              {consentBlocked
                ? "A consent check failed — this can't go public until the homeowner's consent covers it."
                : "A privacy check failed — edit the text so it names no street, house number or surname."}
            </p>
          )}
          {asset.reviewNotes && (
            <div className="rounded-xl bg-white px-3 py-2.5 text-[13px] ring-1 ring-line">
              <p className="mb-0.5 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">Review note</p>
              {asset.reviewNotes}
            </div>
          )}
          {(asset.externalUrl || asset.publishedAt) && (
            <div className="rounded-xl bg-olive-dark px-3 py-2.5 text-[13px] text-white">
              <p className="flex items-center gap-1.5 font-medium">
                <Icon name="globe" size={14} className="text-leaf" /> Published {formatDate(asset.publishedAt)}
              </p>
              {asset.externalUrl && (
                <a href={asset.externalUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-white/75 underline">
                  {asset.externalUrl}
                </a>
              )}
            </div>
          )}
          {asset.status === "approved" && !asset.externalUrl && !tasks.length && (
            <Badge tone="leaf" icon="clock">
              Approved — waiting to publish
            </Badge>
          )}
        </aside>
      </div>

      <footer className="border-t border-line px-4 py-3.5 sm:px-5">
        <AssetActions
          assetId={asset.id}
          type={asset.type}
          status={asset.status}
          version={asset.version}
          content={asset.content}
          blockedReason={blockedReason}
          busyLabel={active?.label ?? null}
        />
      </footer>
    </Card>
  );
}
