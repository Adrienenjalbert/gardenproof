"use client";
/**
 * The decision cards on Today: at most three, most important first. Each has one primary action; "Later"
 * (or a swipe) hides it until tomorrow on this device. Done cards slide away at once.
 */
import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { approveManyAction, approvePageAction } from "@/lib/owner/actions";
import type { CardAction, DecisionCard } from "@/lib/owner/today-logic";
import { Spinner, useOwnerAction } from "./feedback";
import { OIcon } from "./icons";
import { buttonClass, cx, Thumb } from "./ui";

const MAX = 3;
const key = () => `owner:later:${new Date().toISOString().slice(0, 10)}`;

/** "Later" is a per-device convenience (localStorage), read through an external store so SSR stays stable. */
let memoryLater = "[]";
const LATER_EVENT = "owner:later";
function laterSnapshot(): string {
  try {
    return localStorage.getItem(key()) ?? memoryLater;
  } catch {
    return memoryLater; // private mode: "later" just lasts for this visit
  }
}
function subscribeLater(cb: () => void) {
  window.addEventListener(LATER_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LATER_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function setLater(ids: Set<string>) {
  memoryLater = JSON.stringify([...ids]);
  try {
    localStorage.setItem(key(), memoryLater);
  } catch {
    /* kept in memory */
  }
  window.dispatchEvent(new Event(LATER_EVENT));
}

export function TodayCards({ cards }: { cards: DecisionCard[] }) {
  const raw = useSyncExternalStore(subscribeLater, laterSnapshot, () => "[]");
  const later = useMemo(() => new Set(JSON.parse(raw) as string[]), [raw]);
  const [gone, setGone] = useState<Set<string>>(new Set());

  const visible = cards.filter((c) => !later.has(c.id) && !gone.has(c.id)).slice(0, MAX);
  const hiddenCount = cards.filter((c) => later.has(c.id)).length;

  const snooze = (id: string) => {
    setLater(new Set(later).add(id));
  };

  if (!visible.length)
    return (
      <AllClear
        snoozed={hiddenCount}
        onShow={() => {
          setLater(new Set());
        }}
      />
    );
  return (
    <div className="space-y-3.5">
      {visible.map((c, i) => (
        <Card
          key={c.id}
          card={c}
          index={i}
          onLater={() => snooze(c.id)}
          onDone={() => setGone((g) => new Set(g).add(c.id))}
        />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setLater(new Set())}
          className="w-full py-2 text-center text-[14px] text-(--ink2)"
        >
          {hiddenCount} set aside for later · Show
        </button>
      )}
    </div>
  );
}

function AllClear({ snoozed, onShow }: { snoozed: number; onShow: () => void }) {
  return (
    <div className="anim-rise overflow-hidden rounded-[24px] bg-(--card) px-6 py-10 text-center shadow-(--shadow)">
      <div className="relative mx-auto mb-5 size-[76px]">
        <span className="absolute inset-0 rounded-full bg-(--accent-soft)" />
        <span className="absolute inset-[14px] grid place-items-center rounded-full bg-(--accent) text-(--accent-ink)">
          <OIcon name="check" size={26} strokeWidth={2.4} />
        </span>
      </div>
      <p className="font-title text-[22px] font-semibold text-(--ink)">You&rsquo;re all caught up</p>
      <p className="mx-auto mt-1.5 max-w-[28ch] text-[15px] leading-relaxed text-(--ink2)">
        Nothing needs you right now. Messages, reminders and follow-ups are taken care of.
      </p>
      {snoozed > 0 && (
        <button type="button" onClick={onShow} className="mt-4 text-[15px] font-medium text-(--accent)">
          Show {snoozed} set aside
        </button>
      )}
    </div>
  );
}

function Card({
  card,
  index,
  onLater,
  onDone,
}: {
  card: DecisionCard;
  index: number;
  onLater: () => void;
  onDone: () => void;
}) {
  const { pending, run } = useOwnerAction();
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<null | "later" | "done">(null);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; locked: boolean | null } | null>(null);

  const leave = (why: "later" | "done") => {
    setLeaving(why);
    setTimeout(why === "later" ? onLater : onDone, 260);
  };

  const act = (a: CardAction) => {
    if (a.kind === "approve")
      run(
        () => approveManyAction({ ids: a.ids, done: a.done }),
        (ok) => ok && leave("done"),
      );
    if (a.kind === "approve_page")
      run(
        () => approvePageAction(a.assetId),
        (ok) => ok && leave("done"),
      );
  };

  // Swipe left to set aside (horizontal intent only; vertical scroll is never hijacked).
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, locked: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.locked === null && Math.abs(mx) + Math.abs(my) > 8) {
      s.locked = Math.abs(mx) > Math.abs(my);
      setDragging(s.locked);
    }
    if (s.locked) setDx(Math.min(0, mx));
  };
  const onPointerUp = () => {
    if (start.current?.locked && dx < -110) leave("later");
    else setDx(0);
    start.current = null;
    setDragging(false);
  };

  const shift = leaving ? (leaving === "later" ? -420 : 0) : dx;
  return (
    <div className="relative" style={{ animationDelay: `${index * 60}ms` }}>
      {dx < -10 && (
        <div className="absolute inset-0 flex items-center justify-end rounded-[24px] bg-(--fill) pr-7 text-[15px] font-semibold text-(--ink2)">
          <OIcon name="clock" size={20} className="mr-1.5" /> Later
        </div>
      )}
      <article
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cx(
          "anim-rise relative overflow-hidden rounded-[24px] bg-(--card) shadow-(--shadow) touch-pan-y",
          !dragging && "transition-[transform,opacity] duration-300 ease-out",
        )}
        style={{
          transform: `translateX(${shift}px) ${leaving === "done" ? "scale(0.96)" : ""}`,
          opacity: leaving ? 0 : 1,
        }}
      >
        {card.photo && card.primary.kind === "link" && card.eyebrow === "Showcase" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photo} alt="" className="aspect-[16/9] w-full object-cover" />
        )}
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-(--accent) uppercase">
              {card.eyebrow}
            </span>
            <button
              type="button"
              onClick={() => leave("later")}
              className="-mr-2 rounded-full px-2 py-1 text-[14px] text-(--ink3) hover:text-(--ink2)"
            >
              Later
            </button>
          </div>
          <Wrap href={card.href}>
            <div className="flex items-center gap-3.5">
              {card.icon ? (
                <span className="grid size-[52px] shrink-0 place-items-center rounded-[14px] bg-(--accent-soft) text-(--accent)">
                  <OIcon name={card.icon} size={26} />
                </span>
              ) : (
                !(card.photo && card.eyebrow === "Showcase") && (
                  <Thumb src={card.photo} label={card.monogram} size={52} radius={14} />
                )
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-(--ink)">{card.title}</h3>
                <p className="mt-0.5 text-[15px] leading-snug text-(--ink2)">{card.detail}</p>
              </div>
            </div>
          </Wrap>
          {card.preview && (
            <p className="mt-3.5 line-clamp-2 rounded-[14px] bg-(--fill2) px-3.5 py-2.5 text-[15px] leading-snug text-(--ink2)">
              &ldquo;{card.preview}&rdquo;
            </p>
          )}
          <div className="mt-4 flex gap-2.5">
            <Primary action={card.primary} pending={pending} onAct={act} />
            {card.secondary && (
              <a href={card.secondary.href} className={buttonClass("gray", "md")} aria-label={card.secondary.label}>
                <OIcon name={card.secondary.icon === "phone" ? "phone" : "chat"} size={19} />
                {card.secondary.label}
              </a>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

function Wrap({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className="block rounded-[14px] outline-offset-4">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

function Primary({ action, pending, onAct }: { action: CardAction; pending: boolean; onAct: (a: CardAction) => void }) {
  const cls = cx(buttonClass("primary", "md"), "flex-1");
  if (action.kind === "link") {
    return action.external || /^(https?:|tel:)/.test(action.href) ? (
      <a href={action.href} target={action.external ? "_blank" : undefined} rel="noreferrer" className={cls}>
        {action.label}
      </a>
    ) : (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={() => onAct(action)} className={cls}>
      {pending ? <Spinner /> : action.label}
    </button>
  );
}
