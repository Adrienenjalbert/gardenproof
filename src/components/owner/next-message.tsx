"use client";
/** "Next message": exactly what will go out, to whom and when — with Send now, Edit and Skip. */
import { useState } from "react";
import { editMessageAction, sendNowAction, skipMessageAction } from "@/lib/owner/actions";
import type { NextMessage } from "@/lib/owner/jobs";
import { Spinner, useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { Sheet } from "./sheet";
import { buttonClass, Pill } from "./ui";

export function NextMessageCard({ msg, later }: { msg: NextMessage; later: number }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(msg.body);
  const send = useOwnerAction();
  const skip = useOwnerAction();
  const save = useOwnerAction();
  const waiting = msg.status === "awaiting_approval";

  return (
    <div className="overflow-hidden rounded-[22px] bg-(--card) shadow-(--shadow)">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-[0.02em] text-(--ink2) uppercase">Next message</p>
          <p className="mt-0.5 text-[17px] leading-snug font-semibold text-(--ink)">
            {msg.label} <span className="font-normal text-(--ink2)">to {msg.to}</span>
          </p>
        </div>
        <Pill tone={waiting ? "amber" : "gray"}>
          <OIcon name="clock" size={13} strokeWidth={2.2} />
          {msg.whenText}
        </Pill>
      </div>
      <div className="px-5 pt-3.5">
        <div className="rounded-[18px] rounded-bl-[6px] bg-(--accent-soft) px-4 py-3 text-[15.5px] leading-[1.45] whitespace-pre-line text-(--ink)">
          {msg.body}
        </div>
        {msg.reason && (
          <p className="mt-2.5 flex gap-1.5 text-[14px] leading-snug text-(--ink2)">
            <OIcon name="sparkles" size={15} className="mt-0.5 shrink-0 text-(--accent)" />
            {msg.reason}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 px-5 pt-4 pb-5">
        <button
          type="button"
          disabled={send.pending}
          onClick={() => send.run(() => sendNowAction(msg.id))}
          className={`${buttonClass("primary", "md")} flex-1`}
        >
          {send.pending ? <Spinner /> : waiting ? "Send" : "Send now"}
        </button>
        {msg.canEdit && (
          <button type="button" onClick={() => setEditing(true)} className={buttonClass("gray", "md")}>
            Edit
          </button>
        )}
        <button
          type="button"
          disabled={skip.pending}
          onClick={() => skip.run(() => skipMessageAction(msg.id))}
          className={buttonClass("gray", "md")}
        >
          {skip.pending ? <Spinner /> : "Skip"}
        </button>
      </div>
      {later > 0 && (
        <p className="border-t border-(--sep) px-5 py-3 text-[14px] text-(--ink2)">Then {later} more planned</p>
      )}

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit message"
        footer={
          <button
            type="button"
            disabled={save.pending || !body.trim()}
            onClick={() =>
              save.run(
                () => editMessageAction({ id: msg.id, body }),
                (ok) => ok && setEditing(false),
              )
            }
            className={buttonClass("primary", "lg", true)}
          >
            {save.pending ? <Spinner /> : "Save"}
          </button>
        }
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
          maxLength={1000}
          className="w-full resize-none rounded-[16px] bg-(--fill2) px-4 py-3 text-[17px] leading-relaxed text-(--ink) outline-none ring-1 ring-(--sep) focus:ring-(--accent)"
        />
        <p className="mt-2 text-right text-[13px] text-(--ink3) tabular-nums">{body.length}/1000</p>
      </Sheet>
    </div>
  );
}
