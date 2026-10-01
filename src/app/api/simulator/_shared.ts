/**
 * Shared bits for the in-app WhatsApp simulator (demo & review tool).
 * Enabled when real WhatsApp isn't configured, or explicitly with SIMULATOR=on; SIMULATOR=off disables it.
 * With Twilio live it's off by default, so a demo click can never message a real customer.
 */
import { and, asc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isSimulatorMessaging } from "@/lib/config";
import { getTenantBySlug } from "@/lib/tenants";

export function simulatorEnabled(): boolean {
  if (process.env.SIMULATOR === "off") return false;
  return process.env.SIMULATOR === "on" || isSimulatorMessaging();
}

export const notFound = () => Response.json({ error: "Simulator disabled" }, { status: 404 });

export type Persona = {
  phone: string;
  name: string;
  subtitle: string;
  kind: "crew" | "customer" | "unknown";
};

export const UNKNOWN_PERSONA: Persona = {
  phone: "+447700900999",
  name: "Unknown number",
  subtitle: "Not crew, not a customer",
  kind: "unknown",
};

const ROLE_LABEL: Record<string, string> = { owner: "Owner", foreman: "Foreman", crew: "Crew", admin: "Admin" };

export async function listPersonas(): Promise<{ tenantId: string; tenantName: string; personas: Persona[] }> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const crew = await db
    .select()
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, tenant.id), eq(schema.crewMembers.active, true)))
    .orderBy(asc(schema.crewMembers.phone));
  const customers = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.tenantId, tenant.id))
    .orderBy(asc(schema.customers.phone));
  // Marco first: the foreman is the star of the capture demo.
  const rank = (role: string) => ({ foreman: 0, crew: 1, owner: 2 })[role] ?? 3;
  const personas: Persona[] = [
    ...crew
      .sort((a, b) => rank(a.role) - rank(b.role))
      .map((c) => ({
        phone: c.phone,
        name: c.name,
        subtitle: `${ROLE_LABEL[c.role] ?? c.role} · ${c.team === "maintenance" ? "maintenance" : "landscaping"}`,
        kind: "crew" as const,
      })),
    ...customers
      .filter((c) => c.phone)
      .map((c) => ({
        phone: c.phone!,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.phone!,
        subtitle: `Customer${c.area ? ` · ${c.area}` : ""}`,
        kind: "customer" as const,
      })),
    UNKNOWN_PERSONA,
  ];
  return { tenantId: tenant.id, tenantName: tenant.name, personas };
}

export type SimMessage = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  mediaUrls: string[];
  options: { id: string; title: string }[];
  status: string;
  error: string | null;
  createdAt: string;
};

export async function conversationFor(tenantId: string, phone: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.tenantId, tenantId),
        or(
          and(eq(schema.messages.direction, "in"), eq(schema.messages.fromNumber, phone)),
          and(eq(schema.messages.direction, "out"), eq(schema.messages.toNumber, phone)),
        ),
      ),
    )
    .orderBy(asc(schema.messages.createdAt));
  const [customer] = await db
    .select({ optedOut: schema.customers.optedOut })
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, phone)));
  const messages: SimMessage[] = rows.slice(-150).map((m) => ({
    id: m.id,
    direction: m.direction,
    body: m.body,
    mediaUrls: m.mediaUrls,
    options: m.options,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
  }));
  return { messages, optedOut: customer?.optedOut ?? false };
}
