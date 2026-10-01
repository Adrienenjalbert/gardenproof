"use client";
/** Dashboard navigation: left rail on desktop, bottom tab bar on phones. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";

type Item = { href: string; label: string; icon: IconName; count?: number };

function isActive(pathname: string, href: string) {
  return href === "/ops" ? pathname === "/ops" : pathname === href || pathname.startsWith(`${href}/`);
}

function items(reviewCount: number, heldCount: number): Item[] {
  return [
    { href: "/ops", label: "Overview", icon: "home" },
    { href: "/ops/jobs", label: "Jobs", icon: "jobs" },
    { href: "/ops/review", label: "Review", icon: "review", count: reviewCount },
    { href: "/ops/messages", label: "Messages", icon: "message", count: heldCount },
    { href: "/ops/leads", label: "Leads", icon: "leads" },
  ];
}

export function SideNav({ reviewCount, heldCount }: { reviewCount: number; heldCount: number }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items(reviewCount, heldCount).map((it) => {
        const on = isActive(pathname, it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                on ? "bg-olive text-white shadow-sm" : "text-olive-dark/80 hover:bg-olive-50 hover:text-olive-dark",
              )}
            >
              <Icon name={it.icon} size={17} className={on ? "text-leaf" : "text-muted group-hover:text-olive"} />
              <span className="flex-1 font-medium">{it.label}</span>
              {!!it.count && (
                <span
                  className={cx(
                    "rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums",
                    on ? "bg-white/15 text-white" : "bg-amber-100 text-amber-900",
                  )}
                >
                  {it.count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomTabs({ reviewCount, heldCount }: { reviewCount: number; heldCount: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items(reviewCount, heldCount).map((it) => {
          const on = isActive(pathname, it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  on ? "text-olive-dark" : "text-muted",
                )}
              >
                <span className={cx("grid h-7 w-12 place-items-center rounded-full transition-colors", on && "bg-olive-100")}>
                  <Icon name={it.icon} size={19} />
                </span>
                {it.label}
                {!!it.count && (
                  <span className="absolute top-1.5 left-1/2 ml-2.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">
                    {it.count}
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
