import type { Metadata } from "next";
import { logoutAction } from "@/app/login/actions";
import { BusinessMark } from "@/components/owner/business-mark";
import { OIcon } from "@/components/owner/icons";
import { Group, LargeTitle, Page, Row, RowDivider } from "@/components/owner/ui";
import { isAuthEnabled } from "@/lib/dashboard/session";
import { listTeam } from "@/lib/owner/team";
import { getOwnerContext } from "@/lib/owner/tenant";
import type { TenantConfig } from "@/lib/tenant";

export const metadata: Metadata = { title: "More" };

const TONE_WORDS = { warm: "Warm", professional: "Professional", brief: "Short & friendly" } as const;

export default async function MorePage() {
  const { tenant, brand, settings } = await getOwnerContext();
  const team = await listTeam(tenant.id);
  const website = tenant.profile?.source.url ?? (tenant.config as TenantConfig).website;
  const digest = settings.notifications.digestHour;
  return (
    <Page>
      <LargeTitle title="More" />
      <Group className="mb-8">
        <div className="flex items-center gap-4 px-4 py-4">
          <BusinessMark brand={brand} size={60} className="rounded-[16px]" />
          <div className="min-w-0">
            <p className="truncate text-[20px] font-semibold text-(--ink)">{brand.name}</p>
            <p className="truncate text-[15px] text-(--ink2)">
              {website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </p>
          </div>
        </div>
      </Group>

      <Group className="mb-8">
        <Row href="/more/team" icon="people" iconTint="#5e5ce6" title="Team" trailing={`${team.length}`} />
        <RowDivider inset={60} />
        <Row href="/more/business" icon="store" iconTint="#ff9f0a" title="Your business" />
      </Group>

      <Group className="mb-8">
        <Row
          href="/more/messages"
          icon="quote"
          iconTint="#34c759"
          title="Messages"
          trailing={TONE_WORDS[settings.style.tone]}
        />
        <RowDivider inset={60} />
        <Row
          href="/more/notifications"
          icon="bell"
          iconTint="#ff3b30"
          title="Notifications"
          trailing={digest === null ? "Instant only" : `Summary at ${digest}:00`}
        />
      </Group>

      <Group className="mb-8">
        <Row
          href="/start"
          icon="sparkles"
          iconTint="var(--accent)"
          title="Set up from your website"
          subtitle="Logo, services, reviews and badges"
        />
      </Group>

      <Group>
        <Row href="/ops" icon="shield" iconTint="#8e8e93" title="Agency view" subtitle="For Adrien" />
        {isAuthEnabled() && (
          <>
            <RowDivider inset={60} />
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left text-[17px] text-(--red)"
              >
                <span className="grid size-[30px] place-items-center rounded-[8px] bg-(--red-soft)">
                  <OIcon name="logout" size={18} />
                </span>
                Sign out
              </button>
            </form>
          </>
        )}
      </Group>
    </Page>
  );
}
