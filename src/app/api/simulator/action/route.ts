/**
 * POST /api/simulator/action — demo shortcuts so the whole loop can be shown from one screen:
 *   { action: "approve" | "cancel", messageId }  agency decision on a held customer message
 *   { action: "request_review", phone }          as if the customer's latest job had just been wrapped
 * The real approval UI lives in the dashboard; these call the same library functions.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { approveHeldMessage, cancelHeldMessage, normalisePhone } from "@/lib/messaging";
import { requestTestimonial } from "@/lib/testimonials";
import { listPersonas, notFound, simulatorEnabled } from "../_shared";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve", "cancel"]), messageId: z.string().min(1) }),
  z.object({ action: z.literal("request_review"), phone: z.string().min(5) }),
]);

export async function POST(req: Request) {
  if (!simulatorEnabled()) return notFound();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  const input = parsed.data;

  try {
    if (input.action !== "request_review") {
      const decide = input.action === "approve" ? approveHeldMessage : cancelHeldMessage;
      return Response.json({ message: await decide(input.messageId, "simulator") });
    }

    const { tenantId } = await listPersonas();
    const db = await getDb();
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, normalisePhone(input.phone))));
    if (!customer) return Response.json({ error: "Not a customer" }, { status: 400 });
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.customerId, customer.id), inArray(schema.jobs.status, ["captured", "awaiting_testimonial", "ready_for_content", "content_draft", "in_review"])))
      .orderBy(desc(schema.jobs.completedAt));
    if (!job) return Response.json({ error: "This customer has no finished job yet" }, { status: 400 });
    const sent = await requestTestimonial(job.id);
    return Response.json({ ok: sent, jobCode: job.code });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
