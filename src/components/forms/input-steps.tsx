"use client";
/** Steps that need a little typing (kept to the minimum), plus photo upload. */
import { useEffect, useRef, useState } from "react";
import { normalisePostcode } from "@/lib/forms/engine";
import type { ContactStep, LongTextStep, PhotosStep, PhotoValue, PostcodeValue, TextStep } from "@/lib/forms/types";
import { isError, postcodeApi, uploadPhotoApi } from "./api";
import { compressImage } from "./compress";
import { Glyph } from "./glyphs";
import { photoUrl } from "./view";

const field =
  "w-full rounded-[18px] border-[1.5px] border-black/[0.09] bg-white px-4 text-[17px] text-[#16180f] outline-none transition placeholder:text-black/30 focus:border-[var(--b)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--b)_14%,transparent)]";

export function TextStepView({ step, value, onDraft, onEnter }: { step: TextStep; value: string | undefined; onDraft: (v: string) => void; onEnter: () => void }) {
  return (
    <input
      autoFocus
      className={`${field} h-[60px]`}
      value={value ?? ""}
      maxLength={step.maxLength}
      placeholder={step.placeholder}
      inputMode={step.inputMode}
      autoComplete={step.autoComplete}
      aria-label={step.title}
      onChange={(e) => onDraft(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );
}

export function LongTextStepView({ step, value, onDraft }: { step: LongTextStep; value: string | undefined; onDraft: (v: string) => void }) {
  const len = (value ?? "").length;
  return (
    <div>
      <textarea
        autoFocus
        rows={5}
        className={`${field} min-h-[150px] resize-none py-3.5 leading-relaxed`}
        value={value ?? ""}
        maxLength={step.maxLength}
        placeholder={step.placeholder}
        aria-label={step.title}
        onChange={(e) => onDraft(e.target.value)}
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-black/50">
        {step.voiceHint ? (
          <span className="flex items-center gap-1.5">
            <Glyph name="mic" className="h-4 w-4 text-[var(--b)]" /> Rather talk? Tap the microphone on your keyboard.
          </span>
        ) : (
          <span />
        )}
        {len > step.maxLength * 0.7 && <span className="tabular-nums">{step.maxLength - len} left</span>}
      </div>
    </div>
  );
}

type PostcodeDraft = { postcode: string };

export function PostcodeStepView(props: { token: string; value: PostcodeDraft | undefined; onDraft: (v: PostcodeDraft) => void; onEnter: () => void; error?: string }) {
  const raw = props.value?.postcode ?? "";
  const valid = normalisePostcode(raw);
  const [place, setPlace] = useState<{ for: string; value: PostcodeValue | null; error?: string } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await postcodeApi(props.token, valid);
      if (!live) return;
      setPlace(isError(res) ? { for: valid, value: null, error: res.error } : { for: valid, value: res.place });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [valid, props.token]);

  const shown = place && place.for === valid ? place : null;
  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--b)]">
          <Glyph name="pin" className="h-6 w-6" />
        </span>
        <input
          autoFocus
          className={`${field} h-[68px] pl-12 text-[24px] font-semibold uppercase tracking-[0.08em] placeholder:font-normal placeholder:normal-case placeholder:tracking-normal`}
          value={raw}
          maxLength={9}
          placeholder="e.g. SW19 5AB"
          autoComplete="postal-code"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Postcode"
          aria-invalid={!!props.error || undefined}
          onChange={(e) => props.onDraft({ postcode: e.target.value.toUpperCase() })}
          onKeyDown={(e) => e.key === "Enter" && props.onEnter()}
        />
      </div>
      <div className="mt-3 min-h-[64px]" aria-live="polite">
        {shown?.value && (
          <div className="gp-rise flex items-start gap-3 rounded-[18px] bg-[var(--b-soft)] px-4 py-3.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--b)] text-[var(--b-ink)]">
              <Glyph name="check" className="h-4 w-4" strokeWidth={3} />
            </span>
            <span className="text-[15px] leading-snug text-[#16180f]">
              <strong className="font-semibold">{[shown.value.area, shown.value.district !== shown.value.area ? shown.value.district : null].filter(Boolean).join(", ") || shown.value.postcode}</strong>
              <span className="block text-black/60">{shown.value.inArea ? "Lovely, that's right in our patch." : "A little outside our usual area, but we'll gladly take a look."}</span>
            </span>
          </div>
        )}
        {shown?.error && !props.error && <p className="text-[14px] text-[#9a3b1f]">{shown.error}</p>}
      </div>
    </div>
  );
}

type ContactDraft = { firstName: string; lastName: string; phone: string; email: string; consent: boolean };

export function ContactStepView(props: { step: ContactStep; value: Partial<ContactDraft> | undefined; prefilled: boolean; onDraft: (v: ContactDraft) => void; errorPath?: string; error?: string; onEnter: () => void }) {
  const v: ContactDraft = { firstName: "", lastName: "", phone: "", email: "", consent: false, ...props.value };
  const set = (patch: Partial<ContactDraft>) => props.onDraft({ ...v, ...patch });
  const bad = (p: string) => props.errorPath === p;
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && props.onEnter();
  return (
    <div className="flex flex-col gap-3">
      {props.prefilled && <p className="-mt-1 mb-1 text-[14px] text-black/55">We&apos;ve filled in what we know. Just check it&apos;s right.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-black/60">First name</span>
          <input className={`${field} h-[58px]`} value={v.firstName} autoComplete="given-name" autoCapitalize="words" aria-invalid={bad("firstName") || undefined} onChange={(e) => set({ firstName: e.target.value })} onKeyDown={enter} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-black/60">
            Last name <span className="font-normal text-black/40">(optional)</span>
          </span>
          <input className={`${field} h-[58px]`} value={v.lastName} autoComplete="family-name" autoCapitalize="words" onChange={(e) => set({ lastName: e.target.value })} onKeyDown={enter} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-black/60">Mobile</span>
        <input
          className={`${field} h-[58px] tabular-nums tracking-wide`}
          value={v.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="07…"
          aria-invalid={bad("phone") || undefined}
          onChange={(e) => set({ phone: e.target.value })}
          onKeyDown={enter}
        />
      </label>
      {props.step.askEmail && (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-black/60">
            Email <span className="font-normal text-black/40">(optional)</span>
          </span>
          <input className={`${field} h-[58px]`} value={v.email} type="email" inputMode="email" autoComplete="email" onChange={(e) => set({ email: e.target.value })} onKeyDown={enter} />
        </label>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={v.consent}
        onClick={() => set({ consent: !v.consent })}
        className={`gp-press mt-1 flex items-start gap-3 rounded-[18px] border-[1.5px] px-4 py-3.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${
          v.consent ? "border-[var(--b)] bg-[var(--b-soft)]" : bad("consent") ? "border-[#c2410c]/60 bg-white" : "border-black/[0.08] bg-white"
        }`}
      >
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[1.5px] ${v.consent ? "border-[var(--b)] bg-[var(--b)] text-[var(--b-ink)]" : "border-black/25"}`}>
          {v.consent && <Glyph name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span className="text-[14.5px] leading-snug text-[#16180f]">{props.step.consentText}</span>
      </button>
      <p className="flex items-center gap-1.5 text-[12.5px] text-black/45">
        <Glyph name="lock" className="h-3.5 w-3.5" /> Only used to reply to you. Never shared, never published.
      </p>
    </div>
  );
}

type Upload = { key: string; preview: string; photo?: PhotoValue; error?: string };

export function PhotosStepView(props: { token: string; step: PhotosStep; value: PhotoValue[] | undefined; onDraft: (v: PhotoValue[]) => void; onBusy: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>(() => (props.value ?? []).map((p) => ({ key: p.id, preview: photoUrl(props.token, p.id), photo: p })));
  // Parent callbacks change identity every render; keep the latest in a ref so the effect runs per upload change only.
  const parent = useRef({ onDraft: props.onDraft, onBusy: props.onBusy });
  useEffect(() => {
    parent.current = { onDraft: props.onDraft, onBusy: props.onBusy };
  });
  const first = useRef(true);
  useEffect(() => {
    parent.current.onBusy(uploads.some((u) => !u.photo && !u.error));
    if (first.current) {
      first.current = false;
      return;
    }
    parent.current.onDraft(uploads.flatMap((u) => (u.photo ? [u.photo] : [])));
  }, [uploads]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const room = props.step.max - uploads.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, Math.max(0, room));
    const fresh: Upload[] = picked.map((f, i) => ({ key: `${Date.now()}-${i}`, preview: URL.createObjectURL(f) }));
    setUploads((u) => [...u, ...fresh]);
    await Promise.all(
      picked.map(async (file, i) => {
        const res = await uploadPhotoApi(props.token, await compressImage(file));
        setUploads((current) => current.map((u) => (u.key === fresh[i].key ? (isError(res) ? { ...u, error: res.error } : { ...u, photo: res.photo }) : u)));
      }),
    );
  }

  function remove(key: string) {
    setUploads((current) => current.filter((u) => u.key !== key));
  }

  const full = uploads.length >= props.step.max;
  return (
    <div>
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      {uploads.length === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="gp-press flex h-[210px] w-full flex-col items-center justify-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-[var(--b)]/45 bg-[var(--b-soft)] text-[var(--b-dark)] outline-none transition hover:border-[var(--b)] focus-visible:ring-4 focus-visible:ring-[var(--b)]/30"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--b)] text-[var(--b-ink)] shadow-lg shadow-black/10">
            <Glyph name="camera" className="h-7 w-7" />
          </span>
          <span className="text-[17px] font-semibold">Add photos</span>
          <span className="text-[13px] text-black/50">Up to {props.step.max}, straight from your camera roll</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {uploads.map((u) => (
            <div key={u.key} className="gp-rise relative aspect-square overflow-hidden rounded-2xl bg-black/5">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob or token-scoped photo */}
              <img src={u.preview} alt="" className={`h-full w-full object-cover transition ${u.photo ? "" : "opacity-60"}`} />
              {!u.photo && !u.error && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-white/40 border-t-white" />
                </span>
              )}
              {u.error && <span className="absolute inset-x-0 bottom-0 bg-[#9a3b1f]/90 px-2 py-1 text-[11px] leading-tight text-white">{u.error}</span>}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => remove(u.key)}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
              >
                <Glyph name="x" className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {!full && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              aria-label="Add more photos"
              className="gp-press flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed border-[var(--b)]/45 bg-[var(--b-soft)] text-[var(--b)]"
            >
              <Glyph name="camera" className="h-6 w-6" />
              <span className="text-[12px] font-semibold">Add</span>
            </button>
          )}
        </div>
      )}
      {props.step.tips && (
        <ul className="mt-4 space-y-1.5">
          {props.step.tips.map((t) => (
            <li key={t} className="flex items-center gap-2 text-[13.5px] text-black/55">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--b)]" /> {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
