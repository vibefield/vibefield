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
//
// AR-4 (stable ingress): the restart rows boot a SECOND fieldd on the first
// one's root with field-native still running — a graceful stop RELEASES the
// runs, and the next boot's first inventory re-attaches (the scripted
// provider with `attachSession`), holds PENDING (without), and resumes a
// pending run by hand (`agent.resume`) or by itself once the fake rosettad's
// session rows say the conversation has been still (resume-when-idle).
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
import type {
  AgentProvider,
  AgentProviderSessionOptions,
  AttachProviderSessionOptions,
} from "@vibecook/puppeteer-runtime";
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
const fakeSpawner = (mode: string, extra: Record<string, string> = {}): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode, ...extra },
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
/** AR-4 — what the scripted adapter was asked to attach to. */
interface ScriptedAttach {
  runtimeSessionId: string;
  sessionId: string;
  ingress: AttachProviderSessionOptions["ingress"];
}
function scriptedBinding(
  host: AgentHost,
  runtimeSessionId: string,
  sessionId: string,
): AgentAdapterBinding {
  return {
    sessionId,
    runtimeSessionId,
    observationLevel: () => "terminal-only",
    events: { onCandidate: () => () => undefined },
    services: {
      prompt: {
        async submit(submission: PromptSubmission): Promise<PromptReceipt> {
          const result = await host.automateTerminal(runtimeSessionId, {
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
}
function scriptedProvider(
  envOut: string,
  sessions: ScriptedSession[],
  attach: { records: ScriptedAttach[] } | undefined,
): AgentProvider {
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
      return scriptedBinding(options.host, runtimeSessionId, sessionId);
    },
    // AR-4 — an adapter that can re-attach to its running process: it records
    // what it was handed and binds the same terminal and native session
    ...(attach === undefined
      ? {}
      : {
          async attachSession(options: AttachProviderSessionOptions): Promise<AgentAdapterBinding> {
            attach.records.push({
              runtimeSessionId: options.runtimeSessionId,
              sessionId: options.sessionId,
              ingress: options.ingress,
            });
            return scriptedBinding(options.host, options.runtimeSessionId, options.sessionId);
          },
        }),
  };
}

interface Box {
  root: string;
  dataDir: string;
  bin: string;
  envOut: string;
  daemon: FielddDaemon;
  sessions: ScriptedSession[];
  /** AR-4 — the scripted adapter's attach log (empty when it cannot attach) */
  attached: ScriptedAttach[];
  /** AR-4 — the file the fake rosettad serves session rows from */
  sessionsFile: string;
}

interface SetupConfig {
  floor: "mock" | "real";
  realAgent?: boolean;
  /** AR-4 — give the scripted provider an `attachSession` */
  attach?: boolean;
  /** AR-4 — boot a SECOND fieldd on this box's root, its field-native still
   * running and its records on disk: the restart */
  restartOf?: Box;
  resumeWhenIdle?: { afterMs: number; pollMs: number };
}

/** Boot fieldd: over the mock mgmt server (no floor) or the REAL field-native. */
async function setup(config: SetupConfig): Promise<Box> {
  const restart = config.restartOf;
  const root = restart?.root ?? shortTmpRoot("vf-ar3-");
  if (restart === undefined) cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  const bin = join(root, "bin");
  const envOut = join(root, "env-out");
  const home = join(dataDir, "home");
  const sessionsFile = join(root, "rosetta-sessions.json");
  if (restart === undefined) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    mkdirSync(bin);
    copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
    mkdirSync(envOut);
    mkdirSync(home, { recursive: true });
  }
  if (restart !== undefined) {
    // the floor is the one already running; only fieldd is reborn
  } else if (config.floor === "mock") {
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
  const sessions: ScriptedSession[] = restart?.sessions ?? [];
  const attached: ScriptedAttach[] = restart?.attached ?? [];
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner("ok", { FAKE_ROSETTAD_SESSIONS: sessionsFile }),
    rosettadHome: home,
    vibefieldRoot: root,
    agentSearchPath: bin,
    agentProviders: (builtin) => [
      ...builtin,
      scriptedProvider(envOut, sessions, config.attach ? { records: attached } : undefined),
    ],
    ...(config.resumeWhenIdle !== undefined ? { agentResumeWhenIdle: config.resumeWhenIdle } : {}),
    // no floor: a spawn must refuse quickly, not wait a cell's whole birth budget
    ...(config.floor === "mock" ? { terminalBirthWaitMs: 300 } : {}),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { root, dataDir, bin, envOut, daemon, sessions, attached, sessionsFile };
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

/** The fold's row for a run, once the inventory has joined it to its cell. */
async function joinedRow(
  win: WsRpc,
  runtimeRunId: string,
): Promise<AgentListResult["sessions"][number]> {
  return await poll(async () => {
    const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
    const row = sessions.find((r) => r.runtimeRunId === runtimeRunId);
    return row?.terminal?.cellBootId !== undefined ? row : undefined;
  }, 15_000);
}

const listed = async (win: WsRpc, sessionId: string): Promise<boolean> => {
  const { terminals } = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
  return terminals.some((t) => t.sessionId === sessionId);
};
/** the inventory trails a birth and an exit by a beat (TC): wait for the listing to say `expected` */
const untilListed = (win: WsRpc, sessionId: string, expected: boolean): Promise<true> =>
  poll(async () => ((await listed(win, sessionId)) === expected ? true : undefined), 10_000);

/** rosetta's row for a native session whose conversation last moved `stillForMs` ago. */
const rosettaRow = (nativeSessionId: string, stillForMs: number) => ({
  id: `rs-${nativeSessionId}`,
  native_session_id: nativeSessionId,
  runtime_id: "rt-scripted",
  project_id: null,
  cwd: null,
  parent_session_id: null,
  delegation: null,
  root_session_id: `rs-${nativeSessionId}`,
  role: "primary",
  title: null,
  summary: null,
  started_at: Date.now() - stillForMs - 60_000,
  updated_at: Date.now(),
  activity: { first_at: Date.now() - stillForMs - 60_000, last_at: Date.now() - stillForMs },
  stream_state: "indexed",
});

describe("stable ingress — a managed session outlives fieldd (AR-4)", () => {
  it("re-attach across a restart: a graceful stop RELEASES the run (no exit, the PTY alive); the next boot attaches it at the next epoch, the same PTY, automation working; the attached run still refuses a resume; its exit is the ordinary one", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "ra1");
    const spawned = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "survivor",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    // the durable identity the next boot restores against, and puppeteer's
    // claim registry under this user's agents/ tree
    const record = readRecord(first.dataDir, runId);
    expect(record.creationRequestId).toBeTruthy();
    expect(record.runtimeEpoch).toBe(1);
    expect(record.reattach).toBeUndefined();
    expect(mode(join(first.dataDir, ...LAYOUT.AGENT_RUNS_DIR))).toBe(0o700);
    expect(existsSync(join(first.dataDir, ...LAYOUT.AGENT_RUNS_DIR, "claims"))).toBe(true);
    await joinedRow(win1, runId);

    // ── the restart: the stop releases; nothing is stamped, the PTY lives ──
    await first.daemon.stop();
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "ra2");
    expect(await listed(win2, ptyId)).toBe(true);
    const row = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.reattached === true ? found : undefined;
    }, 20_000);
    expect(row.runtimeEpoch).toBe(2);
    expect(row.sessionId).toBe(nativeId);
    expect(row.title).toBe("survivor");
    expect(row.terminal).toMatchObject({ hosted: "local", runtimeSessionId: ptyId });
    expect(row.continuation).toEqual({ persisted: true, resumable: false, reattached: true });
    expect(row.status).not.toBe(undefined);
    // the adapter was handed exactly the terminal and the native session
    expect(first.attached).toHaveLength(1);
    expect(first.attached[0]).toMatchObject({ runtimeSessionId: ptyId, sessionId: nativeId });
    expect(first.attached[0]?.ingress).toBeUndefined();
    // the record: the new epoch, what the boot did
    const after = readRecord(first.dataDir, runId);
    expect(after.runtimeEpoch).toBe(2);
    expect(after.reattach).toMatchObject({ state: "attached" });
    expect(after.exited).toBeUndefined();
    // the daemon's own act, in the ledger as the system actor
    const audit = auditText(first.dataDir);
    expect(audit).toContain('"action":"agent.session.reattach"');
    expect(audit).toMatch(/"actor":\{"kind":"system"/);
    // automation through the re-attached run: the floor's epoch path, again
    const agent = second.daemon.agents.runtime.agent(ptyId);
    expect(agent).toBeDefined();
    expect((await agent!.submitPrompt({ text: "still-here" })).status).toBe("confirmed");
    // attached and alive: a resume is refused, as before
    const refused = await win2.callErr("agent.resume", { runtimeRunId: runId });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(refused)).toContain("terminal-alive");

    // ── the exit, on the second daemon: the ordinary path ──
    await win2.call("terminal.terminate", { sessionId: ptyId });
    await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    expect(readRecord(first.dataDir, runId).exited).toBeDefined();
  }, 150_000);

  it("a provider that cannot attach: the run is held PENDING across the restart (live, unobserved, resumable), and agent.resume replaces its PTY by hand — the new row names the PTY it replaced", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "pe1");
    const spawned = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "held",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();

    const second = await setup({ floor: "real", restartOf: first });
    const win2 = await window(second.daemon, DECK, "pe2");
    const pending = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(pending).toMatchObject({
      status: "unknown",
      observationLevel: "none",
      sessionIdBasis: "recorded",
      sessionId: nativeId,
      title: "held",
    });
    expect(pending.terminal).toMatchObject({ hosted: "local", runtimeSessionId: ptyId });
    expect(pending.continuation).toMatchObject({
      persisted: true,
      resumable: true,
      pending: "resume-when-idle",
    });
    expect(pending.continuation?.reason).toContain("cannot attach");
    expect(pending.monitor).toBeUndefined();
    expect(readRecord(first.dataDir, runId).reattach).toMatchObject({ state: "unsupported" });
    expect(auditText(first.dataDir)).toContain('"reasonCode":"ATTACH_UNSUPPORTED"');
    // the PTY is alive, listed by the floor, and nothing observes it
    expect(await listed(win2, ptyId)).toBe(true);
    expect(second.daemon.agents.runtime.agent(ptyId)).toBeUndefined();

    // ── the replacement by hand ──
    const resumed = (await win2.call("agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.runtimeRunId).not.toBe(runId);
    expect(resumed.session.sessionId).toBe(nativeId);
    expect(resumed.session.title).toBe("held");
    expect(resumed.terminal.sessionId).not.toBe(ptyId);
    expect(resumed.session.terminal).toMatchObject({
      hosted: "local",
      runtimeSessionId: resumed.terminal.sessionId,
      replaced: ptyId,
    });
    expect(resumed.session.continuation).toEqual({ persisted: true, resumable: false });
    expect(first.sessions).toHaveLength(2);
    expect(first.sessions[1]?.resume).toBe(nativeId);
    // the old PTY is gone before the new run was born; the records say what happened
    await untilListed(win2, ptyId, false);
    const old = readRecord(first.dataDir, runId);
    expect(old.exited?.reason).toBe("replaced");
    expect(old.reattach).toMatchObject({ state: "resumed", replaced: ptyId });
    const fresh = readRecord(first.dataDir, resumed.session.runtimeRunId);
    expect(fresh.replaced).toBe(ptyId);
    expect(fresh.exited).toBeUndefined();
    expect(fresh.creationRequestId).toBeTruthy();
    // the fold: one row, the new run
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([resumed.session.runtimeRunId]);
    const audit = auditText(first.dataDir);
    expect(audit).toContain('"action":"agent.session.resume"');
    expect(audit).toContain('"how":"manual"');
    await win2.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 150_000);

  it("resume-when-idle: a pending run stays pending while the index knows nothing of it, and is resumed by the daemon itself once the index says its conversation has been still", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "ri1");
    const spawned = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();

    // the fake index serves NO rows yet: no evidence, no resume
    const second = await setup({
      floor: "real",
      restartOf: first,
      resumeWhenIdle: { afterMs: 30_000, pollMs: 200 },
    });
    const win2 = await window(second.daemon, DECK, "ri2");
    await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.runtimeRunId === runId)?.continuation?.pending !== undefined
        ? true
        : undefined;
    }, 20_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const still = ((await win2.call("agent.list", {})) as AgentListResult).sessions;
    expect(still.map((r) => r.runtimeRunId)).toEqual([runId]);
    expect(still[0]?.continuation?.pending).toBe("resume-when-idle");
    expect(await listed(win2, ptyId)).toBe(true);

    // a row moved a second ago is NOT idle; one still for a minute is
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, 1_000)]));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(
      ((await win2.call("agent.list", {})) as AgentListResult).sessions[0]?.continuation?.pending,
    ).toBe("resume-when-idle");
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, 60_000)]));
    const replaced = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.terminal?.replaced === ptyId);
    }, 30_000);
    expect(replaced.runtimeRunId).not.toBe(runId);
    expect(replaced.sessionId).toBe(nativeId);
    expect(replaced.continuation?.pending).toBeUndefined();
    expect(first.sessions.at(-1)?.resume).toBe(nativeId);
    await untilListed(win2, ptyId, false);
    await untilListed(win2, replaced.terminal?.runtimeSessionId ?? "", true);
    const old = readRecord(first.dataDir, runId);
    expect(old.exited?.reason).toBe("replaced");
    expect(old.reattach).toMatchObject({ state: "resumed", replaced: ptyId });
    const audit = auditText(first.dataDir);
    expect(audit).toContain('"how":"idle"');
    expect(audit).toMatch(/"actor":\{"kind":"system"/);
    // the fold holds the new run only
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([replaced.runtimeRunId]);
    await win2.call("terminal.terminate", { sessionId: replaced.terminal?.runtimeSessionId ?? "" });
  }, 150_000);

  it("a record whose PTY did NOT survive is stamped at the next boot as an unknown exit, and resumes from the door like any other", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "go1");
    const spawned = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();
    // the process ended while no fieldd was there to see it: the record is
    // un-stamped and names a PTY the floor no longer lists (staged by pointing
    // the record at a session the floor never had — the same fact)
    const path = join(first.dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${runId}.json`);
    const record = readRecord(first.dataDir, runId);
    writeFileSync(
      path,
      JSON.stringify({ ...record, terminalSessionId: "sess-that-never-was" }, null, 2),
    );
    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "go2");
    const stamped = await poll(async () => {
      const r = readRecord(first.dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 20_000);
    expect(stamped.exited?.reason).toBe("unknown");
    expect(stamped.reattach).toBeUndefined();
    expect(first.attached).toHaveLength(0);
    expect(((await win2.call("agent.list", {})) as AgentListResult).sessions).toEqual([]);
    // …and it resumes from the door
    const resumed = (await win2.call("agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.sessionId).toBe(spawned.session.sessionId);
    expect(resumed.session.terminal?.replaced).toBeUndefined();
    await win2.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
    // the orphaned PTY of the first run is still the floor's; end it too
    await win2.call("terminal.terminate", { sessionId: ptyId }).catch(() => undefined);
  }, 150_000);
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

    it("AR-4 — the REAL claude re-attached across a fieldd restart: the bridge re-bound to the pinned ingress, the run at its next epoch, the hooks flowing again after a prompt", async () => {
      const first = await setup({ floor: "real", realAgent: true });
      const win1 = await window(first.daemon, DECK, "real2");
      const cwd = join(first.root, "work");
      mkdirSync(cwd);
      const spawned = (await win1.call("agent.spawn", {
        provider: "claude",
        cwd,
      })) as AgentSpawnResult;
      const runId = spawned.session.runtimeRunId;
      const ptyId = spawned.terminal.sessionId;
      const live = await poll(async () => {
        const { sessions } = (await win1.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.monitor?.alive === true && row.sessionIdBasis === "observed" ? row : undefined;
      }, 60_000);
      const before = readRecord(first.dataDir, runId);
      console.log(
        `REAL_AGENT_INGRESS ${JSON.stringify({ port: before.ingress?.port, hasToken: before.ingress?.token !== undefined, creationRequestId: before.creationRequestId !== undefined })}`,
      );
      expect(before.ingress?.port).toBeGreaterThan(0);
      expect(before.creationRequestId).toBeTruthy();
      // let the vendor TUI finish starting (the AR-3 row's hold): the hooks
      // reached us, the process is settling
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      console.log(
        `REAL_AGENT_BEFORE_STOP ${JSON.stringify({ listed: await listed(win1, ptyId) })}`,
      );

      await first.daemon.stop();
      expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
      const second = await setup({ floor: "real", realAgent: true, restartOf: first });
      const win2 = await window(second.daemon, DECK, "real3");
      const ptyAlive = await listed(win2, ptyId);
      const fate = await poll(async () => {
        const r = readRecord(first.dataDir, runId);
        return r.reattach !== undefined || r.exited !== undefined ? r : undefined;
      }, 30_000).catch(() => readRecord(first.dataDir, runId));
      console.log(
        `REAL_AGENT_SECOND_BOOT ${JSON.stringify({
          ptyAlive,
          reattach: fate.reattach,
          exited: fate.exited,
          rows: ((await win2.call("agent.list", {})) as AgentListResult).sessions.map((r) => ({
            runtimeRunId: r.runtimeRunId,
            continuation: r.continuation,
          })),
        })}`,
      );
      const row = await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.continuation?.reattached === true ? found : undefined;
      }, 30_000);
      console.log(
        `REAL_AGENT_REATTACHED ${JSON.stringify({
          runtimeEpoch: row.runtimeEpoch,
          status: row.status,
          observationLevel: row.observationLevel,
          level: row.monitor?.freshness?.level,
          alive: row.monitor?.alive,
          sessionId: row.sessionId,
        })}`,
      );
      expect(row.runtimeEpoch).toBe(2);
      expect(row.sessionId).toBe(live.sessionId);
      expect(row.terminal?.runtimeSessionId).toBe(ptyId);
      // a prompt through the re-attached run: the vendor's hooks reach the
      // re-bound bridge, and the monitor moves on native evidence again
      const agent = second.daemon.agents.runtime.agent(ptyId);
      expect(agent).toBeDefined();
      const receipt = await agent!.submitPrompt({ text: "/clear" });
      console.log(`REAL_AGENT_PROMPT ${JSON.stringify(receipt)}`);
      const hooked = await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.monitor?.alive === true && found.monitor.freshness?.level === "native-hooks"
          ? found
          : undefined;
      }, 60_000);
      console.log(
        `REAL_AGENT_HOOKED ${JSON.stringify({
          status: hooked.status,
          observationLevel: hooked.observationLevel,
          level: hooked.monitor?.freshness?.level,
          sessionId: hooked.sessionId,
          basis: hooked.sessionIdBasis,
        })}`,
      );
      const after = readRecord(first.dataDir, runId);
      expect(after.reattach).toMatchObject({ state: "attached" });
      expect(after.runtimeEpoch).toBe(2);
      const term = (await win2.call("terminal.terminate", { sessionId: ptyId })) as {
        terminated: boolean;
      };
      console.log(`REAL_AGENT_TERMINATE ${JSON.stringify(term)}`);
      await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
      }, 30_000);
      console.log(`REAL_AGENT_EXIT ${JSON.stringify(readRecord(first.dataDir, runId).exited)}`);
    }, 300_000);
  },
);
