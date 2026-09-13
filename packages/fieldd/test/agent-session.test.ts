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
//
// The witnesses answer to a review (2026-09-12), and what it asked for is the
// difference between a claim and evidence: the clean environment is read as a
// SET (an allow-list, which a deny-list would fail), the bound ingress is
// asserted at every place it travels, "the old PTY is gone before the new run
// is born" is measured as two TIMES rather than an end state, the ledger is
// parsed rather than grepped, a window in which nothing changed also carries
// the poller's own request count, and the index is asked with a canonical row
// and a decoy beside it.
import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentAdapterBinding,
  AgentHost,
  BoundIngress,
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
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  killDaemonTree,
  nativeBinPath,
  nativeEndpoint,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";
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
let roots: string[] = [];
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
  // Kill each floor's whole TREE and await the real exits BEFORE removing the
  // root (cross-daemon.test.ts / mesh-lane.test.ts do the same): field-native
  // spawns children of its own, a dying daemon can still be writing inside the
  // temp root while rmSync walks it (ENOTEMPTY), and on win32 a surviving
  // grandchild's handle makes the removal EPERM outright. The old teardown
  // removed the root first, with a bare SIGKILL to the parent only.
  await Promise.all(children.map((child) => killDaemonTree(child)));
  children = [];
  for (const root of roots) removeTempRoot(root);
  roots = [];
});

/** The scripted provider: an adapter that owns nothing but a recipe. Its
 * `createSession` asks the HOST for a PTY running a shell that writes its
 * environment to a file the test reads (the EL7 witness) and then holds the
 * PTY open with a `cat` whose OWN stdout is a second file — so what the
 * automation seam types reaches a real process and can be read back without a
 * data leg; its prompt service is `automateTerminal`; a resume arrives as
 * `options.resume`, which it records and continues as the native id. It also
 * binds an ingress the way an adapter with a loopback listener does: the pair
 * is reported through `options.ingress.onBound` BEFORE the process launches,
 * which is the contract a host that outlives its agent depends on. */
interface ScriptedSession {
  runtimeSessionId: string;
  sessionId: string;
  resume: string | undefined;
  host: AgentHost;
  /** the loopback pair this run reported before its process launched */
  ingress: BoundIngress;
  /** the instant `createSession` was ENTERED — the earliest moment this run
   * can be said to exist. A replacement's claim ("the old PTY is gone before
   * the new run is born") is measured against this. */
  bornAt: number;
  /** where this run's `cat` writes whatever is typed into its PTY */
  typedOut: string;
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
      const bornAt = Date.now();
      const n = ++counter;
      const out = join(envOut, `session-${n}.env`);
      const typedOut = join(envOut, `session-${n}.typed`);
      // the stable-ingress contract, from the adapter's side: bound, then
      // REPORTED, and only then does anything launch. (The counter is this
      // provider instance's, so a restart's first run repeats the pair — no
      // listener is ever really bound, and nothing here assumes uniqueness.)
      const ingress: BoundIngress = { port: 40_000 + n, token: `bearer-${n}` };
      options.ingress?.onBound?.(ingress);
      const { runtimeSessionId } = await options.host.spawnTerminal({
        command: "/bin/sh",
        // the environment lands ATOMICALLY (written beside, then renamed): the
        // witness polls for the file, and a reader that met it half-written
        // once read the adapter's token as absent under a loaded host
        args: [
          "-c",
          `env > "$SCRIPTED_ENV_OUT.part" && mv "$SCRIPTED_ENV_OUT.part" "$SCRIPTED_ENV_OUT"; exec /bin/cat >> "$SCRIPTED_TYPED_OUT"`,
        ],
        cwd: options.cwd,
        env: {
          SCRIPTED_ENV_OUT: out,
          SCRIPTED_TYPED_OUT: typedOut,
          SCRIPTED_TOKEN: `token-${n}`,
          // an adapter asking for a daemon-secret class: the host must refuse it
          FIELDD_SMUGGLED: "never",
        },
      });
      const sessionId = options.resume ?? `scripted-native-${n}`;
      sessions.push({
        runtimeSessionId,
        sessionId,
        resume: options.resume,
        host: options.host,
        ingress,
        bornAt,
        typedOut,
      });
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
  /** AR-4 — one line per `/api/sessions` the fake rosettad answered: the
   * poller's own footprint, so a window in which nothing changed can say
   * whether anything was ASKED in it */
  requestLog: string;
  /** the product's own record store over this root — the only way a test can
   * stage a record the daemon will still act on (AR-4b: an unsigned or
   * re-written record is set aside, which is a different witness) */
  records: SessionRecordStore;
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
  /** the fake rosettad's scripted misbehaviour for THIS boot (default `ok`) */
  rosettadMode?: string;
}

/** Boot fieldd: over the mock mgmt server (no floor) or the REAL field-native. */
async function setup(config: SetupConfig): Promise<Box> {
  const restart = config.restartOf;
  const root = restart?.root ?? shortTmpRoot("vf-ar3-");
  // the root is removed in afterEach AFTER every floor's tree is reaped
  if (restart === undefined) roots.push(root);
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  const bin = join(root, "bin");
  const envOut = join(root, "env-out");
  const home = join(dataDir, "home");
  const sessionsFile = join(root, "rosetta-sessions.json");
  const requestLog = join(root, "rosetta-requests.log");
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
    rosettadSpawn: fakeSpawner(config.rosettadMode ?? "ok", {
      FAKE_ROSETTAD_SESSIONS: sessionsFile,
      FAKE_ROSETTAD_REQUEST_LOG: requestLog,
    }),
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
  const records =
    restart?.records ??
    new SessionRecordStore({
      dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
      keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
      now: () => new Date(),
    });
  return {
    root,
    dataDir,
    bin,
    envOut,
    daemon,
    sessions,
    attached,
    sessionsFile,
    requestLog,
    records,
  };
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

/** every JSONL ledger under the user root (the `.integrity.json` checkpoints
 * beside them are not records) */
function auditLedgers(dataDir: string): string[] {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        )
      : [];
  return walk(dir).filter((f) => f.endsWith(".jsonl"));
}

/** every audit line under the user root, concatenated (the ledgers are JSONL) */
const auditText = (dataDir: string): string =>
  auditLedgers(dataDir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

/** One appended record: `AuditRecordBase` (packages/audit/src/model.ts) as it
 * lands on the line. */
interface AuditEntry {
  action: string;
  phase: "attempt" | "outcome";
  outcome?: string;
  reasonCode?: string;
  operationId?: string;
  actor: { kind: string; id?: string };
  target: { kind: string; id: string };
  attrs?: Record<string, unknown>;
}

const auditEntries = (dataDir: string): AuditEntry[] =>
  auditLedgers(dataDir).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as AuditEntry),
  );

/** ONE act, read as the pair it is written as: the `attempt` that matches
 * (carrying the mutation's own attrs — `how`, the provider, the PTY) and the
 * `outcome` sharing its operationId (carrying the result's). Disjoint greps
 * over the concatenated ledger cannot say that the words came from the same
 * act, or the same ACTOR; this can, and it says what it saw when it cannot. */
function auditAct(
  dataDir: string,
  where: (entry: AuditEntry) => boolean,
): { attempt: AuditEntry; outcome: AuditEntry } {
  const entries = auditEntries(dataDir);
  const attempt = entries.find((entry) => entry.phase === "attempt" && where(entry));
  if (attempt === undefined) {
    const seen = entries.map((entry) => ({
      action: entry.action,
      phase: entry.phase,
      outcome: entry.outcome,
      actor: entry.actor.kind,
      target: entry.target.id,
      attrs: entry.attrs,
    }));
    throw new Error(`no audit attempt matched; the ledger holds ${JSON.stringify(seen)}`);
  }
  const outcome = entries.find(
    (entry) => entry.phase === "outcome" && entry.operationId === attempt.operationId,
  );
  if (outcome === undefined) {
    throw new Error(`the audit attempt ${attempt.operationId} never got an outcome record`);
  }
  return { attempt, outcome };
}

/** EL7 as a SET, not as a list of suspicions.
 *
 * A row that only names forbidden keys cannot tell an allow-list from a
 * deny-list: it passes equally against a host that leaks the daemon's whole
 * environment except the four names the test thought to check. The witness is
 * the DIFFERENCE — every key the PTY was born with, minus the ones some
 * policy actually grants, must be empty.
 *
 * Three sources, each read from the code that owns it, and copied here on
 * purpose: importing the constant would only assert that the policy equals
 * itself, while a copy makes a widened allow-list a diff someone reviews.
 *   · `AGENT_ENV_PASSTHROUGH` — packages/fieldd/src/agent-host.ts
 *   · `buildAgentEnvironment` — puppeteer packages/runtime/src/host/environment.ts
 *   · the scripted adapter's own `spec.env`, and what /bin/sh adds for the
 *     `env` it runs (PWD, SHLVL, _ — and OLDPWD if anything ever cd's)
 * The win32 halves of the first two are left out: this suite spawns /bin/sh. */
const AGENT_ENV_ALLOWED = new Set([
  // fieldd's passthrough (agent-host.ts AGENT_ENV_PASSTHROUGH)
  "PATH",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TERMINFO",
  "TERMINFO_DIRS",
  "SSH_AUTH_SOCK",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  // puppeteer's own policy (buildAgentEnvironment, POSIX branch)
  "TERM",
  "COLORTERM",
  "FORCE_COLOR",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "CLAUDE_CODE_NO_FLICKER",
  "USER",
  "LOGNAME",
  "HOME",
  // the scripted adapter's own variables
  "SCRIPTED_ENV_OUT",
  "SCRIPTED_TYPED_OUT",
  "SCRIPTED_TOKEN",
  // /bin/sh's, for the child it runs
  "PWD",
  "SHLVL",
  "_",
  "OLDPWD",
]);

/** how many `/api/sessions` requests the fake rosettad has answered so far */
const sessionRequests = (box: Box): number =>
  existsSync(box.requestLog)
    ? readFileSync(box.requestLog, "utf8")
        .split("\n")
        .filter((line) => line !== "").length
    : 0;

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

  it("MF-1 — one door, two projections: `full` is unchanged, `field` is the phone's board, a bad option is refused", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "mf1");

    // absent params: byte for byte what the desktop has always received
    const full = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(full.snapshot).toEqual({ sessions: [] });
    // and asking for it by name is the same answer
    const named = (await win.call("agent.subscribe", { projection: "full" })) as {
      snapshot: AgentListResult;
    };
    expect(named.snapshot).toEqual({ sessions: [] });

    // the field projection answers a REVISIONED board, never a sessions array
    const field = (await win.call("agent.subscribe", {
      projection: "field",
      minIntervalMs: 250,
    })) as { subId: string; snapshot: { revision: number; rows: unknown[] } };
    expect(field.snapshot).toEqual({ revision: 0, rows: [] });
    expect(field.subId).not.toBe(full.subId);

    // a tolerant reader still refuses an option it cannot honour, rather than
    // silently serving a cadence nobody asked for
    expect((await win.callErr("agent.subscribe", { projection: "mirror" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect((await win.callErr("agent.subscribe", { minIntervalMs: 5 })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    // an unknown OPTION is not an error — it is the next version's field
    expect(
      (
        (await win.call("agent.subscribe", { projection: "field", futureOption: 1 })) as {
          snapshot: { revision: number };
        }
      ).snapshot.revision,
    ).toBe(0);
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
    // the ledger, as records: the door's own act, the provider it was for,
    // and the floor's refusal kind as the outcome's reason
    const refusal = auditAct(dataDir, (entry) => entry.action === "agent.session.spawn");
    expect(refusal.attempt.attrs?.["provider"]).toBe("scripted");
    expect(refusal.attempt.actor.kind).toBe("local-token");
    expect(refusal.outcome.outcome).toBe("failed");
    expect(refusal.outcome.reasonCode).toBe("UNAVAILABLE");
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
    // a variable of the TEST RUNNER's, carrying no prefix anyone strips: it is
    // in this process's environment and it is not in the agent's
    expect(env).not.toHaveProperty("VITEST");
    expect(process.env).toHaveProperty("VITEST");
    expect(
      Object.keys(env).filter((k) => k.startsWith("FIELD_") || k.startsWith("FIELDD_")),
    ).toEqual([]);
    // …and the whole SET, which is the claim the named absences only gesture
    // at: nothing is here that no policy granted (see AGENT_ENV_ALLOWED)
    const ungranted = Object.keys(env).filter((key) => !AGENT_ENV_ALLOWED.has(key));
    expect(
      ungranted,
      `the agent's PTY was born holding keys no policy grants: ${ungranted.join(", ")}`,
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
    // AR-4 — the ingress the adapter reported BEFORE its process launched is
    // the one the record keeps, pair for pair: the host's half of the stable
    // ingress contract (a re-attach hands exactly this back)
    expect(sessions[0]?.ingress).toEqual({ port: 40_001, token: "bearer-1" });
    expect(record.ingress).toEqual(sessions[0]?.ingress);
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
    // accepted is the floor's answer, not the agent's: the bytes reach the
    // PROCESS, which is the claim. The scripted PTY's `cat` writes its own
    // stdout to a file, so the typed line can be read back without a data leg
    // (EL2 — bytes never ride this control path).
    const typed = await poll(async () => {
      const path = sessions[0]?.typedOut;
      if (path === undefined || !existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      return text.includes("hello-floor") ? text : undefined;
    }, 10_000);
    expect(typed).toContain("hello-floor");

    // ── the audit ──
    const spawnAct = auditAct(dataDir, (entry) => entry.action === "agent.session.spawn");
    expect(spawnAct.attempt.target.kind).toBe("agent-session");
    expect(spawnAct.attempt.attrs?.["provider"]).toBe("scripted");
    expect(spawnAct.outcome.outcome).toBe("succeeded");
    expect(spawnAct.outcome.attrs?.["runtimeRunId"]).toBe(runId);
    expect(spawnAct.outcome.attrs?.["sessionId"]).toBe(spawned.terminal.sessionId);

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
    // a new run is a new identity: its own claim, its own ingress pair
    expect(second.creationRequestId).not.toBe(record.creationRequestId);
    expect(sessions[1]?.ingress).toEqual({ port: 40_002, token: "bearer-2" });
    expect(second.ingress).toEqual(sessions[1]?.ingress);
    const resumeAct = auditAct(dataDir, (entry) => entry.action === "agent.session.resume");
    expect(resumeAct.attempt.target.id).toBe(runId);
    expect(resumeAct.attempt.actor.kind).toBe("local-token");
    expect(resumeAct.outcome.outcome).toBe("succeeded");
    expect(resumeAct.outcome.attrs?.["runtimeRunId"]).toBe(resumed.session.runtimeRunId);
    // this resume ended nothing — the record's PTY was already gone — and the
    // entry says so by omission: `how`/`replaced` ride only a REPLACEMENT
    expect(resumeAct.outcome.attrs).not.toHaveProperty("how");
    expect(resumeAct.outcome.attrs).not.toHaveProperty("replaced");
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

/** Watch the floor's listing for one session's DISAPPEARANCE, from the call
 * until `stop()`, and answer the instant it was first missing (undefined if it
 * never was). The reading is the product door, so the time is never earlier
 * than the truth — which is the direction that keeps "gone BEFORE the new run
 * was born" an honest claim rather than a generous one. Give it its own
 * window: it runs concurrently with the call it is watching. */
function watchForGone(win: WsRpc, sessionId: string): { stop: () => Promise<number | undefined> } {
  let goneAt: number | undefined;
  let watching = true;
  const loop = (async () => {
    while (watching && goneAt === undefined) {
      try {
        if (!(await listed(win, sessionId))) {
          goneAt = Date.now();
          return;
        }
      } catch {
        /* the floor can refuse mid-replacement; the next reading answers */
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  return {
    stop: async () => {
      watching = false;
      await loop;
      return goneAt;
    },
  };
}

/** rosetta's row for a native session whose conversation last moved
 * `stillForMs` ago — or, with `null`, one rosetta knows and has no timestamped
 * evidence for (`activity: null`: no evidence is NOT idle).
 *
 * `role` is rosetta's own vocabulary — `SessionRole` = main | subagent | team
 * (crates/core/src/rows.rs, clients/ts/generated/SessionRole.ts). An earlier
 * draft emitted "primary", which rosetta cannot produce; a fixture that speaks
 * words upstream does not have is not a witness of anything.
 *
 * `child` is what a delegated thread looks like BESIDE its root: its own id,
 * the root named as parent and as `root_session_id`, the "subagent" role — the
 * row whose clock fieldd must not read. The canonical row is the one whose
 * `root_session_id` is its own id (agent-index.ts `sessionByNativeId`). */
const rosettaRow = (nativeSessionId: string, stillForMs: number | null, child = false) => ({
  id: child ? `rs-${nativeSessionId}-child` : `rs-${nativeSessionId}`,
  native_session_id: nativeSessionId,
  runtime_id: "rt-scripted",
  project_id: null,
  cwd: null,
  parent_session_id: child ? `rs-${nativeSessionId}` : null,
  delegation: null,
  root_session_id: `rs-${nativeSessionId}`,
  role: child ? "subagent" : "main",
  title: null,
  summary: null,
  started_at: Date.now() - (stillForMs ?? 0) - 60_000,
  updated_at: Date.now(),
  activity:
    stillForMs === null
      ? null
      : { first_at: Date.now() - stillForMs - 60_000, last_at: Date.now() - stillForMs },
  stream_state: "indexed",
});

describe("AR-6-0 — the stop verb (agent.interrupt)", () => {
  it("interrupts a live run through the floor, is refused for an exited or unknown one, needs agent.control, and lands in the ledger", async () => {
    const { daemon, dataDir, envOut } = await setup({ floor: "real" });
    // the deck's own scopes do NOT include agent.control — the fold's reader
    // is not, by that fact, allowed to steer what it is watching
    const watcher = await window(daemon, DECK, "i0");
    const win = await window(daemon, [...DECK, "agent.control"], "i1");

    const spawned = (await win.call("agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;

    expect((await watcher.callErr("agent.interrupt", { runtimeRunId: runId })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    // a run nobody ever minted is NOT_FOUND, never a silent no-op
    expect((await win.callErr("agent.interrupt", { runtimeRunId: "run-none" })).data?.kind).toBe(
      "NOT_FOUND",
    );
    expect((await win.callErr("agent.interrupt", {})).data?.kind).toBe("PRECONDITION_FAILED");

    // Wait for the floor's inventory to TAG the session with its cell before
    // steering it. This is not politeness: every automate resolves the session's
    // cell first, and an untagged session sends the operation to the wrong one,
    // where the floor answers "unknown or remote session" and TerminalService
    // raises INTERNAL (terminal-service.ts:645-660 — the pre-existing shape for
    // paste and text too, not something this door introduced).
    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      const row = rows.find((r) => r.runtimeRunId === runId);
      return row?.terminal?.cellBootId !== undefined ? row : undefined;
    }, 10_000);

    // ── the act: the floor takes it, and the scripted PTY's `cat` dies of it ──
    // `accepted` is the FLOOR's word — that the interrupt reached the PTY's
    // process group, not that any agent obeyed it. The witness that it really
    // reached a process is the exit below.
    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });

    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      return rows.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    const exited = await poll(async () => {
      const record = readRecord(dataDir, runId);
      return record.exited !== undefined ? record : undefined;
    }, 10_000);
    expect(exited.exited?.reason).toBeTruthy();

    // ── the same run, now gone: not-alive, with the state a caller can read ──
    const refused = (await win.callErr("agent.interrupt", {
      runtimeRunId: runId,
    })) as RpcErrorShape;
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe("not-alive");

    // ── the ledger: this device's own act, on the run, with its outcome ──
    // (the attempt is written BEFORE the effect, so the refusals above are in
    // the ledger too — the act is matched by its target, not by being first)
    const act = auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.interrupt" && entry.target.id === runId,
    );
    expect(act.attempt.target).toMatchObject({ kind: "agent-session", id: runId });
    expect(act.attempt.actor.kind).toBe("local-token");
    expect(act.outcome.outcome).toBe("succeeded");
    expect(act.outcome.attrs?.["accepted"]).toBe(true);
    // an interrupt aimed at a run that does not exist is ledgered as an
    // ATTEMPT that failed — a reach for someone else's session leaves a trace
    const missed = auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.interrupt" && entry.target.id === "run-none",
    );
    expect(missed.outcome.outcome).toBe("failed");
    expect(missed.outcome.reasonCode).toBe("NOT_FOUND");
  });
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
    // the pair the adapter bound before its process launched, persisted
    expect(record.ingress).toEqual(first.sessions[0]?.ingress);
    expect(record.ingress?.port).toBe(40_001);
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
    // the adapter was handed exactly the terminal, the native session — and
    // the ingress its process is still posting to, which is the whole point of
    // pinning one: a re-bound listener picks the stream up where it left off
    expect(first.attached).toHaveLength(1);
    expect(first.attached[0]).toMatchObject({ runtimeSessionId: ptyId, sessionId: nativeId });
    expect(first.attached[0]?.ingress).toEqual(record.ingress);
    expect(first.attached[0]?.ingress).toEqual({ port: 40_001, token: "bearer-1" });
    // the record: the new epoch, what the boot did, the ingress unchanged
    const after = readRecord(first.dataDir, runId);
    expect(after.runtimeEpoch).toBe(2);
    expect(after.reattach).toMatchObject({ state: "attached" });
    expect(after.exited).toBeUndefined();
    expect(after.ingress).toEqual(record.ingress);
    // the daemon's own act, read as records: the system actor, the epoch it
    // found on the attempt and the epoch it reached on the outcome
    const reattachAct = auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.reattach" && entry.target.id === runId,
    );
    expect(reattachAct.attempt.actor.kind).toBe("system");
    expect(reattachAct.attempt.target.kind).toBe("agent-session");
    expect(reattachAct.attempt.attrs).toMatchObject({
      provider: "scripted",
      sessionId: ptyId,
      runtimeEpoch: 1,
    });
    expect(reattachAct.outcome.actor.kind).toBe("system");
    expect(reattachAct.outcome.outcome).toBe("succeeded");
    expect(reattachAct.outcome.attrs?.["runtimeEpoch"]).toBe(2);
    // automation through the re-attached run: the floor's epoch path, again
    const agent = second.daemon.agents.runtime.agent(ptyId);
    expect(agent).toBeDefined();
    expect((await agent!.submitPrompt({ text: "still-here" })).status).toBe("confirmed");
    // …and the bytes reach the process the FIRST fieldd started: the surviving
    // `cat` appends them to the file it opened at its own birth, which nothing
    // since has re-created. Accepted-by-the-floor would be true of a PTY that
    // had been replaced underneath us; this is not.
    const typed = await poll(async () => {
      const path = first.sessions[0]?.typedOut;
      if (path === undefined || !existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      return text.includes("still-here") ? text : undefined;
    }, 10_000);
    expect(typed).toContain("still-here");
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
    // the boot's own act, as records: it tried, and the adapter's "I cannot"
    // is the outcome's CODE (a daemon act's reasonCode is a code, not prose)
    const held = auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.reattach" && entry.target.id === runId,
    );
    expect(held.attempt.actor.kind).toBe("system");
    expect(held.attempt.attrs).toMatchObject({ provider: "scripted", sessionId: ptyId });
    expect(held.outcome.outcome).toBe("failed");
    expect(held.outcome.reasonCode).toBe("ATTACH_UNSUPPORTED");
    expect(held.outcome.attrs).toMatchObject({ state: "unsupported" });
    // the PTY is alive, listed by the floor, and nothing observes it
    expect(await listed(win2, ptyId)).toBe(true);
    expect(second.daemon.agents.runtime.agent(ptyId)).toBeUndefined();

    // AR-6-0 — and it CANNOT be interrupted. The PTY is alive and fieldd even
    // knows its id from the record, which is exactly why the refusal matters:
    // nothing observes this run, so typing into its terminal would be steering
    // blind. `not-alive` is the honest state for a row nothing is driving.
    const stopper = await window(second.daemon, [...DECK, "agent.control"], "pe-stop");
    const blind = (await stopper.callErr("agent.interrupt", {
      runtimeRunId: runId,
    })) as RpcErrorShape;
    expect(blind.data?.kind).toBe("PRECONDITION_FAILED");
    expect((blind.data?.details as { state?: string } | undefined)?.state).toBe("not-alive");
    expect(await listed(win2, ptyId)).toBe(true); // and the PTY is untouched

    // ── the replacement by hand ──
    // A second window watches the floor's listing for the whole of the resume:
    // the claim ("the old PTY leaves FIRST, and is gone before the new run is
    // born") is an ORDER, and an end state cannot tell it from the reverse.
    const watcher = await window(second.daemon, DECK, "pe3");
    const gone = watchForGone(watcher, ptyId);
    const resumed = (await win2.call("agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    const goneAt = await gone.stop();
    const bornAt = first.sessions[1]?.bornAt ?? Number.NEGATIVE_INFINITY;
    expect(goneAt, "the watcher never saw the old PTY leave the listing").toBeDefined();
    expect(
      (goneAt ?? Number.POSITIVE_INFINITY) < bornAt,
      `the old PTY was still listed when the new run was born (gone at ${goneAt}, born at ${bornAt})`,
    ).toBe(true);
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
    // the two records name each other: the old one the PTY it gave up and the
    // run that took its place, the new one the PTY it replaced
    expect(old.reattach).toMatchObject({
      state: "resumed",
      replaced: ptyId,
      replacedBy: resumed.session.runtimeRunId,
    });
    const fresh = readRecord(first.dataDir, resumed.session.runtimeRunId);
    expect(fresh.replaced).toBe(ptyId);
    expect(fresh.exited).toBeUndefined();
    expect(fresh.creationRequestId).toBeTruthy();
    // the fold: one row, the new run
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([resumed.session.runtimeRunId]);
    // The ledger holds ONE act for a resume a person asked for: the door's,
    // under the window's own token — and it is the entry that says a live PTY
    // was ENDED for it (`how: manual`, the PTY it replaced). The daemon writes
    // no second, system-actor copy: that one is reserved for the resume it
    // decides on by itself, and two entries for one act is a double ledger,
    // not corroboration.
    const byDoor = auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.resume" && entry.target.id === runId,
    );
    expect(byDoor.attempt.actor.kind).toBe("local-token");
    expect(byDoor.outcome.outcome).toBe("succeeded");
    expect(byDoor.outcome.attrs).toMatchObject({
      runtimeRunId: resumed.session.runtimeRunId,
      sessionId: resumed.terminal.sessionId,
      how: "manual",
      replaced: ptyId,
    });
    expect(
      auditEntries(first.dataDir).filter(
        (entry) => entry.action === "agent.session.resume" && entry.actor.kind === "system",
      ),
      "a resume asked for at the door was ledgered twice, once as the daemon itself",
    ).toEqual([]);
    await win2.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 150_000);

  it("resume-when-idle: a pending run stays pending while the index knows nothing of it, while its row carries no activity, while its conversation has just moved, and while a still SUBAGENT row sits beside an active canonical one — and is resumed by the daemon itself once the canonical row says the conversation has been still", async () => {
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

    /** A window the fold must come through unchanged — WITH the evidence that
     * the poller was awake for it. A sleep alone witnesses nothing: a poll
     * that never fired, a rosettad that never started, and a correct refusal
     * to resume are the same picture. The fake index counts every
     * `/api/sessions` it answers, and that count has to have moved. */
    const heldPending = async (what: string, ms: number): Promise<void> => {
      const asked = sessionRequests(second);
      await new Promise((resolve) => setTimeout(resolve, ms));
      const rows = ((await win2.call("agent.list", {})) as AgentListResult).sessions;
      expect(
        rows.map((r) => r.runtimeRunId),
        `${what}: the fold changed`,
      ).toEqual([runId]);
      expect(rows[0]?.continuation?.pending, `${what}: the run stopped being pending`).toBe(
        "resume-when-idle",
      );
      expect(await listed(win2, ptyId), `${what}: the PTY left the floor`).toBe(true);
      expect(
        sessionRequests(second) - asked,
        `${what}: the index was never ASKED during the window, so the window proves nothing`,
      ).toBeGreaterThan(0);
    };

    // ① the index has never read this session — and no evidence is not idle
    await heldPending("the index knows nothing of it", 1_500);
    // ② rosetta knows the session and has no timestamped evidence for it yet
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, null)]));
    await heldPending("the row carries no activity", 1_500);
    // ③ the conversation moved a second ago
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, 1_000)]));
    await heldPending("the conversation moved a second ago", 1_500);
    // ④ two rows for the one native id, the DECOY first: a subagent thread
    //    still for a minute beside a canonical row that just moved. A reader
    //    that took the first row would resume here; the canonical row is the
    //    one whose root_session_id is its own id, and its clock is the one
    //    that counts.
    writeFileSync(
      first.sessionsFile,
      JSON.stringify([rosettaRow(nativeId, 60_000, true), rosettaRow(nativeId, 1_000)]),
    );
    await heldPending("a still subagent row beside an active canonical one", 1_500);

    // ⑤ the same pair the other way about: the canonical row has been still
    //    for a minute, and an ACTIVE subagent row ahead of it changes nothing
    const watcher = await window(second.daemon, DECK, "ri3");
    const gone = watchForGone(watcher, ptyId);
    writeFileSync(
      first.sessionsFile,
      JSON.stringify([rosettaRow(nativeId, 1_000, true), rosettaRow(nativeId, 60_000)]),
    );
    const replaced = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.terminal?.replaced === ptyId);
    }, 30_000);
    const goneAt = await gone.stop();
    const bornAt = first.sessions.at(-1)?.bornAt ?? Number.NEGATIVE_INFINITY;
    expect(goneAt, "the watcher never saw the old PTY leave the listing").toBeDefined();
    expect(
      (goneAt ?? Number.POSITIVE_INFINITY) < bornAt,
      `the old PTY was still listed when the new run was born (gone at ${goneAt}, born at ${bornAt})`,
    ).toBe(true);
    expect(replaced.runtimeRunId).not.toBe(runId);
    expect(replaced.sessionId).toBe(nativeId);
    expect(replaced.continuation?.pending).toBeUndefined();
    expect(first.sessions.at(-1)?.resume).toBe(nativeId);
    await untilListed(win2, ptyId, false);
    await untilListed(win2, replaced.terminal?.runtimeSessionId ?? "", true);
    const old = readRecord(first.dataDir, runId);
    expect(old.exited?.reason).toBe("replaced");
    // and the old record names its successor as well as the PTY it gave up
    expect(old.reattach).toMatchObject({
      state: "resumed",
      replaced: ptyId,
      replacedBy: replaced.runtimeRunId,
    });
    // the ledger: ONE act, the daemon's own, and it says how it decided
    const byIdle = auditAct(
      first.dataDir,
      (entry) =>
        entry.action === "agent.session.resume" &&
        entry.actor.kind === "system" &&
        entry.target.id === runId,
    );
    expect(byIdle.attempt.attrs).toMatchObject({
      provider: "scripted",
      how: "idle",
      replaced: ptyId,
    });
    expect(byIdle.outcome.outcome).toBe("succeeded");
    expect(byIdle.outcome.attrs).toMatchObject({
      runtimeRunId: replaced.runtimeRunId,
      sessionId: replaced.terminal?.runtimeSessionId,
    });
    // nobody asked for it: no door act stands beside the daemon's
    expect(
      auditEntries(first.dataDir).filter(
        (entry) => entry.action === "agent.session.resume" && entry.actor.kind !== "system",
      ),
    ).toEqual([]);
    // the fold holds the new run only
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([replaced.runtimeRunId]);
    await win2.call("terminal.terminate", { sessionId: replaced.terminal?.runtimeSessionId ?? "" });
  }, 200_000);

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
    // The rewrite goes through the product's OWN record store, so the staged
    // record stays SIGNED (AR-4b): a record whose signature does not verify is
    // set aside at read and never acted on, which would witness the tamper
    // path instead of this row's — a PTY that ended unseen.
    const record = readRecord(first.dataDir, runId);
    first.records.write({ ...record, terminalSessionId: "sess-that-never-was" });
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

  it("a managed PTY that ends on its OWN (killed out of band, nothing asked) withdraws the row and stamps the record", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, DECK, "ko1");
    const spawned = (await win.call("agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win, runId);
    // the floor's inventory row names the process it started; kill THAT, the
    // way a crash would, with no door touched and nothing telling fieldd
    const { terminals } = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    const pid = terminals.find((t) => t.sessionId === ptyId)?.pid;
    expect(pid, "the floor's inventory row carries no pid to kill").toBeTypeOf("number");
    process.kill(pid as number, "SIGKILL");

    // the row leaves the fold — by the floor's exit facts if they arrive, by
    // the inventory backstop (EXIT_GRACE_MS) if they do not; either is the
    // honest answer, and the record's reason says which got there first
    await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    const stamped = await poll(async () => {
      const r = readRecord(box.dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 10_000);
    expect([
      "completed",
      "crashed",
      "signaled",
      "user-terminated",
      "application-terminated",
      "service-terminated",
      "unknown",
    ]).toContain(stamped.exited?.reason);
    expect(await listed(win, ptyId)).toBe(false);
    // and puppeteer has let the run go with it
    expect(box.daemon.agents.runtime.agent(ptyId)).toBeUndefined();
  }, 120_000);

  it("the index down under a pending run: it stays pending with no replacement and nothing unhandled — and a stop under that armed poll still RELEASES the PTY rather than ending it", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    cleanup.push(() => {
      process.off("unhandledRejection", onUnhandled);
    });

    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "ix1");
    const spawned = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();

    // the second boot's index refuses to start at all: the poll is armed as
    // eagerly as it can be (a millisecond of stillness would do), so if an
    // index that answers NOTHING could ever be read as "idle" this run would
    // be replaced within a tick
    const second = await setup({
      floor: "real",
      restartOf: first,
      rosettadMode: "crash-on-start",
      resumeWhenIdle: { afterMs: 1, pollMs: 100 },
    });
    const win2 = await window(second.daemon, DECK, "ix2");
    const pending = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(pending.continuation?.pending).toBe("resume-when-idle");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(second.daemon.health().rosettad.phase, "the index came up after all").not.toBe("ready");
    expect(sessionRequests(second), "a dead index answered a request").toBe(0);
    const rows = ((await win2.call("agent.list", {})) as AgentListResult).sessions;
    expect(rows.map((r) => r.runtimeRunId)).toEqual([runId]);
    expect(rows[0]?.continuation?.pending).toBe("resume-when-idle");
    expect(await listed(win2, ptyId)).toBe(true);
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();

    // ── the stop, with that poll still armed: the detach promise holds ──
    const asked = Date.now();
    await second.daemon.stop();
    expect(Date.now() - asked, "the stop waited on something").toBeLessThan(10_000);
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
    const third = await setup({ floor: "real", restartOf: first });
    const win3 = await window(third.daemon, DECK, "ix3");
    await untilListed(win3, ptyId, true);
    expect(
      unhandled.map((reason) => (reason instanceof Error ? reason.message : String(reason))),
    ).toEqual([]);
    await win3.call("terminal.terminate", { sessionId: ptyId });
  }, 200_000);

  it("one record's trouble does not end the re-attach: a record naming a provider that no longer exists is held pending with its reason, and the good record beside it still attaches", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "tr1");
    const good = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "the good one",
    })) as AgentSpawnResult;
    const bad = (await win1.call("agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "the troubled one",
    })) as AgentSpawnResult;
    await joinedRow(win1, good.session.runtimeRunId);
    await joinedRow(win1, bad.session.runtimeRunId);
    await first.daemon.stop();
    // one record now names an adapter this daemon has never heard of — and it
    // is the NEWER record, so the re-attach meets it first (records are listed
    // newest first). Written through the store: a signed record fieldd will
    // act on, which is what makes the failure the ATTACH's and not the read's.
    const record = readRecord(first.dataDir, bad.session.runtimeRunId);
    first.records.write({ ...record, provider: "ghost" });

    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "tr2");
    const attached = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === good.session.runtimeRunId);
      return found?.continuation?.reattached === true ? found : undefined;
    }, 20_000);
    expect(attached.runtimeEpoch).toBe(2);
    expect(attached.title).toBe("the good one");
    expect(first.attached.map((a) => a.runtimeSessionId)).toEqual([good.terminal.sessionId]);
    // the troubled one is held, live and unobserved, with the reason on the
    // record — the state a person resumes from, not a boot that stopped
    const held = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === bad.session.runtimeRunId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(held.title).toBe("the troubled one");
    expect(held.continuation).toMatchObject({ resumable: true, pending: "resume-when-idle" });
    expect(readRecord(first.dataDir, bad.session.runtimeRunId).reattach).toMatchObject({
      state: "failed",
    });
    const trouble = auditAct(
      first.dataDir,
      (entry) =>
        entry.action === "agent.session.reattach" && entry.target.id === bad.session.runtimeRunId,
    );
    expect(trouble.attempt.attrs?.["provider"]).toBe("ghost");
    expect(trouble.outcome.outcome).toBe("failed");
    expect(trouble.outcome.reasonCode).toBe("ATTACH_FAILED");
    // both PTYs are still the floor's; end them
    await win2.call("terminal.terminate", { sessionId: good.terminal.sessionId });
    await win2.call("terminal.terminate", { sessionId: bad.terminal.sessionId });
  }, 200_000);
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
      // the AR-3 ledger's own claim for this hold — "`native-hooks` and `idle`
      // after five" — asserted rather than only logged: a run whose evidence
      // has fallen back to the log tail is a finding, not a passing row
      expect(still?.monitor?.freshness?.level).toBe("native-hooks");
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
      // Let the vendor TUI finish starting before the stop — PU-11: a fieldd
      // stop within about a second of the first observed hook LOSES the
      // process (4 of 4 without a hold; 3 of 3 survive with one). Wait for the
      // HOOK rather than for a number of seconds, then give it a beat: a blind
      // sleep is the same number whether the thing it was waiting for happened
      // or not.
      const settled = await poll(async () => {
        const { sessions } = (await win1.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.monitor?.freshness?.level === "native-hooks" ? found : undefined;
      }, 60_000);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      console.log(
        `REAL_AGENT_BEFORE_STOP ${JSON.stringify({
          listed: await listed(win1, ptyId),
          level: settled.monitor?.freshness?.level,
          status: settled.status,
        })}`,
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
      // the premise of everything below, asserted once the facts are logged:
      // a re-attach to a PTY the stop took with it is not a re-attach
      expect(ptyAlive, "the PTY did not survive the stop").toBe(true);
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
      const exit = readRecord(first.dataDir, runId).exited;
      console.log(`REAL_AGENT_EXIT ${JSON.stringify(exit)}`);
      // the AR-4 ledger's claim for this ending, asserted: terminated cleanly,
      // the vendor's own process leaving by the application's ladder
      expect(term.terminated).toBe(true);
      expect(exit?.reason).toBe("application-terminated");
    }, 300_000);
  },
);
