import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type { MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import {
  AGENT_CATALOG,
  type AgentSessionSummary,
  createAgentCatalogReaders,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { hostProfileSetFrom, hostRunFromSummary, isUrgentChange } from "../src/agent-monitor";
import { managedSummary as summary } from "./agent-field-summary";
import {
  floorTerminal,
  NOW0,
  nativeSet,
  profileSetsFrame,
  stateOf,
  T0,
  testMonitor,
} from "./agent-monitor-fixture";

// MV-3a (MV-D22) — the monitor backend hosted beside the runtime: the fold's
// rows and the runtime's states (puppeteer's real shapes, from
// `agent-field-summary.ts`) in, the model's rows out, through fieldd's own host
// facts. What is tested here is the HOST half — how fieldd's facts reach the
// backend and what the backend makes of them; the backend's own rules are
// puppeteer-monitor's and pinned there.

const working = summary({
  runtimeRunId: "run-working",
  status: "working",
  cumulativeTokens: 900,
  contextPercent: 41,
  effort: { value: "high", intent: "observed" },
  lastAssistantText: "Keeping it greyed; wiring the filter now.",
  git: { branch: "ds/c" },
});
const blocked = summary({ runtimeRunId: "run-blocked", status: "blocked", permissionTool: "Bash" });
const pending = summary({
  runtimeRunId: "run-pending",
  monitor: false,
  pending: "re-attach refused",
});
const exited = summary({ runtimeRunId: "run-exited", status: "idle", exited: true });

function asking(base: AgentSessionSummary, prompt: string): AgentSessionSummary {
  const monitor = base.monitor;
  if (monitor === undefined) throw new Error("a question needs a mirror");
  return {
    ...base,
    status: "blocked",
    monitor: {
      ...monitor,
      status: "blocked",
      blockers: [
        {
          id: "q-1",
          kind: "question",
          since: "2026-09-13T10:04:30.000Z",
          detail: "the provider's own sentence about the question",
          questions: [{ header: "Keep?", prompt, options: [{ label: "Keep it" }] }],
        },
      ],
    },
  };
}

describe("hostRunFromSummary — the fold's row as the backend's host record", () => {
  it("joins the PTY and names the project by the workspace; the row's identity is the backend's to carry (M22)", () => {
    const run = hostRunFromSummary(working);
    expect(run).toMatchObject({
      runtimeRunId: "run-working",
      createdAt: T0,
      provider: { id: "claude", label: "Claude Code" },
      terminalSessionId: "run-working-pty",
      projectKey: "/repo",
      workspace: { root: "/repo", sourcePath: "/repo" },
      tier: "managed",
      nativeSessionId: "run-working-native",
    });
    // a mirror exists: the backend reads the runtime's own liveness, so the
    // host says nothing about it
    expect(run.alive).toBeUndefined();
    expect(run.pending).toBeUndefined();
    // fieldd keeps no identity for a PTY across handoffs: the backend's
    // carry-forward decides the row's id, and `rowForRun` asks it (`idOf`)
    expect(run.terminalIdentity).toBeUndefined();
  });

  it("an exited run is not alive and claims no PTY — its shell is a bare terminal again (AR-7)", () => {
    const run = hostRunFromSummary(exited);
    expect(run.alive).toBe(false);
    expect(run.terminalSessionId).toBeUndefined();
  });

  it("a pending run is alive by its PTY and says what drives it (AR-4)", () => {
    const run = hostRunFromSummary(pending);
    expect(run.pending).toBe("resume-when-idle");
    expect(run.alive).toBe(true);
    expect(run.terminalSessionId).toBe("run-pending-pty");
  });

  it("no mirror and no PTY: not alive, as the field row says (ruled 2026-09-13)", () => {
    const run = hostRunFromSummary(
      summary({ runtimeRunId: "run-bare", monitor: false, noTerminal: true }),
    );
    expect(run.alive).toBe(false);
    expect(run.terminalSessionId).toBeUndefined();
  });

  it("AR-4's replaced PTY rides along so the old pane is no phantom terminal", () => {
    const run = hostRunFromSummary(
      summary({
        runtimeRunId: "run-resumed",
        terminal: { hosted: "local", runtimeSessionId: "pty-new", replaced: "pty-old" },
      }),
    );
    expect(run.terminalSessionId).toBe("pty-new");
    expect(run.replacedTerminalSessionId).toBe("pty-old");
  });
});

describe("the hosted backend — the model's rows for the fold's fixtures", () => {
  it("derives a working row from the state, the fold's facts and this device", async () => {
    const monitor = await testMonitor({
      summaries: [working],
      profiles: profileSetsFrame([nativeSet()]),
    });
    const row = monitor.row("run-working");
    expect(row).toMatchObject({
      id: "run-working",
      kind: "agent",
      createdAt: T0,
      status: "working",
      alive: true,
      observed: true,
      stale: false,
      project: { name: "repo", branch: "ds/c", seq: 0 },
      provider: { id: "claude", label: "Claude Code" },
      model: "Opus 5",
      effort: { value: "high", intent: "observed" },
      context: { usedPercent: 41 },
      reply: { text: "Keeping it greyed; wiring the filter now.", final: true },
      tokens: { total: 900, perMinute: 120 },
      unread: false,
      device: { id: "this-device", name: "Studio", os: "mac", self: true },
      tier: "managed",
      profileSet: "native",
      attachable: true,
    });
    expect(row.pending).toBeUndefined();
    expect(row.wait).toBeUndefined();
    // the activity line is the state's own
    expect(row.statusSince).toBe(Date.parse("2026-09-13T10:04:00.000Z"));
    monitor.service.dispose();
  });

  it("a permission blocker is a wait with its tool; a question carries header and prompt apart (M2)", async () => {
    const question = asking(summary({ runtimeRunId: "run-asking" }), "Keep the board greyed?");
    const monitor = await testMonitor({ summaries: [blocked, question] });
    const permission = monitor.row("run-blocked");
    expect(permission.status).toBe("blocked");
    expect(permission.wait).toMatchObject({
      kind: "permission",
      tool: "Bash",
      since: Date.parse("2026-09-13T10:04:00.000Z"),
      detail: "Claude wants to run a command",
    });
    expect(permission.wait?.count).toBeUndefined();
    const asked = monitor.row("run-asking");
    expect(asked.wait).toMatchObject({
      kind: "question",
      header: "Keep?",
      question: "Keep the board greyed?",
      detail: "the provider's own sentence about the question",
    });
    monitor.service.dispose();
  });

  it("a pending run is an idle, unobserved row that says so; an exited run is a dead row and its PTY a terminal", async () => {
    const monitor = await testMonitor({
      summaries: [pending, exited],
      terminals: [
        floorTerminal({ sessionId: "run-exited-pty", cwd: "/repo", title: "zsh" }),
        floorTerminal({ sessionId: "run-pending-pty", cwd: "/repo" }),
      ],
    });
    const rows = monitor.rows();
    const pendingRow = monitor.row("run-pending");
    expect(pendingRow).toMatchObject({
      status: "idle",
      alive: true,
      observed: false,
      pending: true,
      detail: "unobserved · resumes when idle",
      attachable: true,
    });
    const exitedRow = monitor.row("run-exited");
    expect(exitedRow).toMatchObject({ alive: false, attachable: false });
    // the exited run's PTY is a bare terminal row; the pending run's is claimed
    const terminals = rows.filter((row) => row.kind === "terminal").map((row) => row.id);
    expect(terminals).toEqual(["run-exited-pty"]);
    expect(monitor.service.terminalRows().map((row) => row.id)).toEqual(["run-exited-pty"]);
    monitor.service.dispose();
  });

  it("a bare terminal is a row of its own: the floor's cwd, title and class, the profile it was born under", async () => {
    const monitor = await testMonitor({
      summaries: [working],
      terminals: [
        floorTerminal(),
        floorTerminal({ sessionId: "run-working-pty", cwd: "/repo" }),
        floorTerminal({ sessionId: "pty-bound", cwd: undefined, title: "" }),
      ],
    });
    monitor.terminals.bind("pty-bound", "work");
    monitor.terminals.observe(monitor.terminals.list());
    const rows = monitor.rows();
    // the agent's row carries its PTY's id — the shell's body is the agent's
    // (the backend's carry-forward, M22); the run is found through `idOf`
    expect(rows.map((row) => `${row.kind}:${row.id}`)).toEqual([
      "agent:run-working-pty",
      "terminal:pty-bare",
      "terminal:pty-bound",
    ]);
    expect(monitor.service.rowForRun("run-working")?.id).toBe("run-working-pty");
    expect(monitor.row("run-working").kind).toBe("agent");
    const bare = rows.find((row) => row.id === "pty-bare");
    expect(bare).toMatchObject({
      kind: "terminal",
      status: "idle",
      alive: true,
      observed: true,
      detail: "/Users/me/notes",
      project: { name: "notes" },
      unread: false,
      attachable: true,
      createdAt: T0 - 30_000,
    });
    expect(bare?.project.seq).toBeUndefined();
    const bound = rows.find((row) => row.id === "pty-bound");
    expect(bound).toMatchObject({ profileSet: "work", detail: "Unassigned terminal" });
    expect(bound?.project.name).toBe("terminal");
    monitor.service.dispose();
  });

  it("deals each project one colour sequence, in row order, from the identity store", async () => {
    const other = summary({ runtimeRunId: "run-other", cwd: "/elsewhere" });
    const monitor = await testMonitor({ summaries: [working, other, blocked] });
    const rows = monitor.rows();
    // dealt in the fold's order (working, other, blocked); the model's rows are
    // in the model's order — agents by birth, ties by id (`compareMonitorRows`)
    expect(rows.map((row) => [row.id, row.project.seq])).toEqual([
      ["run-blocked", 0],
      ["run-other", 1],
      ["run-working", 0],
    ]);
    expect([...monitor.identity.entries()]).toEqual([
      ["/repo", 0],
      ["/elsewhere", 1],
    ]);
    monitor.service.dispose();
  });

  it("the device is read per facts: a renamed roster row reaches every row", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    expect(monitor.row("run-working").device).toEqual({
      id: "this-device",
      name: "Studio",
      os: "mac",
      self: true,
    });
    monitor.devices.rename({ id: "dev-ULID", name: "Studio", platform: "linux" });
    expect(monitor.row("run-working").device).toEqual({
      id: "dev-ULID",
      name: "Studio",
      os: "linux",
      self: true,
    });
    monitor.service.dispose();
  });

  it("the spawn menu reads `reading` until the profiles land, then offers the sets with the catalog's sign-in labels", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    expect(monitor.service.snapshot().spawn?.devices[0]).toMatchObject({
      id: "this-device",
      label: "Studio",
      self: true,
      state: "reading",
    });
    monitor.profiles.publish(
      profileSetsFrame([
        nativeSet(),
        nativeSet({
          id: "work",
          kind: "managed",
          label: "Work",
          glyph: "briefcase",
          default: false,
          personas: [
            {
              profileId: "codex-work",
              provider: "codex",
              label: "Codex",
              kind: "managed",
              createdAt: "2026-09-01T00:00:00.000Z",
              identity: { loggedIn: false, verifiedAt: "2026-09-13T09:00:00.000Z" },
            },
          ],
        }),
      ]),
    );
    monitor.rows();
    const device = monitor.service.snapshot().spawn?.devices[0];
    expect(device?.state).toBe("ready");
    expect(
      device?.profiles?.map((profile) => [profile.id, profile.label, profile.signedIn]),
    ).toEqual([
      ["native", "This Mac", ["Claude Code"]],
      // a managed set lists every persona, signed in or not (vf's rule)
      ["work", "Work", ["Codex"]],
    ]);
    expect(device?.profiles?.[0]?.isDefault).toBe(true);
    expect(device?.profiles?.[1]?.glyph).toBe("briefcase");
    monitor.service.dispose();
  });

  it("hostProfileSetFrom names each persona's provider by the catalog, never the adapter", () => {
    const catalog = createAgentCatalogReaders(AGENT_CATALOG);
    const set = hostProfileSetFrom(nativeSet(), catalog);
    expect(set.personas).toEqual([
      { profileId: "claude-native", providerLabel: catalog.entry("claude")?.label, loggedIn: true },
    ]);
    expect(set.isDefault).toBe(true);
  });
});

describe("the hosted backend — the record's past (TL, B-D6 (a))", () => {
  it("joins a fold run with the record by its provider and native id: its past up to statusSince, our gone run ended, a stranger's session none", async () => {
    const MIN = 60_000;
    const asked: unknown[] = [];
    const monitor = await testMonitor({
      summaries: [working],
      history: {
        async read(window, options) {
          asked.push({ window, silenceMs: options.silenceMs });
          return {
            fidelity: "turns",
            partial: false,
            sessions: [
              {
                // the fold's run: `kind` is puppeteer's provider id, `sessionId` the native id
                provider: { id: "claude", label: "Claude Code" },
                nativeSessionId: "run-working-native",
                firstAt: T0 - 60 * MIN,
                lastAt: T0 + 5 * MIN,
                turns: [{ firstAt: T0 - 60 * MIN, lastAt: T0 - 30 * MIN }],
              },
              {
                provider: { id: "claude", label: "Claude Code" },
                nativeSessionId: "gone-native",
                firstAt: T0 - 120 * MIN,
                lastAt: T0 - 90 * MIN,
                projectKey: "/w/gone",
                turns: [{ firstAt: T0 - 120 * MIN, lastAt: T0 - 90 * MIN }],
              },
              {
                // a session this runtime never ran (another terminal app): no lane
                provider: { id: "claude", label: "Claude Code" },
                nativeSessionId: "stranger-native",
                firstAt: T0 - 20 * MIN,
                lastAt: T0 + 5 * MIN,
                turns: [{ firstAt: T0 - 20 * MIN, lastAt: T0 + 5 * MIN }],
              },
            ],
            runs: [
              {
                provider: { id: "claude", label: "Claude Code" },
                nativeSessionId: "gone-native",
                runtimeRunId: "run-gone",
                projectKey: "/w/gone",
                title: "Ship the gone thing",
              },
            ],
          };
        },
      },
    });
    const row = monitor.row("run-working");
    const window = { sinceMs: NOW0 - 24 * 60 * MIN, untilMs: NOW0 };
    const past = (await monitor.service.readPast(window))!;
    expect(asked).toEqual([{ window, silenceMs: 15 * MIN }]);
    expect(past.live).toEqual([
      {
        id: row.id,
        seamAt: row.statusSince,
        spans: [
          { kind: "worked", from: T0 - 60 * MIN, to: T0 - 30 * MIN },
          { kind: "quiet", from: T0 - 30 * MIN, to: row.statusSince },
        ],
      },
    ]);
    expect(past.ended).toMatchObject([
      {
        id: "past:claude:gone-native",
        title: "Ship the gone thing",
        project: { name: "gone" },
        device: { id: "this-device", self: true },
        spans: [{ kind: "worked", from: T0 - 120 * MIN, to: T0 - 90 * MIN }],
      },
    ]);
    // read, never dealt: the gone run's key was never dealt here, so no sequence and no write
    expect(past.ended[0]?.project).not.toHaveProperty("seq");
    expect(monitor.identity.entries().has("/w/gone")).toBe(false);
    monitor.service.dispose();
  });

  it("with no record source there is no past to lend at all (v2 item 9)", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    await expect(
      monitor.service.readPast({ sinceMs: NOW0 - 60_000, untilMs: NOW0 }),
    ).resolves.toBeUndefined();
    monitor.service.dispose();
  });
});

describe("the hosted backend — live changes", () => {
  it("a state push revises the row; a usage-only revision is not urgent, a status flip is", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const heard: Array<{ ids: string[]; urgent: boolean }> = [];
    const off = monitor.service.subscribe((change, urgent) =>
      heard.push({ ids: change.upserts.map((row) => row.id), urgent }),
    );
    const base = stateOf(working);
    // a usage sample: the mirror revised, nothing a person waits on moved
    monitor.runtime.push({
      ...base,
      revision: base.revision + 1,
      usage: { ...base.usage, cumulativeTokens: 1_200 },
    } as AgentMonitorState);
    monitor.rows();
    expect(heard).toEqual([{ ids: ["run-working"], urgent: false }]);
    expect(monitor.row("run-working").tokens?.total).toBe(1_200);
    // the run goes idle: urgent, and the backend flushed it synchronously
    monitor.runtime.push({
      ...base,
      revision: base.revision + 2,
      status: "idle",
      statusSince: "2026-09-13T10:06:00.000Z",
    } as AgentMonitorState);
    expect(heard[1]).toEqual({ ids: ["run-working"], urgent: true });
    expect(monitor.service.rowForRun("run-working")?.status).toBe("idle");
    off();
    monitor.service.dispose();
  });

  it("a birth and a removal are urgent; the removed run leaves the model", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const heard: Array<{ upserts: string[]; removed: string[]; urgent: boolean }> = [];
    monitor.service.subscribe((change, urgent) =>
      heard.push({
        upserts: change.upserts.map((row) => row.id),
        removed: [...change.removed],
        urgent,
      }),
    );
    monitor.fold.publish([working, blocked]);
    monitor.runtime.push(stateOf(blocked));
    monitor.rows();
    expect(heard.at(-1)).toMatchObject({ upserts: ["run-blocked"], urgent: true });
    monitor.fold.publish([working]);
    monitor.runtime.remove("run-blocked");
    monitor.rows();
    expect(heard.at(-1)).toMatchObject({ removed: ["run-blocked"], urgent: true });
    expect(monitor.service.rowForRun("run-blocked")).toBeUndefined();
    monitor.service.dispose();
  });

  it("isUrgentChange: what a person waits on, moved", () => {
    const row = (overrides: Partial<MonitorAgentRow>): MonitorAgentRow =>
      ({
        id: "r",
        kind: "agent",
        createdAt: 0,
        status: "working",
        statusSince: 0,
        stale: false,
        alive: true,
        observed: true,
        detail: "",
        project: { name: "p" },
        unread: false,
        device: { id: "d", name: "d", self: true },
        attachable: true,
        ...overrides,
      }) as MonitorAgentRow;
    const held = new Map([["r", row({})]]);
    const change = (upsert: MonitorAgentRow) => ({
      since: 0,
      revision: 1,
      upserts: [upsert],
      removed: [],
    });
    expect(isUrgentChange(held, change(row({ stale: true, unread: true })))).toBe(false);
    expect(isUrgentChange(held, change(row({ status: "blocked" })))).toBe(true);
    expect(isUrgentChange(held, change(row({ alive: false })))).toBe(true);
    expect(isUrgentChange(held, change(row({ pending: true })))).toBe(true);
    expect(
      isUrgentChange(held, change(row({ wait: { kind: "permission", since: 5, tool: "Bash" } }))),
    ).toBe(true);
    expect(isUrgentChange(held, { since: 0, revision: 1, upserts: [], removed: ["r"] })).toBe(true);
    expect(isUrgentChange(held, change(row({ id: "new" })))).toBe(true);
  });
});

describe("the hosted backend — screens (L5, M20)", () => {
  it("no mark accrues while no screen is open; an open screen's unshown row is marked when its turn finishes; showing it clears; forgetting the last screen drops every mark", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const base = stateOf(working);
    const flip = (revision: number, status: "idle" | "working", at: string): void =>
      monitor.runtime.push({
        ...base,
        revision: base.revision + revision,
        status,
        statusSince: at,
      } as AgentMonitorState);
    // Godview closed: a turn that finishes is never marked (today's behaviour)
    flip(1, "idle", "2026-09-13T10:06:00.000Z");
    expect(monitor.row("run-working")).toMatchObject({ status: "idle", unread: false });
    // a report from a screen that is not open is refused, and changes nothing
    expect(monitor.service.reportShown("win-1", ["run-working"])).toBe(false);
    // the board opens: the screen's first (empty) report stamps first sight
    const close = monitor.service.openScreen("win-1");
    expect(monitor.row("run-working").unread).toBe(false);
    // a turn finishes while the pane shows nothing: unread
    flip(2, "working", "2026-09-13T10:07:00.000Z");
    flip(3, "idle", "2026-09-13T10:08:00.000Z");
    expect(monitor.row("run-working").unread).toBe(true);
    // the pane shows it: cleared now, and the next finished turn stays clear
    expect(monitor.service.reportShown("win-1", ["run-working"])).toBe(true);
    expect(monitor.row("run-working").unread).toBe(false);
    flip(4, "working", "2026-09-13T10:09:00.000Z");
    flip(5, "idle", "2026-09-13T10:10:00.000Z");
    expect(monitor.row("run-working").unread).toBe(false);
    // the pane shows nothing again — an empty report keeps the screen open
    expect(monitor.service.reportShown("win-1", [])).toBe(true);
    flip(6, "working", "2026-09-13T10:11:00.000Z");
    flip(7, "idle", "2026-09-13T10:12:00.000Z");
    expect(monitor.row("run-working").unread).toBe(true);
    // the board closes: the screen is forgotten, the marks go, reports are refused
    close();
    expect(monitor.row("run-working").unread).toBe(false);
    expect(monitor.service.reportShown("win-1", ["run-working"])).toBe(false);
    flip(8, "working", "2026-09-13T10:13:00.000Z");
    flip(9, "idle", "2026-09-13T10:14:00.000Z");
    expect(monitor.row("run-working").unread).toBe(false);
    monitor.service.dispose();
  });
});

describe("the hosted backend — a shell promoted to an agent keeps its body (M22)", () => {
  it("the bare terminal's row id becomes the agent's; the terminal row leaves; the run is found through idOf", async () => {
    const monitor = await testMonitor({
      summaries: [],
      terminals: [floorTerminal({ sessionId: "pty-shell", cwd: "/repo", title: "zsh" })],
    });
    expect(monitor.rows().map((row) => `${row.kind}:${row.id}`)).toEqual(["terminal:pty-shell"]);
    // the person types the agent's name in that shell: the fold names a run in the PTY
    const promoted = summary({
      runtimeRunId: "run-typed",
      status: "working",
      terminal: { hosted: "local", runtimeSessionId: "pty-shell", workloadClass: "interactive" },
    });
    monitor.fold.publish([promoted]);
    monitor.runtime.push(stateOf(promoted));
    const rows = monitor.rows();
    expect(rows.map((row) => `${row.kind}:${row.id}`)).toEqual(["agent:pty-shell"]);
    expect(monitor.service.rowForRun("run-typed")?.id).toBe("pty-shell");
    expect(monitor.service.rowForRun("run-typed")?.status).toBe("working");
    // the PTY stays listed by the floor the whole time (the host contract): the
    // backend dedupes it under the run, and nothing was dropped from the facts
    expect(monitor.terminals.list()?.map((info) => info.sessionId)).toEqual(["pty-shell"]);
    // the run ends and leaves the PTY standing: a bare terminal again, same id
    monitor.fold.publish([]);
    monitor.runtime.remove("run-typed");
    expect(monitor.rows().map((row) => `${row.kind}:${row.id}`)).toEqual(["terminal:pty-shell"]);
    expect(monitor.service.rowForRun("run-typed")).toBeUndefined();
    monitor.service.dispose();
  });
});
