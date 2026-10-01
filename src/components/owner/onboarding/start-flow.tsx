"use client";
/**
 * "Set up from your website": paste a URL → watch it being read → confirm on five cards → Today.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confirmProfileAction, runProfileAction, sampleProfileAction } from "@/lib/owner/onboarding-actions";
import type { Choices } from "@/lib/owner/onboarding-choices";
import { toast, Spinner } from "../feedback";
import { OIcon } from "../icons";
import { buttonClass, cx } from "../ui";
import { ConfirmCards } from "./confirm-cards";
import { OFFLINE_STEPS, pollLive, startLive, type Loaded, type ReadStep } from "./reader";

type Phase =
  | { kind: "url" }
  | { kind: "reading"; host: string; steps: ReadStep[]; offline: boolean }
  | { kind: "confirm"; data: Loaded };

const hostOf = (u: string) =>
  u
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function StartFlow({ initialUrl }: { initialUrl: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "url" });
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [slow, setSlow] = useState(false);
  const alive = useRef(true);
  const router = useRouter();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function read() {
    setError(null);
    const clean = url.trim();
    if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(clean)) {
      setError("Please paste your website address, e.g. yourgarden.co.uk");
      return;
    }
    const full = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    let runId: string | null;
    try {
      runId = await startLive(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That doesn't look right.");
      return;
    }
    const host = hostOf(full);
    if (runId) return readLive(runId, host);
    return readOffline(host);
  }

  async function readLive(runId: string, host: string) {
    setPhase({ kind: "reading", host, steps: [], offline: false });
    const slowTimer = setTimeout(() => alive.current && setSlow(true), 15_000);
    for (let i = 0; i < 300 && alive.current; i++) {
      try {
        const r = await pollLive(runId);
        setPhase({ kind: "reading", host, steps: r.steps, offline: false });
        if (r.status === "ready") {
          clearTimeout(slowTimer);
          const profile = await runProfileAction(runId);
          if (profile)
            return setPhase({
              kind: "confirm",
              data: { profile, runId, sample: false },
            });
        }
        if (r.status === "failed") throw new Error(r.error ?? "We couldn't read that website.");
      } catch (e) {
        clearTimeout(slowTimer);
        setPhase({ kind: "url" });
        setError(e instanceof Error ? e.message : "We couldn't read that website.");
        return;
      }
      await wait(1200);
    }
  }

  async function readOffline(host: string) {
    const steps: ReadStep[] = OFFLINE_STEPS.map((s) => ({
      ...s,
      status: "pending",
    }));
    const loading = sampleProfileAction();
    for (let i = 0; i < steps.length && alive.current; i++) {
      steps[i] = { ...steps[i], status: "running" };
      setPhase({ kind: "reading", host, steps: [...steps], offline: true });
      await wait(650);
      steps[i] = { ...steps[i], status: "done" };
    }
    setPhase({ kind: "reading", host, steps: [...steps], offline: true });
    const data = await loading;
    await wait(350);
    if (alive.current) setPhase({ kind: "confirm", data: { ...data, runId: null } });
  }

  async function confirm(choices: Choices, runId: string | null) {
    setSaving(true);
    const r = await confirmProfileAction({ runId, choices });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message);
    router.push("/");
  }

  if (phase.kind === "confirm")
    return (
      <ConfirmCards data={phase.data} saving={saving} onConfirm={confirm} onBack={() => setPhase({ kind: "url" })} />
    );

  if (phase.kind === "reading") {
    const done = phase.steps.filter((s) => s.status === "done").length;
    return (
      <div className="anim-fade mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-6 py-16">
        <div className="relative mx-auto mb-8 size-20">
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--fill)" strokeWidth="5" />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={226}
              strokeDashoffset={226 - (226 * done) / Math.max(1, phase.steps.length)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-(--accent)">
            <OIcon name="globe" size={30} strokeWidth={1.5} />
          </span>
        </div>
        <h1 className="font-title text-center text-[28px] leading-tight font-bold text-(--ink)">
          Reading your website
        </h1>
        <p className="mt-1.5 text-center text-[16px] text-(--ink2)">{phase.host}</p>
        <ul className="mt-9 space-y-1">
          {(phase.steps.length
            ? phase.steps
            : [
                {
                  key: "wait",
                  label: "Getting started",
                  status: "running" as const,
                },
              ]
          ).map((s) => (
            <li
              key={s.key}
              className={cx(
                "anim-rise flex items-center gap-3.5 rounded-[14px] px-3 py-2.5 transition-opacity",
                s.status === "pending" && "opacity-35",
              )}
            >
              <span
                className={cx(
                  "grid size-7 shrink-0 place-items-center rounded-full",
                  s.status === "done"
                    ? "bg-(--accent) text-(--accent-ink)"
                    : s.status === "failed"
                      ? "bg-(--red-soft) text-(--red)"
                      : "bg-(--fill) text-(--ink2)",
                )}
              >
                {s.status === "done" ? (
                  <OIcon name="check" size={15} strokeWidth={2.6} />
                ) : s.status === "running" ? (
                  <Spinner size={14} />
                ) : s.status === "failed" ? (
                  <OIcon name="x" size={14} strokeWidth={2.4} />
                ) : null}
              </span>
              <span className="text-[17px] text-(--ink)">{s.label}</span>
              {s.detail && <span className="ml-auto truncate text-[14px] text-(--ink2)">{s.detail}</span>}
            </li>
          ))}
        </ul>
        {slow && !phase.offline && (
          <p className="anim-fade mt-8 text-center text-[14px] text-(--ink2)">
            Reviews and badges take a minute to check. You can leave this open.
          </p>
        )}
        {phase.offline && (
          <p className="mt-8 text-center text-[13px] text-(--ink3)">
            Live reading isn&rsquo;t switched on here, so we&rsquo;re using sample details.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="anim-fade mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pt-[max(24px,env(safe-area-inset-top))] pb-10">
      <div className="flex items-center gap-2 pt-4 text-[15px] font-semibold text-(--ink)">
        <span className="grid size-7 place-items-center rounded-[8px] bg-(--accent) text-(--accent-ink)">
          <OIcon name="leaf" size={16} strokeWidth={2} />
        </span>
        GardenProof
      </div>
      <div className="flex flex-1 flex-col justify-center py-12">
        <h1 className="font-title text-[34px] leading-[1.08] font-bold text-(--ink)">
          Let&rsquo;s set you up from your website
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-(--ink2)">
          Paste your address. We&rsquo;ll find your logo, services, reviews and badges, and you check them in a minute.
        </p>
        <form
          className="mt-9"
          onSubmit={(e) => {
            e.preventDefault();
            void read();
          }}
        >
          <label className="flex h-[56px] items-center gap-3 rounded-[16px] bg-(--card) px-4 shadow-(--shadow) ring-1 ring-(--sep) focus-within:ring-2 focus-within:ring-(--accent)">
            <OIcon name="globe" size={21} className="text-(--ink3)" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourgarden.co.uk"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Your website"
              className="h-full min-w-0 flex-1 bg-transparent text-[18px] text-(--ink) outline-none placeholder:text-(--ink3)"
            />
          </label>
          {error && <p className="anim-rise mt-3 px-1 text-[15px] text-(--red)">{error}</p>}
          <button type="submit" className={cx(buttonClass("primary", "lg", true), "mt-5")}>
            Continue
          </button>
        </form>
        <p className="mt-6 flex items-start gap-2 px-1 text-[14px] leading-snug text-(--ink2)">
          <OIcon name="shield" size={17} className="mt-0.5 shrink-0" />
          We only read public pages. Nothing is published until you confirm.
        </p>
      </div>
    </div>
  );
}
