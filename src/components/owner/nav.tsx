"use client";
/** Owner navigation: bottom tab bar on phones, sidebar on desktop. Four places, nothing else. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OIcon, type OwnerIconName } from "./icons";
import { cx } from "./ui";

const TABS: { href: string; label: string; icon: OwnerIconName }[] = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/jobs", label: "Jobs", icon: "jobsStack" },
  { href: "/showcase", label: "Showcase", icon: "showcase" },
  { href: "/more", label: "More", icon: "more" },
];

const active = (path: string, href: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

export function TabBar({ badges }: { badges: Partial<Record<string, number>> }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-(--sep) bg-(--blur-bg) backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
    >
      <ul className="mx-auto grid h-[56px] max-w-[520px] grid-cols-4">
        {TABS.map((t) => {
          const on = active(path, t.href);
          const n = badges[t.href];
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative flex h-full flex-col items-center justify-center gap-[3px] text-[10.5px] font-medium tracking-[0.01em] transition-colors",
                  on ? "text-(--accent)" : "text-(--ink3)",
                )}
              >
                <OIcon name={t.icon} size={25} strokeWidth={on ? 2 : 1.7} />
                {t.label}
                {!!n && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] rounded-full bg-(--red) px-1 text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums">
                    {n}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({ badges }: { badges: Partial<Record<string, number>> }) {
  const path = usePathname();
  return (
    <ul className="space-y-1">
      {TABS.map((t) => {
        const on = active(path, t.href);
        const n = badges[t.href];
        return (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "flex h-11 items-center gap-3 rounded-[12px] px-3 text-[16px] transition-colors",
                on ? "bg-(--accent-soft) font-semibold text-(--accent)" : "text-(--ink) hover:bg-(--fill2)",
              )}
            >
              <OIcon name={t.icon} size={22} strokeWidth={on ? 2 : 1.7} />
              <span className="flex-1">{t.label}</span>
              {!!n && (
                <span className="min-w-[22px] rounded-full bg-(--red) px-1.5 text-center text-[12px] leading-[22px] font-semibold text-white tabular-nums">
                  {n}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
