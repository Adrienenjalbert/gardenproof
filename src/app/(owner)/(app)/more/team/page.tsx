import type { Metadata } from "next";
import { TeamEditor } from "@/components/owner/team-editor";
import { BackLink, LargeTitle, Page } from "@/components/owner/ui";
import { listTeam } from "@/lib/owner/team";
import { getOwnerContext } from "@/lib/owner/tenant";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { tenant } = await getOwnerContext();
  const members = await listTeam(tenant.id);
  return (
    <Page>
      <div className="pt-3 lg:hidden">
        <BackLink href="/more" label="More" />
      </div>
      <LargeTitle title="Team" />
      <TeamEditor members={members} />
      <p className="mt-6 px-4 text-[13px] leading-relaxed text-(--ink2)">
        Crew send photos and voice notes to the business WhatsApp number. Crew leads also get a note before each visit
        and start.
      </p>
    </Page>
  );
}
