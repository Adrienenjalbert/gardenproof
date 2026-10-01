"use client";
/** Notifications and message style. Changes save as you make them (no Save button to forget). */
import { useState } from "react";
import type { InstantKind, OwnerSettings, Tone } from "@/lib/crm-engine/settings";
import type { ContentOutputs } from "@/lib/outputs";
import { saveNotificationsAction, saveOutputsAction, saveStyleAction } from "@/lib/owner/actions";
import { Spinner, useOwnerAction } from "./feedback";
import { Toggle } from "./toggle";
import { buttonClass, cx, Group, GroupLabel, RowDivider } from "./ui";

const INSTANT: { kind: InstantKind; label: string }[] = [
  { kind: "new_enquiry", label: "A new enquiry" },
  { kind: "quote_accepted", label: "A quote is accepted" },
  { kind: "customer_needs_owner", label: "A customer asks for you" },
  { kind: "low_review", label: "A review of 3★ or less" },
];

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] text-(--ink)">{label}</p>
        {hint && <p className="mt-0.5 text-[14px] leading-snug text-(--ink2)">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function NotificationsForm({ initial }: { initial: OwnerSettings }) {
  const [s, setS] = useState({
    ...initial.notifications,
    autoSendRoutine: initial.autoSendRoutine,
  });
  const { run } = useOwnerAction();
  const update = (patch: Partial<typeof s>) => {
    const next = { ...s, ...patch };
    setS(next);
    run(() => saveNotificationsAction(next));
  };
  const hours = [16, 17, 18, 19, 20, 21];
  return (
    <div className="space-y-8">
      <div>
        <GroupLabel>Tell me straight away on WhatsApp when…</GroupLabel>
        <Group>
          {INSTANT.map((i, n) => (
            <div key={i.kind}>
              {n > 0 && <RowDivider />}
              <SwitchRow
                label={i.label}
                checked={s.instant.includes(i.kind)}
                onChange={(on) =>
                  update({
                    instant: on ? [...s.instant, i.kind] : s.instant.filter((k) => k !== i.kind),
                  })
                }
              />
            </div>
          ))}
        </Group>
      </div>

      <div>
        <GroupLabel>Everything else</GroupLabel>
        <Group>
          <SwitchRow
            label="Evening summary"
            hint="One WhatsApp with the day, what's ready to send and tomorrow's jobs."
            checked={s.digestHour !== null}
            onChange={(on) => update({ digestHour: on ? 18 : null })}
          />
          {s.digestHour !== null && (
            <>
              <RowDivider />
              <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => update({ digestHour: h })}
                    className={cx(
                      "h-9 shrink-0 rounded-full px-3.5 text-[15px] font-medium tabular-nums transition-colors",
                      s.digestHour === h ? "bg-(--accent) text-(--accent-ink)" : "bg-(--fill2) text-(--ink)",
                    )}
                  >
                    {h}:00
                  </button>
                ))}
              </div>
            </>
          )}
        </Group>
      </div>

      <div>
        <GroupLabel>Messages to customers</GroupLabel>
        <Group>
          <SwitchRow
            label="Send reminders automatically"
            hint="Thank-yous and visit or start reminders go without asking you."
            checked={s.autoSendRoutine}
            onChange={(on) => update({ autoSendRoutine: on })}
          />
          <RowDivider />
          <SwitchRow
            label="Stop asking after 30 days"
            hint="Once you've said yes to a kind of message for 30 days, it goes on its own."
            checked={s.autoApproveAfterDays !== null}
            onChange={(on) => update({ autoApproveAfterDays: on ? 30 : null })}
          />
        </Group>
        <p className="mt-2 px-4 text-[13px] leading-relaxed text-(--ink2)">
          Renewals and anything unusual always wait for you. Nothing goes to customers between 8pm and 8am.
        </p>
      </div>
    </div>
  );
}

const TONES: { value: Tone; label: string; sample: (sig: string) => string }[] = [
  {
    value: "warm",
    label: "Warm",
    sample: (sig) =>
      `Hi Olivia,\n\nJust a reminder that we'll come and see your garden tomorrow at 10:00. If anything changes, just reply here.\n\nThanks,\n${sig}`,
  },
  {
    value: "professional",
    label: "Professional",
    sample: (sig) =>
      `Dear Olivia,\n\nJust a reminder that we'll come and see your garden tomorrow at 10:00. If anything changes, just reply here.\n\nKind regards,\n${sig}`,
  },
  {
    value: "brief",
    label: "Short",
    sample: (sig) =>
      `Hi Olivia, just a reminder that we'll come and see your garden tomorrow at 10:00. If anything changes, just reply here.\n\n${sig}`,
  },
];

export function StyleForm({
  initial,
  defaultSignature,
}: {
  initial: OwnerSettings["style"];
  defaultSignature: string;
}) {
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [signOff, setSignOff] = useState(initial.signOff ?? "");
  const { pending, run } = useOwnerAction();
  const sig = signOff.trim() || defaultSignature;
  const dirty = tone !== initial.tone || (signOff.trim() || null) !== (initial.signOff ?? null);
  return (
    <div className="space-y-8">
      <div>
        <GroupLabel>How messages sound</GroupLabel>
        <Group>
          {TONES.map((t, i) => (
            <div key={t.value}>
              {i > 0 && <RowDivider />}
              <button
                type="button"
                onClick={() => setTone(t.value)}
                className="flex min-h-[52px] w-full items-center justify-between px-4 text-left text-[17px] text-(--ink)"
              >
                {t.label}
                {tone === t.value && <span className="text-[20px] leading-none text-(--accent)">✓</span>}
              </button>
            </div>
          ))}
        </Group>
      </div>
      <div>
        <GroupLabel>Signed</GroupLabel>
        <Group>
          <input
            value={signOff}
            onChange={(e) => setSignOff(e.target.value)}
            maxLength={80}
            placeholder={defaultSignature}
            className="h-[52px] w-full bg-transparent px-4 text-[17px] text-(--ink) outline-none placeholder:text-(--ink3)"
          />
        </Group>
      </div>
      <div>
        <GroupLabel>Preview</GroupLabel>
        <div className="rounded-[22px] bg-[#e7f7dc] p-4 dark:bg-[#0b3d2c]">
          <div className="max-w-[88%] rounded-[16px] rounded-tl-[4px] bg-white px-3.5 py-2.5 text-[15.5px] leading-[1.45] whitespace-pre-line text-[#111] shadow-sm dark:bg-[#1f2c24] dark:text-[#eee]">
            {TONES.find((t) => t.value === tone)!.sample(sig)}
          </div>
        </div>
      </div>
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() => run(() => saveStyleAction({ tone, signOff: signOff.trim() || null }))}
        className={buttonClass("primary", "lg", true)}
      >
        {pending ? <Spinner /> : "Save"}
      </button>
    </div>
  );
}

const OUTPUT_ROWS: { key: keyof ContentOutputs; label: string; hint: string }[] = [
  { key: "ads", label: "Ad copy", hint: "Google and Facebook ads. Turn on if you run ads." },
  { key: "social", label: "Social captions", hint: "Ready-to-post Instagram and Facebook captions." },
  { key: "areaArticles", label: "Area articles", hint: "“Patios in Wimbledon” pages for your website, to be found on Google." },
  { key: "allVideoFormats", label: "Every video shape", hint: "Square and landscape too, plus the review and progress cuts." },
];

/** What is made for each finished job. The page, Google post and one video are always made. */
export function OutputsForm({ initial }: { initial: ContentOutputs }) {
  const [o, setO] = useState(initial);
  const { run } = useOwnerAction();
  const update = (patch: Partial<ContentOutputs>) => {
    const next = { ...o, ...patch };
    setO(next);
    run(() => saveOutputsAction(next));
  };
  return (
    <div>
      <GroupLabel>What we make for each finished job</GroupLabel>
      <Group>
        <div className="px-4 py-3 text-[15px] leading-snug text-(--ink2)">
          Always: a project page, a Google Business post and a portrait video. Fewer things to check means more gets
          published.
        </div>
        {OUTPUT_ROWS.map((r) => (
          <div key={r.key}>
            <RowDivider />
            <SwitchRow label={r.label} hint={r.hint} checked={o[r.key]} onChange={(v) => update({ [r.key]: v })} />
          </div>
        ))}
      </Group>
    </div>
  );
}
