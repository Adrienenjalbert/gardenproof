import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/dashboard/action-button";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { Card, EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { approveMessageAction, cancelMessageAction } from "@/lib/dashboard/actions";
import { formatDate, pluralise, timeAgo } from "@/lib/dashboard/logic";
import { getHeldMessages, getRecentOutbound, type HeldMessageView } from "@/lib/dashboard/queries";
import { env, isSimulatorMessaging } from "@/lib/config";

export const metadata: Metadata = { title: "Messages" };

function Recipient({ m }: { m: HeldMessageView }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium">{m.recipientName ?? "Unknown recipient"}</span>
      <span className="block truncate text-xs text-muted">
        <span className="font-mono">{m.toNumber}</span>
        {m.jobTitle && m.jobId && (
          <>
            {" · "}
            <Link href={`/ops/jobs/${m.jobId}`} className="hover:text-foreground hover:underline">
              {m.jobTitle}
            </Link>
          </>
        )}
      </span>
    </span>
  );
}

export default async function MessagesPage() {
  const [held, recent] = await Promise.all([getHeldMessages(), getRecentOutbound()]);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Messages"
        title={held.length ? `${pluralise(held.length, "message")} held for approval` : "Outbox"}
        description="Every message to a homeowner waits here until you approve it. Crew messages send straight away."
      />

      <div
        className={
          env.safeMode
            ? "flex items-start gap-3 rounded-2xl bg-olive-dark px-5 py-4 text-white"
            : "flex items-start gap-3 rounded-2xl bg-red-50 px-5 py-4 text-red-900 ring-1 ring-red-200"
        }
      >
        <Icon name={env.safeMode ? "shieldCheck" : "alert"} size={20} className={env.safeMode ? "mt-0.5 shrink-0 text-leaf" : "mt-0.5 shrink-0"} />
        <div className="text-sm leading-relaxed">
          <p className="font-medium">{env.safeMode ? "Safe mode is on" : "Safe mode is off"}</p>
          <p className={env.safeMode ? "text-white/75" : ""}>
            {env.safeMode
              ? "Customer messages are held, never sent automatically. Opt-outs (STOP) are re-checked when you approve."
              : "Customer messages send immediately. Set SAFE_MODE=on to hold them for approval."}
            {isSimulatorMessaging() && " Messages are delivered to the WhatsApp simulator, not real phones."}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader title="Held" />
        {held.length ? (
          <ul className="grid gap-4 lg:grid-cols-2">
            {held.map((m) => (
              <li key={m.id}>
                <Card className="flex h-full flex-col p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-olive-50 font-display text-olive">
                      {(m.recipientName ?? "?").charAt(0)}
                    </span>
                    <Recipient m={m} />
                    <span className="ml-auto shrink-0 text-xs text-muted" title={formatDate(m.createdAt, true)}>
                      {timeAgo(m.createdAt)}
                    </span>
                  </div>
                  <div className="flex-1 rounded-2xl rounded-tl-md bg-[#e7f6d8] px-4 py-3 text-[14px] leading-relaxed whitespace-pre-line text-[#1f2a17]">
                    {m.mediaUrls.length > 0 && (
                      // The homeowner sees these photos with the message, so the operator approves them too.
                      <span className="mb-3 flex gap-2">
                        {m.mediaUrls.slice(0, 3).map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
                            <Photo src={u} alt="Photo sent with this message" className="size-24" />
                          </a>
                        ))}
                      </span>
                    )}
                    {m.body}
                    {m.options.length > 0 && (
                      <span className="mt-3 flex flex-wrap gap-1.5">
                        {m.options.map((o) => (
                          <span key={o.id} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-sky-800 ring-1 ring-sky-100">
                            {o.title}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <ActionButton action={cancelMessageAction.bind(null, m.id)} variant="ghost" icon="x" confirm="Cancel this message? It will never be sent.">
                      Cancel
                    </ActionButton>
                    <ActionButton action={approveMessageAction.bind(null, m.id)} variant="primary" icon="send" pendingLabel="Sending…">
                      Approve & send
                    </ActionButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="message" title="Nothing held" compact>
            Review requests and replies to homeowners will wait here for you.
          </EmptyState>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader title="Recently sent" description="Last 25 outbound messages that left the outbox." />
        {recent.length ? (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {recent.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:px-5">
                  <div className="sm:w-56 sm:shrink-0">
                    <Recipient m={m} />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm text-foreground/80">{m.body}</p>
                  <div className="flex items-center gap-3 sm:shrink-0">
                    <StatusPill kind="message" status={m.status} />
                    <span className="w-24 text-right text-xs text-muted" title={formatDate(m.createdAt, true)}>
                      {timeAgo(m.createdAt)}
                    </span>
                  </div>
                  {m.error && <p className="text-xs text-red-700 sm:basis-full">{m.error}</p>}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState icon="send" title="Nothing sent yet" compact />
        )}
      </section>
    </div>
  );
}
