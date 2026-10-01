/**
 * Dashboard auth gate.
 * - ADMIN_PASSWORD set: every non-public path needs a valid signed session cookie; pages redirect to /login,
 *   API calls get a 401.
 * - Zero-config local demo (not production, or DEMO_MODE=on): everything is open, as before.
 * - Production with no password and no demo opt-in: private paths get a 503 config error instead of being
 *   silently left open (P1-2).
 * Public paths (homeowner links, previews, webhooks, lead capture…) are never gated.
 */
import { NextResponse, type NextRequest } from "next/server";
import { MISCONFIGURED_MESSAGE, SESSION_COOKIE, authMode, isPublicPath, verifySessionToken } from "@/lib/dashboard/auth";

function misconfigured(pathname: string): NextResponse {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: MISCONFIGURED_MESSAGE }, { status: 503 });
  }
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard unavailable</title></head>
<body style="font-family:system-ui,sans-serif;background:#2f3a22;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<main style="max-width:28rem"><h1 style="font-size:1.4rem">Dashboard unavailable</h1>
<p style="opacity:.8;line-height:1.5">${MISCONFIGURED_MESSAGE}</p></main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const mode = authMode();
  if (mode === "open") return NextResponse.next();
  if (mode === "misconfigured") return misconfigured(pathname);

  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, process.env.ADMIN_PASSWORD ?? "");
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals and static files with an extension; the rest is decided by isPublicPath().
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|webp|svg|ico|css|js|woff2?|mp4)$).*)"],
};
