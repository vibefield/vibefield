// AR-7b/c — the REAL floor under the typed-agent rows: a field-native the
// test spawns, a fieldd booted on it in this process, a shell born through
// `terminal.create`, and a person's typing done the only way a test may do it
// — the floor's own automation door, into a PTY the test itself birthed (no
// OS-level input is ever injected). The agent is the scripted one
// (agent-gateway-fixture.ts): no vendor's binary runs.
//
// A pane here (`openPane`) is `/bin/sh`, named explicitly, so no row depends
// on the machine's own startup files; the launcher directory is put at the
// head of its PATH by typing the `export` a born-integrated shell would not
// need. A pane BORN integrated (`bornPane`, AR-7b × AR-7d) is the person's
// login shell as `terminal.create {}` births it — over a floor that runs with
// a throwaway HOME (`person: true`), so the shell reads a throwaway person's
// startup files and never the machine owner's — and nothing is typed to make
// the launchers lead: the daemon's own wiring does.
//
// Test-local — not shipped.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { userInfo } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSpawnThroughResponse,
  readRendezvous,
  type SpawnThroughResponse,
  spawnThroughLayout,
} from "@vibecook/puppeteer-runtime/spawn-through";
import {
  AgentSessionRecord,
  type AgentSessionSummary,
  LAYOUT,
  type TerminalInfo,
} from "@vibefield/contracts";
import WebSocket from "ws";
import { agentShimHome } from "../src/agent-gateway";
import { bootstrap, type FielddConfig, type FielddDaemon, SessionRecordStore } from "../src/index";
import type { SecretStore } from "../src/plugin-settings";
import {
  TYPED_CATALOG,
  TYPED_COMMAND,
  type TypedProviderOptions,
  type TypedScript,
  typedProvider,
  typedScript,
} from "./agent-gateway-fixture";
import {
  killDaemonTree,
  nativeBinPath,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");
const FLOOR_BIN = nativeBinPath(REPO);
const FAKE_ROSETTAD = join(HERE, "fixtures", "fake-rosettad.mjs");

/** What a row on a loaded host is given to see an effect: no row asserts speed. */
export const FLOOR_WAIT_MS = 60_000;
/** One row's whole budget. */
export const FLOOR_BUDGET_MS = 300_000;

/** End of input, as a person types it (built, never typed into this file). */
export const END_OF_INPUT = String.fromCodePoint(4);

/** A zsh on this host's PATH, for the panes born as a person's are. win32 has
 * none to integrate: the kit's shim execs in place, which is POSIX only. */
export function findZsh(): string | undefined {
  if (process.platform === "win32") return undefined;
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "zsh");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}
export const ZSH = findZsh();

/** The person's login shell as the daemon reads it, when it is a zsh: a pane
 * born by default (`terminal.create {}`) is then the shell under test. */
function loginZsh(): string | undefined {
  try {
    const shell = userInfo().shell;
    return typeof shell === "string" && basename(shell) === "zsh" ? shell : undefined;
  } catch {
    return undefined;
  }
}

let floors: ChildProcess[] = [];
let roots: string[] = [];
let closers: Array<() => void | Promise<void>> = [];

/** Every floor's tree reaped, every root removed — each row's `afterEach`. */
export async function teardownFloors(): Promise<void> {
  for (const close of closers.reverse()) {
    try {
      await close();
    } catch {
      /* a daemon already stopped, a socket already closed */
    }
  }
  closers = [];
  await Promise.all(floors.map((floor) => killDaemonTree(floor)));
  floors = [];
  for (const root of roots) removeTempRoot(root);
  roots = [];
}

export async function poll<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  ms: number = FLOOR_WAIT_MS,
  what = "the condition",
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what} did not hold within ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A window of time in which something must NOT happen. */
export const quiet = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function keychain(): SecretStore {
  const entries = new Map<string, string>();
  return {
    get: async (service, account) => entries.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => {
      entries.set(`${service}/${account}`, value);
    },
    delete: async (service, account) => {
      entries.delete(`${service}/${account}`);
    },
  };
}

export interface Floor {
  root: string;
  dataDir: string;
  /** where panes are born: a directory of the test's own, by its physical path */
  work: string;
  /** the throwaway HOME the floor — and so every born shell — runs with, when
   * the floor is a person's (`person: true`); its startup files leave one
   * line per run in `<personHome>/ran` */
  personHome?: string;
  /** the launchers' home, and the directory a pane puts at the head of its PATH */
  home: string;
  shimDirectory: string;
  daemon: FielddDaemon;
  script: TypedScript;
  /** the product's own record store over this root — the only way a row can
   * stage a record the daemon will still act on */
  records: SessionRecordStore;
  /** a window that may make panes, read the fold and resume a run */
  win: WsRpc;
  config: FloorConfig;
  /** the file the scripted index serves its session rows from */
  sessionsFile: string;
  /** one line per read the scripted index answered */
  requestLog: string;
}

export interface FloorConfig {
  /** the scripted adapter can re-attach (AR-4) */
  attach?: boolean;
  /** a SECOND fieldd on this floor's root, its field-native still running */
  restartOf?: Floor;
  /** how long a launcher in a pane waits for a fieldd that does not answer */
  retryMs?: number;
  provider?: TypedProviderOptions;
  gateway?: NonNullable<FielddConfig["agentGateway"]>;
  /** the bundled shim, which the test file builds once */
  bundle: string;
  /** false = the row expects no launcher from this boot, and waits for none */
  launchers?: boolean;
  /** the floor runs with a throwaway HOME and a throwaway person's startup
   * files, as a person's panes would: what a shell BORN integrated reads. The
   * test process's own ZDOTDIR is set aside meanwhile — the gateway hands the
   * kit fieldd's environment, and a born shell restores that ZDOTDIR. */
  person?: boolean;
  /** compose the agent index (a scripted rosettad) and resume-when-idle's
   * thresholds: what a run that MAY be replaced at idle is replaced by */
  index?: { afterMs: number; pollMs: number };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  closers.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A renderer window token holding exactly `scopes`. */
export async function windowOf(daemon: FielddDaemon, scopes: string[]): Promise<WsRpc> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: {
      participantId: `renderer:desktop-test:window-${suffix}`,
      incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
    },
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

/** Boot fieldd over the REAL field-native, the scripted typed agent composed
 * and nothing of any vendor's. */
export async function floor(config: FloorConfig): Promise<Floor> {
  const restart = config.restartOf;
  const root = restart?.root ?? shortTmpRoot("vf-ar7-");
  // the root is removed AFTER every floor's tree is reaped
  if (restart === undefined) roots.push(root);
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  const personHome =
    config.person === true || restart?.personHome !== undefined ? join(root, "home") : undefined;
  if (personHome !== undefined && restart === undefined) {
    // a throwaway person: startup files that say they ran, and nothing else
    // (an interactive zsh with NO .zshrc would offer its new-user wizard)
    const ran = join(personHome, "ran");
    mkdirSync(personHome, { recursive: true });
    for (const file of [".zshenv", ".zprofile", ".zshrc"])
      writeFileSync(join(personHome, file), `print -r -- ${file} >> '${ran}'\n`);
    writeFileSync(join(personHome, ".profile"), `echo .profile >> '${ran}'\n`);
  }
  if (personHome !== undefined) {
    const zdotdir = process.env["ZDOTDIR"];
    delete process.env["ZDOTDIR"];
    closers.push(() => {
      if (zdotdir !== undefined) process.env["ZDOTDIR"] = zdotdir;
    });
  }
  if (restart === undefined) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    mkdirSync(join(root, "work"));
    const child = spawn(FLOOR_BIN, [], {
      env: {
        ...(personHome === undefined ? process.env : personEnvironment(personHome)),
        FIELD_NATIVE_DATA_DIR: dataDir,
        FIELD_LOG_DIR: join(dataDir, "logs"),
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      },
      stdio: "ignore",
    });
    floors.push(child);
    await waitForMgmtEndpoint(dataDir, 30_000);
  }
  const script = restart?.script ?? typedScript(join(root, "scripted"));
  const sessionsFile = join(root, "rosetta-sessions.json");
  const requestLog = join(root, "rosetta-requests.log");
  const indexHome = join(dataDir, "home");
  if (config.index !== undefined) mkdirSync(indexHome, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    secretStore: keychain(),
    vibefieldRoot: root,
    ...(config.index === undefined
      ? {}
      : {
          rosettadBin: "/stand-in/rosettad",
          rosettadSpawn: ((_bin: string, args: readonly string[], options: object) =>
            spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
              ...options,
              env: {
                ...process.env,
                FAKE_ROSETTAD_MODE: "ok",
                FAKE_ROSETTAD_SESSIONS: sessionsFile,
                FAKE_ROSETTAD_REQUEST_LOG: requestLog,
              },
            })) as unknown as typeof spawn,
          rosettadHome: indexHome,
          agentResumeWhenIdle: config.index,
        }),
    agentCatalog: TYPED_CATALOG,
    // the scripted agent and no other: nothing of any vendor's is composed
    agentProviders: () => [
      typedProvider(script, { attach: config.attach === true, ...config.provider }),
    ],
    agentGateway: {
      shimScript: config.bundle,
      ...(config.retryMs !== undefined ? { retryMs: config.retryMs } : {}),
      ...config.gateway,
    },
  });
  closers.push(() => daemon.stop().catch(() => undefined));
  const home = agentShimHome(dataDir);
  // The gateway's start is not a boot gate, and it is the DAEMON's to begin:
  // a row waits for what that start leaves, and never starts it itself.
  if (daemon.agentGateway !== null && config.launchers !== false) {
    const launcher = join(spawnThroughLayout(home).shimDirectory, TYPED_COMMAND);
    await poll(
      () =>
        daemon.agentGateway?.state().listening === true &&
        existsSync(launcher) &&
        existsSync(join(home, "gateway.json")) &&
        existsSync(join(home, "terminals.json"))
          ? true
          : undefined,
      FLOOR_WAIT_MS,
      "the daemon's own gateway coming up",
    );
  }
  return {
    root,
    dataDir,
    work: realpathSync(join(root, "work")),
    ...(personHome === undefined ? {} : { personHome }),
    home,
    shimDirectory: spawnThroughLayout(home).shimDirectory,
    daemon,
    script,
    records:
      restart?.records ??
      new SessionRecordStore({
        dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
        keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
        now: () => new Date(),
      }),
    win: await windowOf(daemon, [
      "agent.spawn",
      "agent.observe",
      "agent.control",
      "terminal.attach",
    ]),
    config,
    sessionsFile,
    requestLog,
  };
}

/** The environment a person's floor runs with — and so every shell it births
 * (`inherit`): this process's, minus what would make a born shell look already
 * integrated or reach outside the box (a ZDOTDIR or HISTFILE of the machine
 * owner's, a terminal app's session hooks), plus the throwaway HOME. */
function personEnvironment(home: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name === "ZDOTDIR" || name === "HISTFILE") continue;
    if (name.startsWith("TERM_") || name.startsWith("PUPPETEER_")) continue;
    environment[name] = value;
  }
  environment["HOME"] = home;
  return environment;
}

/** A session row of the index's, as rosetta serves it: the conversation's
 * canonical row, still for `stillForMs`. */
export const indexedSession = (nativeSessionId: string, stillForMs: number) => ({
  id: `rs-${nativeSessionId}`,
  native_session_id: nativeSessionId,
  runtime_id: "rt-scripted",
  project_id: null,
  cwd: null,
  parent_session_id: null,
  delegation: null,
  root_session_id: `rs-${nativeSessionId}`,
  role: "main",
  title: null,
  summary: null,
  started_at: Date.now() - stillForMs - 60_000,
  updated_at: Date.now(),
  activity: { first_at: Date.now() - stillForMs - 60_000, last_at: Date.now() - stillForMs },
  stream_state: "indexed",
});

/** What the scripted index was asked, one line per read. */
export const indexRequests = (box: Floor): string[] =>
  existsSync(box.requestLog)
    ? readFileSync(box.requestLog, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

/** One request on the gateway's own socket, with the bearer the rendezvous
 * holds — what anything of this user's can send. */
export async function ask(
  box: Floor,
  payload: Record<string, unknown>,
): Promise<SpawnThroughResponse | undefined> {
  const rendezvous = await readRendezvous(box.home);
  if (rendezvous === undefined) throw new Error("no rendezvous to ask by");
  return new Promise((resolve) => {
    const socket = createConnection({ host: rendezvous.host, port: rendezvous.port });
    let text = "";
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ token: rendezvous.token, ...payload })}\n`),
    );
    socket.on("data", (chunk: string) => {
      text += chunk;
    });
    socket.on("error", () => undefined);
    socket.once("close", () => {
      const line = text.split("\n")[0];
      if (line === undefined || line === "") return resolve(undefined);
      try {
        resolve(parseSpawnThroughResponse(JSON.parse(line)));
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** A launch, as a launcher in `cwd` would ask for it. */
export const launchOf = (
  box: Floor,
  pid: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: "launch",
  providerId: "scripted",
  cwd: box.work,
  argv: [],
  environment: {},
  pid,
  parentPid: 1,
  command: TYPED_COMMAND,
  interactive: true,
  ...over,
});

// ── a pane, and a person at it ──

export interface Pane {
  sessionId: string;
  /** the shell's pid, as the floor lists it */
  pid: number;
  /** everything the pane has shown, when the pane is recorded */
  screen?: string;
}

/** Type one line at the pane's prompt, as a person would: the text, then Return. */
export async function type(box: Floor, pane: Pane, line: string): Promise<void> {
  await key(box, pane, `${line}\r`);
}

/** Press keys that are no line (end of input, an interrupt's byte). */
export async function key(box: Floor, pane: Pane, text: string): Promise<void> {
  await poll(
    async () => {
      const result = await box.daemon.terminals.automate(pane.sessionId, { kind: "text", text });
      return result.accepted ? true : undefined;
    },
    FLOOR_WAIT_MS,
    "the floor taking the typed input",
  );
}

/** What the pane has shown so far (a recorded pane). */
export function screenOf(pane: Pane): string {
  if (pane.screen === undefined || !existsSync(pane.screen)) return "";
  return readFileSync(pane.screen, "utf8").replace(/\r/gu, "");
}

let paneSeq = 0;

/** Birth a shell through `terminal.create`, wait for the floor to list it, and
 * put the launcher directory at the head of its PATH.
 *
 * `recorded`: the shell hands its terminal to `script(1)`, which runs the
 * pane's shell beneath it and copies everything the pane shows into a file —
 * the pane's screen, read without a renderer. The launcher is then a
 * GRANDCHILD of the session's process, which is the nested case the ancestor
 * walk exists for. */
export async function openPane(
  box: Floor,
  options: { recorded?: boolean; path?: boolean } = {},
): Promise<Pane> {
  const created = (await box.win.call("terminal.create", {
    shell: "/bin/sh",
    cwd: box.work,
  })) as { sessionId: string };
  const listed = await poll(
    () => {
      const row = box.daemon.terminals.get(created.sessionId);
      return row?.pid === undefined ? undefined : row;
    },
    FLOOR_WAIT_MS,
    "the floor listing the pane",
  );
  const pane: Pane = { sessionId: created.sessionId, pid: listed.pid as number };
  if (options.recorded === true) await record(box, pane);
  if (options.path !== false) {
    await type(box, pane, `export PATH='${box.shimDirectory}':"$PATH"`);
  }
  return pane;
}

/** The pane hands its terminal to `script(1)`, which runs `/bin/sh` beneath it
 * and copies everything the pane shows into a file. The sh inherits the PATH
 * the pane's shell exported — a born-integrated shell's, led by the launchers
 * at its first prompt — so what is typed from here resolves as it would there. */
async function record(box: Floor, pane: Pane): Promise<void> {
  paneSeq += 1;
  const screen = join(box.root, `screen-${paneSeq}.txt`);
  pane.screen = screen;
  await type(box, pane, `exec script -q -F '${screen}' /bin/sh`);
  // `script` empties the terminal's input as it takes it over: typing is
  // lost until it is ready, so ask until the pane answers
  let asked = 0;
  await poll(
    async () => {
      asked += 1;
      await type(box, pane, `echo vf-ready-${asked}`);
      await quiet(400);
      return /^vf-ready-\d+$/mu.test(screenOf(pane)) ? true : undefined;
    },
    FLOOR_WAIT_MS,
    "the recorded pane answering",
  );
}

/** Birth a pane as a person's is born — `terminal.create {}`, the login shell
 * with `-l` — when that shell is a zsh; on a host whose login shell is
 * another, an explicit zsh from PATH, the other birth `create` integrates.
 * Nothing is typed to make the launchers lead: the shell is BORN integrated
 * by the daemon's own wiring, or the row is red. The pane has answered at its
 * first prompt when this returns, so the integration's hook has run.
 * `profileSet` (SB-2): the pane is born under that Agent Profile, and the
 * answer says what the daemon said of it (`bound`, the create's `profileSet`). */
export async function bornPane(
  box: Floor,
  options: { recorded?: boolean; profileSet?: string } = {},
): Promise<
  Pane & { integrated: boolean; login: boolean; bound: boolean; profileSet?: string | undefined }
> {
  if (box.personHome === undefined) throw new Error("a born pane needs a person's floor");
  const login = loginZsh() !== undefined;
  if (!login && ZSH === undefined) throw new Error("no zsh on this host");
  const created = (await box.win.call("terminal.create", {
    ...(login ? {} : { shell: ZSH }),
    cwd: box.work,
    ...(options.profileSet === undefined ? {} : { profileSet: options.profileSet }),
  })) as { sessionId: string; profileSet?: string };
  const listed = await poll(
    () => {
      const row = box.daemon.terminals.get(created.sessionId);
      return row?.pid === undefined ? undefined : row;
    },
    FLOOR_WAIT_MS,
    "the floor listing the born pane",
  );
  const pane: Pane = { sessionId: created.sessionId, pid: listed.pid as number };
  // the birth's own word, from the ledger: what the daemon says it did
  const act = await poll(
    () =>
      auditActs(box.dataDir, "terminal.session.create").find(
        (found) => found.outcome?.attrs?.["sessionId"] === created.sessionId,
      ),
    FLOOR_WAIT_MS,
    "the birth in the ledger",
  );
  const integrated = act.outcome?.attrs?.["integrated"] === true;
  const bound = act.outcome?.attrs?.["bound"] === true;
  await answers(box, pane, "born");
  if (options.recorded === true) await record(box, pane);
  return { ...pane, integrated, login, bound, profileSet: created.profileSet };
}

/** The pane answers at its prompt: a line typed now runs. */
export async function answers(box: Floor, pane: Pane, word: string): Promise<void> {
  const marker = join(box.root, `answer-${word}`);
  await type(box, pane, `echo ${word} > '${marker}'`);
  await poll(
    () => (existsSync(marker) && readFileSync(marker, "utf8").trim() === word ? true : undefined),
    FLOOR_WAIT_MS,
    `the pane answering ${word}`,
  );
}

/** Run a command line at the prompt and read how it left. */
export async function statusOf(
  box: Floor,
  pane: Pane,
  line: string,
  name: string,
): Promise<number> {
  const file = join(box.root, `status-${name}`);
  await type(box, pane, `${line}; echo "status=$?" > '${file}'`);
  const text = await poll(
    () => (existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined),
    FLOOR_WAIT_MS,
    `the status of ${name}`,
  );
  return Number(text.replace("status=", ""));
}

// ── the fold, the record, the ledger ──

/** The typed run in a pane, as the fold lists it. */
export function typedRow(box: Floor, pane: Pane): AgentSessionSummary | undefined {
  return box.daemon.agents
    .list()
    .sessions.find((row) => row.terminal?.runtimeSessionId === pane.sessionId);
}

export function rowOf(box: Floor, runtimeRunId: string): AgentSessionSummary | undefined {
  return box.daemon.agents.list().sessions.find((row) => row.runtimeRunId === runtimeRunId);
}

/** The row a name typed in `pane` became. */
export function adopted(box: Floor, pane: Pane): Promise<AgentSessionSummary> {
  return poll(() => typedRow(box, pane), FLOOR_WAIT_MS, "the typed run entering the fold");
}

export const recordPath = (dataDir: string, runtimeRunId: string): string =>
  join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${encodeURIComponent(runtimeRunId)}.json`);

/** The record as it is ON DISK — read without the store, so a row sees the
 * bytes and not the store's judgement of them. */
export function readRecord(dataDir: string, runtimeRunId: string): AgentSessionRecord {
  return AgentSessionRecord.parse(
    JSON.parse(readFileSync(recordPath(dataDir, runtimeRunId), "utf8")),
  );
}

export interface AuditEntry {
  action: string;
  phase: "attempt" | "outcome";
  outcome?: string;
  reasonCode?: string;
  operationId?: string;
  actor: { kind: string; id?: string };
  target: { kind: string; id: string };
  attrs?: Record<string, unknown>;
}

function ledgers(dataDir: string): string[] {
  const walk = (directory: string): string[] =>
    existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
        )
      : [];
  return walk(join(dataDir, ...LAYOUT.AUDIT_DIR)).filter((file) => file.endsWith(".jsonl"));
}

/** Every line of every ledger under the user root. */
export const auditText = (dataDir: string): string =>
  ledgers(dataDir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

export const auditEntries = (dataDir: string): AuditEntry[] =>
  ledgers(dataDir).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as AuditEntry),
  );

/** Every act of one action, each read as the pair it is written as. */
export function auditActs(
  dataDir: string,
  action: string,
): Array<{ attempt: AuditEntry; outcome: AuditEntry | undefined }> {
  const entries = auditEntries(dataDir);
  return entries
    .filter((entry) => entry.phase === "attempt" && entry.action === action)
    .map((attempt) => ({
      attempt,
      outcome: entries.find(
        (entry) => entry.phase === "outcome" && entry.operationId === attempt.operationId,
      ),
    }));
}

// ── the process table, as the system tells it ──

function ps(args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      [...args],
      { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 20_000 },
      (error, stdout) => resolve(error === null ? stdout.trim() : ""),
    );
  });
}

export interface SeenProcess {
  pid: number;
  parentPid: number;
  command: string;
}

/** One process, or undefined when no such process runs. */
export async function processOf(pid: number): Promise<SeenProcess | undefined> {
  const line = await ps(["-o", "pid=", "-o", "ppid=", "-o", "comm=", "-p", String(pid)]);
  const columns = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
  return columns === null
    ? undefined
    : { pid: Number(columns[1]), parentPid: Number(columns[2]), command: columns[3] as string };
}

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Whether the floor lists the session now. */
export function listedRow(box: Floor, sessionId: string): TerminalInfo | undefined {
  return box.daemon.terminals.observation() === undefined
    ? undefined
    : box.daemon.terminals.get(sessionId);
}

export { TYPED_COMMAND };
