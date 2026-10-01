"use client";
/**
 * What happened on a job, newest first. Milestones, photos, replies and reviews show; the routine messages we
 * sent fold into one line ("12 messages sent · Show") so the story of the job reads at a glance.
 */
import { useState } from "react";
import type { TimelineIcon, TimelineItem } from "@/lib/owner/jobs";
import { OIcon, type OwnerIconName } from "./icons";

const ICON: Record<TimelineIcon, { icon: OwnerIconName; tint: string }> = {
  flag: { icon: "flag", tint: "var(--accent)" },
  camera: { icon: "camera", tint: "#ff9f0a" },
  send: { icon: "send", tint: "#34c759" },
  reply: { icon: "reply", tint: "#0a84ff" },
  form: { icon: "form", tint: "#5e5ce6" },
  star: { icon: "star", tint: "#f5a623" },
  page: { icon: "globe", tint: "#0a84ff" },
  video: { icon: "video", tint: "#ff375f" },
  mic: { icon: "mic", tint: "#8e8e93" },
  clock: { icon: "clock", tint: "#8e8e93" },
};

export function Timeline({ items: all }: { items: TimelineItem[] }) {
  const [showMessages, setShowMessages] = useState(false);
  if (!all.length)
    return <p className="px-1 text-[15px] text-(--ink2)">Nothing yet.</p>;
  const sent = all.filter((it) => it.icon === "send").length;
  const items =
    showMessages || sent === all.length
      ? all
      : all.filter((it) => it.icon !== "send");
  return (
    <>
      <ol className="relative">
        {items.map((it, i) => (
          <li key={it.id} className="relative flex gap-3.5 pb-6 last:pb-0">
            {i < items.length - 1 && (
              <span
                aria-hidden
                className="absolute top-9 bottom-1 left-[15px] w-px bg-(--sep)"
              />
            )}
            <span
              className="relative z-[1] grid size-[31px] shrink-0 place-items-center rounded-full text-white ring-4 ring-(--bg)"
              style={{ background: ICON[it.icon].tint }}
            >
              <OIcon name={ICON[it.icon].icon} size={16} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[16px] leading-snug font-medium text-(--ink)">
                  {it.title}
                </p>
                <time
                  dateTime={it.at}
                  className="shrink-0 text-[13px] text-(--ink3)"
                >
                  {it.ago}
                </time>
              </div>
              {it.detail && (
                <p className="mt-1 line-clamp-3 text-[15px] leading-snug whitespace-pre-line text-(--ink2)">
                  {it.detail}
                </p>
              )}
              {it.photos && (
                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  {it.photos.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={src}
                      src={src}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-[10px] object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {sent > 0 && sent < all.length && (
        <button
          type="button"
          onClick={() => setShowMessages((v) => !v)}
          className="mt-5 ml-[45px] text-[15px] font-medium text-(--accent)"
        >
          {showMessages
            ? "Hide the messages we sent"
            : `${sent} ${sent === 1 ? "message" : "messages"} sent · Show`}
        </button>
      )}
    </>
  );
}
