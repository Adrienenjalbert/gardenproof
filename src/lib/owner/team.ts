/** The team: who's who, which team they're on and what they can do. */
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { CrewMember } from "@/db/schema";
import { TEAM_ROLES, type TeamRole } from "@/lib/crm";
import { TEAMS, type CrewRole } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { parseUkMobile } from "@/lib/messaging";
import { prettyPhone } from "./words";

export class TeamError extends Error {}

export const ROLE_WORDS: Record<TeamRole, { label: string; hint: string }> = {
  owner: {
    label: "Owner",
    hint: "Gets the important things and the evening summary",
  },
  office: { label: "Office", hint: "Can see everything and send messages" },
  crew_lead: { label: "Crew lead", hint: "Gets job notes and sends photos" },
  crew: { label: "Crew", hint: "Sends photos from site" },
};

/** The WhatsApp capture bot still reads the v1 role; keep it in step. */
const LEGACY_ROLE: Record<TeamRole, CrewRole> = {
  owner: "owner",
  office: "admin",
  crew_lead: "foreman",
  crew: "crew",
};

export type TeamMemberView = {
  id: string;
  name: string;
  phone: string;
  phonePretty: string;
  team: CrewMember["team"];
  teamRole: TeamRole;
  roleLabel: string;
  active: boolean;
};

export const MemberInput = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().trim().min(1, "Add their name.").max(60),
  phone: z.string().trim().min(1, "Add their mobile number."),
  team: z.enum(TEAMS),
  teamRole: z.enum(TEAM_ROLES),
});
export type MemberInputT = z.infer<typeof MemberInput>;

const view = (c: CrewMember): TeamMemberView => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  phonePretty: prettyPhone(c.phone) ?? c.phone,
  team: c.team,
  teamRole: c.teamRole,
  roleLabel: ROLE_WORDS[c.teamRole].label,
  active: c.active,
});

export async function listTeam(tenantId: string): Promise<TeamMemberView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.crewMembers)
    .where(eq(schema.crewMembers.tenantId, tenantId))
    .orderBy(asc(schema.crewMembers.createdAt));
  const order = (r: TeamRole) => TEAM_ROLES.indexOf(r);
  return rows
    .filter((r) => r.active)
    .map(view)
    .sort((a, b) => order(a.teamRole) - order(b.teamRole) || a.name.localeCompare(b.name));
}

export async function saveMember(tenantId: string, raw: unknown, actor = "owner"): Promise<TeamMemberView> {
  const input = MemberInput.safeParse(raw);
  if (!input.success) throw new TeamError(input.error.issues[0]?.message ?? "Please check the details.");
  const v = input.data;
  const phone = parseUkMobile(v.phone);
  if (!phone) throw new TeamError("That doesn't look like a UK mobile number (e.g. 07700 900123).");
  const db = await getDb();
  const [clash] = await db
    .select({ id: schema.crewMembers.id, name: schema.crewMembers.name })
    .from(schema.crewMembers)
    .where(
      and(
        eq(schema.crewMembers.tenantId, tenantId),
        eq(schema.crewMembers.phone, phone),
        v.id ? ne(schema.crewMembers.id, v.id) : undefined,
      ),
    );
  if (clash) throw new TeamError(`${clash.name} already uses that number.`);

  const values = {
    name: v.name,
    phone,
    team: v.team,
    teamRole: v.teamRole,
    role: LEGACY_ROLE[v.teamRole],
    active: true,
  };
  let row: CrewMember | undefined;
  if (v.id) {
    [row] = await db
      .update(schema.crewMembers)
      .set(values)
      .where(and(eq(schema.crewMembers.id, v.id), eq(schema.crewMembers.tenantId, tenantId)))
      .returning();
    if (!row) throw new TeamError("That person is no longer on the team.");
  } else {
    [row] = await db
      .insert(schema.crewMembers)
      .values({ id: newId("crw"), tenantId, ...values })
      .returning();
  }
  await logEvent({
    tenantId,
    type: v.id ? "team.updated" : "team.added",
    entity: "crew_member",
    entityId: row.id,
    actor,
    data: { teamRole: v.teamRole, team: v.team },
  });
  return view(row);
}

/** Remove someone from the team (kept for history; they stop receiving anything). */
export async function removeMember(tenantId: string, id: string, actor = "owner"): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.id, id), eq(schema.crewMembers.tenantId, tenantId)));
  if (!row) return;
  if (row.teamRole === "owner") throw new TeamError("The owner can't be removed.");
  await db.update(schema.crewMembers).set({ active: false }).where(eq(schema.crewMembers.id, id));
  await logEvent({
    tenantId,
    type: "team.removed",
    entity: "crew_member",
    entityId: id,
    actor,
  });
}
