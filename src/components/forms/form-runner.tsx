"use client";
/**
 * One question per screen. Taps advance on their own; every answer is saved the moment it's given (queued in
 * order, optimistic for taps, awaited for postcode/contact which the server normalises). Keyboard: letters pick
 * options, Enter continues. Back never loses anything.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentIndex, isAnswered, validateAnswer, visibleSteps } from "@/lib/forms/engine";
import type { Answers, FormStep } from "@/lib/forms/types";
import { completeApi, isError, saveAnswerApi } from "./api";
import { BudgetStepView, ChoiceStepView, DateStepView, TimeWindowStepView, YesNoStepView } from "./choice-steps";
import { Glyph } from "./glyphs";
import { ContactStepView, LongTextStepView, PhotosStepView, PostcodeStepView, TextStepView } from "./input-steps";
import type { FormView } from "./view";

const AUTO_ADVANCE_MS = 320;
/** Steps the server enriches (postcode lookup, phone normalisation): wait for it before moving on. */
const AWAIT_SERVER = new Set<FormStep["kind"]>(["postcode", "contact", "photos"]);

function autoAdvances(step: FormStep): boolean {
  return (step.kind === "choice" && !step.multiple) || step.kind === "budget" || step.kind === "yesno";
}

function pickables(step: FormStep): unknown[] {
  if (step.kind === "choice" && step.layout !== "photo") return step.options.map((o) => o.value);
  if (step.kind === "budget") return step.options.map((o) => o.value);
  if (step.kind === "yesno") return [true, false];
  if (step.kind === "date") return step.options.map((o) => o.value);
  return [];
}

type Err = { stepId: string; message: string; path?: string } | null;

export function FormRunner({ view }: { view: FormView }) {
  const router = useRouter();
  const { definition: def, brand, token } = view;
  const [answers, setAnswers] = useState<Answers>(view.answers);
  const [drafts, setDrafts] = useState<Answers>({});
  const [stepId, setStepId] = useState<string>(() => {
    const steps = visibleSteps(def, view.answers);
    return steps[Math.min(currentIndex(def, view.answers), steps.length - 1)].id;
  });
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState<Err>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [resuming, setResuming] = useState(!!view.resume);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = useMemo(() => visibleSteps(def, answers), [def, answers]);
  const index = Math.max(0, steps.findIndex((s) => s.id === stepId));
  const step = steps[index] ?? steps[0];
  const answeredCount = steps.filter((s) => isAnswered(s, answers)).length;
  const progress = Math.round((answeredCount / steps.length) * 100);
  const isLast = index === steps.length - 1;

  const draft = step.id in drafts ? drafts[step.id] : step.id in answers && answers[step.id] !== null ? answers[step.id] : view.initial[step.id];
  const check = draft === undefined ? null : validateAnswer(step, draft);
  const canContinue = !busy && !pending && !!check?.ok;

  useEffect(() => () => void (advanceTimer.current && clearTimeout(advanceTimer.current)), []);

  const go = useCallback((id: string, direction: "fwd" | "back") => {
    setDir(direction);
    setError(null);
    setStepId(id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  /** Queue a save so answers reach the server in the order they were given. */
  const persist = useCallback(
    (id: string, value: unknown) => {
      const run = queue.current.then(async () => {
        const res = await saveAnswerApi(token, id, value);
        if (isError(res)) throw Object.assign(new Error(res.error), { stepId: res.stepId ?? id, path: res.path });
        setSavedAt(Date.now());
        return res;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [token],
  );

  const finish = useCallback(async () => {
    setPending(true);
    try {
      await queue.current;
      const res = await completeApi(token);
      if (isError(res)) {
        const missing = res.stepId ?? stepId;
        setPending(false);
        if (steps.some((s) => s.id === missing)) go(missing, "back");
        setError({ stepId: missing, message: res.error });
        return;
      }
      router.refresh();
    } catch {
      setPending(false);
      setError({ stepId, message: "Something went wrong. Your answers are saved, please try again." });
    }
  }, [token, router, steps, stepId, go]);

  const commit = useCallback(
    async (value: unknown) => {
      const checked = validateAnswer(step, value);
      if (!checked.ok) {
        setError({ stepId: step.id, message: checked.error, path: checked.path });
        return;
      }
      const next = { ...answers, [step.id]: checked.value };
      const nextSteps = visibleSteps(def, next);
      const after = nextSteps[nextSteps.findIndex((s) => s.id === step.id) + 1];

      if (AWAIT_SERVER.has(step.kind)) {
        setPending(true);
        try {
          const res = await persist(step.id, value);
          setAnswers(res.answers);
          setDrafts((d) => ({ ...d, [step.id]: res.value }));
        } catch (err) {
          const e = err as Error & { path?: string };
          setError({ stepId: step.id, message: e.message, path: e.path });
          setPending(false);
          return;
        }
        setPending(false);
      } else {
        setAnswers(next);
        persist(step.id, value).catch((err: Error & { stepId?: string; path?: string }) => {
          setAnswers((a) => {
            const copy = { ...a };
            delete copy[step.id];
            return copy;
          });
          go(err.stepId ?? step.id, "back");
          setError({ stepId: err.stepId ?? step.id, message: err.message, path: err.path });
        });
      }
      if (after) go(after.id, "fwd");
      else void finish();
    },
    [answers, def, finish, go, persist, step],
  );

  const setDraft = useCallback((v: unknown) => {
    setError(null);
    setDrafts((d) => ({ ...d, [step.id]: v }));
  }, [step.id]);

  const pick = useCallback(
    (v: unknown) => {
      setDraft(v);
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => void commit(v), AUTO_ADVANCE_MS);
    },
    [commit, setDraft],
  );

  const back = () => index > 0 && go(steps[index - 1].id, "back");
  const onContinue = () => (canContinue ? void commit(draft) : check && !check.ok && setError({ stepId: step.id, message: check.error, path: check.path }));

  // Keyboard: A–Z picks an option, Enter continues (inputs handle their own Enter).
  useEffect(() => {
    if (resuming) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Enter" && !(t && t.tagName === "BUTTON")) {
        e.preventDefault();
        onContinue();
        return;
      }
      const options = pickables(step);
      const i = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) - 65 : -1;
      if (i < 0 || i >= options.length) return;
      e.preventDefault();
      const v = options[i];
      if (step.kind === "choice" && step.multiple) {
        const cur = Array.isArray(draft) ? (draft as string[]) : [];
        setDraft(cur.includes(v as string) ? cur.filter((x) => x !== v) : [...cur, v]);
      } else if (step.kind === "date") {
        if (v === "date") setDraft({ choice: "date" });
        else pick({ choice: v });
      } else pick(v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const err = error && error.stepId === step.id ? error : null;
  const showFooter = !autoAdvances(step) || draft !== undefined;
  const sendLabel = def.kind === "enquiry" ? "Send enquiry" : "Send";

  if (resuming && view.resume) {
    return (
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-10 sm:px-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.name} className="gp-rise h-12 w-auto max-w-[170px] self-start object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element -- the business's own garden */}
        <img src={brand.heroImage} alt="" className="gp-fade mt-8 aspect-[16/10] w-full rounded-[24px] object-cover shadow-[0_24px_48px_-28px_rgba(0,0,0,0.5)] lg:hidden" />
        <h1 className="gp-rise mt-8 font-display text-[34px] leading-[1.1] tracking-tight text-balance">
          Welcome back{view.resume.firstName ? `, ${view.resume.firstName}` : ""}
        </h1>
        <p className="gp-rise mt-4 text-[17px] leading-relaxed text-black/60">
          Everything you answered is saved. Just {view.resume.remaining} question{view.resume.remaining === 1 ? "" : "s"} to go.
        </p>
        <div className="gp-rise mt-8 h-2 overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-[var(--b)]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-[13px] text-black/45">
          {view.resume.answered} of {view.resume.answered + view.resume.remaining} done
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => setResuming(false)}
          className="gp-press mt-10 flex h-14 items-center justify-center gap-2 rounded-2xl bg-[var(--b)] px-7 outline-none focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 text-[17px] font-semibold text-[var(--b-ink)] shadow-[0_14px_30px_-16px_var(--b)] transition hover:brightness-110"
        >
          Pick up where I left off <Glyph name="arrow-right" className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setResuming(false);
            go(steps[0].id, "back");
          }}
          className="mt-3 h-12 text-[15px] font-semibold text-black/55 underline-offset-4 hover:underline"
        >
          Look over my answers first
        </button>
      </main>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-20 bg-[#fbfaf7]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[640px] items-center gap-2 px-3 sm:px-6">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            aria-label="Previous question"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black/70 transition hover:bg-black/5 disabled:pointer-events-none disabled:opacity-0"
          >
            <Glyph name="chevron-left" className="h-6 w-6" strokeWidth={2} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt="" className="h-8 w-auto max-w-[96px] object-contain" />
            <span className="sr-only">{brand.name}</span>
          </div>
          <span className="hidden flex-1 lg:block" />
          <span className={`flex items-center gap-1.5 pr-2 text-[13px] font-medium text-black/45 transition-opacity duration-500 ${savedAt ? "opacity-100" : "opacity-0"}`} aria-live="polite">
            <Glyph name="check" className="h-4 w-4 text-[var(--b)]" strokeWidth={2.4} /> Saved
          </span>
        </div>
        <div className="h-[3px] w-full bg-black/[0.05]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
          <div className="h-full rounded-r-full bg-[var(--b)] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ width: `${Math.max(progress, 3)}%` }} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pb-40 pt-7 sm:px-8 lg:justify-center lg:pb-36 lg:pt-10">
        <section key={step.id} className={dir === "fwd" ? "gp-fwd" : "gp-back"} aria-labelledby={`q-${step.id}`}>
          {index === 0 && answeredCount === 0 && <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-[var(--b)]">{def.intro.title}</p>}
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-black/40">
            <span className="tabular-nums text-[var(--b)]">{index + 1}</span>
            <Glyph name="arrow-right" className="h-3.5 w-3.5 text-[var(--b)]" strokeWidth={2.2} />
            <span className="tabular-nums">of {steps.length}</span>
          </p>
          <h1 id={`q-${step.id}`} className="mt-2 font-display text-[28px] leading-[1.15] tracking-tight text-balance sm:text-[34px]">
            {step.title}
          </h1>
          {step.subtitle && <p className="mt-2.5 text-[16px] leading-relaxed text-black/55">{step.subtitle}</p>}
          {index === 0 && def.kind === "enquiry" && brand.rating && (
            <p className="mt-3 flex items-center gap-2 text-[13.5px] font-medium text-black/55 lg:hidden">
              <span className="tracking-[0.12em] text-[#e0a526]" aria-hidden>
                ★★★★★
              </span>
              {brand.rating.value.toFixed(1)} from {brand.rating.count} reviews
            </p>
          )}
          <div className="mt-7">
            <StepBody step={step} draft={draft} token={token} onDraft={setDraft} onPick={pick} onEnter={onContinue} setBusy={setBusy} err={err} prefilled={step.id in view.initial && !(step.id in drafts)} />
          </div>
          {err && (
            <p role="alert" className="gp-rise mt-4 flex items-center gap-2 text-[14.5px] font-medium text-[#9a3b1f]">
              <Glyph name="alert" className="h-4 w-4" /> {err.message}
            </p>
          )}
        </section>
      </main>

      {(showFooter || step.optional) && (
        <footer className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7]/95 to-transparent pb-[max(env(safe-area-inset-bottom),16px)] pt-8 lg:left-[45.45%]">
          <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-5 sm:px-8">
            {showFooter && (
              <button
                type="button"
                onClick={onContinue}
                aria-disabled={!canContinue}
                className={`gp-press flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-7 text-[17px] font-semibold transition sm:flex-none ${
                  canContinue ? "bg-[var(--b)] text-[var(--b-ink)] shadow-[0_14px_30px_-16px_var(--b)] hover:brightness-110" : "bg-black/[0.07] text-black/35"
                }`}
              >
                {pending ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-current/30 border-t-current" aria-label="Saving" />
                ) : (
                  <>
                    {isLast ? sendLabel : "Continue"} <Glyph name="arrow-right" className="h-5 w-5" strokeWidth={2} />
                  </>
                )}
              </button>
            )}
            {showFooter && <span className="hidden text-[13px] text-black/40 sm:inline">press Enter ↵</span>}
            {step.optional && (
              <button type="button" onClick={() => void commit(null)} className="ml-auto h-14 px-4 text-[15.5px] font-semibold text-black/50 transition hover:text-black/80">
                Skip
              </button>
            )}
          </div>
        </footer>
      )}
    </>
  );
}

function StepBody(p: {
  step: FormStep;
  draft: unknown;
  token: string;
  onDraft: (v: unknown) => void;
  onPick: (v: unknown) => void;
  onEnter: () => void;
  setBusy: (b: boolean) => void;
  err: Err;
  prefilled: boolean;
}) {
  const { step, draft } = p;
  switch (step.kind) {
    case "choice":
      return <ChoiceStepView step={step} value={draft as string | string[] | undefined} onPick={step.multiple ? p.onDraft : p.onPick} />;
    case "budget":
      return <BudgetStepView step={step} value={draft as string | undefined} onPick={p.onPick} />;
    case "date":
      return <DateStepView step={step} value={draft as never} onPick={p.onPick} onDraft={p.onDraft} />;
    case "timeWindow":
      return <TimeWindowStepView step={step} value={draft as never} onDraft={p.onDraft} />;
    case "yesno":
      return <YesNoStepView step={step} value={draft as boolean | undefined} onPick={p.onPick} />;
    case "text":
      return <TextStepView step={step} value={draft as string | undefined} onDraft={p.onDraft} onEnter={p.onEnter} />;
    case "longtext":
      return <LongTextStepView step={step} value={draft as string | undefined} onDraft={p.onDraft} />;
    case "photos":
      return <PhotosStepView token={p.token} step={step} value={draft as never} onDraft={p.onDraft} onBusy={p.setBusy} />;
    case "postcode":
      return <PostcodeStepView token={p.token} value={draft as never} onDraft={p.onDraft} onEnter={p.onEnter} error={p.err?.message} />;
    case "contact":
      return <ContactStepView step={step} value={draft as never} prefilled={p.prefilled} onDraft={p.onDraft} onEnter={p.onEnter} errorPath={p.err?.path} error={p.err?.message} />;
  }
}
