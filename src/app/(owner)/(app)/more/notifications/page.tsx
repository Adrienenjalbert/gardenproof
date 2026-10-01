import type { Metadata } from "next";
import { NotificationsForm } from "@/components/owner/settings-forms";
import { BackLink, LargeTitle, Page } from "@/components/owner/ui";
import { getOwnerContext } from "@/lib/owner/tenant";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { settings } = await getOwnerContext();
  return (
    <Page>
      <div className="pt-3 lg:hidden">
        <BackLink href="/more" label="More" />
      </div>
      <LargeTitle title="Notifications" />
      <NotificationsForm initial={settings} />
    </Page>
  );
}
