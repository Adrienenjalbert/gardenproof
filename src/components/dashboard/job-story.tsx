import type { JobDetail } from "@/lib/dashboard/queries";
import { formatDate, timeAgo } from "@/lib/dashboard/logic";
import { serviceLabel } from "@/lib/tenant";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, Fact } from "@/components/ui/primitives";

function Chips({ items, tone = "olive" }: { items: string[]; tone?: "olive" | "neutral" }) {
  if (!items.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i} tone={tone}>
          {i}
        </Badge>
      ))}
    </span>
  );
}

const humanEvent = (t: string) => t.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function JobStory({ detail }: { detail: JobDetail }) {
  const { job, media, events, tenantConfig } = detail;
  const e = job.enrichment;
  const transcripts = media.filter((m) => m.kind === "audio" && m.transcript);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="p-5">
          <h3 className="mb-1 font-display text-[17px]">Crew brief</h3>
          <p className="mb-4 text-xs text-muted">What the crew said on WhatsApp — the source of truth for every claim in the copy.</p>
          {job.brief || transcripts.length ? (
            <div className="space-y-3">
              {job.brief && (
                <blockquote className="border-l-2 border-leaf pl-4 text-[15px] leading-relaxed text-foreground/85">{job.brief}</blockquote>
              )}
              {transcripts.map((t) => (
                <blockquote key={t.id} className="border-l-2 border-line pl-4 text-sm leading-relaxed text-foreground/75">
                  <span className="mb-1 flex items-center gap-1.5 text-xs text-muted not-italic">
                    <Icon name="mic" size={13} /> Voice note · {formatDate(t.createdAt, true)}
                  </span>
                  {t.transcript}
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No brief or voice note yet.</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[17px]">Enrichment facts</h3>
            {e && (
              <Badge tone={e.confidence >= 0.7 ? "leaf" : "amber"} title="How sure the AI is about these facts">
                {Math.round(e.confidence * 100)}% confidence
              </Badge>
            )}
          </div>
          {e ? (
            <dl className="divide-y divide-line">
              <Fact label="Service">{serviceLabel(e.service, tenantConfig)}</Fact>
              <Fact label="Sub-services">
                <Chips items={e.subServices} tone="neutral" />
              </Fact>
              <Fact label="Materials">
                <Chips items={e.materials} />
              </Fact>
              <Fact label="Features">
                <Chips items={e.features} />
              </Fact>
              <Fact label="Plants">
                <Chips items={e.plants} />
              </Fact>
              <Fact label="Duration">{e.durationDays ? `${e.durationDays} days` : "—"}</Fact>
              <Fact label="Style">{e.style ?? "—"}</Fact>
              <Fact label="Challenge">{e.challenge ?? "—"}</Fact>
              <Fact label="Result">{e.result ?? "—"}</Fact>
            </dl>
          ) : (
            <EmptyState icon="wand" title="Not enriched yet" compact>
              Facts are extracted from photos and the voice note when the crew taps Done.
            </EmptyState>
          )}
        </Card>
      </div>

      <Card className="h-fit p-5">
        <h3 className="mb-4 font-display text-[17px]">Activity</h3>
        {events.length ? (
          <ol className="relative space-y-4 before:absolute before:top-1 before:bottom-1 before:left-[5px] before:w-px before:bg-line">
            {events.map((ev) => (
              <li key={ev.id} className="relative pl-6 text-sm">
                <span className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-white bg-olive ring-1 ring-line" />
                <p className="font-medium leading-snug">{humanEvent(ev.type)}</p>
                <p className="text-xs text-muted">
                  {ev.actor ?? "system"} · <time title={formatDate(ev.createdAt, true)}>{timeAgo(ev.createdAt)}</time>
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No activity recorded yet.</p>
        )}
      </Card>
    </div>
  );
}
