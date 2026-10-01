import { describe, expect, it } from "vitest";
import { HOMEOWNER_ASK, MEDIA_BURST_MS, coerceState, parsePostcode, parseTypedContact, reduce } from "./reducer";
import { initialBotState, type BotContext, type BotEffect, type BotState, type InboundEvent, type JobSummary } from "./types";

// ---------------------------------------------------------------------------
// A tiny in-memory "runtime" that applies effects to the context, so whole
// conversations can be replayed purely and taps counted.
// ---------------------------------------------------------------------------
const SERVICES = [
  { key: "full_design", label: "Garden design & build" },
  { key: "patio_paving", label: "Patios & paving" },
  { key: "fencing", label: "Fencing & screening" },
  { key: "lawn_turf", label: "Lawns & turfing" },
  { key: "planting", label: "Planting schemes" },
  { key: "structures", label: "Garden structures" },
  { key: "maintenance", label: "Garden maintenance" },
];
const AREAS = [
  { postcode: "SW19", label: "Wimbledon" },
  { postcode: "SW15", label: "Putney" },
  { postcode: "SW4", label: "Clapham" },
];

function baseCtx(over: Partial<BotContext> = {}): BotContext {
  return {
    now: 1_000_000,
    role: "crew",
    tenantName: "Thorburn Landscapes",
    tenantWebsite: "https://www.thorburnlandscapes.co.uk",
    crewName: "Marco",
    team: "landscaping",
    services: SERVICES,
    areas: AREAS,
    openJobs: [],
    activeJob: null,
    newJob: { id: "job_new1", code: "TL-2345" },
    customerJobCode: null,
    customerName: null,
    ...over,
  };
}

const emptyJob = (over: Partial<JobSummary> = {}): JobSummary => ({
  id: "job_a",
  code: "TL-4821",
  service: "patio_paving",
  serviceLabel: "Patios & paving",
  postcode: "SW19 5AB",
  area: "Wimbledon",
  counts: { before: 0, progress: 0, after: 0, audio: 0 },
  firstBeforeUrl: null,
  ...over,
});

const text = (t: string): InboundEvent => ({ text: t, choiceId: null, media: [] });
const tap = (id: string): InboundEvent => ({ text: "", choiceId: id, media: [] });
const photos = (n: number, caption = ""): InboundEvent => ({ text: caption, choiceId: null, media: Array.from({ length: n }, () => ({ kind: "image" as const })) });
const voice = (): InboundEvent => ({ text: "", choiceId: null, media: [{ kind: "audio" }] });

class Sim {
  state: BotState = initialBotState();
  jobs = new Map<string, JobSummary>();
  now = 1_000_000;
  taps = 0;
  replies: Extract<BotEffect, { type: "reply" }>[] = [];
  effects: BotEffect[] = [];
  seq = 0;

  constructor(private over: Partial<BotContext> = {}) {}

  ctx(): BotContext {
    const open = [...this.jobs.values()].reverse();
    return baseCtx({
      ...this.over,
      now: this.now,
      openJobs: open,
      activeJob: this.state.jobId ? (this.jobs.get(this.state.jobId) ?? null) : null,
      newJob: { id: `job_new${this.seq + 1}`, code: `TL-${2345 + this.seq}` },
    });
  }

  send(ev: InboundEvent, { countsAsTap = ev.media.length === 0 } = {}) {
    if (countsAsTap) this.taps++;
    const { state, effects } = reduce(this.state, ev, this.ctx());
    for (const e of effects) this.apply(e, ev);
    this.state = state;
    this.effects.push(...effects);
    this.now += 60_000; // a minute between actions: outside the burst window
    return effects;
  }

  apply(e: BotEffect, ev: InboundEvent) {
    switch (e.type) {
      case "reply":
        this.replies.push(e);
        break;
      case "createJob":
        this.seq++;
        this.jobs.set(e.jobId, emptyJob({ id: e.jobId, code: e.code, service: null, serviceLabel: null, postcode: null, area: null }));
        break;
      case "updateJob": {
        const j = this.jobs.get(e.jobId)!;
        if (e.patch.service) j.service = e.patch.service;
        if (e.patch.service) j.serviceLabel = SERVICES.find((s) => s.key === e.patch.service)!.label;
        if (e.patch.postcode !== undefined) {
          j.postcode = e.patch.postcode;
          j.area = AREAS.find((a) => e.patch.postcode?.startsWith(a.postcode))?.label ?? null;
        }
        break;
      }
      case "storeMedia": {
        const j = this.jobs.get(e.jobId)!;
        for (const m of ev.media) {
          if (m.kind === "audio") j.counts.audio++;
          else j.counts[e.stage]++;
          if (m.kind === "image" && e.stage === "before" && !j.firstBeforeUrl) j.firstBeforeUrl = "/api/media/before-1.public.jpg";
        }
        break;
      }
      case "deleteJob":
        this.jobs.delete(e.jobId);
        break;
      case "completeJob":
        this.jobs.delete(e.jobId); // no longer "capturing"
        break;
    }
  }

  get lastReply() {
    return this.replies[this.replies.length - 1];
  }
}

describe("capture flow — tap budget (Muddy Boots)", () => {
  it("photos-first capture takes 6 taps (≤ 8, incl. skipping the homeowner question) and completes the job", () => {
    const s = new Sim();
    s.send(photos(3));
    expect(s.lastReply.body).toContain("Got 3 before photos");
    expect(s.lastReply.options?.length).toBeLessThanOrEqual(7);
    s.send(tap("svc:patio_paving"));
    expect(s.state.step).toBe("postcode");
    s.send(tap("pc:SW19"));
    expect(s.state.step).toBe("before");
    expect(s.lastReply.body).toContain("3 before photos saved");
    s.send(tap("before:next"));
    expect(s.state.step).toBe("working");
    s.send(tap("work:finish"));
    expect(s.state.step).toBe("after");
    // framing guide: the first before photo comes back for matching angles
    expect(s.lastReply.mediaUrls).toEqual(["/api/media/before-1.public.jpg"]);
    s.send(photos(2));
    expect(s.lastReply.options).toEqual([{ id: "after:done", title: "Done" }]);
    s.send(tap("after:done"));
    expect(s.effects.some((e) => e.type === "completeJob")).toBe(true);
    expect(s.state).toMatchObject({ step: "homeowner", jobId: null, homeowner: { jobId: "job_new1", code: "TL-2345" } });
    expect(s.lastReply.body).toContain(HOMEOWNER_ASK);
    expect(s.lastReply.options).toEqual([{ id: "home:skip", title: "Skip" }]);
    s.send(tap("home:skip"));
    expect(s.effects.at(-2)).toEqual({ type: "homeownerStepDone", jobId: "job_new1" });
    expect(s.state).toMatchObject({ step: "idle", jobId: null, homeowner: null });
    expect(s.taps).toBe(6);
  });

  it("chat-first capture with voice notes and numbered replies stays ≤ 8 taps", () => {
    const s = new Sim();
    s.send(text("hi"));
    expect(s.lastReply.body).toMatch(/^Hi Marco/);
    s.send(text("1")); // "Start a new job" is option 1 when no jobs are open
    expect(s.state.step).toBe("service");
    s.send(text("2")); // Patios & paving
    s.send(text("1")); // Wimbledon (SW19)
    s.send(photos(4));
    s.send(voice(), { countsAsTap: false }); // brief voice note auto-advances
    expect(s.state.step).toBe("working");
    s.send(photos(1)); // progress
    expect(s.lastReply.body).toContain("progress photo saved");
    s.send(text("1")); // Finish job
    s.send(photos(3));
    s.send(voice(), { countsAsTap: false }); // materials note
    expect(s.lastReply.body).toContain("Materials note saved");
    s.send(text("1")); // Done
    expect(s.effects.filter((e) => e.type === "completeJob")).toHaveLength(1);
    s.send(text("1")); // Skip the homeowner question
    expect(s.state.step).toBe("idle");
    expect(s.taps).toBeLessThanOrEqual(8);
    expect(s.taps).toBe(7);
  });

  it("every bot question offers at most 7 options", () => {
    const s = new Sim();
    for (const ev of [photos(1), tap("svc:fencing"), tap("pc:SW15"), tap("before:next"), tap("work:finish"), photos(1), tap("after:done")]) s.send(ev);
    for (const r of s.replies) expect((r.options ?? []).length).toBeLessThanOrEqual(7);
  });
});

describe("steps and edge cases", () => {
  it("skips the postcode question when the job already has one", () => {
    const job = emptyJob({ service: null, serviceLabel: null });
    const s = new Sim();
    s.jobs.set(job.id, job);
    s.send(text("TL-4821"));
    expect(s.state).toMatchObject({ step: "service", jobId: "job_a" });
    s.send(tap("svc:patio_paving"));
    expect(s.state.step).toBe("before");
    expect(s.lastReply.body).toContain("Set up: TL-4821 · Patios & paving · Wimbledon");
  });

  it("accepts typed postcodes and area names, and Skip", () => {
    for (const [input, expected] of [["sw19 5ab", "SW19 5AB"], ["SW4", "SW4"], ["Putney", "SW15"]] as const) {
      const s = new Sim();
      s.send(tap("job:new"));
      s.send(tap("svc:planting"));
      const effects = s.send(text(input));
      expect(effects).toContainEqual({ type: "updateJob", jobId: "job_new1", patch: { postcode: expected } });
      expect(s.state.step).toBe("before");
    }
    const s = new Sim();
    s.send(tap("job:new"));
    s.send(tap("svc:planting"));
    s.send(tap("pc:skip"));
    expect(s.state.step).toBe("before");
    expect(s.lastReply.body).toContain("office can add it");
  });

  it("re-asks on off-script text instead of guessing", () => {
    const s = new Sim();
    s.send(tap("job:new"));
    s.send(text("banana"));
    expect(s.state.step).toBe("service");
    expect(s.lastReply.options?.[0].id).toBe("svc:full_design");
    s.send(text("paving")); // fuzzy label match still works
    expect(s.state.step).toBe("postcode");
    s.send(text("somewhere nice"));
    expect(s.state.step).toBe("postcode");
  });

  it("won't start work without a before photo, or finish without an after photo", () => {
    const s = new Sim();
    s.send(tap("job:new"));
    s.send(tap("svc:fencing"));
    s.send(tap("pc:SW19"));
    s.send(tap("before:next"));
    expect(s.state.step).toBe("before");
    expect(s.lastReply.body).toContain("at least one before photo");
    s.send(photos(1));
    s.send(text("done")); // proceed word = primary button
    expect(s.state.step).toBe("working");
    s.send(text("finished"));
    expect(s.state.step).toBe("after");
    s.send(tap("after:done"));
    expect(s.lastReply.body).toContain("at least one after photo");
    expect(s.effects.some((e) => e.type === "completeJob")).toBe(false);
  });

  it("stays quiet during a burst of photos, then counts them on the next tap", () => {
    const s = new Sim();
    s.send(photos(1));
    s.send(tap("svc:fencing"));
    s.send(tap("pc:SW19"));
    s.send(photos(1));
    const before = s.replies.length;
    s.now -= 60_000 - 1000; // next photo arrives 1s later
    const effects = s.send(photos(1));
    expect(effects).toEqual([{ type: "storeMedia", jobId: "job_new1", stage: "before" }]);
    expect(s.replies.length).toBe(before);
    s.now += MEDIA_BURST_MS;
    s.send(tap("before:next"));
    expect(s.state.step).toBe("working");
  });

  it("a voice note before any photos is saved and the photos are asked for", () => {
    const s = new Sim();
    s.send(tap("job:new"));
    s.send(tap("svc:fencing"));
    s.send(tap("pc:SW19"));
    s.send(voice(), { countsAsTap: false });
    expect(s.state.step).toBe("before");
    expect(s.lastReply.body).toContain("Voice note saved");
  });

  it("photos during the service question are stored as before photos", () => {
    const s = new Sim();
    s.send(tap("job:new"));
    const effects = s.send(photos(2));
    expect(effects[0]).toEqual({ type: "storeMedia", jobId: "job_new1", stage: "before" });
    expect(s.lastReply.body).toContain("2 before photos saved. Quick one first");
    expect(s.state.step).toBe("service");
  });

  it("resumes a picked job at the right step", () => {
    const working = emptyJob({ id: "job_w", code: "TL-5555", counts: { before: 2, progress: 0, after: 0, audio: 0 } });
    const after = emptyJob({ id: "job_x", code: "TL-6666", counts: { before: 2, progress: 1, after: 1, audio: 0 } });
    const s = new Sim();
    s.jobs.set(working.id, working);
    s.jobs.set(after.id, after);
    s.send(tap("job:job_w"));
    expect(s.state).toMatchObject({ step: "working", jobId: "job_w" });
    s.send(text("6666"));
    expect(s.state).toMatchObject({ step: "after", jobId: "job_x" });
    s.send(text("sw19 5ab")); // postcode picks the first matching open job
    expect(s.state.jobId).toBeDefined();
  });

  it("photos with an active job in 'idle' continue that job at its natural stage", () => {
    const job = emptyJob({ counts: { before: 3, progress: 0, after: 0, audio: 0 } });
    const s = new Sim();
    s.jobs.set(job.id, job);
    s.state = { ...initialBotState(), step: "idle", jobId: job.id };
    const effects = s.send(photos(1));
    expect(effects[0]).toEqual({ type: "storeMedia", jobId: "job_a", stage: "progress" });
    expect(s.state.step).toBe("working");
  });

  it("stale buttons for a finished job are handled gracefully", () => {
    const s = new Sim();
    s.send(tap("job:job_gone"));
    expect(s.lastReply.body).toContain("already wrapped up");
    expect(s.state.step).toBe("pick_job");
  });

  it("drops a vanished active job instead of crashing", () => {
    const s = new Sim();
    s.state = { ...initialBotState(), step: "working", jobId: "job_deleted" };
    s.send(tap("work:finish"));
    expect(s.state).toMatchObject({ step: "pick_job", jobId: null });
  });

  it("recovers from corrupt stored state", () => {
    const { state } = reduce({ nonsense: true }, text("hi"), baseCtx());
    expect(state.v).toBe(1);
  });

  it("maintenance crew flow works the same way", () => {
    const s = new Sim({ team: "maintenance", crewName: "Jake" });
    s.send(photos(1));
    s.send(tap("svc:maintenance"));
    expect(s.effects).toContainEqual({ type: "updateJob", jobId: "job_new1", patch: { service: "maintenance" } });
  });
});

describe("commands", () => {
  it("help lists the commands with tap shortcuts", () => {
    const s = new Sim();
    s.send(text("help"));
    expect(s.lastReply.body).toContain("status, switch job, cancel, help");
    expect(s.lastReply.options?.map((o) => o.id)).toEqual(["cmd:status", "cmd:switch", "job:new"]);
    s.send(text("1")); // Status
    expect(s.lastReply.body).toContain("No job open");
  });

  it("status summarises the active job and repeats the current question", () => {
    const s = new Sim();
    s.send(photos(2));
    s.send(tap("svc:patio_paving"));
    s.send(tap("pc:SW19"));
    s.send(text("Status"));
    expect(s.lastReply.body).toContain("TL-2345 · Patios & paving · Wimbledon");
    expect(s.lastReply.body).toContain("Before 2 · Progress 0 · After 0");
    expect(s.lastReply.options?.[0].id).toBe("before:next");
  });

  it("switch job lists open jobs plus 'Start a new job'", () => {
    const s = new Sim();
    s.jobs.set("job_a", emptyJob());
    s.send(text("switch job"));
    expect(s.state.step).toBe("pick_job");
    expect(s.lastReply.options).toEqual([
      { id: "job:job_a", title: "TL-4821 · Wimbledon" },
      { id: "job:new", title: "Start a new job" },
    ]);
  });

  it("cancel deletes an empty job", () => {
    const s = new Sim();
    s.send(tap("job:new"));
    const effects = s.send(text("cancel"));
    expect(effects[0]).toEqual({ type: "deleteJob", jobId: "job_new1" });
    expect(s.state).toMatchObject({ step: "idle", jobId: null });
  });

  it("cancel pauses a job that has photos, with a one-tap resume", () => {
    const s = new Sim();
    s.send(photos(2));
    const effects = s.send(text("cancel"));
    expect(effects.some((e) => e.type === "deleteJob")).toBe(false);
    expect(s.lastReply.body).toContain("Paused TL-2345");
    s.send(text("1"));
    expect(s.state).toMatchObject({ step: "service", jobId: "job_new1" });
  });

  it("cancel with nothing open says so", () => {
    const s = new Sim();
    s.send(text("cancel"));
    expect(s.lastReply.body).toBe("Nothing to cancel.");
  });

  it("new job via text", () => {
    const s = new Sim();
    const effects = s.send(text("new job"));
    expect(effects[0]).toEqual({ type: "createJob", jobId: "job_new1", code: "TL-2345" });
  });
});

describe("customers and unknown numbers", () => {
  it("STOP opts a customer out without replying; START opts back in", () => {
    const ctx = baseCtx({ role: "customer", customerName: "Harriet" });
    expect(reduce(null, text("STOP"), ctx).effects).toEqual([{ type: "setOptOut", optedOut: true }]);
    expect(reduce(null, text("Unsubscribe"), ctx).effects).toEqual([{ type: "setOptOut", optedOut: true }]);
    expect(reduce(null, text("start"), ctx).effects).toEqual([{ type: "setOptOut", optedOut: false }]);
  });

  it("other customer messages go to the owner, never to the bot", () => {
    const ctx = baseCtx({ role: "customer", customerName: "Harriet", customerJobCode: "TL-4821" });
    const { effects } = reduce(null, text("Thank you so much"), ctx);
    expect(effects).toEqual([{ type: "notifyOwner", body: 'Harriet (TL-4821) sent a WhatsApp message: "Thank you so much"' }]);
  });

  it("unknown numbers get one polite reply per day", () => {
    const ctx = baseCtx({ role: "unknown" });
    const first = reduce(null, text("hello?"), ctx);
    expect(first.effects).toHaveLength(1);
    expect((first.effects[0] as { body: string }).body).toContain("job-photo line");
    const second = reduce(first.state, text("hello??"), { ...ctx, now: ctx.now + 3600_000 });
    expect(second.effects).toHaveLength(0);
    const nextDay = reduce(first.state, text("hi"), { ...ctx, now: ctx.now + 25 * 3600_000 });
    expect(nextDay.effects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Homeowner contact step (after Done)
// ---------------------------------------------------------------------------
const card = (phone: string, firstName: string | null = "Emily", lastName: string | null = "Hart"): InboundEvent => ({
  text: "",
  choiceId: null,
  media: [],
  contacts: [{ firstName, lastName, phone }],
});

function wrapped(): Sim {
  const s = new Sim();
  for (const ev of [photos(1), tap("svc:fencing"), tap("pc:SW15"), tap("before:next"), tap("work:finish"), photos(1), tap("after:done")]) s.send(ev);
  expect(s.state.step).toBe("homeowner");
  return s;
}

describe("homeowner contact step", () => {
  it("a shared contact card links the homeowner and releases the job", () => {
    const s = wrapped();
    const effects = s.send(card("+44 7700 900104"), { countsAsTap: true });
    expect(effects).toEqual([
      { type: "attachCustomer", jobId: "job_new1", contact: { phone: "+447700900104", firstName: "Emily", lastName: "Hart" } },
      { type: "homeownerStepDone", jobId: "job_new1" },
      expect.objectContaining({ type: "reply", body: "Thanks. The office will ask Emily how it went." }),
    ]);
    expect(s.state).toMatchObject({ step: "idle", homeowner: null });
  });

  it("uses the first UK mobile on a card with several numbers", () => {
    const s = wrapped();
    const ev: InboundEvent = { text: "", choiceId: null, media: [], contacts: [{ firstName: "Emily", lastName: null, phone: "020 7946 0000" }, { firstName: "Emily", lastName: null, phone: "07700900104" }] };
    expect(s.send(ev)[0]).toMatchObject({ type: "attachCustomer", contact: { phone: "+447700900104" } });
  });

  it("accepts a typed mobile, with or without a name", () => {
    const s = wrapped();
    expect(s.send(text("emily hart 07700 900104"))[0]).toEqual({
      type: "attachCustomer",
      jobId: "job_new1",
      contact: { phone: "+447700900104", firstName: "Emily", lastName: "Hart" },
    });
    const t = wrapped();
    t.send(text("07700900105"));
    expect(t.lastReply.body).toBe("Thanks. The office will ask the homeowner how it went.");
  });

  it("re-asks on a number that isn't a UK mobile, or a card without one", () => {
    const s = wrapped();
    s.send(text("020 7946 0000"));
    expect(s.state.step).toBe("homeowner");
    expect(s.lastReply.body).toContain("doesn't look like a UK mobile");
    expect(s.lastReply.options).toEqual([{ id: "home:skip", title: "Skip" }]);
    s.send(card("+33 6 12 34 56 78"));
    expect(s.state.step).toBe("homeowner");
    expect(s.lastReply.body).toContain("no UK mobile");
    expect(s.effects.some((e) => e.type === "attachCustomer")).toBe(false);
  });

  it("'no' / 'skip' typed, or tapping 1, skips", () => {
    for (const ev of [text("no thanks"), text("Skip"), text("1")]) {
      const s = wrapped();
      const effects = s.send(ev);
      expect(effects[0]).toEqual({ type: "homeownerStepDone", jobId: "job_new1" });
      expect(s.lastReply.body).toContain("is with the office now");
      expect(s.state.step).toBe("idle");
    }
  });

  it("photos or a command mean the crew has moved on: release and carry on normally", () => {
    const s = wrapped();
    const effects = s.send(photos(2));
    expect(effects[0]).toEqual({ type: "homeownerStepDone", jobId: "job_new1" });
    expect(effects.some((e) => e.type === "createJob")).toBe(true);
    expect(s.state.step).toBe("service");

    const t = wrapped();
    const help = t.send(text("help"));
    expect(help[0]).toEqual({ type: "homeownerStepDone", jobId: "job_new1" });
    expect(t.lastReply.body).toContain("How it works");
  });

  it("a contact card during capture is saved against the job in hand", () => {
    const s = new Sim();
    s.send(photos(1));
    s.send(tap("svc:fencing"));
    s.send(tap("pc:SW15"));
    const effects = s.send(card("07700900104"));
    expect(effects[0]).toEqual({ type: "attachCustomer", jobId: "job_new1", contact: { phone: "+447700900104", firstName: "Emily", lastName: "Hart" } });
    expect(s.lastReply.body).toContain("Emily saved as the homeowner for TL-2345");
    expect(s.state.step).toBe("before");
  });

  it("coerceState drops a homeowner step without its job", () => {
    expect(coerceState({ ...initialBotState(), step: "homeowner", homeowner: null }).step).toBe("idle");
    expect(coerceState({ ...initialBotState(), step: "homeowner", homeowner: { jobId: "j", code: "TL-1" } }).step).toBe("homeowner");
  });
});

describe("parseTypedContact", () => {
  it("extracts a UK mobile and a name in either order", () => {
    expect(parseTypedContact("07700 900104 Emily")).toEqual({ phone: "+447700900104", firstName: "Emily", lastName: null });
    expect(parseTypedContact("Her number is +44 7700 900104, Mrs Hart")).toEqual({ phone: "+447700900104", firstName: "Hart", lastName: null });
    expect(parseTypedContact("call 020 7946 0000")).toBeNull();
    expect(parseTypedContact("done")).toBeNull();
  });
});

describe("parsePostcode", () => {
  it("normalises full and outward codes", () => {
    expect(parsePostcode("sw197ab")).toBe("SW19 7AB");
    expect(parsePostcode(" tw10 6ub ")).toBe("TW10 6UB");
    expect(parsePostcode("SW4")).toBe("SW4");
    expect(parsePostcode("hello")).toBeNull();
  });
});
