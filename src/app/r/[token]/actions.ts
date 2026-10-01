"use server";
/**
 * Homeowner actions. Public by design (the unguessable token is the credential); all validation happens in
 * the testimonials module. Content generation is only queued here, so the homeowner sees their thank-you instantly.
 */
import { revalidatePath } from "next/cache";
import { submitTestimonial, withdrawConsentByToken, type SubmitResult } from "@/lib/testimonials";

export type ReviewFormState = SubmitResult | null;
export type WithdrawState = { ok: boolean; message: string } | null;

const yesNo = (v: FormDataEntryValue | null): boolean | undefined =>
  v === "yes" ? true : v === "no" ? false : undefined;

export async function submitReviewAction(_prev: ReviewFormState, form: FormData): Promise<ReviewFormState> {
  const token = String(form.get("token") ?? "");
  const rating = Number(form.get("rating"));
  const input = {
    rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    quote: String(form.get("quote") ?? ""),
    consentPhotos: yesNo(form.get("consentPhotos")),
    consentArea: yesNo(form.get("consentArea")),
    consentFirstName: yesNo(form.get("consentFirstName")),
    consentQuote: yesNo(form.get("consentQuote")),
    maintenanceInterest: yesNo(form.get("maintenanceInterest")) ?? null,
  };
  return submitTestimonial(token, input);
}

export async function withdrawConsentAction(_prev: WithdrawState, form: FormData): Promise<WithdrawState> {
  const token = String(form.get("token") ?? "");
  try {
    const result = await withdrawConsentByToken(token);
    if (!result) return { ok: false, message: "There's nothing to withdraw on this link." };
    revalidatePath(`/r/${token}`);
    return { ok: true, message: "Done. We won't use your photos, words, name or area, and anything already online is being taken down." };
  } catch (err) {
    console.error("[r] withdraw failed", err);
    return { ok: false, message: "Sorry, that didn't work. Please try again, or reply to our WhatsApp message." };
  }
}
