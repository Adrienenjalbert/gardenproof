"use client";
/**
 * Buttons that run a Server Action and report the result as a toast.
 * `ActionButton` fires immediately; `NoteActionButton` first asks for a note (reject / regenerate).
 */
import { useId, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/dashboard/action-result";
import { Button, Textarea, type ButtonSize, type ButtonVariant } from "@/components/ui/primitives";
import type { IconName } from "@/components/ui/icons";
import { toast } from "./toaster";

type Common = {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  title?: string;
  className?: string;
};

export function ActionButton({
  action,
  pendingLabel,
  confirm,
  ...btn
}: Common & { action: () => Promise<ActionResult>; pendingLabel?: string; confirm?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...btn}
      disabled={btn.disabled || pending}
      aria-busy={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => toast(await action()));
      }}
    >
      {pending ? (pendingLabel ?? "Working…") : btn.children}
    </Button>
  );
}

export function NoteActionButton({
  action,
  prompt,
  placeholder,
  submitLabel,
  required,
  ...btn
}: Common & {
  action: (note: string) => Promise<ActionResult>;
  prompt: string;
  placeholder?: string;
  submitLabel: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const id = useId();

  if (!open) {
    return <Button {...btn} onClick={() => setOpen(true)} />;
  }
  return (
    <form
      className="w-full basis-full rounded-xl bg-olive-50/70 p-3 ring-1 ring-olive-100"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await action(note.trim());
          toast(r);
          if (r.ok) {
            setOpen(false);
            setNote("");
          }
        });
      }}
    >
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">
        {prompt}
      </label>
      <Textarea
        id={id}
        autoFocus
        rows={2}
        value={note}
        placeholder={placeholder}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          type="submit"
          variant={btn.variant === "danger" ? "danger" : "primary"}
          disabled={pending || (required && !note.trim())}
        >
          {pending ? "Working…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
