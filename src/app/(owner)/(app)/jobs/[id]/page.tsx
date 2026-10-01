import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OIcon } from "@/components/owner/icons";
import { NextMessageCard } from "@/components/owner/next-message";
import { StageStepper } from "@/components/owner/stage-stepper";
import { TeamPicker } from "@/components/owner/team-picker";
import { Timeline } from "@/components/owner/timeline";
import { Group, Page, Row, RowDivider, SectionTitle, cx } from "@/components/owner/ui";
import { getOwnerJob, type OwnerJob } from "@/lib/owner/jobs";
import { initials } from "@/lib/owner/words";

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const job = await getOwnerJob((await params).id);
  return { title: job ? `${job.name}${job.area ? `, ${job.area}` : ""}` : "Job" };
}

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const job = await getOwnerJob((await params).id);
  if (!job) notFound();
  return (
    <div>
      {/* Hero: the garden itself, edge to edge on a phone. */}
      <div className="relative mx-auto max-w-[980px] lg:px-10 lg:pt-10">
        <div
          className={cx(
            "relative overflow-hidden lg:rounded-[28px]",
            job.hero ? "aspect-[4/3] lg:aspect-[21/9]" : "h-[220px] lg:h-[240px]",
          )}
        >
          {job.hero ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.hero} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_100%_at_30%_0%,var(--accent-soft),transparent_70%)]">
              <span className="grid size-24 place-items-center rounded-full bg-(--accent) text-[36px] font-semibold text-(--accent-ink) shadow-(--shadow)">
                {initials(job.fullName)}
              </span>
            </div>
          )}
          {job.hero && (
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
          )}
          <Link
            href="/jobs"
            aria-label="Back to jobs"
            className="press absolute top-[max(12px,env(safe-area-inset-top))] left-3 grid size-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md lg:top-4 lg:left-4"
          >
            <OIcon name="chevronLeft" size={22} strokeWidth={2.2} />
          </Link>
          {job.hero && (
            <div className="absolute inset-x-0 bottom-0 px-5 pb-5 text-white lg:px-8 lg:pb-7">
              <h1 className="font-title text-[30px] leading-tight font-bold drop-shadow-sm lg:text-[40px]">
                {job.name}
              </h1>
              <p className="mt-0.5 text-[16px] text-white/85">{[job.service, job.area].filter(Boolean).join(" · ")}</p>
            </div>
          )}
        </div>
      </div>

      <Page wide className="!pt-5">
        {!job.hero && (
          <header className="mb-4 text-center lg:text-left">
            <h1 className="font-title text-[30px] leading-tight font-bold text-(--ink)">{job.name}</h1>
            <p className="mt-0.5 text-[16px] text-(--ink2)">{[job.service, job.area].filter(Boolean).join(" · ")}</p>
          </header>
        )}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10">
          <div className="min-w-0">
            <p className={cx("text-[15px] font-medium text-(--ink2)", !job.hero && "text-center lg:text-left")}>
              {job.statusLine}
            </p>

            {/* Contact actions, like a contact card (in the side column on desktop). */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 lg:hidden">
              <ContactTile href={job.whatsapp} icon="chat" label="WhatsApp" />
              <ContactTile href={job.phone ? `tel:${job.phone}` : null} icon="phone" label="Call" />
            </div>

            <section className="mt-7 lg:mt-5">
              <StageStepper jobId={job.id} stage={job.stage} nextActionAt={job.nextActionAt} />
            </section>

            {job.next && (
              <section className="mt-6">
                <NextMessageCard key={job.next.id + job.next.body} msg={job.next} later={job.laterCount} />
              </section>
            )}

            <div className="lg:hidden">
              <Details job={job} />
            </div>

            <section className="mt-8">
              <SectionTitle>Timeline</SectionTitle>
              <div className="px-1">
                <Timeline items={job.timeline} />
              </div>
            </section>
          </div>

          <aside className="hidden lg:sticky lg:top-8 lg:block">
            <div className="grid grid-cols-2 gap-2.5">
              <ContactTile href={job.whatsapp} icon="chat" label="WhatsApp" />
              <ContactTile href={job.phone ? `tel:${job.phone}` : null} icon="phone" label="Call" />
            </div>
            <Details job={job} />
          </aside>
        </div>
      </Page>
    </div>
  );
}

/** Team, contact details, photos and the crew's notes. */
function Details({ job }: { job: OwnerJob }) {
  return (
    <>
      <section className="mt-6">
        <Group>
          <TeamPicker jobId={job.id} team={job.team} lead={job.crewLead} />
          {job.phonePretty && (
            <>
              <RowDivider inset={60} />
              <Row icon="phone" iconTint="#34c759" title="Mobile" trailing={job.phonePretty} chevron={false} />
            </>
          )}
          {job.valueBand && (
            <>
              <RowDivider inset={60} />
              <Row icon="sparkles" iconTint="#ff9f0a" title="Budget" trailing={job.valueBand} chevron={false} />
            </>
          )}
        </Group>
      </section>

      {job.photos.length > 1 && (
        <section className="mt-8">
          <SectionTitle>Photos</SectionTitle>
          <div className="rail -mx-4 flex snap-x gap-2 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0">
            {job.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.url}
                alt=""
                loading="lazy"
                className="h-40 w-auto shrink-0 snap-start rounded-[14px] object-cover lg:aspect-square lg:h-auto lg:w-full"
              />
            ))}
          </div>
        </section>
      )}

      {job.brief && (
        <section className="mt-8">
          <SectionTitle>From the crew</SectionTitle>
          <p className="rounded-[20px] bg-(--card) px-5 py-4 text-[16px] leading-relaxed text-(--ink) shadow-(--shadow)">
            {job.brief}
          </p>
        </section>
      )}
    </>
  );
}

function ContactTile({ href, icon, label }: { href: string | null; icon: "chat" | "phone"; label: string }) {
  const cls =
    "press flex h-[60px] flex-col items-center justify-center gap-1 rounded-[16px] bg-(--card) text-[13px] font-medium text-(--accent) shadow-(--shadow)";
  if (!href) {
    return (
      <span className={cx(cls, "opacity-40")} aria-disabled>
        <OIcon name={icon} size={22} />
        {label}
      </span>
    );
  }
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls}>
      <OIcon name={icon} size={22} />
      {label}
    </a>
  );
}
