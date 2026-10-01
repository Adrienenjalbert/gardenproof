/**
 * Pure planning: given a job's situation, which messages should exist and when. No DB, so every timing
 * decision (quiet hours, reminders whose moment has passed, missing recipients) is unit-tested.
 */
import type { TrustTier } from "@/lib/crm";
import { RULES, instanceKey, type Audience, type Rule, type RuleContext } from "./rules";
import { outsideQuietHours } from "./time";

export type Planned = {
  ruleKey: string;
  rule: Rule;
  audience: Audience;
  trustTier: TrustTier;
  sendAt: Date;
  body: string;
  reason: string;
  customerId: string | null;
  crewId: string | null;
};

function recipientOk(rule: Rule, ctx: RuleContext): boolean {
  if (rule.audience === "customer") return !!ctx.customer?.phone && !ctx.customer.optedOut;
  if (rule.audience === "crew") return !!ctx.crewLead;
  return true;
}

/**
 * When a rule's message should go, or null when it no longer makes sense:
 * - anchored reminders (visit, start) whose moment has already passed are dropped;
 * - a reminder that would land after the thing it reminds about (after a quiet-hours shift) is dropped;
 * - anything else that is overdue goes now; customer messages never go between 20:00 and 08:00 (→ 08:30).
 */
export function sendTimeFor(rule: Rule, ctx: RuleContext): Date | null {
  const planned = rule.when(ctx);
  if (!planned) return null;
  const anchor = rule.anchor?.(ctx) ?? null;
  const isReminderOf =
    rule.anchor && ctx.job.nextActionAt && anchor && anchor.getTime() === ctx.job.nextActionAt.getTime();
  if (isReminderOf && anchor!.getTime() <= ctx.now.getTime()) return null;
  let at = planned.getTime() < ctx.now.getTime() ? ctx.now : planned;
  if (rule.audience === "customer") at = outsideQuietHours(at);
  if (isReminderOf && at.getTime() >= anchor!.getTime()) return null;
  return at;
}

export function planMessages(ctx: RuleContext, rules: readonly Rule[] = RULES): Planned[] {
  const out: Planned[] = [];
  for (const rule of rules) {
    if (rule.stage !== ctx.job.stage || !recipientOk(rule, ctx)) continue;
    const key = instanceKey(rule, ctx);
    const sendAt = key ? sendTimeFor(rule, ctx) : null;
    if (!key || !sendAt) continue;
    const { body, reason } = rule.compose(ctx);
    out.push({
      ruleKey: key,
      rule,
      audience: rule.audience,
      trustTier: rule.trustTier,
      sendAt,
      body,
      reason,
      customerId: rule.audience === "customer" ? (ctx.customer?.id ?? null) : null,
      crewId: rule.audience === "crew" ? (ctx.crewLead?.id ?? null) : null,
    });
  }
  return out;
}

/**
 * Quick-yes items earn automatic sending after the owner has consistently said yes: at least one of this
 * rule's messages was sent `days` or more ago, and none was skipped in the last `days` days.
 */
export function quickYesEarned(
  history: ReadonlyArray<{ status: string; createdAt: Date }>,
  days: number | null,
  now: Date,
): boolean {
  if (!days) return false;
  const cutoff = now.getTime() - days * 24 * 3600_000;
  const approvedLongAgo = history.some((h) => h.status === "sent" && h.createdAt.getTime() <= cutoff);
  const skippedRecently = history.some((h) => h.status === "skipped" && h.createdAt.getTime() > cutoff);
  return approvedLongAgo && !skippedRecently;
}
