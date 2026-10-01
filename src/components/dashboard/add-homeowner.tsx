"use client";
/**
 * P0-4: crew-captured jobs have no homeowner, so nobody can be asked for consent and nothing can ever publish.
 * The operator adds the homeowner here; the customers module links them and prepares the review request
 * (held for approval in safe mode).
 */
import { useId, useState, useTransition } from "react";
import { attachHomeownerAction } from "@/lib/dashboard/actions";
import { Button, Input, Label } from "@/components/ui/primitives";
import { toast } from "./toaster";

export function AddHomeownerForm({ jobId, safeMode }: { jobId: string; safeMode: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const form = e.currentTarget;
        start(async () => {
          const r = await attachHomeownerAction({
            jobId,
            firstName: String(fd.get("firstName") ?? ""),
            phone: String(fd.get("phone") ?? ""),
            postcode: String(fd.get("postcode") ?? ""),
          });
          setError(r.ok ? null : r.error);
          toast(r);
          if (r.ok) form.reset();
        });
      }}
      aria-describedby={error ? `${id}-err` : `${id}-help`}
    >
      <div>
        <Label htmlFor={`${id}-first`}>First name</Label>
        <Input id={`${id}-first`} name="firstName" required maxLength={60} autoComplete="off" placeholder="Harriet" />
      </div>
      <div>
        <Label htmlFor={`${id}-phone`}>Mobile</Label>
        <Input id={`${id}-phone`} name="phone" type="tel" required inputMode="tel" autoComplete="off" placeholder="07700 900123" />
      </div>
      <div>
        <Label htmlFor={`${id}-pc`} hint="optional">
          Postcode
        </Label>
        <Input id={`${id}-pc`} name="postcode" maxLength={10} autoComplete="off" placeholder="SW19 4AB" className="uppercase" />
      </div>
      <Button type="submit" variant="primary" icon="user" disabled={pending}>
        {pending ? "Adding…" : "Add homeowner"}
      </Button>
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted sm:col-span-4">
        We&apos;ll prepare a WhatsApp review request asking them to rate the job and choose what we may show (photos,
        their words, area, first name).{" "}
        {safeMode ? "Safe mode is on, so it waits in Messages until you approve it." : "It is sent straight away."} Their
        address and surname are never published.
      </p>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-red-700 sm:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}
