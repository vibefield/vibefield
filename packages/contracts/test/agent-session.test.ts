import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_MONITOR_SCHEMA_VERSION,
  AgentMonitorMirror,
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
      subscription: m.subscription ?? false,
    }));

  it("births on agent.spawn, reads on agent.observe, steers on agent.control; all local in v1", () => {
    expect(rows("agent.")).toEqual([
      {
        method: "agent.providers",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      {
        method: "agent.spawn",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
        subscription: false,
      },
      {
        method: "agent.resume",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
        subscription: false,
      },
      // AR-6-0 (MF-1) — the stop verb, and the first door on `agent.control`:
      // it steers a run that already exists rather than watching the fold or
      // creating a session.
      {
        method: "agent.interrupt",
        scope: "agent.control",
        idempotent: false,
        locality: "local",
        subscription: false,
      },
      {
        method: "agent.list",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      {
        method: "agent.subscribe",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: true,
      },
    ]);
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
