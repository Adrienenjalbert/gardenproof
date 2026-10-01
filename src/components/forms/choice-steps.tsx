"use client";
/**
 * Tap-don't-type steps: photo cards, glyph tiles, list rows, budget bands, timing, yes/no, time windows.
 * Every option is a real <button> with aria-pressed/role=radio so it works with a keyboard and a screen reader.
 */
import type { BudgetStep, ChoiceStep, DateStep, DateValue, FormOption, TimeWindowStep, TimeWindowValue, YesNoStep } from "@/lib/forms/types";
import { Glyph } from "./glyphs";

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function KeyHint({ i, on }: { i: number; on: boolean }) {
  return (
    <span
      aria-hidden
      className={`hidden h-6 min-w-6 items-center justify-center rounded-md border px-1 text-[11px] font-semibold lg:inline-flex ${on ? "border-white/60 bg-white/20 text-current" : "border-black/10 bg-white text-black/45"}`}
    >
      {KEYS[i]}
    </span>
  );
}

function Tick({ on, round = true }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center ${round ? "rounded-full" : "rounded-md"} border-[1.5px] transition ${on ? "border-[var(--b)] bg-[var(--b)] text-[var(--b-ink)]" : "border-black/20 bg-white"}`}
    >
      {on && <Glyph name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

/** Toggle a multi-select value, honouring "exclusive" options ("Not sure yet" clears the rest and vice versa). */
export function toggle(options: FormOption[], current: string[], value: string, max?: number): string[] {
  const opt = options.find((o) => o.value === value);
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (opt?.exclusive) return [value];
  const rest = current.filter((v) => !options.find((o) => o.value === v)?.exclusive);
  const next = [...rest, value];
  return max && next.length > max ? next.slice(next.length - max) : next;
}

type Picker<V> = { value: V | undefined; onPick: (v: V) => void };

export function ChoiceStepView({ step, value, onPick }: { step: ChoiceStep } & Picker<string | string[]>) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const choose = (v: string) => (step.multiple ? onPick(toggle(step.options, selected, v, step.max)) : onPick(v));
  const role = step.multiple ? "checkbox" : "radio";

  if (step.layout === "photo") {
    const square = step.options.length > 5;
    return (
      <div role={step.multiple ? "group" : "radiogroup"} aria-label={step.title} className="grid grid-cols-2 gap-3 sm:gap-4">
        {step.options.map((o, i) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={role}
              aria-checked={on}
              onClick={() => choose(o.value)}
              className={`gp-press group relative overflow-hidden rounded-[20px] text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/40 ${square ? "aspect-square" : "aspect-[4/5]"} ${
                on ? "shadow-[0_0_0_3px_var(--b),0_12px_28px_-12px_rgba(0,0,0,0.45)]" : "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]"
              }`}
            >
              {o.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- the business's own photos, any host
                <img src={o.image} alt="" loading={i < 4 ? "eager" : "lazy"} className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${on ? "scale-[1.04]" : "group-hover:scale-[1.03]"}`} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(120%_90%_at_30%_15%,#ffffff_0%,var(--b-soft)_70%)] text-[var(--b)]">
                  <Glyph name={o.glyph ?? "leaf"} className="h-10 w-10" strokeWidth={1.3} />
                </span>
              )}
              {o.image && <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />}
              <span className={`absolute inset-x-0 bottom-0 p-3.5 ${o.image ? "text-white" : "text-[var(--b-dark)]"}`}>
                <span className="block text-[15px] font-semibold leading-snug">{o.label}</span>
                {o.hint && <span className={`mt-0.5 block text-[12.5px] leading-snug ${o.image ? "text-white/80" : "text-black/55"}`}>{o.hint}</span>}
              </span>
              <span
                className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full transition ${
                  on ? "scale-100 bg-[var(--b)] text-[var(--b-ink)] opacity-100" : "scale-75 bg-white/85 opacity-0 group-hover:opacity-60"
                }`}
              >
                <Glyph name="check" className="h-4 w-4" strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (step.layout === "tiles") {
    return (
      <div role={step.multiple ? "group" : "radiogroup"} aria-label={step.title} className="grid grid-cols-2 gap-3">
        {step.options.map((o, i) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={role}
              aria-checked={on}
              onClick={() => choose(o.value)}
              className={`gp-press flex min-h-[120px] flex-col items-start justify-between rounded-[20px] border-[1.5px] p-4 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${
                on ? "border-[var(--b)] bg-[var(--b-soft)]" : "border-black/[0.08] bg-white hover:border-black/20"
              }`}
            >
              <span className="flex w-full items-start justify-between">
                <span className={`flex h-11 w-11 items-center justify-center rounded-full transition ${on ? "bg-[var(--b)] text-[var(--b-ink)]" : "bg-[var(--b-soft)] text-[var(--b)]"}`}>
                  <Glyph name={o.glyph ?? "leaf"} className="h-[22px] w-[22px]" />
                </span>
                <KeyHint i={i} on={false} />
              </span>
              <span className="mt-3">
                <span className="block text-[16px] font-semibold leading-snug text-[#16180f]">{o.label}</span>
                {o.hint && <span className="mt-0.5 block text-[13px] leading-snug text-black/55">{o.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return <OptionList options={step.options} selected={selected} onChoose={choose} multiple={!!step.multiple} label={step.title} />;
}

function OptionList(props: { options: FormOption[]; selected: string[]; onChoose: (v: string) => void; multiple: boolean; label: string; glyphs?: boolean }) {
  return (
    <div role={props.multiple ? "group" : "radiogroup"} aria-label={props.label} className="flex flex-col gap-2.5">
      {props.options.map((o, i) => {
        const on = props.selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={props.multiple ? "checkbox" : "radio"}
            aria-checked={on}
            onClick={() => props.onChoose(o.value)}
            className={`gp-press flex min-h-[64px] w-full items-center gap-3.5 rounded-[18px] border-[1.5px] px-4 py-3 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${
              on ? "border-[var(--b)] bg-[var(--b-soft)]" : "border-black/[0.08] bg-white hover:border-black/20"
            }`}
          >
            {props.glyphs !== false && o.glyph && (
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-[var(--b)] text-[var(--b-ink)]" : "bg-[var(--b-soft)] text-[var(--b)]"}`}>
                <Glyph name={o.glyph} className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold leading-snug text-[#16180f]">{o.label}</span>
              {o.hint && <span className="block text-[13px] leading-snug text-black/55">{o.hint}</span>}
            </span>
            <KeyHint i={i} on={false} />
            <Tick on={on} round={!props.multiple} />
          </button>
        );
      })}
    </div>
  );
}

export function BudgetStepView({ step, value, onPick }: { step: BudgetStep } & Picker<string>) {
  return (
    <div role="radiogroup" aria-label={step.title} className="grid grid-cols-2 gap-2.5">
      {step.options.map((o, i) => {
        const on = value === o.value;
        const wide = i === step.options.length - 1 && step.options.length % 2 === 1;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(o.value)}
            className={`gp-press flex h-[68px] items-center justify-between rounded-[18px] border-[1.5px] px-4 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${wide ? "col-span-2" : ""} ${
              on ? "border-[var(--b)] bg-[var(--b)] text-[var(--b-ink)]" : "border-black/[0.08] bg-white text-[#16180f] hover:border-black/20"
            }`}
          >
            <span className="text-[16.5px] font-semibold tabular-nums tracking-tight">{o.label}</span>
            <KeyHint i={i} on={on} />
          </button>
        );
      })}
    </div>
  );
}

export function DateStepView({ step, value, onPick, onDraft }: { step: DateStep; onDraft: (v: DateValue) => void } & Picker<DateValue>) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      <OptionList
        options={step.options}
        selected={value?.choice ? [value.choice] : []}
        multiple={false}
        label={step.title}
        onChoose={(v) => (v === "date" ? onDraft({ choice: "date", date: value?.date }) : onPick({ choice: v }))}
      />
      {value?.choice === "date" && (
        <label className="gp-rise block rounded-[18px] border-[1.5px] border-[var(--b)] bg-white px-4 py-3">
          <span className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-black/50">Your date</span>
          <input
            type="date"
            min={today}
            value={value.date ?? ""}
            autoFocus
            onChange={(e) => onDraft({ choice: "date", date: e.target.value || undefined })}
            className="mt-1 w-full bg-transparent text-[18px] font-semibold text-[#16180f] outline-none"
          />
        </label>
      )}
    </div>
  );
}

export function YesNoStepView({ step, value, onPick }: { step: YesNoStep } & Picker<boolean>) {
  const opt = (v: boolean, label: string, glyph: "check" | "x", i: number) => {
    const on = value === v;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => onPick(v)}
        className={`gp-press flex h-36 flex-1 flex-col items-center justify-center gap-3 rounded-[22px] border-[1.5px] outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${
          on ? "border-[var(--b)] bg-[var(--b)] text-[var(--b-ink)]" : "border-black/[0.08] bg-white text-[#16180f] hover:border-black/20"
        }`}
      >
        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${on ? "bg-white/20" : "bg-[var(--b-soft)] text-[var(--b)]"}`}>
          <Glyph name={glyph} className="h-6 w-6" strokeWidth={2} />
        </span>
        <span className="flex items-center gap-2 text-[17px] font-semibold">
          {label} <KeyHint i={i} on={on} />
        </span>
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label={step.title} className="flex gap-3">
      {opt(true, step.yes ?? "Yes", "check", 0)}
      {opt(false, step.no ?? "No", "x", 1)}
    </div>
  );
}

function Chips(props: { label: string; options: FormOption[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-black/50">{props.label}</legend>
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => {
          const on = props.selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => props.onChange(toggle(props.options, props.selected, o.value))}
              className={`gp-press flex h-[52px] items-center gap-2 rounded-full border-[1.5px] px-5 text-[15.5px] font-semibold outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--b)]/30 ${
                on ? "border-[var(--b)] bg-[var(--b)] text-[var(--b-ink)]" : "border-black/[0.08] bg-white text-[#16180f] hover:border-black/20"
              }`}
            >
              {on && <Glyph name="check" className="h-4 w-4" strokeWidth={2.6} />}
              {o.label}
              {o.hint && <span className={`text-[13px] font-medium ${on ? "text-white/75" : "text-black/45"}`}>{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TimeWindowStepView({ step, value, onDraft }: { step: TimeWindowStep; value: TimeWindowValue | undefined; onDraft: (v: TimeWindowValue) => void }) {
  const v = value ?? { days: [], windows: [] };
  return (
    <div className="flex flex-col gap-7">
      <Chips label="Days" options={step.days} selected={v.days} onChange={(days) => onDraft({ ...v, days })} />
      <Chips label="Times" options={step.windows} selected={v.windows} onChange={(windows) => onDraft({ ...v, windows })} />
    </div>
  );
}
