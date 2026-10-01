import Link from "next/link";
import { ToastHost } from "@/components/owner/feedback";
import { OIcon } from "@/components/owner/icons";
import { SideNav, TabBar } from "@/components/owner/nav";
import { BusinessMark } from "@/components/owner/business-mark";
import { getShowcaseBadge } from "@/lib/owner/badges";
import { getOwnerContext } from "@/lib/owner/tenant";

export default async function OwnerShell({ children }: LayoutProps<"/">) {
  const [{ brand }, showcase] = await Promise.all([getOwnerContext(), getShowcaseBadge()]);
  const badges = { "/showcase": showcase };
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-(--sep) px-4 pt-7 pb-5 lg:flex">
        <Link href="/" className="mb-8 flex items-center gap-3 px-2">
          <BusinessMark brand={brand} size={40} />
          <span className="min-w-0 text-[16px] leading-tight font-semibold text-(--ink)">{brand.name}</span>
        </Link>
        <SideNav badges={badges} />
        <div className="mt-auto px-3">
          <a href="/ops" className="inline-flex items-center gap-1.5 text-[13px] text-(--ink3) hover:text-(--ink2)">
            <OIcon name="shield" size={14} /> Agency view
          </a>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
      <TabBar badges={badges} />
      <ToastHost />
    </div>
  );
}
