import { customAlphabet, nanoid } from "nanoid";

/** Prefixed, sortable-enough ids: "job_V1StGXR8_Z5jdHi6B". */
export function newId(prefix: string): string {
  return `${prefix}_${nanoid(16)}`;
}

const codeAlphabet = customAlphabet("23456789", 4);
/** Human job code crews can say out loud, e.g. "TL-4821". */
export function newJobCode(prefix = "TL"): string {
  return `${prefix}-${codeAlphabet()}`;
}

/** Unguessable token for homeowner links. */
export function newToken(): string {
  return nanoid(24);
}
