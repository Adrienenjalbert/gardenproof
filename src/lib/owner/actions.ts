"use server";
/**
 * Server Actions for the owner app. Each one re-checks the session (actions are public POST endpoints),
 * validates input, does one thing, and returns a short sentence for the toast. Errors come back as text.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { CRM_STAGES } from "@/lib/crm";
import {
  ApprovalError,
  INSTANT_KINDS,
  OutputsInput,
  StageError,
  TONES,
  approveScheduledMessage,
  editScheduledMessage,
  moveJobToStage,
  previewStageMove,
  replan,
  saveSettings,
  skipScheduledMessage,
} from "@/lib/crm-engine";
import { DashboardError, approveAsset, rejectAsset } from "@/lib/dashboard/service";
import { UnauthorisedError, requireAgency } from "@/lib/dashboard/session";
import { TEAMS } from "@/lib/domain";
import { approveHeldMessage } from "@/lib/messaging";
import { requestUnpublish } from "@/lib/pipeline";
import { getTenantBySlug } from "@/lib/tenants";
import { TeamError, removeMember, saveMember } from "./team";
import { STAGE_WORDS, capitalise, plural, when } from "./words";

export type OwnerResult = { ok: true; message: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(120);
const ACTOR = "owner";

async function run<T>(
  schema: z.ZodType<T>,
  input: unknown,
  fn: (v: T, tenantId: string) => Promise<string>,
): Promise<OwnerResult> {
  try {
    await requireAgency();
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Please check and try again.",
      };
    const tenant = await getTenantBySlug();
    const message = await fn(parsed.data, tenant.id);
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (err) {
    if ([ApprovalError, StageError, DashboardError, TeamError, UnauthorisedError].some((E) => err instanceof E)) {
      return { ok: false, error: (err as Error).message };
    }
    console.error("[owner action]", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

async function ownJob(tenantId: string, jobId: string) {
  const db = await getDb();
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.tenantId, tenantId)));
  if (!job) throw new StageError("That job no longer exists.");
  return job;
}

const StageInput = z.object({
  jobId: id,
  stage: z.enum(CRM_STAGES),
  at: z.iso.datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

export type PlannedPreview = {
  label: string;
  to: string;
  when: string;
  asks: boolean;
};

/** What moving the job would send (shown in the confirm sheet). Read-only. */
export async function previewStageAction(input: z.input<typeof StageInput>): Promise<PlannedPreview[]> {
  await requireAgency();
  const v = StageInput.parse(input);
  const tenant = await getTenantBySlug();
  await ownJob(tenant.id, v.jobId);
  const now = new Date();
  const plan = await previewStageMove(
    v.jobId,
    v.stage,
    v.at === undefined ? undefined : v.at ? new Date(v.at) : null,
    now,
  );
  return plan.map((p) => ({
    label: p.rule.label,
    to: p.audience === "crew" ? "the crew lead" : p.audience === "owner" ? "you" : "the customer",
    when: capitalise(when(p.sendAt, now)),
    asks: p.trustTier !== "automatic",
  }));
}

export async function moveStageAction(input: z.input<typeof StageInput>): Promise<OwnerResult> {
  return run(StageInput, input, async (v, tenantId) => {
    await ownJob(tenantId, v.jobId);
    const r = await moveJobToStage(v.jobId, v.stage, ACTOR, v.note, {
      at: v.at === undefined ? undefined : v.at ? new Date(v.at) : null,
    });
    const n = r.planned.length;
    return `Moved to ${STAGE_WORDS[v.stage]}.${n ? ` ${plural(n, "message")} planned.` : ""}`;
  });
}

export async function setJobTeamAction(input: { jobId: string; team: string }): Promise<OwnerResult> {
  return run(z.object({ jobId: id, team: z.enum(TEAMS) }), input, async (v, tenantId) => {
    await ownJob(tenantId, v.jobId);
    const db = await getDb();
    const [job] = await db
      .update(schema.jobs)
      .set({ team: v.team, updatedAt: new Date() })
      .where(eq(schema.jobs.id, v.jobId))
      .returning();
    await replan(job, new Date());
    return `Now with the ${v.team} team.`;
  });
}

export async function sendNowAction(scheduledId: string): Promise<OwnerResult> {
  return run(id, scheduledId, async (v, tenantId) => {
    const out = await approveScheduledMessage(tenantId, v, ACTOR);
    if (out.status === "scheduled") return out.note ?? "It will go first thing tomorrow.";
    if (out.status === "cancelled") return out.note ?? "Not sent.";
    return "Sent.";
  });
}

export async function approveManyAction(input: { ids: string[]; done?: string }): Promise<OwnerResult> {
  return run(
    z.object({
      ids: z.array(id).min(1).max(50),
      done: z.string().max(120).optional(),
    }),
    input,
    async (v, tenantId) => {
      let later = 0;
      for (const sid of v.ids) {
        const out = await approveScheduledMessage(tenantId, sid, ACTOR);
        if (out.status === "scheduled") later++;
      }
      if (later) return "Done. It's late, so they go first thing tomorrow.";
      return v.done ?? "Sent.";
    },
  );
}

export async function skipMessageAction(scheduledId: string): Promise<OwnerResult> {
  return run(id, scheduledId, async (v, tenantId) => {
    await skipScheduledMessage(tenantId, v, ACTOR);
    return "Skipped. It won't be sent.";
  });
}

export async function editMessageAction(input: { id: string; body: string }): Promise<OwnerResult> {
  return run(z.object({ id, body: z.string().max(1000) }), input, async (v, tenantId) => {
    await editScheduledMessage(tenantId, v.id, v.body, ACTOR);
    return "Saved.";
  });
}

export async function approvePageAction(assetId: string): Promise<OwnerResult> {
  return run(id, assetId, async (v) => {
    const r = await approveAsset(v, ACTOR);
    if (r.publishError) throw new DashboardError("Approved. It couldn't go live just yet; we'll sort it out.");
    return "Approved. It will be live in a moment.";
  });
}

export async function approveVideosAction(ids: string[]): Promise<OwnerResult> {
  return run(z.array(id).min(1).max(20), ids, async (v) => {
    for (const a of v) await approveAsset(a, ACTOR);
    return "Approved.";
  });
}

export async function hideAssetsAction(input: { ids: string[]; live: boolean }): Promise<OwnerResult> {
  return run(z.object({ ids: z.array(id).min(1).max(20), live: z.boolean() }), input, async (v) => {
    for (const a of v.ids) {
      if (v.live) await requestUnpublish(a, "Hidden by the owner");
      else await rejectAsset(a, "Hidden by the owner", ACTOR);
    }
    return v.live ? "Taking it down." : "Hidden.";
  });
}

export async function sendHeldRequestAction(messageId: string): Promise<OwnerResult> {
  return run(id, messageId, async (v, tenantId) => {
    const db = await getDb();
    const [m] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, v), eq(schema.messages.tenantId, tenantId)));
    if (!m) throw new ApprovalError("That message no longer exists.");
    const out = await approveHeldMessage(v, ACTOR);
    return out.status === "sent"
      ? "Sent. We'll let you know when they reply."
      : "Not sent: they asked not to be messaged.";
  });
}

export async function saveMemberAction(input: unknown): Promise<OwnerResult> {
  return run(z.unknown(), input, async (v, tenantId) => {
    const m = await saveMember(tenantId, v, ACTOR);
    return `${m.name} saved.`;
  });
}

export async function removeMemberAction(memberId: string): Promise<OwnerResult> {
  return run(id, memberId, async (v, tenantId) => {
    await removeMember(tenantId, v, ACTOR);
    return "Removed from the team.";
  });
}

export async function saveNotificationsAction(input: unknown): Promise<OwnerResult> {
  const Input = z.object({
    instant: z.array(z.enum(INSTANT_KINDS)),
    digestHour: z.number().int().min(0).max(23).nullable(),
    autoApproveAfterDays: z.number().int().min(1).max(365).nullable(),
    autoSendRoutine: z.boolean(),
  });
  return run(Input, input, async (v, tenantId) => {
    await saveSettings(tenantId, {
      notifications: {
        instant: v.instant,
        digestHour: v.digestHour,
        autoApproveAfterDays: v.autoApproveAfterDays,
      },
      autoSendRoutine: v.autoSendRoutine,
    });
    return "Saved.";
  });
}

export async function saveStyleAction(input: unknown): Promise<OwnerResult> {
  return run(
    z.object({
      tone: z.enum(TONES),
      signOff: z.string().trim().max(80).nullable(),
    }),
    input,
    async (v, tenantId) => {
      await saveSettings(tenantId, {
        style: { tone: v.tone, signOff: v.signOff || null },
      });
      return "Saved. New messages will sound like this.";
    },
  );
}

export async function saveOutputsAction(input: unknown): Promise<OwnerResult> {
  return run(OutputsInput, input, async (v, tenantId) => {
    await saveSettings(tenantId, { outputs: v });
    return "Saved. The next finished job uses this.";
  });
}
