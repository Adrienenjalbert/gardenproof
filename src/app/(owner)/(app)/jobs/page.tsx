import type { Metadata } from "next";
import { JobsList } from "@/components/owner/jobs-list";
import { LargeTitle, Page } from "@/components/owner/ui";
import { listOwnerJobs } from "@/lib/owner/jobs";
import { getWeekPlanner } from "@/lib/owner/planner";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  const [items, week] = await Promise.all([listOwnerJobs(), getWeekPlanner()]);
  return (
    <Page>
      <LargeTitle title="Jobs" />
      <JobsList items={items} week={week} />
    </Page>
  );
}
