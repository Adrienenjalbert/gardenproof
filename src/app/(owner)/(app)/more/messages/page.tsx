import type { Metadata } from "next";
import { StyleForm } from "@/components/owner/settings-forms";
import { BackLink, LargeTitle, Page } from "@/components/owner/ui";
import { getOwnerContext } from "@/lib/owner/tenant";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesStylePage() {
  const { settings, brand, ownerName } = await getOwnerContext();
  return (
    <Page>
      <div className="pt-3 lg:hidden">
        <BackLink href="/more" label="More" />
      </div>
      <LargeTitle title="Messages" />
      <StyleForm initial={settings.style} defaultSignature={ownerName ? `${ownerName}, ${brand.name}` : brand.name} />
    </Page>
  );
}
