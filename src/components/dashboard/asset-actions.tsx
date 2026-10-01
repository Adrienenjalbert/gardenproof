"use client";
/** Review actions for one asset: approve / reject / regenerate / edit (and re-render for videos). */
import { useState } from "react";
import type { AssetStatus, AssetType } from "@/lib/domain";
import {
  approveAssetAction,
  regenerateAssetAction,
  rejectAssetAction,
  rerenderVideoAction,
} from "@/lib/dashboard/actions";
import { Button } from "@/components/ui/primitives";
import { ActionButton, NoteActionButton } from "./action-button";
import { AssetEditor } from "./asset-editor";

export function AssetActions({
  assetId,
  type,
  status,
  version,
  content,
  blockedReason,
  busyLabel = null,
}: {
  assetId: string;
  type: AssetType;
  status: AssetStatus;
  version: number;
  content: Record<string, unknown>;
  /** Set when a consent or privacy check failed: approval is refused, so the button explains why. */
  blockedReason: string | null;
  /** Background work in flight on this asset ("Publishing…"): pipeline buttons wait for it. */
  busyLabel?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const published = status === "published";

  if (editing) {
    return <AssetEditor assetId={assetId} type={type} version={version} content={content} onClose={() => setEditing(false)} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!published && (
        <ActionButton
          action={() => approveAssetAction(assetId)}
          variant="primary"
          icon="check"
          disabled={!!blockedReason || !!busyLabel}
          title={blockedReason ?? busyLabel ?? (status === "approved" ? "Queue publishing again" : "Approve and publish")}
          pendingLabel="Approving…"
        >
          {busyLabel ?? (status === "approved" ? "Publish again" : "Approve")}
        </ActionButton>
      )}
      <Button icon="edit" onClick={() => setEditing(true)}>
        Edit
      </Button>
      {!published && status !== "rejected" && (
        <NoteActionButton
          action={(note) => rejectAssetAction({ assetId, note })}
          variant="danger"
          icon="x"
          prompt="What's wrong with it?"
          placeholder="e.g. Don't mention the pergola — it was the client's own."
          submitLabel="Reject"
          required
        >
          Reject
        </NoteActionButton>
      )}
      <NoteActionButton
        action={(note) => regenerateAssetAction({ assetId, note })}
        variant="ghost"
        icon="refresh"
        prompt="Anything the new draft should do differently? (optional)"
        placeholder="e.g. Lead with the brick band, shorter captions."
        submitLabel="Regenerate"
        disabled={!!busyLabel || published}
      >
        Regenerate
      </NoteActionButton>
      {type === "video" && (
        <ActionButton
          action={() => rerenderVideoAction(assetId)}
          variant="ghost"
          icon="film"
          pendingLabel="Queuing…"
          disabled={!!busyLabel}
        >
          Re-render video
        </ActionButton>
      )}
    </div>
  );
}
