import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_MONITOR_SCHEMA_VERSION,
  AgentModelsResult,
  AgentMonitorMirror,
  AgentResumeNativeParams,
  AgentResumeParams,
  AgentSessionRecord,
  AgentSessionSummary,
  AgentSpawnParams,
  AgentSpawnResult,
  AgentStatus,
  AgentTier,
} from "../src/agent-session";
import { METHODS } from "../src/methods";
import { LAYOUT, LAYOUT_ROOT_LEVEL, SCOPES, TAILNET_SCOPES } from "../src/registries";

// AR-3 — the managed-session doors and SessionSummary v2 (thinking-ar-agent-
// plane.md §5/§7; AR-D4/AR-D5 as ruled 2026-09-12). The rows are pinned the
// way AR-1's are; the monitor golden is puppeteer's own fixture.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("agent.* registry rows (AR-3)", () => {
  const rows = (prefix: string) =>
    METHODS.filter((m) => m.method.startsWith(prefix)).map((m) => ({
      method: m.method,
      scope: m.scope,
      idempotent: m.idempotent,
      locality: m.locality,
      // SP-1 — a descriptor is a subscription too; registry.test.ts pins what it says
      subscription: m.subscription !== undefined,
    }));

  it("births on agent.spawn, reads on agent.observe, steers on agent.control; acts federate, the fold streams (DS-2)", () => {
    // DS-2 (2026-09-30, DS-D1 — thinking-desktop-sync-plane.md §6.1): "local in
    // v1" ended here. The ACTS federate — executed only on the device that owns
    // the floor and the run, reached by routing with `device` — the fold's
    // reads stream, and the owner's offer lists (providers, catalog) federate.
    // Scopes and idempotency are unchanged.
    // DS-3 (2026-09-30) needs the same `stream` on `agent.subscribe`: the mesh
    // board's upstreams are this door asked by a peer daemon, which the D36
    // wall refuses on a `local` method — both lanes set it, landed here once.
    expect(rows("agent.")).toEqual([
      {
        method: "agent.providers",
        scope: "agent.spawn",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      // AC-1 — the catalog: read-only and content-free, so it reads on
      // `agent.observe` like `agent.list` (thinking-ar-agent-catalog.md §5.1).
      {
        method: "agent.catalog",
        scope: "agent.observe",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      // PJ-6 — the agent's own model picker: a read that starts the agent's
      // CLI in a profile's sign-in, so a launch's scope; asked of its desktop
      {
        method: "agent.models",
        scope: "agent.spawn",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "agent.spawn",
        scope: "agent.spawn",
        idempotent: false,
        locality: "federate",
        subscription: false,
      },
      {
        method: "agent.resume",
        scope: "agent.spawn",
        idempotent: false,
        locality: "federate",
        subscription: false,
      },
      // AR-6-0 (MF-1) — the stop verb, and the first door on `agent.control`:
      // it steers a run that already exists rather than watching the fold or
      // creating a session.
      {
        method: "agent.interrupt",
        scope: "agent.control",
        idempotent: false,
        locality: "federate",
        subscription: false,
      },
      {
        method: "agent.list",
        scope: "agent.observe",
        idempotent: true,
        locality: "stream",
        subscription: false,
      },
      // MV-3a (L5) — what a window shows, reported to the backend beside the
      // runtime: the board's scope, `local` because the screen is this
      // connection's own model board.
      {
        method: "agent.reportShown",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      // LR (2026-10-15) — what the last run left: read on the board's scope,
      // forgotten on spawn's (the other half of the restore decision); both
      // local, as the board they picture is.
      {
        method: "agent.lastRun",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      {
        method: "agent.lastRunForget",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      // TL (docket v9; B-D6 (a)) — the lanes' past, the backend's over the
      // record: the record's consent (`index.search`, as `index.activity`),
      // asked where the record lives (`federate`), never a stream
      {
        method: "agent.recordedLanes",
        scope: "index.search",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "agent.subscribe",
        scope: "agent.observe",
        idempotent: true,
        locality: "stream",
        subscription: true,
      },
    ]);
  });

  it("MF-1f — a continuation can say the conversation STOPPED while the pane stands", () => {
    // The row survives its process because the floor still lists the PTY, so
    // `terminal.hosted` stays `local` and only this field says the run ended.
    // Optional and additive: a fold that predates MF-1f simply never sets it.
    const row = AgentSessionSummary.parse({
      ...(fixture("agent-session-summary.valid.json") as Record<string, unknown>),
      continuation: { persisted: true, resumable: true, exited: true },
    });
    expect(row.continuation).toEqual({ persisted: true, resumable: true, exited: true });
    // and it is not the pending state — AR-4's row is alive and unobserved,
    // this one is over and still on screen
    expect(row.continuation?.pending).toBeUndefined();
    const legacy = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(legacy.continuation?.exited).toBeUndefined();
  });

  it("the persona login pane is a spawn-class act on this device", () => {
    const login = METHODS.find((m) => m.method === "agents.profiles.login");
    expect(login).toMatchObject({ scope: "agent.spawn", idempotent: false, locality: "local" });
  });

  it("the three agent.* scopes exist and federate; the doors themselves do not yet", () => {
    for (const scope of ["agent.spawn", "agent.observe", "agent.control"] as const) {
      expect(SCOPES).toContain(scope);
      expect(TAILNET_SCOPES).toContain(scope);
    }
  });
});

describe("LAYOUT (AR-3)", () => {
  it("the session records live under this user's agents/ tree, re-rooted with it", () => {
    expect(LAYOUT.AGENT_SESSIONS_DIR).toEqual(["agents", "sessions"]);
    expect(LAYOUT.AGENT_SESSIONS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_SESSIONS_DIR");
  });
});

describe("the monitor mirror (AR-D4) against puppeteer's own fixture", () => {
  const golden = fixture("agent-monitor-state.valid.json") as Record<string, unknown>;

  it("is pinned to the schema generation the pinned puppeteer emits", () => {
    expect(AGENT_MONITOR_SCHEMA_VERSION).toBe(3);
    expect(golden["schemaVersion"]).toBe(AGENT_MONITOR_SCHEMA_VERSION);
  });

  it("reads the fields fieldd's logic needs and carries every other field through verbatim", () => {
    const parsed = AgentMonitorMirror.parse(golden);
    expect(parsed.status).toBe("blocked");
    expect(parsed.alive).toBe(true);
    expect(parsed.blockers[0]).toMatchObject({ id: "question-1", kind: "question" });
    expect(parsed.context?.usedPercent).toBe(20);
    expect(parsed.model?.displayName).toBe("Model Card V2");
    expect(parsed.environment?.git).toBeNull();
    expect(parsed.session?.nativeSessionId).toBe("native-1");
    expect(parsed.freshness?.level).toBe("native-hooks");
    // passthrough: the generation-3 collections a view may want ride along
    // (teams, workflows and artifacts left the state at generation 3)
    expect(parsed).toHaveProperty("subagents");
    expect(parsed).toHaveProperty("subagentCount");
    expect(parsed).toHaveProperty("compaction");
    expect(parsed).toHaveProperty("modes");
    expect(parsed).not.toHaveProperty("team");
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(golden);
  });

  it("keeps the headline status OPEN — a fourth upstream value parses and folds later", () => {
    expect(AgentMonitorMirror.safeParse({ ...golden, status: "paused" }).success).toBe(true);
    expect(AgentStatus.safeParse("paused").success).toBe(false);
  });

  it("refuses a state without liveness — the one field the fold cannot invent", () => {
    const { alive: _alive, ...withoutAlive } = golden;
    expect(AgentMonitorMirror.safeParse(withoutAlive).success).toBe(false);
  });
});

describe("SessionSummary v2 and the doors", () => {
  it("a managed row: the native id is the spine, the tier is one of three, status derived once", () => {
    const summary = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(summary.sessionId).toBe("native-1");
    expect(summary.tier).toBe("managed");
    expect(summary.terminal?.hosted).toBe("local");
    expect(summary.terminal?.runtimeSessionId).toBe("sess-01J8Z3K9");
    expect(AgentTier.options).toEqual(["managed", "ingested", "remote"]);
    expect(AgentStatus.options).toEqual(["idle", "working", "blocked", "unknown"]);
  });

  it("kind is an OPEN provider id — no vendor is enumerated here (AR-L1)", () => {
    const summary = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(AgentSessionSummary.safeParse({ ...summary, kind: "some-new-agent" }).success).toBe(
      true,
    );
    expect(AgentSessionSummary.safeParse({ ...summary, kind: "" }).success).toBe(false);
  });

  it("the spawn answer carries the fold's row AND the routed terminal ticket the pane mounts", () => {
    const spawn = AgentSpawnResult.parse(fixture("agent-spawn.valid.json"));
    expect(spawn.session.monitor?.schemaVersion).toBe(AGENT_MONITOR_SCHEMA_VERSION);
    expect(spawn.terminal.sessionId).toBe(spawn.session.terminal?.runtimeSessionId);
    expect(spawn.terminal).toHaveProperty("attachGrant");
    expect(spawn.terminal).toHaveProperty("transportGrant");
  });

  it("spawn params: provider required, the rest optional; a persona is named by id only", () => {
    expect(AgentSpawnParams.safeParse({ provider: "claude" }).success).toBe(true);
    expect(
      AgentSpawnParams.safeParse({ provider: "claude", profileId: "claude:abc", cwd: "/repo" })
        .success,
    ).toBe(true);
    expect(AgentSpawnParams.safeParse({}).success).toBe(false);
  });

  it("PJ-6 — a spawn at a model carries the agent's own ids opaque: any id, any control, nothing read for meaning", () => {
    const params = AgentSpawnParams.parse(fixture("agent-spawn-params.model-selection.json"));
    expect(params.modelSelection).toEqual({
      modelId: "model-card-v2",
      controls: { effort: "high" },
    });
    // an unlisted model is the caller's explicit opt-in, and a key a newer
    // caller adds rides through whole (the record signs the selection)
    const custom = AgentSpawnParams.parse({
      provider: "claude",
      modelSelection: { modelId: "vendor/model:variant", custom: true, later: { kept: 1 } },
    });
    expect(custom.modelSelection).toEqual({
      modelId: "vendor/model:variant",
      custom: true,
      later: { kept: 1 },
    });
    for (const bad of [
      { modelId: "" },
      { controls: { effort: "high" } },
      { modelId: "m", controls: { effort: 3 } },
      { modelId: "m", controls: { "": "high" } },
      { modelId: "m", custom: "yes" },
      "model-card-v2",
    ]) {
      expect(
        AgentSpawnParams.safeParse({ provider: "claude", modelSelection: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("PJ-7 — a spawn names a place by its ref or a folder by its path, never both, and a ref is a device and an id", () => {
    const params = AgentSpawnParams.parse(fixture("agent-spawn-params.place.json"));
    expect(params.place).toEqual({
      device: "01J9ZK3M5Q8XR2V7N4B6C1D0EF",
      placeId: "pl_4c1e9a0b7d2f6e8a1b3c5d7e",
    });
    expect(params.cwd).toBeUndefined();
    expect(params).toMatchObject({
      profileSet: "work-7f3a",
      modelSelection: { modelId: "model-card-v2" },
    });
    // a key a newer caller adds to the ref rides through
    const later = AgentSpawnParams.parse({
      provider: "claude",
      place: { device: "d", placeId: "pl_1", later: 1 },
    }).place as Record<string, unknown>;
    expect(later["later"]).toBe(1);
    // both: which folder did the caller mean? Refused, never a guess
    expect(
      AgentSpawnParams.safeParse({
        provider: "claude",
        cwd: "/repo",
        place: { device: "d", placeId: "pl_1" },
      }).success,
    ).toBe(false);
    for (const bad of [
      { device: "d" },
      { placeId: "pl_1" },
      { device: "", placeId: "pl_1" },
      { device: "d", placeId: "" },
      "pl_1",
      "/Users/me/Projects/vibe-field",
    ]) {
      expect(
        AgentSpawnParams.safeParse({ provider: "claude", place: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("PJ-6 — agent.models answers a catalog with its read's time, or the last read's failure in puppeteer's words — never an empty list — and reads newer words tolerantly", () => {
    const valid = AgentModelsResult.parse(fixture("agent-models.valid.json"));
    expect(valid.failure).toBeUndefined();
    expect(valid.catalog?.observedAt).toBe("2026-10-12T18:07:17.797Z");
    // each model owns its controls: the effort a model offers is its own
    const opus = valid.catalog?.models.find((model) => model.label === "Opus");
    expect(opus?.controls[0]?.role).toBe("effort");
    expect(valid.catalog?.models.at(-1)?.controls).toEqual([]);

    const signedOut = AgentModelsResult.parse(fixture("agent-models.auth-required.json"));
    expect(signedOut.catalog).toBeUndefined();
    expect(signedOut.failure).toMatchObject({ status: "auth-required", code: "auth-required" });

    // an older catalog stands beside the last read's failure, a read running;
    // a role and a key a newer daemon sends ride through
    const stale = AgentModelsResult.parse(fixture("agent-models.stale.json"));
    expect(stale.refreshing).toBe(true);
    expect(stale.failure?.code).toBe("timeout");
    expect(stale.catalog?.models[1]?.controls.map((control) => control.role)).toEqual([
      "effort",
      "some-future-role",
    ]);
    expect((stale as Record<string, unknown>)["later"]).toEqual({ kept: true });
    // `refreshing` is always said; a control offers at least its ids
    const { refreshing: _r, ...unsaid } = valid;
    expect(AgentModelsResult.safeParse(unsaid).success).toBe(false);
  });

  it("QL-D10 — resume params: a run, or a conversation by its native id; the run is the more specific claim", () => {
    const run = AgentResumeParams.parse(fixture("agent-resume-params.valid.json"));
    expect("runtimeRunId" in run && run.runtimeRunId).toBe("run-01J8Z3K9");
    const native = AgentResumeParams.parse(fixture("agent-resume-params.native.json"));
    expect(native).toMatchObject({ provider: "codex", profileId: "codex:work-1c7e" });
    expect("runtimeRunId" in native).toBe(false);
    // a body naming both a run and a conversation is the RUN form
    const both = AgentResumeParams.parse({
      runtimeRunId: "run-1",
      provider: "codex",
      nativeSessionId: "n-1",
    });
    expect("runtimeRunId" in both && both.runtimeRunId).toBe("run-1");
    // a persona is named once: its id, or an Agent Profile — never both
    expect(
      AgentResumeNativeParams.safeParse({
        provider: "codex",
        nativeSessionId: "n-1",
        profileId: "codex:a",
        profileSet: "work",
      }).success,
    ).toBe(false);
    expect(
      AgentResumeParams.safeParse({ provider: "codex", nativeSessionId: "n-1", profileSet: "work" })
        .success,
    ).toBe(true);
    for (const bad of [
      {},
      { provider: "codex" },
      { nativeSessionId: "n-1" },
      { provider: "codex", nativeSessionId: "" },
      { provider: "not a provider!", nativeSessionId: "n-1" },
      { provider: "codex", nativeSessionId: "n-1", profileSet: "Not A Set" },
    ]) {
      expect(AgentResumeParams.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the persisted record: an opaque continuation beside the launch facts, stamped at exit", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    expect(record.format).toBe(1);
    expect(record.continuation.nativeSessionId).toBe("native-1");
    expect(record.exited?.reason).toBe("completed");
    // never a transcript, never a path to one
    expect(JSON.stringify(record)).not.toContain("transcript");
  });

  it("AR-4: the record carries the durable identity a re-attach restores against, and what the last boot did", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    expect(record.creationRequestId).toBe("req-01J8Z3K9");
    expect(record.ingress).toEqual({ port: 53210, token: "c0ffee-bearer" });
    expect(record.reattach).toMatchObject({ state: "attached" });
    expect(record.runtimeEpoch).toBe(2);
    // a record written before AR-4 (no identity, no ingress) still parses
    const { creationRequestId: _c, ingress: _i, reattach: _r, ...older } = record;
    expect(AgentSessionRecord.safeParse(older).success).toBe(true);
    // the ingress is a positive port and a non-empty bearer, or nothing
    expect(
      AgentSessionRecord.safeParse({ ...record, ingress: { port: 0, token: "x" } }).success,
    ).toBe(false);
    expect(
      AgentSessionRecord.safeParse({ ...record, reattach: { state: "later", at: "now" } }).success,
    ).toBe(false);
  });

  it("PJ-6 (Q4): the record keeps the model the run was launched at, opaque; a record without one is every record before PJ-6", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    expect(record.modelSelection).toBeUndefined();
    const launched = AgentSessionRecord.parse({
      ...record,
      modelSelection: { modelId: "model-card-v2", controls: { effort: "high" } },
    });
    expect(launched.modelSelection).toEqual({
      modelId: "model-card-v2",
      controls: { effort: "high" },
    });
    // the field is the launch's shape, typed: a record naming no model is not one
    expect(
      AgentSessionRecord.safeParse({ ...record, modelSelection: { modelId: "" } }).success,
    ).toBe(false);
  });

  it("RA-D7: the continuation carries puppeteer's not-yet-resumable mark; a record without it is every record before it", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    expect(record.continuation.resumable).toBeUndefined();
    const unwritten = AgentSessionRecord.parse({
      ...record,
      continuation: { ...record.continuation, resumable: false },
    });
    expect(unwritten.continuation.resumable).toBe(false);
    // typed: the mark is a boolean, never a word
    expect(
      AgentSessionRecord.safeParse({
        ...record,
        continuation: { ...record.continuation, resumable: "no" },
      }).success,
    ).toBe(false);
  });

  it("RA-D3: the record keeps the adapter's attach record opaque, and a failed attach's next step as an open word", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    // every record before the re-attach study's Step 1 has neither
    expect(record.attach).toBeUndefined();
    expect(record.reattach?.next).toBeUndefined();
    const attach = {
      version: 2,
      state: '{"endpoint":"unix:///tmp/helper.sock"}',
      secret: "nonce-1",
    };
    const kept = AgentSessionRecord.parse({
      ...record,
      attach,
      reattach: { state: "failed", at: record.createdAt, reason: "starting", next: "retry" },
    });
    expect(kept.attach).toEqual(attach);
    expect(kept.reattach?.next).toBe("retry");
    // a key a newer puppeteer adds rides through whole (the HMAC covers it),
    // and so does a next word this pin does not know
    const later = { version: 1, state: "", later: true };
    expect(AgentSessionRecord.parse({ ...record, attach: later }).attach).toEqual(later);
    const unknownNext = { state: "failed", at: record.createdAt, next: "a-later-step" };
    expect(AgentSessionRecord.safeParse({ ...record, reattach: unknownNext }).success).toBe(true);
    // typed: a version is a whole number, a secret is not empty
    for (const bad of [
      { version: 1.5, state: "s" },
      { version: -1, state: "s" },
      { state: "s" },
      { version: 1, state: "s", secret: "" },
    ]) {
      const parsed = AgentSessionRecord.safeParse({ ...record, attach: bad });
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("AR-4: the row says whether it was re-attached, or is pending a resume at its next idle", () => {
    const summary = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(summary.continuation).toEqual({ persisted: true, resumable: false, reattached: true });
    const pending = AgentSessionSummary.parse({
      ...summary,
      observationLevel: "none",
      status: "unknown",
      continuation: {
        persisted: true,
        resumable: true,
        pending: "resume-when-idle",
        reason: "the adapter cannot attach to a running session",
      },
    });
    expect(pending.continuation?.pending).toBe("resume-when-idle");
    expect(
      AgentSessionSummary.safeParse({
        ...summary,
        continuation: { persisted: true, resumable: true, pending: "someday" },
      }).success,
    ).toBe(false);
    // a resumed run names the PTY it replaced
    const replaced = AgentSessionSummary.parse({
      ...summary,
      terminal: { hosted: "local", runtimeSessionId: "sess-new", replaced: "sess-01J8Z3K9" },
    });
    expect(replaced.terminal?.replaced).toBe("sess-01J8Z3K9");
  });
});

describe("LAYOUT (AR-4)", () => {
  it("puppeteer's creation registry lives under this user's agents/ tree", () => {
    expect(LAYOUT.AGENT_RUNS_DIR).toEqual(["agents", "runs"]);
    expect(LAYOUT.AGENT_RUNS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_RUNS_DIR");
  });

  it("AR-4b: the signing key sits beside the records, under the same tree", () => {
    expect(LAYOUT.AGENT_SESSIONS_KEY_FILE).toEqual(["agents", "sessions.key"]);
    expect(LAYOUT.AGENT_SESSIONS_KEY_FILE.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_SESSIONS_KEY_FILE");
  });
});

describe("the record's tamper evidence (AR-4b)", () => {
  it("carries a hex HMAC or nothing; a successor run is named by id", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.valid.json"));
    expect(record.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(AgentSessionRecord.safeParse({ ...record, signature: "not-hex" }).success).toBe(false);
    const resumed = AgentSessionRecord.parse({
      ...record,
      reattach: { state: "resumed", at: record.createdAt, replacedBy: "run-next" },
    });
    expect(resumed.reattach?.replacedBy).toBe("run-next");
  });
});

describe("item 124 — the row says the door is off for this process", () => {
  it("carries `door: off` for a run born without its briefing, and a row without it reads as before", () => {
    const off = AgentSessionSummary.parse(fixture("agent-session-summary.door-off.json"));
    expect(off.door).toBe("off");
    // absent is the door as briefed, or none asked: every row from before item 124
    const before = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(before.door).toBeUndefined();
    // OPEN, like spawnedBy: a later word still reads; an empty one is no word
    expect(AgentSessionSummary.safeParse({ ...off, door: "later-word" }).success).toBe(true);
    expect(AgentSessionSummary.safeParse({ ...off, door: "" }).success).toBe(false);
  });

  it("is never the signed record's: the record keeps no door, so the next birth is briefed afresh", () => {
    expect(Object.keys(AgentSessionRecord.shape)).not.toContain("door");
  });
});
