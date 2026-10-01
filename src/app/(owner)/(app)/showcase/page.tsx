import type { Metadata } from "next";
import { ShowcaseView } from "@/components/owner/showcase-view";
import { LargeTitle, Page } from "@/components/owner/ui";
import { getShowcase } from "@/lib/owner/showcase";
import { getOwnerContext } from "@/lib/owner/tenant";
import { publicUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Showcase" };

export default async function ShowcasePage() {
  const [data, { tenant }] = await Promise.all([getShowcase(), getOwnerContext()]);
  const websiteProjects = (tenant.profile?.projects ?? []).slice(0, 12).map((p) => {
    const img = p.images[0];
    return { title: p.title, url: p.url, image: img ? (img.key ? publicUrl(img.key) : img.url) : null };
  });
  return (
    <Page wide>
      <LargeTitle title="Showcase" />
      <ShowcaseView data={data} websiteProjects={websiteProjects} />
    </Page>
  );
}
