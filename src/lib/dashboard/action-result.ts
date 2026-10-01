/** Result every dashboard Server Action returns (kept outside the "use server" file so it can be shared). */
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
