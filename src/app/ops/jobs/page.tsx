import type { Metadata } from "next";
import { Suspense } from "react";
import { JobCard } from "@/components/dashboard/job-card";
import { JobFilters } from "@/components/dashboard/job-filters";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui/primitives";
import { pluralise } from "@/lib/dashboard/logic";
import { listJobs } from "@/lib/dashboard/queries";

export const metadata: Metadata = { title: "Jobs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function JobsPage({ searchParams }: PageProps<"/ops/jobs">) {
  const sp = await searchParams;
  const filters = { status: one(sp.status), service: one(sp.service), area: one(sp.area) };
  const { jobs, facets } = await listJobs(filters);
  const filtered = Boolean(filters.status || filters.service || filters.area);

  return (
    <>
      <PageHeader
        eyebrow="Jobs"
        title="Every job, from first photo to published"
        description={`${pluralise(jobs.length, "job")}${filtered ? " match these filters" : " captured by your crews"}.`}
      />
      <div className="mb-6">
        <Suspense>
          <JobFilters services={facets.services} areas={facets.areas} />
        </Suspense>
      </div>
      {jobs.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="jobs"
          title={filtered ? "No jobs match these filters" : "No jobs yet"}
          action={
            filtered ? (
              <ButtonLink href="/ops/jobs" size="sm">
                Clear filters
              </ButtonLink>
            ) : undefined
          }
        >
          {filtered ? "Try a different status, service or area." : "Crews start a job by sending a photo on WhatsApp."}
        </EmptyState>
      )}
    </>
  );
}
