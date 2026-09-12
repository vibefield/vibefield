// Managed sessions (AR-3): the AgentHost over the REAL floor, the fold, the
// persisted continuation, the persona login pane. The first block runs
// against the mock mgmt server (no floor: the doors refuse typed); the rest
// spawns the real field-native (Rust) and drives puppeteer inside fieldd with
// a SCRIPTED provider whose adapter asks the host for a PTY the way every
// built-in adapter does — so the seam under test is VibeField's (the clean
// environment, the agent cell, the ticket, the record, the exit path, the
// resume) and nothing of any vendor's. The persona login pane runs the
// scripted `claude` (test/fixtures/fake-claude) through puppeteer's own
// onboarding. The last block runs the REAL claude when FIELDD_TEST_REAL_AGENT
// names it — the P0 witness at the daemon level: a real agent in a PTY on the
// floor with live status.
import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentAdapterBinding,
  AgentHost,
  PromptReceipt,
  PromptSubmission,
} from "@vibecook/puppeteer-core";
import type { AgentProvider, AgentProviderSessionOptions } from "@vibecook/puppeteer-runtime";
import {
  type AgentListResult,
  type AgentProvidersResult,
  AgentSessionRecord,
  type AgentSpawnResult,
  type AgentsProfilesListResult,
  type AgentsProfilesLoginResult,
  LAYOUT,
  SOCKETS,
  type TerminalInfo,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeBinPath, nativeEndpoint, shortTmpRoot, waitForMgmtEndpoint } from "./native-harness";
import { helloAs, type RpcErrorShape, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ROSETTAD = join(FIXTURES, "fake-rosettad.mjs");
const FAKE_CLAUDE = join(FIXTURES, "fake-claude");
const fakeSpawner = (mode: string): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode },
    })) as unknown as typeof spawn;

const rendererParticipant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already-stopped daemons and dead sockets are fine */
    }
  }
  cleanup = [];
  for (const child of children) child.kill("SIGKILL");
  children = [];
});

/** The scripted provider: an adapter that owns nothing but a recipe. Its
 * `createSession` asks the HOST for a PTY running a shell that writes its
 * environment to a file the test reads (the EL7 witness) and then holds the
 * PTY open; its prompt service is `automateTerminal`; a resume arrives as
 * `options.resume`, which it records and continues as the native id. */
interface ScriptedSession {
  runtimeSessionId: string;
  sessionId: string;
  resume: string | undefined;
  host: AgentHost;
}
function scriptedProvider(envOut: string, sessions: ScriptedSession[]): AgentProvider {
  let counter = 0;
  return {
    descriptor: { id: "scripted", label: "Scripted" },
    async createSession(options: AgentProviderSessionOptions): Promise<AgentAdapterBinding> {
      const n = ++counter;
      const out = join(envOut, `session-${n}.env`);
      const { runtimeSessionId } = await options.host.spawnTerminal({
        command: "/bin/sh",
        args: ["-c", `env > "$SCRIPTED_ENV_OUT"; exec /bin/cat`],
        cwd: options.cwd,
        env: {
          SCRIPTED_ENV_OUT: out,
          SCRIPTED_TOKEN: `token-${n}`,
          // an adapter asking for a daemon-secret class: the host must refuse it
          FIELDD_SMUGGLED: "never",
        },
      });
      const sessionId = options.resume ?? `scripted-native-${n}`;
      sessions.push({ runtimeSessionId, sessionId, resume: options.resume, host: options.host });
      return {
        sessionId,
        runtimeSessionId,
        observationLevel: () => "terminal-only",
        events: { onCandidate: () => () => undefined },
        services: {
          prompt: {
            async submit(submission: PromptSubmission): Promise<PromptReceipt> {
              const result = await options.host.automateTerminal(runtimeSessionId, {
                kind: "paste",
                text: submission.text,
                submit: submission.mode !== "paste-only",
              });
              return result.accepted
                ? { status: "confirmed" }
                : { status: "rejected", reason: result.reason };
            },
          },
        },
        async dispose() {},
      };
    },
  };
}

interface Box {
  root: string;
  dataDir: string;
  bin: string;
  envOut: string;
  daemon: FielddDaemon;
  sessions: ScriptedSession[];
}

/** Boot fieldd: over the mock mgmt server (no floor) or the REAL field-native. */
async function setup(config: { floor: "mock" | "real"; realAgent?: boolean }): Promise<Box> {
  const root = shortTmpRoot("vf-ar3-");
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  const bin = join(root, "bin");
  mkdirSync(bin);
  copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
  const envOut = join(root, "env-out");
  mkdirSync(envOut);
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  if (config.floor === "mock") {
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
  } else {
    const child = spawn(BIN, [], {
      env: {
        ...process.env,
        FIELD_NATIVE_DATA_DIR: dataDir,
        FIELD_LOG_DIR: join(dataDir, "logs"),
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      },
      stdio: "ignore",
    });
    children.push(child);
    await waitForMgmtEndpoint(dataDir, 15_000);
  }
  // The scripted `claude` is what puppeteer's claude profile service runs for
  // the login pane and the identity read (it resolves the executable from
  // this variable at construction); the real-agent block leaves it unset so
  // the vendor's own binary is launched.
  const previous = process.env["PUPPETEER_CLAUDE_BIN"];
  if (config.realAgent) delete process.env["PUPPETEER_CLAUDE_BIN"];
  else process.env["PUPPETEER_CLAUDE_BIN"] = join(bin, "claude");
  cleanup.push(() => {
    if (previous === undefined) delete process.env["PUPPETEER_CLAUDE_BIN"];
    else process.env["PUPPETEER_CLAUDE_BIN"] = previous;
  });
  const sessions: ScriptedSession[] = [];
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner("ok"),
    rosettadHome: home,
    vibefieldRoot: root,
    agentSearchPath: bin,
    agentProviders: (builtin) => [...builtin, scriptedProvider(envOut, sessions)],
    // no floor: a spawn must refuse quickly, not wait a cell's whole birth budget
    ...(config.floor === "mock" ? { terminalBirthWaitMs: 300 } : {}),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { root, dataDir, bin, envOut, daemon, sessions };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A renderer window token holding exactly `scopes`. */
async function window(daemon: FielddDaemon, scopes: string[], suffix: string): Promise<WsRpc> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: rendererParticipant(suffix),
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

const DECK = ["agent.spawn", "agent.observe", "terminal.attach", "index.read"];

async function poll<T>(fn: () => Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const mode = (path: string) => statSync(path).mode & 0o777;
const readRecord = (dataDir: string, runtimeRunId: string) =>
  AgentSessionRecord.parse(
    JSON.parse(
      readFileSync(
        join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${encodeURIComponent(runtimeRunId)}.json`),
        "utf8",
      ),
    ),
  );

/** every audit line under the user root, concatenated (the ledgers are JSONL) */
function auditText(dataDir: string): string {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        )
      : [];
  return walk(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

const parseEnvFile = (path: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );

describe("agent.* without a floor (the mock mgmt server)", () => {
  it("agent.providers lists what one can spawn as — the scripted claude available, the scripted provider composed, personas by provider — and the fold starts empty", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "p1");
    const { providers } = (await win.call("agent.providers", {})) as AgentProvidersResult;
    const claude = providers.find((p) => p.id === "claude");
    expect(claude).toBeDefined();
    expect(claude?.available).toBe(true);
    expect(claude?.resumable).toBe(true);
    expect(claude?.personas.map((p) => p.profileId)).toEqual(["claude:native-default"]);
    const scripted = providers.find((p) => p.id === "scripted");
    expect(scripted).toMatchObject({ label: "Scripted", available: false, personas: [] });
    // nothing here names a path or a home
    expect(JSON.stringify(providers)).not.toContain("/");
    const listed = (await win.call("agent.list", {})) as AgentListResult;
    expect(listed.sessions).toEqual([]);
    const sub = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(sub.snapshot.sessions).toEqual([]);
  });

  it("the scopes: births need agent.spawn, the fold needs agent.observe", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const observer = await window(daemon, ["agent.observe"], "s1");
    expect((await observer.callErr("agent.spawn", { provider: "scripted" })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect((await observer.callErr("agent.providers", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    const spawner = await window(daemon, ["agent.spawn"], "s2");
    expect((await spawner.callErr("agent.list", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    expect((await spawner.callErr("agent.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("a spawn with no floor refuses UNAVAILABLE in the floor's own words, records nothing, and the audit says failed", async () => {
    const { daemon, dataDir } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "n1");
    const err = (await win.callErr("agent.spawn", { provider: "scripted" })) as RpcErrorShape;
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect(JSON.stringify(err)).toContain("terminal");
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
    expect(auditText(dataDir)).toContain("agent.session.spawn");
    expect(auditText(dataDir)).toContain('"outcome":"failed"');
    // an unknown provider is NOT_FOUND, not a spawn attempt
    expect((await win.callErr("agent.spawn", { provider: "nope" })).data?.kind).toBe("NOT_FOUND");
    // a resume of a record that does not exist is NOT_FOUND
    expect((await win.callErr("agent.resume", { runtimeRunId: "run-none" })).data?.kind).toBe(
      "NOT_FOUND",
    );
  });
});

describe("managed sessions over the REAL floor (field-native)", () => {
  it("spawn: a PTY on the agent cell with a CLEAN environment; the fold's row, the record (0600), the ticket, the audit; automation through the host; exit withdraws the row and stamps the record; resume continues from the record; a live run refuses to be resumed", async () => {
    const { daemon, dataDir, envOut, sessions } = await setup({ floor: "real" });
    const win = await window(daemon, DECK, "r1");

    // ── the birth ──
    const spawned = (await win.call("agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      title: "scripted one",
    })) as AgentSpawnResult;
    expect(spawned.session.tier).toBe("managed");
    expect(spawned.session.kind).toBe("scripted");
    expect(spawned.session.label).toBe("Scripted");
    expect(spawned.session.device).toBe(daemon.devices.currentDeviceId());
    expect(spawned.session.title).toBe("scripted one");
    expect(spawned.session.terminal).toMatchObject({
      hosted: "local",
      runtimeSessionId: spawned.terminal.sessionId,
    });
    expect(spawned.session.continuation).toEqual({ persisted: true, resumable: false });
    expect(spawned.session.observationLevel).toBe("terminal-only");
    // the same routed ticket terminal.create answers: the pane mounts it
    expect(spawned.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(spawned.terminal).toHaveProperty("attachGrant");
    expect(spawned.terminal.session.id).toBe(spawned.terminal.sessionId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.runtimeSessionId).toBe(spawned.terminal.sessionId);
    expect(sessions[0]?.resume).toBeUndefined();

    // ── EL7: the environment the agent was born with ──
    const envFile = join(envOut, "session-1.env");
    const env = await poll(
      async () => (existsSync(envFile) ? parseEnvFile(envFile) : undefined),
      10_000,
    );
    expect(env["SCRIPTED_TOKEN"]).toBe("token-1");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["HOME"]).toBeTruthy();
    expect(env["PATH"]).toBeTruthy();
    expect(env["USER"]).toBeTruthy();
    // the daemon's own variables never enter — not the ones it was spawned
    // with, not the one the adapter asked for
    expect(env).not.toHaveProperty("FIELDD_SMUGGLED");
    expect(env).not.toHaveProperty("FIELD_NATIVE_DATA_DIR");
    expect(env).not.toHaveProperty("FIELDD_ROSETTAD_BIN");
    expect(env).not.toHaveProperty("PUPPETEER_CLAUDE_BIN");
    expect(
      Object.keys(env).filter((k) => k.startsWith("FIELD_") || k.startsWith("FIELDD_")),
    ).toEqual([]);

    // ── the record ──
    const runId = spawned.session.runtimeRunId;
    const record = readRecord(dataDir, runId);
    expect(record.provider).toBe("scripted");
    expect(record.cwd).toBe(envOut);
    expect(record.terminalSessionId).toBe(spawned.terminal.sessionId);
    expect(record.continuation).toMatchObject({
      providerId: "scripted",
      nativeSessionId: spawned.session.sessionId,
    });
    expect(record.exited).toBeUndefined();
    const recordPath = join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${runId}.json`);
    expect(mode(recordPath)).toBe(0o600);
    expect(mode(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(0o700);

    // ── the fold: the row, joined to its cell once the inventory carries it ──
    const row = await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      const found = rows.find((r) => r.runtimeRunId === runId);
      return found?.terminal?.cellBootId !== undefined ? found : undefined;
    }, 10_000);
    expect(row.terminal?.workloadClass).toBe("agent");
    expect(["idle", "working", "blocked", "unknown"]).toContain(row.status);
    const observed = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(
      observed.terminals.find((t) => t.sessionId === spawned.terminal.sessionId)?.cell,
    ).toMatchObject({ workloadClass: "agent" });

    // ── agent.subscribe: a snapshot now, frames later ──
    const sub = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(sub.snapshot.sessions.map((r) => r.runtimeRunId)).toEqual([runId]);

    // ── automation through the host: the floor's epoch path accepts it ──
    const agent = daemon.agents.runtime.agent(spawned.terminal.sessionId);
    expect(agent).toBeDefined();
    const receipt = await agent!.submitPrompt({ text: "hello-floor" });
    expect(receipt.status).toBe("confirmed");

    // ── the audit ──
    const audit = auditText(dataDir);
    expect(audit).toContain('"action":"agent.session.spawn"');
    expect(audit).toContain('"kind":"agent-session"');
    expect(audit).toContain(runId);

    // ── the exit: the floor's ladder; the row leaves, the record is stamped ──
    const term = (await win.call("terminal.terminate", {
      sessionId: spawned.terminal.sessionId,
    })) as { terminated: boolean };
    expect(term.terminated).toBe(true);
    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      return rows.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    const exited = await poll(async () => {
      const r = readRecord(dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 5_000);
    expect(exited.exited?.reason).toBeTruthy();
    // the subscriber saw the withdrawal as a full frame
    await poll(async () => {
      const frames = win.notifications.filter((n) => n.params.subId === sub.subId);
      const last = frames.at(-1)?.params.payload as AgentListResult | undefined;
      return last !== undefined && !last.sessions.some((r) => r.runtimeRunId === runId)
        ? true
        : undefined;
    }, 5_000);
    // puppeteer no longer holds the run
    expect(daemon.agents.runtime.agent(spawned.terminal.sessionId)).toBeUndefined();

    // ── resume: a new run in a new PTY, the vendor's conversation continued ──
    const resumed = (await win.call("agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.runtimeRunId).not.toBe(runId);
    expect(resumed.session.sessionId).toBe(spawned.session.sessionId);
    expect(resumed.session.title).toBe("scripted one");
    expect(resumed.terminal.sessionId).not.toBe(spawned.terminal.sessionId);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.resume).toBe(spawned.session.sessionId);
    const second = readRecord(dataDir, resumed.session.runtimeRunId);
    expect(second.continuation.nativeSessionId).toBe(spawned.session.sessionId);
    expect(second.exited).toBeUndefined();
    expect(auditText(dataDir)).toContain('"action":"agent.session.resume"');
    // the old record stands, stamped; the new run is live — and a live run
    // refuses to be resumed (re-attach is AR-4's)
    expect(readRecord(dataDir, runId).exited).toBeDefined();
    const refused = await win.callErr("agent.resume", {
      runtimeRunId: resumed.session.runtimeRunId,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(refused)).toContain("terminal-alive");

    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 90_000);

  it("the persona login pane: the vendor's own login in a PTY, and the identity re-read when it ends", async () => {
    const { daemon, dataDir } = await setup({ floor: "real" });
    const win = await window(daemon, DECK, "l1");
    const before = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(before.personas[0]?.identity).toBeUndefined();

    const login = (await win.call("agents.profiles.login", {
      profileId: "claude:native-default",
    })) as AgentsProfilesLoginResult;
    expect(login.persona.profileId).toBe("claude:native-default");
    expect(login.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(login.terminal).toHaveProperty("attachGrant");

    // the scripted login returns at once → the pane ends → the identity is
    // read from the vendor's status surface and recorded on the persona
    const verified = await poll(async () => {
      const { personas } = (await win.call("agents.profiles.list", {
        provider: "claude",
      })) as AgentsProfilesListResult;
      const persona = personas.find((p) => p.profileId === "claude:native-default");
      return persona?.identity?.loggedIn === true ? persona : undefined;
    }, 15_000);
    expect(verified.identity).toMatchObject({
      loggedIn: true,
      method: "claude.ai",
      email: "persona@example.test",
      organization: "Example Org",
      plan: "max",
    });
    expect(auditText(dataDir)).toContain('"action":"agents.profiles.login"');
    // the login pane is not a managed session: the fold never carried it
    expect(((await win.call("agent.list", {})) as AgentListResult).sessions).toEqual([]);
  }, 60_000);
});

const REAL_AGENT = process.env["FIELDD_TEST_REAL_AGENT"] === "1";

describe.skipIf(!REAL_AGENT)(
  "the REAL claude over the real floor (FIELDD_TEST_REAL_AGENT=1)",
  () => {
    it("a real agent in a PTY on the floor with live status: alive, the native session id observed from the vendor's own hooks, the record following it; terminate withdraws it", async () => {
      const { daemon, dataDir, root } = await setup({ floor: "real", realAgent: true });
      const win = await window(daemon, DECK, "real1");
      const cwd = join(root, "work");
      mkdirSync(cwd);
      const spawned = (await win.call("agent.spawn", {
        provider: "claude",
        cwd,
      })) as AgentSpawnResult;
      expect(spawned.session.kind).toBe("claude");
      expect(spawned.session.terminal?.hosted).toBe("local");
      const runId = spawned.session.runtimeRunId;
      const live = await poll(async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.monitor?.alive === true && row.sessionIdBasis === "observed" ? row : undefined;
      }, 60_000);
      // eslint-disable-next-line no-console
      console.log(
        `REAL_AGENT ${JSON.stringify({
          status: live.status,
          observationLevel: live.observationLevel,
          sessionId: live.sessionId,
          level: live.monitor?.freshness?.level,
          schemaVersion: live.monitor?.schemaVersion,
        })}`,
      );
      expect(live.monitor?.schemaVersion).toBe(2);
      expect(["idle", "working", "blocked"]).toContain(live.status);
      const record = await poll(async () => {
        const r = readRecord(dataDir, runId);
        return r.continuation.nativeSessionId === live.sessionId ? r : undefined;
      }, 10_000);
      expect(record.provider).toBe("claude");
      // hold the live agent for a moment: a vendor TUI that exits by itself in
      // its first seconds is a finding, and the exit facts say which
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const still = ((await win.call("agent.list", {})) as AgentListResult).sessions.find(
        (r) => r.runtimeRunId === runId,
      );
      console.log(
        `REAL_AGENT_AFTER_5S ${JSON.stringify({
          present: still !== undefined,
          status: still?.status,
          alive: still?.monitor?.alive,
          level: still?.monitor?.freshness?.level,
          blockers: still?.monitor?.blockers,
          exited: readRecord(dataDir, runId).exited,
        })}`,
      );
      const term = (await win.call("terminal.terminate", {
        sessionId: spawned.terminal.sessionId,
      })) as { terminated: boolean };
      console.log(`REAL_AGENT_TERMINATE ${JSON.stringify(term)}`);
      await poll(async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
      }, 30_000);
      const final = readRecord(dataDir, runId);
      console.log(`REAL_AGENT_EXIT ${JSON.stringify(final.exited)}`);
      expect(final.exited).toBeDefined();
      expect(still, "the real agent left its PTY within seconds of starting").toBeDefined();
      expect(term.terminated).toBe(true);
    }, 150_000);
  },
);
