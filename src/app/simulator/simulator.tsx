"use client";
/** Phone-style chat against the real bot, with a persona picker and a live tap counter. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Persona, SimMessage } from "@/app/api/simulator/_shared";
import { Bubble, QuickReplies } from "./bubble";
import { Composer, type Outgoing } from "./composer";

const POLL_MS = 1500;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const CREW_SCRIPT = [
  "Tap the paperclip and send a before still. No words needed: a job starts.",
  "Tap the service, then the area.",
  "Send a voice note with the brief, or tap Next.",
  "Tap Finish job. The bot sends back your first before photo as a framing guide.",
  "Send an after still, optionally a voice note, then tap Done.",
  "Share the homeowner's contact (paperclip → Homeowner contact) or type their mobile, or tap Skip.",
];

type Chat = { messages: SimMessage[]; optedOut: boolean };

async function fetchChat(phone: string): Promise<Chat | null> {
  const res = await fetch(`/api/simulator/state?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as Chat;
  return { messages: data.messages, optedOut: data.optedOut };
}

export function Simulator(props: { tenantName: string; personas: Persona[]; stills: string[]; initialPhone: string; safeMode: boolean }) {
  const [phone, setPhone] = useState(props.initialPhone);
  const [chat, setChat] = useState<Chat>({ messages: [], optedOut: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taps, setTaps] = useState<Record<string, { taps: number; media: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const persona = props.personas.find((p) => p.phone === phone) ?? props.personas[0];

  const selectPersona = (next: string) => {
    if (next === phone) return;
    lastCount.current = 0;
    setChat({ messages: [], optedOut: false });
    setPhone(next);
  };

  const refresh = useCallback(() => {
    void fetchChat(phone).then((c) => c && setChat(c));
  }, [phone]);

  // Poll: the bot may answer later (deferred work) and held messages change when approved.
  useEffect(() => {
    let alive = true;
    const load = () => fetchChat(phone).then((c) => alive && c && setChat(c));
    void load();
    const id = setInterval(load, POLL_MS);
    const url = new URL(window.location.href);
    url.searchParams.set("phone", phone);
    window.history.replaceState(null, "", url);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [phone]);

  useEffect(() => {
    if (chat.messages.length !== lastCount.current) {
      const first = lastCount.current === 0;
      lastCount.current = chat.messages.length;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: first ? "auto" : "smooth" });
    }
  }, [chat.messages.length]);

  async function send(o: Outgoing & { choiceId?: string }) {
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set("phone", phone);
    if (o.text) form.set("text", o.text);
    if (o.choiceId) form.set("choiceId", o.choiceId);
    o.files?.forEach((f) => form.append("file", f));
    o.demo?.forEach((d) => form.append("demo", d));
    const media = (o.files?.length ?? 0) + (o.demo?.length ?? 0);
    setTaps((t) => {
      const cur = t[phone] ?? { taps: 0, media: 0 };
      return { ...t, [phone]: media ? { ...cur, media: cur.media + media } : { ...cur, taps: cur.taps + 1 } };
    });
    try {
      const res = await fetch("/api/simulator/send", { method: "POST", body: form });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Send failed");
    } finally {
      setSending(false);
      refresh();
    }
  }

  async function action(body: Record<string, string>) {
    setNotice(null);
    const res = await fetch("/api/simulator/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; jobCode?: string };
    if (!res.ok) setNotice(json.error ?? "Failed");
    else if (body.action === "request_review") setNotice(json.ok ? `Review request created for ${json.jobCode}.` : `No request sent for ${json.jobCode} (no phone or opted out).`);
    refresh();
  }

  const lastOptionsIdx = (() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].direction === "out") return chat.messages[i].options.length ? i : -1;
    return -1;
  })();
  const counter = taps[phone] ?? { taps: 0, media: 0 };
  const isCustomer = persona?.kind === "customer";

  return (
    <div className="flex min-h-svh flex-1 flex-col bg-[#e9e6dc] lg:h-svh lg:min-h-0 lg:flex-none lg:flex-row lg:items-stretch lg:overflow-hidden">
      {/* Side panel */}
      <aside className="order-2 border-t border-line bg-background px-5 py-6 lg:order-1 lg:w-[380px] lg:flex-none lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-8 lg:py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">GardenProof</p>
        <h1 className="mt-1 font-display text-2xl text-olive-dark">WhatsApp simulator</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          The real capture bot, without a phone. Pick who&apos;s holding the phone and chat exactly as a crew member or customer would.
        </p>

        <h2 className="mt-7 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Who&apos;s holding the phone</h2>
        <ul className="mt-2 space-y-1.5">
          {props.personas.map((p) => (
            <li key={p.phone}>
              <button
                type="button"
                onClick={() => selectPersona(p.phone)}
                aria-pressed={p.phone === phone}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${p.phone === phone ? "bg-olive text-white shadow-md" : "hover:bg-olive-50"}`}
              >
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-semibold ${p.phone === phone ? "bg-white/15" : p.kind === "crew" ? "bg-olive-100 text-olive-dark" : p.kind === "customer" ? "bg-[#f1ead8] text-[#7a5c1e]" : "bg-stone-200 text-stone-600"}`}>
                  {p.kind === "unknown" ? "?" : initials(p.name)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium">{p.name}</span>
                  <span className={`block truncate text-[12px] ${p.phone === phone ? "text-white/70" : "text-muted"}`}>{p.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {persona?.kind === "crew" && (
          <div className="mt-7 rounded-3xl bg-white p-5 ring-1 ring-line">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-olive-dark">Capture in under a minute</h2>
            </div>
            <ol className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-foreground/80">
              {CREW_SCRIPT.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-olive-50 text-[11px] font-semibold text-olive">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-center gap-4 rounded-2xl bg-olive-50 px-4 py-3">
              <div>
                <p className="font-display text-2xl text-olive-dark" data-testid="tap-count">{counter.taps}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted">taps</p>
              </div>
              <div>
                <p className="font-display text-2xl text-olive-dark">{counter.media}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted">photos &amp; notes</p>
              </div>
              <p className="ml-auto max-w-[120px] text-[11.5px] leading-snug text-muted">Target: a full job in 8 taps or fewer.</p>
            </div>
            <p className="mt-3 text-[12px] text-muted">Type <b>help</b>, <b>status</b>, <b>switch job</b> or <b>cancel</b> any time, or a job code such as TL-6254.</p>
          </div>
        )}

        {isCustomer && (
          <div className="mt-7 rounded-3xl bg-white p-5 ring-1 ring-line">
            <h2 className="font-display text-lg text-olive-dark">The homeowner side</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/80">
              When a crew taps Done, the homeowner gets a warm message with a link to rate the job and choose what we may share.
              {props.safeMode && " Safe mode is on: customer messages wait for agency approval before they go out."}
            </p>
            <button type="button" onClick={() => action({ action: "request_review", phone })} className="mt-4 w-full rounded-full bg-olive px-4 py-2.5 text-[14px] font-medium text-white hover:bg-olive-dark">
              Simulate: their job is finished
            </button>
            <p className="mt-3 text-[12px] text-muted">Reply <b>STOP</b> to opt out (and <b>START</b> to undo). Other replies are forwarded to the owner.</p>
          </div>
        )}
        {notice && <p className="mt-3 rounded-2xl bg-olive-50 px-4 py-2.5 text-[13px] text-olive-dark" role="status">{notice}</p>}
      </aside>

      {/* Phone */}
      <section className="order-1 flex flex-1 items-start justify-center lg:order-2 lg:items-center lg:py-8">
        <div className="flex h-svh w-full flex-col overflow-hidden bg-[#efebe1] lg:h-[min(820px,calc(100svh-4rem))] lg:w-[400px] lg:rounded-[44px] lg:shadow-[0_40px_90px_-30px_rgba(47,50,34,0.55)] lg:ring-[10px] lg:ring-[#1c1d15]">
          <header className="flex flex-none items-center gap-3 bg-olive-dark px-4 pb-3 pt-4 text-white lg:pt-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/thorburn-logo.jpg" alt="" className="h-10 w-10 rounded-full bg-white object-contain" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15.5px] font-semibold">{props.tenantName}</p>
              <p className="truncate text-[12px] text-white/65">
                {isCustomer ? "Business account" : "Job capture · business account"}
              </p>
            </div>
            <label className="lg:hidden">
              <span className="sr-only">Persona</span>
              <select value={phone} onChange={(e) => selectPersona(e.target.value)} className="max-w-[130px] rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] text-white outline-none">
                {props.personas.map((p) => (
                  <option key={p.phone} value={p.phone} className="text-black">
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden rounded-full bg-white/10 px-3 py-1 text-[11.5px] text-white/80 lg:inline">as {persona?.name}</span>
          </header>

          <div
            ref={scroller}
            className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4"
            style={{ backgroundImage: "radial-gradient(rgba(70,74,51,0.07) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
            aria-live="polite"
          >
            <p className="mx-auto mb-3 w-fit max-w-[85%] rounded-lg bg-[#fdf6dc] px-3 py-1.5 text-center text-[11.5px] leading-snug text-[#6d5a24] shadow-sm">
              Simulator · messages are real (stored in the database) but nothing leaves this app.
            </p>
            {chat.optedOut && (
              <p className="mx-auto w-fit rounded-lg bg-stone-200 px-3 py-1 text-[11.5px] text-stone-700">Opted out (STOP). Nothing will be delivered to this number.</p>
            )}
            {chat.messages.length === 0 && (
              <p className="mx-auto mt-10 max-w-[260px] text-center text-[13.5px] leading-relaxed text-black/45">
                {persona?.kind === "crew" ? "Say hi, or just send the before photos." : "No messages yet."}
              </p>
            )}
            {chat.messages.map((m, i) => (
              <div key={m.id} className={i > 0 && chat.messages[i - 1].direction !== m.direction ? "pt-2" : ""}>
                <Bubble
                  m={m}
                  mine={m.direction === "in"}
                  onApprove={() => action({ action: "approve", messageId: m.id })}
                  onCancel={() => action({ action: "cancel", messageId: m.id })}
                />
                {m.direction === "out" && m.options.length > 0 && (
                  <QuickReplies options={m.options} active={i === lastOptionsIdx && !sending} onPick={(id, title) => send({ choiceId: id, text: title })} />
                )}
              </div>
            ))}
            {sending && (
              <div className="flex justify-start pt-1">
                <span className="flex gap-1 rounded-2xl rounded-tl-md bg-white px-3 py-2.5 shadow-sm" aria-label="Bot is typing">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-olive/50" style={{ animationDelay: `${d * 120}ms` }} />
                  ))}
                </span>
              </div>
            )}
          </div>

          {error && <p className="bg-red-50 px-4 py-2 text-[12.5px] text-red-800" role="alert">{error}</p>}
          <Composer stills={props.stills} disabled={sending} onSend={(o) => send(o)} />
        </div>
      </section>
    </div>
  );
}
