/**
 * Optional external trigger for the testimonial expiry sweep (48h without a reply -> job moves on to content).
 * The worker already runs the sweep hourly by itself; this route only queues it now (idempotent: one sweep
 * is ever queued), so an external scheduler can't make the request do slow work.
 * Protected by CRON_SECRET as a Bearer token; in production the route is disabled without one.
 */
import { env, isProduction } from "@/lib/config";
import { enqueueExpirySweep } from "@/lib/tasks";
import { isAuthorised } from "../auth";

async function handle(req: Request) {
  const secret = env.cronSecret;
  if (!secret && isProduction()) return new Response("Cron disabled: CRON_SECRET is not set", { status: 503 });
  if (secret && !isAuthorised(req.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id, deduped } = await enqueueExpirySweep();
  return Response.json({ queued: id, alreadyQueued: deduped });
}

export const GET = handle;
export const POST = handle;
