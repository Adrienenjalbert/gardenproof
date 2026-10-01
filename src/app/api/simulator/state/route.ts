/** GET /api/simulator/state?phone=+44… — personas plus the chat for one phone (polled by the simulator). */
import { normalisePhone } from "@/lib/messaging";
import { conversationFor, listPersonas, notFound, simulatorEnabled } from "../_shared";

export async function GET(req: Request) {
  if (!simulatorEnabled()) return notFound();
  const { tenantId, tenantName, personas } = await listPersonas();
  const raw = new URL(req.url).searchParams.get("phone");
  const phone = raw ? normalisePhone(raw) : personas[0]?.phone;
  const chat = phone ? await conversationFor(tenantId, phone) : { messages: [], optedOut: false };
  return Response.json({ tenantName, personas, phone, ...chat }, { headers: { "cache-control": "no-store" } });
}
