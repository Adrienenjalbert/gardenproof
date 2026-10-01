"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/config";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, passwordMatches, safeNextPath } from "@/lib/dashboard/auth";
import { LoginThrottle, clientIp } from "@/lib/dashboard/throttle";

export type LoginState = { error: string | null };

const LoginInput = z.object({ password: z.string().min(1, "Enter the dashboard password.").max(200), next: z.string().max(500) });

/** One throttle per server instance (kept on globalThis so dev hot reloads don't reset it). */
const g = globalThis as unknown as { __gpLoginThrottle?: LoginThrottle };
const throttle = (g.__gpLoginThrottle ??= new LoginThrottle());

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({ password: formData.get("password") ?? "", next: formData.get("next") ?? "/" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const secret = env.adminPassword;
  if (!secret) redirect("/"); // auth disabled (demo)

  const ip = clientIp(await headers());
  const wait = throttle.retryAfter(ip);
  if (wait > 0) {
    return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} minute${wait > 60_000 ? "s" : ""}.` };
  }
  if (!(await passwordMatches(parsed.data.password, secret))) {
    throttle.recordFailure(ip);
    // Small fixed delay on top of the throttle so a burst of parallel guesses stays slow.
    await new Promise((r) => setTimeout(r, 400));
    return { error: "That password isn't right." };
  }
  throttle.recordSuccess(ip);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  redirect(safeNextPath(parsed.data.next));
}

/** Clears this browser's cookie. To revoke every session (e.g. a lost laptop) bump SESSION_VERSION. */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
