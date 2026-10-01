/**
 * Crew capture conversation as a pure state machine: reduce(state, inbound, ctx) -> { state, effects }.
 *
 * Designed for the Muddy Boots Problem: every question is answerable with one tap (or "1", "2"…),
 * photos need no words, and nothing ever requires typing. Typing still works as a shortcut
 * (job codes, postcodes, "done", "help").
 *
 * Fast path (photos first): photos → service → area → Next → … → Finish job → photos → Done → Skip = 6 taps.
 * After Done one optional question asks for the homeowner's contact (card or typed mobile) so the office
 * can request a review; Skip is a single tap and sending photos simply moves on.
 */
import type { MediaStage } from "@/lib/domain";
import { parseUkMobile } from "@/lib/messaging/format";
import type { MessageOption } from "@/lib/messaging/types";
import { initialBotState } from "./types";
import type { BotContext, BotEffect, BotState, BotStep, InboundEvent, JobSummary, ReduceResult } from "./types";

/** Photos sent in one go arrive as separate messages; reply to the first, stay quiet for the rest. */
export const MEDIA_BURST_MS = 30_000;
const UNKNOWN_REPLY_EVERY_MS = 24 * 3600_000;

const STEPS: BotStep[] = ["idle", "pick_job", "service", "postcode", "before", "working", "after", "homeowner"];

export function coerceState(raw: unknown): BotState {
  const s = raw as Partial<BotState> | null | undefined;
  if (!s || s.v !== 1 || !STEPS.includes(s.step as BotStep)) return initialBotState();
  const homeowner = s.homeowner && typeof s.homeowner.jobId === "string" && typeof s.homeowner.code === "string" ? s.homeowner : null;
  const state = {
    ...initialBotState(),
    ...s,
    lastOptions: Array.isArray(s.lastOptions) ? s.lastOptions : [],
    homeowner,
  } as BotState;
  return state.step === "homeowner" && !homeowner ? { ...state, step: "idle" } : state;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const reply = (body: string, options: MessageOption[] = [], mediaUrls: string[] = []): BotEffect => ({
  type: "reply",
  body,
  ...(options.length ? { options } : {}),
  ...(mediaUrls.length ? { mediaUrls } : {}),
});

/** Keeps `lastOptions` in sync with the last reply, so numbered answers always refer to what was on screen. */
function done(state: BotState, effects: BotEffect[]): ReduceResult {
  const last = [...effects].reverse().find((e) => e.type === "reply");
  return {
    state: { ...state, lastOptions: last && last.type === "reply" ? (last.options ?? []) : state.lastOptions },
    effects,
  };
}

function normText(t: string): string {
  return t.toLowerCase().trim().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
}

function resolveChoice(state: BotState, ev: InboundEvent): string | null {
  if (ev.choiceId) return ev.choiceId;
  const t = ev.text.trim();
  if (/^\d{1,2}$/.test(t)) return state.lastOptions[Number(t) - 1]?.id ?? null;
  const n = normText(t);
  return state.lastOptions.find((o) => normText(o.title) === n)?.id ?? null;
}

type Command = "help" | "status" | "switch" | "cancel" | "new";
const COMMANDS: Record<string, Command> = {
  help: "help", "?": "help", menu: "help", commands: "help",
  status: "status", "where am i": "status",
  switch: "switch", "switch job": "switch", "change job": "switch", jobs: "switch", "other job": "switch",
  cancel: "cancel", "cancel job": "cancel", abort: "cancel",
  new: "new", "new job": "new", start: "new", "start job": "new", "start a new job": "new",
};

/** Words that mean "move on" — mapped to whatever the current step's primary button is. */
const PROCEED_WORDS = new Set(["done", "finish", "finished", "finish job", "next", "ok", "all done", "skip", "complete"]);

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/;
export function parsePostcode(text: string): string | null {
  const m = text.toUpperCase().trim().match(POSTCODE_RE);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}
const outward = (pc: string) => pc.toUpperCase().trim().split(/\s+/)[0].replace(/(\d[A-Z]{2})$/, "");

function findJobByText(text: string, jobs: JobSummary[]): JobSummary | null {
  const code = text.toUpperCase().match(/\b(?:[A-Z]{2}-?)?(\d{4})\b/);
  if (code) {
    const hit = jobs.find((j) => j.code.endsWith(code[1]));
    if (hit) return hit;
  }
  const pc = parsePostcode(text);
  if (pc) {
    const flat = pc.replace(/\s/g, "");
    return (
      jobs.find((j) => j.postcode && j.postcode.toUpperCase().replace(/\s/g, "") === flat) ??
      jobs.find((j) => j.postcode && outward(j.postcode) === outward(pc)) ??
      null
    );
  }
  return null;
}

function bump(job: JobSummary, stage: MediaStage, ev: InboundEvent): JobSummary {
  const visual = ev.media.filter((m) => m.kind !== "audio").length;
  const audio = ev.media.length - visual;
  return { ...job, counts: { ...job.counts, [stage]: job.counts[stage] + visual, audio: job.counts.audio + audio } };
}

function jobLabel(job: JobSummary): string {
  return [job.code, job.serviceLabel, job.area].filter(Boolean).join(" · ");
}

function jobMenu(ctx: BotContext): MessageOption[] {
  return [
    ...ctx.openJobs.slice(0, 5).map((j) => ({
      id: `job:${j.id}`,
      title: `${j.code} · ${j.area ?? j.serviceLabel ?? "new"}`.slice(0, 60),
    })),
    { id: "job:new", title: "Start a new job" },
  ];
}

const serviceOptions = (ctx: BotContext): MessageOption[] =>
  ctx.services.slice(0, 7).map((s) => ({ id: `svc:${s.key}`, title: s.label }));

const areaOptions = (ctx: BotContext): MessageOption[] => [
  ...ctx.areas.slice(0, 6).map((a) => ({ id: `pc:${a.postcode}`, title: `${a.label} (${a.postcode})` })),
  { id: "pc:skip", title: "Skip for now" },
];

/** Where a picked-up job should resume, based on what it already has. */
function resumeStep(job: JobSummary): BotStep {
  if (!job.service) return "service";
  if (job.counts.before === 0) return "before";
  if (job.counts.after > 0) return "after";
  return "working";
}

/** The question for a step. Used for first asks, re-asks after off-script input, and "status". */
function prompt(step: BotStep, job: JobSummary | null, ctx: BotContext): BotEffect {
  if (!job || step === "idle" || step === "pick_job") {
    return reply("Which job? Or just send the before photos and I'll start a new one.", jobMenu(ctx));
  }
  const c = job.counts;
  switch (step) {
    case "service":
      return reply(`What's the job for ${job.code}?`, serviceOptions(ctx));
    case "postcode":
      return reply("Where is it? Tap the area, or type the postcode.", areaOptions(ctx));
    case "before":
      return c.before === 0
        ? reply("Send the BEFORE photos: wide shots from each corner, before anything moves.")
        : reply(
            `${plural(c.before, "before photo")} saved. Send more, or a voice note with the brief. Tap Next to start work.`,
            [{ id: "before:next", title: "Next: start work" }],
          );
    case "working":
      return reply(`${job.code} is under way. Send progress photos any time. Tap Finish job when it's done.`, [
        { id: "work:finish", title: "Finish job" },
      ]);
    case "after":
      return c.after === 0
        ? job.firstBeforeUrl
          ? reply(
              "Now the AFTER photos. Stand where you took this one so the before and after line up.",
              [],
              [job.firstBeforeUrl],
            )
          : reply("Now the AFTER photos, from the same spots as your before shots.")
        : reply(
            `${plural(c.after, "after photo")} saved. Add a voice note on materials and plants if you like, then tap Done.`,
            [{ id: "after:done", title: "Done" }],
          );
    case "homeowner":
      return reply(HOMEOWNER_ASK, [SKIP_OPTION]);
  }
}

// ---------------------------------------------------------------------------
// Homeowner contact (optional step after Done)
// ---------------------------------------------------------------------------
const SKIP_OPTION: MessageOption = { id: "home:skip", title: "Skip" };
const NEW_JOB_OPTION: MessageOption = { id: "job:new", title: "Start a new job" };
export const HOMEOWNER_ASK = "Shall we ask the homeowner for a review? Share their contact card or type their mobile, or tap Skip.";
const SKIP_WORDS = new Set(["skip", "no", "no thanks", "nope", "none", "n/a", "na", "not now", "later", "don't know", "dont know"]);
const NAME_NOISE = new Set(["her", "his", "their", "number", "mobile", "is", "it's", "its", "the", "homeowner", "customer", "client", "mr", "mrs", "ms", "miss", "dr", "call", "name", "on", "tel", "phone", "and", "for"]);

/** "Emily Hart 07700 900104" / "07700900104 emily" -> phone + name. Null when no UK mobile is in the text. */
export function parseTypedContact(text: string): { phone: string; firstName: string | null; lastName: string | null } | null {
  const candidate = text.match(/\+?\d[\d\s().-]{8,}\d/)?.[0];
  const phone = candidate ? parseUkMobile(candidate) : null;
  if (!phone || !candidate) return null;
  const words = text
    .replace(candidate, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z'-]/g, ""))
    .filter((w) => w.length > 1 && !NAME_NOISE.has(w.toLowerCase()));
  const cap = (w: string | undefined) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : null);
  return { phone, firstName: cap(words[0]), lastName: cap(words[1]) };
}

function firstUsableContact(ev: InboundEvent) {
  for (const c of ev.contacts ?? []) {
    const phone = parseUkMobile(c.phone);
    if (phone) return { phone, firstName: c.firstName, lastName: c.lastName };
  }
  return null;
}

function homeownerThanks(name: string | null): string {
  return `Thanks. The office will ask ${name ?? "the homeowner"} how it went.`;
}

/**
 * Step "homeowner": a contact card or typed mobile links the homeowner; Skip / "no" moves on. Anything
 * else crew-like (photos, a command, a job choice) ends the question and is handled as usual.
 */
function reduceHomeowner(state: BotState, ev: InboundEvent, ctx: BotContext): ReduceResult {
  const target = state.homeowner!;
  const idle: BotState = { ...state, step: "idle", jobId: null, homeowner: null };
  const release: BotEffect = { type: "homeownerStepDone", jobId: target.jobId };

  const contact = firstUsableContact(ev) ?? (ev.media.length === 0 && !ev.choiceId ? parseTypedContact(ev.text) : null);
  if (contact) {
    return done(idle, [
      { type: "attachCustomer", jobId: target.jobId, contact },
      release,
      reply(homeownerThanks(contact.firstName), [NEW_JOB_OPTION]),
    ]);
  }
  if ((ev.contacts ?? []).length > 0) {
    return done(state, [reply("That contact card has no UK mobile number. Type their mobile instead, or tap Skip.", [SKIP_OPTION])]);
  }

  const choice = resolveChoice(state, ev);
  const text = normText(ev.text);
  if (choice === "home:skip" || (!choice && ev.media.length === 0 && SKIP_WORDS.has(text))) {
    return done(idle, [release, reply(`No problem. ${target.code} is with the office now.`, [NEW_JOB_OPTION])]);
  }
  // Photos, a job pick or a command: the crew has moved on. Release the job and carry on normally.
  const movingOn = ev.media.length > 0 || Boolean(choice) || Boolean(COMMANDS[text]) || Boolean(findJobByText(ev.text, ctx.openJobs));
  if (movingOn) {
    const next = reduceCrew(idle, ev, ctx);
    return { state: next.state, effects: [release, ...next.effects] };
  }
  return done(state, [reply(`That doesn't look like a UK mobile. Type it like 07700 900123, share their contact card, or tap Skip.`, [SKIP_OPTION])]);
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------
function startNewJob(state: BotState, ctx: BotContext, prefix = ""): ReduceResult {
  const job: JobSummary = {
    id: ctx.newJob.id,
    code: ctx.newJob.code,
    service: null,
    serviceLabel: null,
    postcode: null,
    area: null,
    counts: { before: 0, progress: 0, after: 0, audio: 0 },
    firstBeforeUrl: null,
  };
  const ask = prompt("service", job, ctx) as Extract<BotEffect, { type: "reply" }>;
  return done({ ...state, step: "service", jobId: job.id }, [
    { type: "createJob", jobId: job.id, code: job.code },
    { ...ask, body: `${prefix}New job ${job.code}. What's the job?` },
  ]);
}

function pickJob(state: BotState, job: JobSummary, ctx: BotContext): ReduceResult {
  const step = resumeStep(job);
  const ask = prompt(step, job, ctx) as Extract<BotEffect, { type: "reply" }>;
  return done({ ...state, step, jobId: job.id, lastMediaAckAt: null }, [
    { ...ask, body: `Picked up ${jobLabel(job)}.\n${ask.body}` },
  ]);
}

/** After the service is known: ask for the area unless we already have it, then move to BEFORE photos. */
function afterDetails(state: BotState, job: JobSummary, ctx: BotContext, effects: BotEffect[]): ReduceResult {
  if (!job.postcode) return done({ ...state, step: "postcode" }, [...effects, prompt("postcode", job, ctx)]);
  const ask = prompt("before", job, ctx) as Extract<BotEffect, { type: "reply" }>;
  return done({ ...state, step: "before" }, [...effects, { ...ask, body: `Set up: ${jobLabel(job)}.\n${ask.body}` }]);
}

function handleMedia(state: BotState, ev: InboundEvent, ctx: BotContext): ReduceResult {
  let job = ctx.activeJob;
  const hasAudio = ev.media.some((m) => m.kind === "audio");
  const hasVisual = ev.media.some((m) => m.kind !== "audio");

  // No job in hand: photos start a new one (the Muddy Boots default: no words needed).
  if (!job) {
    const created = startNewJob(state, ctx);
    const jobId = ctx.newJob.id;
    const n = ev.media.filter((m) => m.kind !== "audio").length;
    const [create, ask] = created.effects;
    const askReply = ask as Extract<BotEffect, { type: "reply" }>;
    const lead = hasVisual ? `Got ${plural(n, "before photo")}. ` : "Got your voice note. ";
    return done({ ...created.state, lastMediaAckAt: ctx.now }, [
      create,
      { type: "storeMedia", jobId, stage: "before" },
      { ...askReply, body: `${lead}${askReply.body}` },
    ]);
  }

  // Idle/picking with a job in hand: carry on with that job where it naturally is.
  let step = state.step;
  if (step === "idle" || step === "pick_job") step = resumeStep(job);

  const stage: MediaStage = step === "working" ? "progress" : step === "after" ? "after" : "before";
  const store: BotEffect = { type: "storeMedia", jobId: job.id, stage };
  job = bump(job, stage, ev);
  const inBurst = state.lastMediaAckAt !== null && ctx.now - state.lastMediaAckAt < MEDIA_BURST_MS;
  const next: BotState = { ...state, step, lastMediaAckAt: ctx.now };

  // A voice note is a deliberate "that's the brief" / "that's the materials" — always acknowledge.
  if (hasAudio && !hasVisual) {
    if (step === "before" && job.counts.before > 0) {
      const ask = prompt("working", job, ctx) as Extract<BotEffect, { type: "reply" }>;
      return done({ ...next, step: "working" }, [store, { ...ask, body: `Brief saved. ${ask.body}` }]);
    }
    if (step === "after" && job.counts.after > 0) {
      return done(next, [store, reply("Materials note saved. Tap Done to send it to the office.", [{ id: "after:done", title: "Done" }])]);
    }
    if (step === "working") {
      return done(next, [store, reply(`Voice note saved to ${job.code}.`, [{ id: "work:finish", title: "Finish job" }])]);
    }
    const ask = prompt(step, job, ctx) as Extract<BotEffect, { type: "reply" }>;
    return done(next, [store, { ...ask, body: `Voice note saved. ${ask.body}` }]);
  }

  if (inBurst && state.step === step) return done(next, [store]);

  if (step === "service" || step === "postcode") {
    const ask = prompt(step, job, ctx) as Extract<BotEffect, { type: "reply" }>;
    return done(next, [store, { ...ask, body: `${plural(job.counts.before, "before photo")} saved. Quick one first: ${ask.body}` }]);
  }
  if (step === "working") {
    return done(next, [
      store,
      reply(`${plural(job.counts.progress, "progress photo")} saved to ${job.code}.`, [{ id: "work:finish", title: "Finish job" }]),
    ]);
  }
  return done(next, [store, prompt(step, job, ctx)]);
}

function handleCommand(cmd: Command, state: BotState, ctx: BotContext): ReduceResult {
  const job = ctx.activeJob;
  switch (cmd) {
    case "new":
      return startNewJob({ ...state, lastMediaAckAt: null }, ctx);
    case "switch":
      return done({ ...state, step: "pick_job", lastMediaAckAt: null }, [prompt("pick_job", null, ctx)]);
    case "help":
      return done(state, [
        reply(
          [
            "How it works:",
            "• Send photos any time. They go to your current job.",
            "• Tap a button, or reply with its number.",
            "• Type a job code (e.g. TL-4821) or postcode to jump to a job.",
            "• Words that work: status, switch job, cancel, help.",
          ].join("\n"),
          [
            { id: "cmd:status", title: "Status" },
            { id: "cmd:switch", title: "Switch job" },
            { id: "job:new", title: "Start a new job" },
          ],
        ),
      ]);
    case "status": {
      if (!job) return done({ ...state, step: "pick_job" }, [{ ...(prompt("pick_job", null, ctx) as Extract<BotEffect, { type: "reply" }>), body: `No job open on your phone. ${plural(ctx.openJobs.length, "job")} in progress across the team. Which one?` }]);
      const c = job.counts;
      const ask = prompt(state.step, job, ctx) as Extract<BotEffect, { type: "reply" }>;
      const summary = `${jobLabel(job)}\nBefore ${c.before} · Progress ${c.progress} · After ${c.after} · Voice notes ${c.audio}`;
      return done(state, [{ ...ask, body: `${summary}\n\n${ask.body}` }]);
    }
    case "cancel": {
      if (!job) return done({ ...state, step: "idle", jobId: null }, [reply("Nothing to cancel.", jobMenu(ctx))]);
      const c = job.counts;
      const empty = c.before + c.progress + c.after + c.audio === 0;
      const effects: BotEffect[] = empty
        ? [{ type: "deleteJob", jobId: job.id }, reply(`Cancelled. ${job.code} is deleted (nothing had been sent).`, [{ id: "job:new", title: "Start a new job" }])]
        : [reply(`Paused ${job.code}. Nothing is lost: type ${job.code} or tap below to pick it up again.`, [{ id: `job:${job.id}`, title: `Resume ${job.code}` }, { id: "job:new", title: "Start a new job" }])];
      return done({ ...state, step: "idle", jobId: null, lastMediaAckAt: null }, effects);
    }
  }
}

function reduceCrew(state: BotState, ev: InboundEvent, ctx: BotContext): ReduceResult {
  if (state.step === "homeowner" && state.homeowner) return reduceHomeowner(state, ev, ctx);
  // Keep state and context consistent: if the active job vanished (completed elsewhere), start clean.
  if (state.jobId && !ctx.activeJob) state = { ...state, step: "idle", jobId: null };

  // A contact card mid-capture: that's the homeowner for the job in hand (asked for once the job is done).
  const shared = firstUsableContact(ev);
  if (shared && ctx.activeJob && ev.media.length === 0) {
    const ask = prompt(state.step, ctx.activeJob, ctx) as Extract<BotEffect, { type: "reply" }>;
    const who = shared.firstName ?? "The homeowner";
    return done(state, [
      { type: "attachCustomer", jobId: ctx.activeJob.id, contact: shared },
      { ...ask, body: `${who} saved as the homeowner for ${ctx.activeJob.code}. We'll ask for a review once it's done.\n${ask.body}` },
    ]);
  }

  if (ev.media.length > 0) return handleMedia(state, ev, ctx);
  state = { ...state, lastMediaAckAt: null };

  const choice = resolveChoice(state, ev);
  const text = normText(ev.text);
  const cmd: Command | undefined = choice?.startsWith("cmd:") ? (choice.slice(4) as Command) : COMMANDS[text];
  if (cmd && (choice?.startsWith("cmd:") || !choice)) return handleCommand(cmd, state, ctx);

  if (choice === "job:new") return startNewJob(state, ctx);
  if (choice?.startsWith("job:")) {
    const job = ctx.openJobs.find((j) => j.id === choice.slice(4)) ?? (ctx.activeJob?.id === choice.slice(4) ? ctx.activeJob : null);
    if (job) return pickJob(state, job, ctx);
    return done({ ...state, step: "pick_job" }, [{ ...(prompt("pick_job", null, ctx) as Extract<BotEffect, { type: "reply" }>), body: "That job is already wrapped up. Which job?" }]);
  }

  // Typed job code / postcode jumps straight to a job (not while we're asking for a postcode).
  if (!choice && state.step !== "postcode" && text) {
    const hit = findJobByText(ev.text, ctx.openJobs);
    if (hit) return pickJob(state, hit, ctx);
  }

  const job = ctx.activeJob;
  if (!job || state.step === "idle" || state.step === "pick_job" || state.step === "homeowner") {
    const greeting = ctx.crewName ? `Hi ${ctx.crewName}. ` : "";
    const ask = prompt("pick_job", null, ctx) as Extract<BotEffect, { type: "reply" }>;
    return done({ ...state, step: "pick_job" }, [{ ...ask, body: `${greeting}${ask.body}` }]);
  }

  const proceed = !choice && PROCEED_WORDS.has(text);
  switch (state.step) {
    case "service": {
      const key =
        choice?.startsWith("svc:") ? choice.slice(4)
        : ctx.services.find((s) => text.length >= 3 && (s.label.toLowerCase().includes(text) || s.key.includes(text.replace(/\s+/g, "_"))))?.key;
      const svc = ctx.services.find((s) => s.key === key);
      if (!svc) return done(state, [prompt("service", job, ctx)]);
      const updated = { ...job, service: svc.key, serviceLabel: svc.label };
      return afterDetails(state, updated, ctx, [{ type: "updateJob", jobId: job.id, patch: { service: svc.key } }]);
    }
    case "postcode": {
      if (choice === "pc:skip" || (!choice && text === "skip")) {
        const ask = prompt("before", job, ctx) as Extract<BotEffect, { type: "reply" }>;
        return done({ ...state, step: "before" }, [{ ...ask, body: `No problem, the office can add it. ${ask.body}` }]);
      }
      let postcode: string | null = null;
      let area: string | null = null;
      if (choice?.startsWith("pc:")) {
        postcode = choice.slice(3);
        area = ctx.areas.find((a) => a.postcode === postcode)?.label ?? null;
      } else {
        postcode = parsePostcode(ev.text);
        const byName = ctx.areas.find((a) => a.label.toLowerCase() === text);
        if (!postcode && byName) postcode = byName.postcode;
        area = ctx.areas.find((a) => postcode && a.postcode === outward(postcode))?.label ?? null;
      }
      if (!postcode) return done(state, [prompt("postcode", job, ctx)]);
      const updated = { ...job, postcode, area: area ?? job.area };
      return afterDetails(state, updated, ctx, [{ type: "updateJob", jobId: job.id, patch: { postcode } }]);
    }
    case "before": {
      if (choice === "before:next" || proceed) {
        if (job.counts.before === 0) {
          return done(state, [reply("I need at least one before photo first. It's the half of the story we can't get back.")]);
        }
        return done({ ...state, step: "working" }, [prompt("working", job, ctx)]);
      }
      return done(state, [prompt("before", job, ctx)]);
    }
    case "working": {
      if (choice === "work:finish" || proceed) return done({ ...state, step: "after" }, [prompt("after", job, ctx)]);
      return done(state, [prompt("working", job, ctx)]);
    }
    case "after": {
      if (choice === "after:done" || proceed) {
        if (job.counts.after === 0) return done(state, [reply("I need at least one after photo before we wrap up.")]);
        const thanks = ctx.crewName ? `Thanks ${ctx.crewName}.` : "Thanks.";
        return done({ ...state, step: "homeowner", jobId: null, homeowner: { jobId: job.id, code: job.code } }, [
          { type: "completeJob", jobId: job.id },
          reply(`Wrapped: ${jobLabel(job)}. ${thanks}\n${HOMEOWNER_ASK}`, [SKIP_OPTION]),
        ]);
      }
      return done(state, [prompt("after", job, ctx)]);
    }
  }
}

// ---------------------------------------------------------------------------
// Customers & unknown numbers
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "opt out", "optout"]);
const START_WORDS = new Set(["start", "unstop", "opt in", "optin"]);

function reduceCustomer(state: BotState, ev: InboundEvent, ctx: BotContext): ReduceResult {
  const text = normText(ev.text);
  if (STOP_WORDS.has(text)) return done(state, [{ type: "setOptOut", optedOut: true }]);
  if (START_WORDS.has(text)) return done(state, [{ type: "setOptOut", optedOut: false }]);
  // Customers never talk to the bot: their messages go to a human (the owner), unchanged.
  const who = ctx.customerName ?? "A customer";
  const about = ctx.customerJobCode ? ` (${ctx.customerJobCode})` : "";
  const extra = ev.media.length ? ` [+${plural(ev.media.length, "attachment")}]` : "";
  if (!ev.text.trim() && !ev.media.length) return done(state, []);
  return done(state, [{ type: "notifyOwner", body: `${who}${about} sent a WhatsApp message: "${ev.text.trim()}"${extra}` }]);
}

function reduceUnknown(state: BotState, ctx: BotContext): ReduceResult {
  if (state.unknownRepliedAt !== null && ctx.now - state.unknownRepliedAt < UNKNOWN_REPLY_EVERY_MS) return done(state, []);
  return done({ ...state, unknownRepliedAt: ctx.now }, [
    reply(
      `Hello, this is the ${ctx.tenantName} job-photo line, used by our garden teams. ` +
        `If you'd like to talk to us about a garden, please get in touch via ${ctx.tenantWebsite} and we'll come straight back to you.`,
    ),
  ]);
}

export function reduce(prev: unknown, ev: InboundEvent, ctx: BotContext): ReduceResult {
  const state = coerceState(prev);
  if (ctx.role === "unknown") return reduceUnknown(state, ctx);
  if (ctx.role === "customer") return reduceCustomer(state, ev, ctx);
  return reduceCrew(state, ev, ctx);
}
