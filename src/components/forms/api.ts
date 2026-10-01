/** Browser calls to the token-scoped form API. Same-origin JSON only (see app/api/forms/guards.ts). */
import type { Answers, PhotoValue, PostcodeValue } from "@/lib/forms/types";

export type ApiError = { ok: false; error: string; code?: string; stepId?: string; path?: string };
type Saved = { ok: true; value: unknown; answers: Answers; index: number; remaining: number; total: number };

async function call<T>(url: string, init: RequestInit): Promise<T | ApiError> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as (T & { ok: boolean }) | ApiError | null;
    if (!body) return { ok: false, error: "Something went wrong. Please try again." };
    return body as T | ApiError;
  } catch {
    return { ok: false, error: "You seem to be offline. Your earlier answers are saved." };
  }
}

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const saveAnswerApi = (token: string, stepId: string, value: unknown) => call<Saved>(`/api/forms/${token}/answer`, post({ stepId, value }));

export const completeApi = (token: string) => call<{ ok: true; alreadyCompleted: boolean }>(`/api/forms/${token}/complete`, post({}));

export const postcodeApi = (token: string, q: string) =>
  call<{ ok: true; place: PostcodeValue }>(`/api/forms/${token}/postcode?q=${encodeURIComponent(q)}`, { method: "GET" });

export const uploadPhotoApi = (token: string, blob: Blob) => {
  const fd = new FormData();
  fd.append("file", blob, "photo.jpg");
  return call<{ ok: true; photo: PhotoValue; url: string }>(`/api/forms/${token}/upload`, { method: "POST", body: fd });
};

export const isError = (r: { ok: boolean }): r is ApiError => !r.ok;
