"use client";
/** One chat bubble. "mine" = sent by the persona holding the phone; the rest are from the business. */
import type { SimMessage } from "@/app/api/simulator/_shared";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Linkify URLs (the homeowner review link) without dangerouslySetInnerHTML. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all font-medium text-olive underline decoration-leaf decoration-2 underline-offset-2">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Media({ url }: { url: string }) {
  const isAudio = /\.(ogg|mp3|m4a|aac|amr|webm|wav)$/i.test(url);
  if (isAudio) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-black/[0.04] px-2 py-1.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-olive text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12h-2z" /></svg>
        </span>
        <audio controls src={url} className="h-8 w-[200px] max-w-full" preload="none" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="max-h-72 min-h-40 w-full rounded-xl bg-black/5 object-cover" />;
}

const STATUS_NOTE: Record<string, { label: string; tone: string }> = {
  held: { label: "Held for approval (safe mode): the customer hasn't received this yet", tone: "bg-amber-50 text-amber-900 ring-amber-200" },
  cancelled: { label: "Not delivered", tone: "bg-stone-100 text-stone-600 ring-stone-200" },
  failed: { label: "Delivery failed", tone: "bg-red-50 text-red-800 ring-red-200" },
};

export function Bubble(props: {
  m: SimMessage;
  mine: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
}) {
  const { m, mine } = props;
  const note = STATUS_NOTE[m.status];
  const held = m.status === "held";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      {/* min width keeps media-only bubbles from collapsing before their image loads */}
      <div
        className={`relative max-w-[82%] ${m.mediaUrls.length ? "w-[70%]" : ""} px-2.5 pb-1.5 pt-1.5 text-[14.5px] leading-snug text-[#1f2117] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] ${
          mine ? "rounded-2xl rounded-tr-md bg-[#e2eac4]" : "rounded-2xl rounded-tl-md bg-white"
        } ${held ? "outline-2 outline-dashed outline-amber-400/80" : ""} ${m.status === "cancelled" ? "opacity-60" : ""}`}
      >
        {m.mediaUrls.length > 0 && (
          <div className={`mb-1 grid gap-1 ${m.mediaUrls.length > 1 ? "grid-cols-2" : ""}`}>
            {m.mediaUrls.map((u) => (
              <Media key={u} url={u} />
            ))}
          </div>
        )}
        {m.body && (
          <p className={`whitespace-pre-wrap px-1 ${mine ? "pr-[4.5rem]" : "pr-12"}`}>
            <RichText text={m.body} />
          </p>
        )}
        <span className="absolute bottom-1 right-2.5 text-[10.5px] text-black/40">
          {time(m.createdAt)}
          {mine && <span className="ml-1 text-olive">✓✓</span>}
        </span>
        {!m.body && <span className="block h-3" />}
        {note && (
          <div className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium ring-1 ${note.tone}`}>
            {note.label}
            {m.error && m.status !== "held" ? ` (${m.error})` : ""}
            {held && props.onApprove && (
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" onClick={props.onApprove} className="rounded-full bg-olive px-3 py-1 text-[11.5px] text-white hover:bg-olive-dark">
                  Agency: approve &amp; send
                </button>
                <button type="button" onClick={props.onCancel} className="rounded-full bg-white px-3 py-1 text-[11.5px] text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** WhatsApp-style reply buttons under the latest business message. Old ones stay visible but inert. */
export function QuickReplies(props: { options: SimMessage["options"]; active: boolean; onPick: (id: string, title: string) => void }) {
  return (
    <div className={`ml-0 mr-auto mt-1 w-[82%] overflow-hidden rounded-2xl bg-white/95 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] ${props.active ? "" : "opacity-50"}`}>
      {props.options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          disabled={!props.active}
          onClick={() => props.onPick(o.id, o.title)}
          className={`flex w-full items-center justify-center gap-2 px-3 py-2.5 text-[14.5px] font-medium text-olive transition enabled:hover:bg-olive-50 enabled:active:bg-olive-100 ${i ? "border-t border-black/[0.07]" : ""}`}
        >
          <span className="text-[11px] font-semibold text-olive/45">{i + 1}</span>
          {o.title}
        </button>
      ))}
    </div>
  );
}
