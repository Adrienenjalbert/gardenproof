import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { BottomTabs, SideNav } from "@/components/dashboard/nav";
import { ModeBadges } from "@/components/dashboard/mode-badges";
import { Toaster } from "@/components/dashboard/toaster";
import { Icon } from "@/components/ui/icons";
import { getShellInfo } from "@/lib/dashboard/queries";

// Operator data changes constantly (crew uploads, homeowner replies): always render fresh.
export const dynamic = "force-dynamic";

function Logo() {
  return (
    <span className="grid size-8 place-items-center rounded-[10px] bg-olive font-display text-[15px] font-bold text-leaf shadow-sm">
      G
    </span>
  );
}

export default async function DashboardLayout({ children }: LayoutProps<"/ops">) {
  const info = await getShellInfo();
  return (
    <div className="min-h-dvh w-full lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-[#f6f5ee] px-4 py-5 lg:flex">
        <Link href="/ops" className="mb-7 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="min-w-0">
            <span className="block font-display text-[15px] leading-tight text-olive-dark">GardenProof</span>
            <span className="block truncate text-xs text-muted">{info.tenantName}</span>
          </span>
        </Link>

        <SideNav reviewCount={info.reviewCount} heldCount={info.heldCount} />

        <p className="mt-8 mb-2 px-3 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Elsewhere</p>
        <ul className="space-y-0.5 text-sm">
          {[
            { href: "/", label: "Owner app", icon: "home" as const },
            { href: "/simulator", label: "WhatsApp simulator", icon: "phone" as const },
            { href: "/portfolio", label: "Portfolio", icon: "globe" as const },
          ].map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="group flex h-9 items-center gap-3 rounded-lg px-3 text-olive-dark/80 hover:bg-olive-50 hover:text-olive-dark"
              >
                <Icon name={l.icon} size={17} className="text-muted group-hover:text-olive" />
                <span className="flex-1">{l.label}</span>
                <Icon name="external" size={13} className="text-stone-400 opacity-0 group-hover:opacity-100" />
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-3 border-t border-line px-2 pt-4">
          <ModeBadges info={info} />
          {info.authEnabled && (
            <form action={logoutAction}>
              <button type="submit" className="flex items-center gap-2 text-xs text-muted hover:text-foreground">
                <Icon name="logout" size={14} /> Sign out
              </button>
            </form>
          )}
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/ops" className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <span className="min-w-0">
            <span className="block font-display text-[15px] leading-tight text-olive-dark">GardenProof</span>
            <span className="block truncate text-[11px] text-muted">{info.tenantName}</span>
          </span>
        </Link>
        <ModeBadges info={info} compact />
      </header>

      <main className="min-w-0 px-4 pt-6 pb-28 sm:px-6 lg:px-12 lg:pt-10 lg:pb-16">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>

      <BottomTabs reviewCount={info.reviewCount} heldCount={info.heldCount} />
      <Toaster />
    </div>
  );
}
