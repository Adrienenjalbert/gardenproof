"use client";
/**
 * Showcase: pages, videos and reviews. One tap to approve or hide. Problems read as a sentence with, when there
 * is one, a single button that fixes it.
 */
import Link from "next/link";
import { useState } from "react";
import {
  approvePageAction,
  approveVideosAction,
  hideAssetsAction,
  sendHeldRequestAction,
  sendNowAction,
} from "@/lib/owner/actions";
import type { Fix, Showcase, ShowPage, ShowReview, ShowState, ShowVideo } from "@/lib/owner/showcase";
import { Spinner, useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { buttonClass, cx, Empty, Pill } from "./ui";

type Tab = "pages" | "videos" | "reviews";

const TONE: Record<ShowState, "gray" | "accent" | "amber" | "green" | "red"> = {
  ready: "accent",
  going_live: "green",
  live: "green",
  hidden: "gray",
  making: "gray",
  blocked: "amber",
};

export function ShowcaseView({
  data,
  websiteProjects,
}: {
  data: Showcase;
  websiteProjects: { title: string; image: string | null; url: string }[];
}) {
  const [tab, setTab] = useState<Tab>("pages");


  return (
    <div>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        className="mb-6"
        options={[
          { value: "pages", label: "Pages" },
          { value: "videos", label: "Videos" },
          { value: "reviews", label: "Reviews" },
        ]}
      />
      {tab === "pages" && (
        <div className="space-y-5">
          {data.pages.length ? (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              {data.pages.map((p) => (
                <PageCard key={p.id} page={p} />
              ))}
            </div>
          ) : (
            <Empty icon="globe" title="No project pages yet">
              When a job is finished and the homeowner says yes, its page appears here for you to check.
            </Empty>
          )}
          {websiteProjects.length > 0 && (
            <section className="pt-4">
              <p className="mb-2 px-1 text-[13px] text-(--ink2)">Already on your website · {websiteProjects.length}</p>
              <div className="rail -mx-4 flex snap-x gap-3 overflow-x-auto px-4">
                {websiteProjects.map((p) => (
                  <a
                    key={p.url}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="press w-[168px] shrink-0 snap-start"
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full rounded-[14px] object-cover"
                      />
                    ) : (
                      <div className="aspect-[4/3] w-full rounded-[14px] bg-(--fill)" />
                    )}
                    <p className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-(--ink)">{p.title}</p>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {tab === "videos" &&
        (data.videos.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.videos.map((v) => (
              <VideoTile key={v.id} video={v} />
            ))}
          </div>
        ) : (
          <Empty icon="video" title="No videos yet">
            Videos are made from the crew&rsquo;s photos once a job is finished.
          </Empty>
        ))}
      {tab === "reviews" &&
        (data.reviews.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.reviews.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        ) : (
          <Empty icon="star" title="No reviews yet">
            After each finished job we ask the homeowner. Their words land here.
          </Empty>
        ))}
    </div>
  );
}

function FixButton({ fix }: { fix: Fix }) {
  const { pending, run } = useOwnerAction();
  if (fix.kind === "open_job") {
    return (
      <Link href={fix.href} className={buttonClass("tinted", "sm")}>
        {fix.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        run(() => (fix.kind === "send_request" ? sendHeldRequestAction(fix.messageId) : sendNowAction(fix.scheduledId)))
      }
      className={buttonClass("primary", "sm")}
    >
      {pending ? <Spinner size={15} /> : fix.label}
    </button>
  );
}

function PageCard({ page }: { page: ShowPage }) {
  const approve = useOwnerAction();
  const hide = useOwnerAction();
  const canApprove = page.state === "ready";
  const canHide = page.state === "ready" || page.state === "live" || page.state === "going_live";
  return (
    <article
      id={page.id}
      className="anim-rise scroll-mt-6 overflow-hidden rounded-[24px] bg-(--card) shadow-(--shadow)"
    >
      <div className="relative">
        {page.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.photo}
            alt=""
            className={cx("aspect-[16/10] w-full object-cover", page.state === "hidden" && "opacity-50 grayscale")}
          />
        ) : (
          <div className="aspect-[16/10] w-full bg-(--fill)" />
        )}
        <span className="absolute top-3 left-3">
          <Pill tone={TONE[page.state]} solid>
            {page.state === "live" && <span className="size-1.5 rounded-full bg-current" />}
            {page.stateLabel}
          </Pill>
        </span>
      </div>
      <div className="p-5">
        <h3 className="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-(--ink)">{page.title}</h3>
        {page.numbers && <p className="mt-1 text-[15px] text-(--ink2)">{page.numbers}</p>}
        {page.problem && (
          <div className="mt-3.5 rounded-[16px] bg-(--amber-soft) px-4 py-3">
            <p className="text-[15px] leading-snug text-(--ink)">{page.problem}</p>
            {page.fix && (
              <div className="mt-2.5">
                <FixButton fix={page.fix} />
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex items-center gap-2.5">
          {canApprove && (
            <button
              type="button"
              disabled={approve.pending}
              onClick={() => approve.run(() => approvePageAction(page.id))}
              className={cx(buttonClass("primary", "md"), "flex-1")}
            >
              {approve.pending ? <Spinner /> : "Approve"}
            </button>
          )}
          <a
            href={page.liveUrl ?? page.previewHref}
            target="_blank"
            rel="noreferrer"
            className={cx(buttonClass("gray", "md"), !canApprove && "flex-1")}
          >
            <OIcon name="eye" size={18} />
            {page.liveUrl ? "View" : "Preview"}
          </a>
          {canHide && (
            <button
              type="button"
              disabled={hide.pending}
              onClick={() =>
                hide.run(() =>
                  hideAssetsAction({
                    ids: [page.id],
                    live: page.state !== "ready",
                  }),
                )
              }
              className={buttonClass("gray", "md")}
              aria-label="Hide"
            >
              {hide.pending ? <Spinner /> : <OIcon name="eyeOff" size={19} />}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function VideoTile({ video }: { video: ShowVideo }) {
  const [open, setOpen] = useState(false);
  const approve = useOwnerAction();
  const hide = useOwnerAction();
  const canApprove = video.state === "ready" && video.ids.length > 0;
  return (
    <div id={video.id} className="anim-rise">
      <button
        type="button"
        onClick={() => video.src && setOpen(true)}
        className="press relative block w-full overflow-hidden rounded-[18px] bg-(--fill)"
      >
        {video.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.poster} alt="" className="aspect-[9/16] w-full object-cover" />
        ) : (
          <div className="aspect-[9/16] w-full" />
        )}
        {video.src && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-12 place-items-center rounded-full bg-white/85 text-black shadow-lg backdrop-blur">
              <OIcon name="play" size={20} className="ml-0.5" />
            </span>
          </span>
        )}
        <span className="absolute top-2.5 left-2.5">
          <Pill tone={TONE[video.state]} solid>
            {video.stateLabel}
          </Pill>
        </span>
      </button>
      <p className="mt-2 px-0.5 text-[15px] leading-snug font-semibold text-(--ink)">{video.style}</p>
      <p className="px-0.5 text-[13px] leading-snug text-(--ink2)">{video.problem ?? video.title}</p>
      {canApprove && (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={approve.pending}
            onClick={() => approve.run(() => approveVideosAction(video.ids))}
            className={cx(buttonClass("tinted", "sm"), "flex-1")}
          >
            {approve.pending ? <Spinner size={15} /> : "Approve"}
          </button>
          <button
            type="button"
            disabled={hide.pending}
            onClick={() => hide.run(() => hideAssetsAction({ ids: video.ids, live: false }))}
            className={buttonClass("gray", "sm")}
            aria-label="Hide"
          >
            <OIcon name="eyeOff" size={17} />
          </button>
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={video.style}>
        {video.src && (
          <video
            src={video.src}
            poster={video.poster ?? undefined}
            controls
            autoPlay
            playsInline
            className="mx-auto max-h-[64dvh] rounded-[16px] bg-black"
          />
        )}
      </Sheet>
    </div>
  );
}

function Stars({ n }: { n: number | null }) {
  const v = Math.round(n ?? 0);
  return (
    <span className="inline-flex gap-0.5 text-[#f5a623]" aria-label={`${n ?? "No"} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <OIcon
          key={i}
          name="star"
          size={16}
          strokeWidth={1.6}
          fill={i <= v ? "currentColor" : "none"}
          className={i <= v ? "" : "text-(--ink3)"}
        />
      ))}
    </span>
  );
}

function ReviewCard({ review }: { review: ShowReview }) {
  return (
    <article className="anim-rise rounded-[22px] bg-(--card) px-5 py-4 shadow-(--shadow)">
      <div className="flex items-center justify-between gap-3">
        <Stars n={review.rating} />
        <span className="text-[13px] text-(--ink3)">{review.source}</span>
      </div>
      {review.text && <p className="mt-2.5 text-[16px] leading-relaxed text-(--ink)">&ldquo;{review.text}&rdquo;</p>}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="text-[14px] font-medium text-(--ink2)">{review.who}</p>
        {review.isPrivate && review.note && <Pill>{review.note}</Pill>}
      </div>
    </article>
  );
}
