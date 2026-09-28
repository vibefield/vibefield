// AR-7b/c — a typed agent is a managed agent: fieldd as the HOST of puppeteer's
// spawn-through kit (`@vibecook/puppeteer-runtime/spawn-through`). The kit gives
// the gateway, the wire, the shim, the launcher and the rendezvous files; what
// is under test here is VibeField's side of it and nothing of any vendor's —
// the scripted agent (agent-gateway-fixture.ts) is the instrument, and no row
// runs a vendor's binary.
//
// The first blocks need no floor: the service is built over puppeteer's REAL
// runtime and the REAL kit, with the floor's inventory and the process table
// stated by the row (a terminal service that lists what the row says, a table
// the row writes), so each rule is read against facts and never against the
// machine it happens to run on. A launch in those rows is a request on the
// gateway's own socket, with the bearer read from the rendezvous the way a
// launcher reads it.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInstallation, BoundIngress } from "@vibecook/puppeteer-core";
import {
  type AgentRuntime,
  createAgentRuntime,
  createFileCreationRequestRegistry,
} from "@vibecook/puppeteer-runtime";
import {
  boundSpawnThroughText,
  MAX_REFUSAL_MESSAGE_LENGTH,
  materializeShims,
  type ProcessRecord,
  parseSpawnThroughResponse,
  prepareSpawnThroughLaunch,
  processStartedAt,
  readLaunchProviders,
  readRendezvous,
  readTerminals,
  SPAWN_THROUGH_DECLINE_CODES,
  SPAWN_THROUGH_EXIT_UNAVAILABLE,
  type SpawnThroughHost,
  type SpawnThroughResponse,
  shellIntegrationEnvironment,
  spawnThroughLayout,
  startSpawnThroughGateway,
  writeRendezvous,
} from "@vibecook/puppeteer-runtime/spawn-through";
import {
  AGENT_CATALOG_READERS,
  type AgentCatalogEntry,
  type AgentProvidersResult,
  type AgentSessionRecord,
  type AgentSessionSummary,
  createAgentCatalogReaders,
  type TerminalInfo,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AgentDistributionService } from "../src/agent-distribution";
import {
  AGENT_GATEWAY_HOST_LABEL,
  AGENT_GATEWAY_STRICT,
  AgentGatewayService,
  agentRefusal,
  agentShimHome,
  chooseLauncherRuntime,
  firstNodeOnPath,
  type GatewayTerminals,
  type LauncherRuntimeFacts,
  nodeCanExecInPlace,
  offeredLaunch,
  refusalReasonCode,
  type ShellIntegration,
  shimHomeIsDurable,
  startedWithSession,
} from "../src/agent-gateway";
import {
  type AgentAdoption,
  type AgentAdoptionInput,
  noTerminalHost,
  type SystemAudit,
} from "../src/agent-runtime";
import { endTypedProcess, typedRunProof } from "../src/agent-typed-run";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import {
  linesOf,
  TYPED_CATALOG,
  TYPED_COMMAND,
  TYPED_PROVIDER,
  type TypedProviderOptions,
  type TypedScript,
  typedProvider,
  typedScript,
} from "./agent-gateway-fixture";
import {
  adopted,
  answers,
  ask as askFloor,
  auditActs,
  auditEntries,
  auditText,
  END_OF_INPUT,
  FLOOR_BUDGET_MS,
  FLOOR_WAIT_MS,
  floor,
  indexedSession,
  indexRequests,
  isAlive,
  key,
  launchOf,
  listedRow,
  openPane,
  processOf,
  quiet,
  readRecord,
  recordPath,
  rowOf,
  screenOf,
  statusOf,
  teardownFloors,
  type,
  typedRow,
  poll as until,
  windowOf,
} from "./agent-gateway-floor";
import { AGENT_SHIM_ENTRY, bundleAgentShim } from "./agent-shim-bundle";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A loaded host takes seconds to start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 60_000;

/** An escape no sentence may carry to a terminal — built, never typed. */
const ESCAPE = String.fromCodePoint(27);

let bundleDir: string;
let shimScript: string;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "vf-shim-"));
  shimScript = await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* a gateway already stopped, a directory already gone */
    }
  }
  cleanup = [];
  // every floor's whole tree is reaped, and only then its root removed
  await teardownFloors();
}, 60_000);

/** Run a program to its end: what it printed and how it left. */
function run(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: PROCESS_BUDGET_MS, ...options },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : (null as null);
        resolve({ code, stdout, stderr });
      },
    );
  });
}

const mode = (path: string): number => statSync(path).mode & 0o777;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function poll<T>(fn: () => T | undefined | Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await sleep(25);
  }
}

describe("the shim bundle (AR-7b)", () => {
  it(
    "is ONE CommonJS file built from the pinned kit's own entry, and run without its launcher's variables it says so and leaves with the kit's status",
    async () => {
      expect(statSync(shimScript).isFile()).toBe(true);
      // the launcher names these two; without them the shim can do nothing
      const env = { ...process.env };
      delete env["PUPPETEER_SHIM_NAME"];
      delete env["PUPPETEER_SHIM_HOME"];
      const bare = await run(process.execPath, [shimScript], { env });
      expect(bare.code).toBe(SPAWN_THROUGH_EXIT_UNAVAILABLE);
      expect(bare.stderr).toContain("PUPPETEER_SHIM_NAME and PUPPETEER_SHIM_HOME are required");
      expect(bare.stdout).toBe("");
    },
    PROCESS_BUDGET_MS,
  );

  it("is a step of fieldd's own build, beside the daemon's bundle, with the options the rows above ran", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    const steps = manifest.scripts.build.split(" && ");
    const step = steps.find((candidate) => candidate.includes("agent-shim.cjs"));
    expect(step).toBe(
      `esbuild ${AGENT_SHIM_ENTRY} --bundle --platform=node --format=cjs --target=node22 --outfile=dist/agent-shim.cjs`,
    );
    // beside the daemon's own bundle: that is where the gateway looks by default
    expect(steps.some((candidate) => candidate.includes("--outfile=dist/bin.cjs"))).toBe(true);
  });
});

// ── the launcher's runtime ──

describe("the launcher's runtime — one rule, four cases (AR-7b)", () => {
  /** A directory holding an executable `node` that nothing ever runs. */
  function nodeIn(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const node = join(directory, "node");
    writeFileSync(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    chmodSync(node, 0o755);
    return node;
  }
  function scratch(): string {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "vf-rt-")));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
  }
  const facts = (over: Partial<LauncherRuntimeFacts>): LauncherRuntimeFacts => ({
    electron: undefined,
    sea: false,
    execPath: "/opt/node/bin/node",
    nodeVersion: "24.1.0",
    path: "",
    shimDirectories: [],
    probe: async () => {
      throw new Error("no row asked for a probe");
    },
    ...over,
  });

  it("`process.execve` exists from 22.15 on the 22 line, 23.11 on the 23 line, and in every 24 and later — and nowhere before", () => {
    const can = [
      "22.15.0",
      "22.19.1",
      "23.11.0",
      "23.11.1",
      "24.0.0",
      "26.5.0",
      "24.0.0-nightly.1",
    ];
    const cannot = ["22.14.9", "22.0.0", "23.0.0", "23.10.5", "21.7.3", "20.19.0", "18.20.0"];
    for (const version of can) expect(nodeCanExecInPlace(version), version).toBe(true);
    for (const version of cannot) expect(nodeCanExecInPlace(version), version).toBe(false);
    for (const nonsense of ["", "v24.0.0", "24", "24.0", "node"])
      expect(nodeCanExecInPlace(nonsense), nonsense).toBe(false);
  });

  it("case 1 — a configured runtime is used as given, its variables with it; one that is not an absolute path is no runtime", async () => {
    const configured = { command: "/opt/app/runtime", args: ["--shim"], env: { APP_AS_NODE: "1" } };
    const chosen = await chooseLauncherRuntime(
      // everything else would have said otherwise: the configured word is first
      facts({ configured, sea: true, electron: "38.0.0" }),
    );
    expect(chosen).toEqual({ runtime: configured, source: "configured" });
    const relative = await chooseLauncherRuntime(facts({ configured: { command: "node" } }));
    expect(relative.runtime).toBeUndefined();
  });

  it("case 2 — fieldd under a real Node that can exec in place: that Node, and no variable of any kind", async () => {
    const chosen = await chooseLauncherRuntime(
      facts({ execPath: "/opt/node/bin/node", nodeVersion: "22.15.0" }),
    );
    expect(chosen).toEqual({
      runtime: { command: "/opt/node/bin/node" },
      source: "own-node",
      version: "22.15.0",
    });
  });

  it("case 3 — under Electron as Node: the first node on fieldd's PATH that can exec in place, asked ONCE; never Electron itself, and never a node in a launcher directory under any spelling", async () => {
    const root = scratch();
    const shim = join(root, "home", "bin");
    nodeIn(shim);
    // three spellings of the launcher directory, and a link elsewhere to a launcher inside it
    symlinkSync(shim, join(root, "linked"));
    mkdirSync(join(root, "elsewhere"));
    symlinkSync(join(shim, "node"), join(root, "elsewhere", "node"));
    const real = nodeIn(join(root, "real"));
    // another host's launcher directory, whose `node` is a link to a real one: what runs is
    // outside it, and the path that names it is still inside a directory a host empties
    const other = join(root, "other-home", "bin");
    mkdirSync(other, { recursive: true });
    symlinkSync(real, join(other, "node"));
    const path = [
      join(root, "linked"),
      `${shim}/`,
      shim,
      other,
      join(root, "elsewhere"),
      join(root, "absent"),
      join(root, "real"),
    ].join(":");
    expect(firstNodeOnPath(path, [shim, other])).toBe(real);

    const asked: string[] = [];
    const chosen = await chooseLauncherRuntime(
      facts({
        electron: "38.2.0",
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        nodeVersion: "22.19.0",
        path,
        shimDirectories: [shim, undefined, other],
        probe: async (command) => {
          asked.push(command);
          return "22.15.0";
        },
      }),
    );
    expect(chosen).toEqual({ runtime: { command: real }, source: "path-node", version: "22.15.0" });
    expect(asked).toEqual([real]);
    expect(JSON.stringify(chosen)).not.toContain("Electron");
  });

  it("case 3 refuses a node that cannot exec in place, one that reports nothing, and a PATH with none — and each is case 4, never Electron", async () => {
    const root = scratch();
    nodeIn(join(root, "old"));
    const electron = {
      electron: "38.2.0",
      execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
      path: join(root, "old"),
    };
    for (const version of ["23.10.0", "22.14.0", undefined, "not a version"]) {
      const chosen = await chooseLauncherRuntime(
        facts({ ...electron, probe: async () => version }),
      );
      expect(chosen.runtime, String(version)).toBeUndefined();
      expect("reason" in chosen ? chosen.reason : "", String(version)).toContain(
        "never the launcher's runtime",
      );
    }
    const none = await chooseLauncherRuntime(facts({ ...electron, path: join(root, "absent") }));
    expect(none).toEqual({
      runtime: undefined,
      reason:
        "fieldd runs under Electron as Node, which is never the launcher's runtime; no node on PATH",
    });
  });

  it("case 2 falls to the PATH when fieldd's own Node is too old to exec in place", async () => {
    const root = scratch();
    const real = nodeIn(join(root, "real"));
    const chosen = await chooseLauncherRuntime(
      facts({ nodeVersion: "22.14.0", path: join(root, "real"), probe: async () => "24.3.0" }),
    );
    expect(chosen).toEqual({ runtime: { command: real }, source: "path-node", version: "24.3.0" });
  });

  it("case 4 — a packaged fieldd (a single executable) has no launcher runtime, whatever its PATH holds", async () => {
    const root = scratch();
    nodeIn(join(root, "real"));
    const chosen = await chooseLauncherRuntime(
      facts({ sea: true, path: join(root, "real"), probe: async () => "26.0.0" }),
    );
    expect(chosen.runtime).toBeUndefined();
    expect("reason" in chosen ? chosen.reason : "").toContain("AR-7j");
  });
});

// ── the words of a refusal ──

describe("the refusal table — VibeField's sentences (AR-7b)", () => {
  const refused = (code: (typeof SPAWN_THROUGH_DECLINE_CODES)[number]) => ({
    code,
    reason: "the adapter's own reason (--bogus)",
    argument: "--bogus",
    providerId: TYPED_PROVIDER,
    command: TYPED_COMMAND,
  });

  it("has ONE sentence for every code the kit defines, each one line inside the kit's bound, naming the command as typed and saying that nothing was started", () => {
    expect(SPAWN_THROUGH_DECLINE_CODES.length).toBeGreaterThan(0);
    const sentences = new Set<string>();
    for (const code of SPAWN_THROUGH_DECLINE_CODES) {
      const words = agentRefusal(refused(code), "Scripted");
      expect(words, code).not.toBe("");
      // the kit's bound leaves it exactly as written: printable, one line, short
      expect(boundSpawnThroughText(words), code).toBe(words);
      expect(words.includes("\n"), code).toBe(false);
      expect(Array.from(words).length, code).toBeLessThanOrEqual(320);
      expect(Array.from(`${TYPED_COMMAND}: ${words}`).length, code).toBeLessThanOrEqual(
        MAX_REFUSAL_MESSAGE_LENGTH,
      );
      expect(words.startsWith(`${TYPED_COMMAND} was not started`), code).toBe(true);
      // DESIGN.md §9: plain, no exclamation, no apology
      expect(words, code).not.toMatch(/!|sorry|apolog|please|oops|unfortunately/iu);
      // and never the kit's own sentence, which is what a missing row would print
      expect(words, code).not.toContain("could not be run as a managed session:");
      sentences.add(words);
      expect(refusalReasonCode(code), code).toMatch(/^[A-Z][A-Z0-9_]*$/u);
    }
    expect(sentences.size).toBe(SPAWN_THROUGH_DECLINE_CODES.length);
  });

  it("names the rejected argument once and quotes the adapter's reason without it; with no argument named it says so", () => {
    expect(agentRefusal(refused("rejected-argument"), "Scripted")).toBe(
      `${TYPED_COMMAND} was not started: a managed session cannot carry --bogus (the adapter's own reason). Run ${TYPED_COMMAND} without it.`,
    );
    expect(
      agentRefusal(
        {
          code: "rejected-argument",
          reason: "it has no managed form",
          providerId: TYPED_PROVIDER,
          command: TYPED_COMMAND,
        },
        "Scripted",
      ),
    ).toBe(
      `${TYPED_COMMAND} was not started: a managed session cannot carry these arguments (it has no managed form). Run ${TYPED_COMMAND} without them.`,
    );
  });

  it("says the agent by the catalog's label, and says that another agent holds the pane", () => {
    expect(agentRefusal(refused("unsupported-agent"), "The Catalog's Name")).toContain(
      "The Catalog's Name does not run as a managed session",
    );
    expect(agentRefusal(refused("terminal-conflict"), "Scripted")).toBe(
      `${TYPED_COMMAND} was not started: another agent is already running in this pane. Quit it first, or open another pane.`,
    );
  });

  it("holds a long or unprintable argument to one bounded line", () => {
    const argument = `${"x".repeat(900)}${ESCAPE}[31m\nsecond line`;
    const words = agentRefusal(
      {
        code: "rejected-argument",
        reason: `${"why ".repeat(200)}(${argument})`,
        argument,
        providerId: TYPED_PROVIDER,
        command: TYPED_COMMAND,
      },
      "Scripted",
    );
    expect(boundSpawnThroughText(words)).toBe(words);
    expect(words.includes("\n")).toBe(false);
    expect(words.includes(ESCAPE)).toBe(false);
    expect(Array.from(words).length).toBeLessThanOrEqual(320);
    expect(words.startsWith(`${TYPED_COMMAND} was not started`)).toBe(true);
    expect(words.endsWith(`Run ${TYPED_COMMAND} without it.`)).toBe(true);
  });
});

// ── the unit box: the real kit and puppeteer's real runtime, no floor ──

const T0 = "2026-09-27T20:00:00.000Z";
const BORN = Date.parse(T0) + 250;

/** The floor's inventory, as a row states it. */
class ListedTerminals implements GatewayTerminals {
  rows: TerminalInfo[] = [];
  observed = true;
  private readonly inventory = new Set<(rows: readonly TerminalInfo[]) => void>();
  private readonly exits = new Set<(event: { sessionId: string }) => void>();
  private readonly births = new Set<(born: { sessionId: string; pid: number | null }) => void>();

  observation(): unknown {
    return this.observed ? { bootId: "boot", generation: 1 } : undefined;
  }
  list(): readonly TerminalInfo[] {
    if (!this.observed) throw new Error("the floor has not been observed");
    return this.rows;
  }
  onInventory(listener: (rows: readonly TerminalInfo[]) => void): () => void {
    this.inventory.add(listener);
    return () => this.inventory.delete(listener);
  }
  onSessionExited(listener: (event: { sessionId: string }) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }
  onSessionBorn(listener: (born: { sessionId: string; pid: number | null }) => void): () => void {
    this.births.add(listener);
    return () => this.births.delete(listener);
  }
  listeners(): number {
    return this.inventory.size + this.exits.size + this.births.size;
  }
  /** the floor lists these now */
  lists(rows: Array<{ sessionId: string; pid?: number; createdAt?: number }>): void {
    this.rows = rows.map((row) => ({
      sessionId: row.sessionId,
      ...(row.pid !== undefined ? { pid: row.pid } : {}),
      createdAt: row.createdAt ?? BORN,
    }));
    for (const listener of [...this.inventory]) listener(this.rows);
  }
  born(sessionId: string, pid: number | null): void {
    for (const listener of [...this.births]) listener({ sessionId, pid });
  }
  exited(sessionId: string): void {
    for (const listener of [...this.exits]) listener({ sessionId });
  }
}

/** The fold, as far as the gateway reaches it. */
class FoldStub implements AgentAdoption {
  adopted: AgentAdoptionInput[] = [];
  withdrawn: Array<{ runtimeRunId: string; reason: string }> = [];
  refuses: Error | undefined;
  identities = 0;

  identity(): ReturnType<AgentAdoption["identity"]> {
    this.identities += 1;
    const creationRequestId = randomUUID();
    let bound: BoundIngress | undefined;
    return {
      creationRequestId,
      ingress: {
        onBound: (b) => {
          bound = b;
        },
      },
      launched: () => ({ creationRequestId, ...(bound !== undefined ? { ingress: bound } : {}) }),
    };
  }
  async adopt(input: AgentAdoptionInput): Promise<void> {
    if (this.refuses !== undefined) throw this.refuses;
    this.adopted.push(input);
  }
  async withdraw(runtimeRunId: string, exit: { reason: string }): Promise<void> {
    this.withdrawn.push({ runtimeRunId, reason: exit.reason });
  }
  /** the runs this fold holds, by terminal: what `release` is asked about */
  held = new Map<string, { pid: number; startedAt: string }>();
  released: string[] = [];
  async release(
    terminalSessionId: string,
    runs: (process: { pid: number; startedAt: string }) => boolean,
  ): Promise<void> {
    const held = this.held.get(terminalSessionId);
    if (held === undefined || runs(held)) return;
    this.held.delete(terminalSessionId);
    this.released.push(terminalSessionId);
    await this.onRelease?.(terminalSessionId);
  }
  onRelease: ((terminalSessionId: string) => Promise<void>) | undefined;
}

interface Logged {
  level: string;
  event: string;
  attrs: Record<string, unknown>;
}
function capturingLogger(into: Logged[]): Logger {
  const at =
    (level: string) =>
    (event: string, _message: string, ...rest: unknown[]): void => {
      const attrs = rest[rest.length - 1];
      into.push({
        level,
        event,
        attrs:
          typeof attrs === "object" && attrs !== null && !(attrs instanceof Error)
            ? (attrs as Record<string, unknown>)
            : {},
      });
    };
  const logger: Logger = {
    child: () => logger,
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    isLevelEnabled: () => true,
  };
  return logger;
}

interface Ledgered {
  mutation: AuditMutation;
  outcome?: AuditMutationOutcome | undefined;
  threw?: boolean;
}

interface LaunchOver {
  argv: string[];
  interactive: boolean;
  providerId: string;
  token: string;
  command: string;
  cwd: string;
}

interface Unit {
  root: string;
  home: string;
  work: string;
  script: TypedScript;
  runtime: AgentRuntime;
  terminals: ListedTerminals;
  fold: FoldStub;
  /** the process table a launch is placed in — the row writes it */
  table: Map<number, ProcessRecord>;
  /** how many times the table was read */
  reads: { count: number };
  /** `ps` fails, or times out, while `now` is set — and for the next `times` reads */
  unread: { now: boolean; times: number };
  catalog: AgentCatalogEntry[];
  logged: Logged[];
  ledger: Ledgered[];
  /** what the kit's functions were called with */
  kit: {
    gateway: Array<Parameters<typeof startSpawnThroughGateway>[0]>;
    materialized: Array<Parameters<typeof materializeShims>[0]>;
    rendezvous: Array<Parameters<typeof writeRendezvous>[1]>;
    hosts: SpawnThroughHost[];
  };
  /** what AR-7d's seam was handed, in order: the answer, then `null` at the stop */
  integrations: Array<ShellIntegration | null>;
  gateway: AgentGatewayService;
  /** a launch request, as a launcher would send it, with the real bearer */
  launch(pid: number, over?: Partial<LaunchOver>): Promise<SpawnThroughResponse | undefined>;
  send(payload: object): Promise<SpawnThroughResponse | undefined>;
}

/** One line to the gateway, one line back — or nothing, when it hung up. */
function ask(port: number, payload: object): Promise<SpawnThroughResponse | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let text = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
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

interface UnitOptions {
  provider?: TypedProviderOptions;
  /** this process's facts for the launcher's runtime, as the row states them */
  runtimeFacts?: Partial<LauncherRuntimeFacts>;
  /** null = no runtime is configured, and the rule's other cases decide */
  launcher?: { command: string } | null;
  shimScript?: string;
  floor?: boolean;
  /** the platform a shell is born on, as the row states it */
  platform?: NodeJS.Platform;
  /** the home takes this long to write (a slow disk) */
  slowHomeMs?: number;
}

async function unit(options: UnitOptions = {}): Promise<Unit> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-gw-")));
  const work = join(root, "work");
  mkdirSync(work);
  const script = typedScript(join(root, "scripted"));
  const runtime = createAgentRuntime({
    host: noTerminalHost(),
    defaultCwd: work,
    providers: [typedProvider(script, options.provider)],
    creationRegistry: createFileCreationRequestRegistry({ directory: join(root, "runs") }),
  });
  const terminals = new ListedTerminals();
  const fold = new FoldStub();
  const table = new Map<number, ProcessRecord>();
  const reads = { count: 0 };
  const unread = { now: false, times: 0 };
  const catalog = [...TYPED_CATALOG];
  const logged: Logged[] = [];
  const ledger: Ledgered[] = [];
  const kit: Unit["kit"] = { gateway: [], materialized: [], rendezvous: [], hosts: [] };
  const integrations: Unit["integrations"] = [];
  const audit: SystemAudit = async (mutation, effect, describe) => {
    const entry: Ledgered = { mutation };
    ledger.push(entry);
    try {
      const value = await effect();
      entry.outcome = describe?.(value);
      return value;
    } catch (error) {
      entry.threw = true;
      throw error;
    }
  };
  const gateway = new AgentGatewayService({
    userRoot: root,
    runtime,
    catalog: createAgentCatalogReaders(catalog),
    terminals: () => (options.floor === false ? null : terminals),
    fold,
    executables: () => new Map(),
    shimScript: options.shimScript ?? shimScript,
    ...(options.launcher === null
      ? {}
      : { launcher: options.launcher ?? { command: process.execPath } }),
    ...(options.runtimeFacts !== undefined ? { runtimeFacts: options.runtimeFacts } : {}),
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    onShellIntegration: (integration) => integrations.push(integration),
    processTable: async () => {
      reads.count += 1;
      if (unread.times > 0) {
        unread.times -= 1;
        return undefined;
      }
      return unread.now ? undefined : table;
    },
    kit: {
      startSpawnThroughGateway: (given) => {
        kit.gateway.push(given);
        return startSpawnThroughGateway(given);
      },
      materializeShims: async (given) => {
        kit.materialized.push(given);
        if (options.slowHomeMs !== undefined) await sleep(options.slowHomeMs);
        return materializeShims(given);
      },
      writeRendezvous: (home, given) => {
        kit.rendezvous.push(given);
        return writeRendezvous(home, given);
      },
      prepareSpawnThroughLaunch: (request, host) => {
        kit.hosts.push(host);
        return prepareSpawnThroughLaunch(request, host);
      },
    },
    audit,
    logger: capturingLogger(logged),
  });
  cleanup.push(async () => {
    await gateway.stop();
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const send = async (payload: object): Promise<SpawnThroughResponse | undefined> => {
    const port = gateway.state().port;
    if (port === undefined) throw new Error("the gateway is not listening");
    return ask(port, payload);
  };
  return {
    root,
    home: agentShimHome(root),
    work,
    script,
    runtime,
    terminals,
    fold,
    table,
    reads,
    unread,
    catalog,
    logged,
    ledger,
    kit,
    integrations,
    gateway,
    send,
    launch: async (pid, over = {}) => {
      const rendezvous = await readRendezvous(agentShimHome(root));
      return send({
        type: "launch",
        token: over.token ?? rendezvous?.token ?? "no-rendezvous",
        providerId: over.providerId ?? TYPED_PROVIDER,
        cwd: over.cwd ?? work,
        argv: over.argv ?? [],
        environment: {},
        pid,
        parentPid: 1,
        command: over.command ?? TYPED_COMMAND,
        interactive: over.interactive ?? true,
      });
    },
  };
}

const proc = (
  pid: number,
  parentPid: number,
  startedAt: string | undefined = T0,
): ProcessRecord => ({ pid, parentPid, startedAt });

/** One pane: session `s1`, its shell pid 500, and a launcher (600) typed at its prompt. */
function onePane(box: Unit): void {
  box.terminals.lists([{ sessionId: "s1", pid: 500 }]);
  box.table.set(500, proc(500, 77));
  box.table.set(600, proc(600, 500, "2026-09-27T20:05:00.000Z"));
}

const withheldSaid = (box: Unit): Logged[] =>
  box.logged.filter((entry) => entry.event === "fieldd.agents.gateway_launcher_withheld");

// ── the offered set ──

describe("who is given a launcher — the offered set (AR-7b)", () => {
  it("offers a launcher to an agent the catalog shows, whose row offers invoke, whose adapter classifies and whose executable is real — and to no other", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-offer-")));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const script = typedScript(join(root, "scripted"));
    const shimDirectory = join(root, "home", "bin");
    mkdirSync(shimDirectory, { recursive: true });
    const inShim = join(shimDirectory, "inside");
    writeFileSync(inShim, "#!/bin/sh\n", { mode: 0o755 });
    const notExecutable = join(root, "plain-file");
    writeFileSync(notExecutable, "", { mode: 0o644 });

    const launch = (id: string, over: Record<string, unknown> = {}, name = `run-${id}`) => ({
      id,
      label: id,
      resume: true,
      nativeInvocation: {
        commands: [{ name, executable: script.real }],
        environmentVariables: [],
        classifies: true,
        ...over,
      },
    });
    const offers = {
      spawn: true,
      resume: true,
      reattach: false,
      history: false,
      usage: false,
      distribution: false,
      personas: false,
      invoke: true,
    };
    const row = (id: string, over: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry => ({
      id,
      label: `The ${id}`,
      status: "preview",
      seams: { puppeteer: { provider: id }, rosetta: null },
      layoutRoot: null,
      offers,
      admitted: "2026-09-27",
      decision: "test fixture",
      surfaces: { desktop: true, phone: false },
      ...over,
    });
    const catalog = createAgentCatalogReaders([
      row("good"),
      row("bound"),
      row("declined", { status: "declined" }),
      row("deprecated", { status: "deprecated" }),
      row("uninvoked", { offers: { ...offers, invoke: false } }),
      row("unclassified"),
      row("silent"),
      row("bare"),
      row("gone"),
      row("plain"),
      row("looping"),
      row("reserved"),
      row("second"),
      row("grammarless"),
      // "rowless" has no row at all
    ]);
    const offered = offeredLaunch({
      launchProviders: [
        launch("good"),
        launch("bound", { commands: [{ name: "run-bound", executable: "bound-by-name" }] }),
        launch("declined"),
        launch("deprecated"),
        launch("uninvoked"),
        launch("unclassified", { classifies: false }),
        launch("silent", { classifies: undefined }),
        launch("bare", { commands: [{ name: "run-bare", executable: "bare-name" }] }),
        launch("gone", { commands: [{ name: "run-gone", executable: join(root, "absent") }] }),
        launch("plain", { commands: [{ name: "run-plain", executable: notExecutable }] }),
        launch("looping", { commands: [{ name: "run-looping", executable: inShim }] }),
        launch("reserved", {}, "ai"),
        // the name `run-good` is taken: one launcher, one agent
        launch("second", {}, "run-good"),
        launch("rowless"),
        { id: "grammarless", label: "grammarless", resume: true },
      ] as Parameters<typeof offeredLaunch>[0]["launchProviders"],
      catalog,
      // the install inventory's word replaces the adapter's own
      executables: new Map([["bound", script.real]]),
      shimDirectory,
    });
    expect(offered.names).toEqual(["run-good", "run-bound", "run-deprecated"]);
    expect(offered.providers.map((provider) => provider.id)).toEqual([
      "good",
      "bound",
      "deprecated",
    ]);
    for (const provider of offered.providers) {
      for (const command of provider.nativeInvocation?.commands ?? []) {
        expect(command.executable, provider.id).toBe(script.real);
      }
    }
    expect(offered.withheld).toEqual([
      { provider: "declined", why: "not-visible" },
      { provider: "uninvoked", why: "no-invoke" },
      { provider: "unclassified", why: "does-not-classify" },
      { provider: "silent", why: "does-not-classify" },
      { provider: "bare", why: "no-executable" },
      { provider: "gone", why: "no-executable" },
      { provider: "plain", why: "no-executable" },
      { provider: "looping", why: "no-executable" },
      { provider: "reserved", why: "no-name" },
      { provider: "second", why: "no-name" },
      { provider: "rowless", why: "not-visible" },
      { provider: "grammarless", why: "no-grammar" },
    ]);
  });

  it(
    "asks for the install of no agent that would get no launcher anyway; with nothing to offer and nothing of ours on the device, nothing is written and nothing listens",
    async () => {
      const asked: string[][] = [];
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-ask-")));
      const script = typedScript(join(root, "scripted"));
      const runtime = createAgentRuntime({
        host: noTerminalHost(),
        defaultCwd: root,
        providers: [typedProvider(script, { classifies: false })],
      });
      const gateway = new AgentGatewayService({
        userRoot: root,
        runtime,
        catalog: createAgentCatalogReaders(TYPED_CATALOG),
        terminals: () => new ListedTerminals(),
        fold: new FoldStub(),
        executables: (providers) => {
          asked.push([...providers]);
          return new Map();
        },
        shimScript,
        launcher: { command: process.execPath },
      });
      cleanup.push(async () => {
        await gateway.stop();
        await runtime.dispose();
        rmSync(root, { recursive: true, force: true });
      });
      await gateway.start();
      await gateway.refresh();
      expect(asked).toEqual([]);
      expect(gateway.state().listening).toBe(false);
      expect(existsSync(agentShimHome(root))).toBe(false);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "the install inventory is asked for exactly the agents that passed the catalog and the adapter, and its word names the launcher's executable",
    async () => {
      const asked: string[][] = [];
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-ask-")));
      const script = typedScript(join(root, "scripted"));
      const installed = join(root, "installed");
      writeFileSync(installed, "#!/bin/sh\n", { mode: 0o755 });
      const runtime = createAgentRuntime({
        host: noTerminalHost(),
        defaultCwd: root,
        // the adapter names its command the way an adapter does with nothing configured: bare
        providers: [typedProvider(script, { executable: "vf-scripted" })],
      });
      const gateway = new AgentGatewayService({
        userRoot: root,
        runtime,
        catalog: createAgentCatalogReaders(TYPED_CATALOG),
        terminals: () => new ListedTerminals(),
        fold: new FoldStub(),
        executables: async (providers) => {
          asked.push([...providers]);
          return new Map([[TYPED_PROVIDER, installed]]);
        },
        shimScript,
        launcher: { command: process.execPath },
      });
      cleanup.push(async () => {
        await gateway.stop();
        await runtime.dispose();
        rmSync(root, { recursive: true, force: true });
      });
      await gateway.start();
      expect(asked).toEqual([[TYPED_PROVIDER]]);
      expect(
        (await readLaunchProviders(agentShimHome(root)))?.[0]?.nativeInvocation?.commands,
      ).toEqual([{ name: TYPED_COMMAND, executable: installed }]);
    },
    PROCESS_BUDGET_MS,
  );
});

describe("the executable a launcher names — the install the runtime itself launches (AR-7b)", () => {
  const install = (over: Partial<AgentInstallation>): AgentInstallation => ({
    provider: "claude",
    executable: "/Users/test/.local/bin/agent",
    realPath: "/Users/test/.local/share/agent/versions/2.1.0",
    version: "2.1.0",
    method: "native-installer",
    autoUpdate: "enabled",
    detectedAt: "2026-09-27T09:00:00.000Z",
    warnings: [],
    origin: "path",
    active: true,
    ...over,
  });

  it("answers the ACTIVE install's absolute path for the agents asked, reads no other agent's install, and answers nothing for an agent with none", async () => {
    const asked: Array<string | undefined> = [];
    const installs: AgentInstallation[] = [
      install({ provider: "claude", active: false, executable: "/opt/other/agent" }),
      install({ provider: "claude" }),
      // configured by a bare name: the file that runs is what a launcher can name
      install({ provider: "codex", executable: "agent-by-name", realPath: "/opt/bin/agent-real" }),
      install({ provider: "pi", active: false }),
    ];
    const service = new AgentDistributionService({
      runtime: {
        inspectInstallations: async (request: { providerId?: string } = {}) => {
          asked.push(request.providerId);
          return installs.filter((found) => found.provider === request.providerId);
        },
      } as unknown as AgentRuntime,
      catalog: AGENT_CATALOG_READERS,
      store: null,
      revealPath: () => null,
      now: () => new Date(),
      logger: capturingLogger([]),
    });
    const answered = await service.launchExecutables([
      "claude",
      "codex",
      "pi",
      "not-in-the-catalog",
    ]);
    expect([...answered]).toEqual([
      ["claude", "/Users/test/.local/bin/agent"],
      ["codex", "/opt/bin/agent-real"],
    ]);
    // an agent the catalog does not show is never read; nor is any agent nobody asked about
    expect(asked).toEqual(["claude", "codex", "pi"]);
    expect([...(await service.launchExecutables([]))]).toEqual([]);
    expect(asked.length).toBe(3);
  });
});

// ── start, refresh, stop ──

describe("the gateway's start, refresh and stop (AR-7b)", () => {
  it(
    "start writes the home the kit's way — 0700 directories, 0600 files, one launcher per offered name naming the real executable — and is idempotent",
    async () => {
      const box = await unit();
      onePane(box);
      await Promise.all([box.gateway.start(), box.gateway.start()]);
      await box.gateway.start();
      expect(box.kit.gateway.length).toBe(1);
      const layout = spawnThroughLayout(box.home);
      expect(box.gateway.state()).toMatchObject({
        home: box.home,
        listening: true,
        names: [TYPED_COMMAND],
        launcher: { command: process.execPath, source: "configured" },
      });
      expect([...box.gateway.launchers()]).toEqual([TYPED_PROVIDER]);
      for (const directory of [box.home, layout.shimDirectory, dirname(layout.script)])
        expect(mode(directory), directory).toBe(0o700);
      for (const file of ["gateway.json", "launch-providers.json", "terminals.json"])
        expect(mode(join(box.home, file)), file).toBe(0o600);
      expect(mode(layout.script)).toBe(0o600);
      expect(readFileSync(layout.script).equals(readFileSync(shimScript))).toBe(true);
      expect(readdirSync(layout.shimDirectory)).toEqual([TYPED_COMMAND]);
      expect(mode(join(layout.shimDirectory, TYPED_COMMAND))).toBe(0o700);

      const table = await readLaunchProviders(box.home);
      expect(table?.map((provider) => provider.id)).toEqual([TYPED_PROVIDER]);
      expect(table?.[0]?.nativeInvocation?.commands).toEqual([
        { name: TYPED_COMMAND, executable: box.script.real },
      ]);
      const rendezvous = await readRendezvous(box.home);
      expect(rendezvous).toMatchObject({ port: box.gateway.state().port, pid: process.pid });
      // a fresh 32-byte bearer, in the file and nowhere else
      expect(rendezvous?.token).toMatch(/^[0-9a-f]{64}$/u);
      const bearer = rendezvous?.token ?? "";
      expect(JSON.stringify(box.logged)).not.toContain(bearer);
      expect(JSON.stringify(box.gateway.state())).not.toContain(bearer);
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "the four places strictness lives say the same word, and both places the host is named say the same name",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      await box.launch(600, { argv: ["--version"] });
      const launcher = readFileSync(
        join(spawnThroughLayout(box.home).shimDirectory, TYPED_COMMAND),
        "utf8",
      );
      const rendezvous = JSON.parse(readFileSync(join(box.home, "gateway.json"), "utf8")) as {
        strict: boolean;
        hostLabel: string;
      };
      const strict = {
        host: box.kit.hosts[0]?.strict,
        gateway: box.kit.gateway[0]?.strict,
        rendezvous: rendezvous.strict,
        launcher: /PUPPETEER_SHIM_STRICT='([01])'/u.exec(launcher)?.[1] === "1",
      };
      expect(strict).toEqual({
        host: AGENT_GATEWAY_STRICT,
        gateway: AGENT_GATEWAY_STRICT,
        rendezvous: AGENT_GATEWAY_STRICT,
        launcher: AGENT_GATEWAY_STRICT,
      });
      expect(AGENT_GATEWAY_STRICT).toBe(true);
      const label = {
        rendezvous: rendezvous.hostLabel,
        launcher: /PUPPETEER_SHIM_LABEL='([^']*)'/u.exec(launcher)?.[1],
      };
      expect(label).toEqual({
        rendezvous: AGENT_GATEWAY_HOST_LABEL,
        launcher: AGENT_GATEWAY_HOST_LABEL,
      });
      // a proper name: it reads inside the shim's own sentences
      expect(AGENT_GATEWAY_HOST_LABEL).toBe("VibeField");
    },
    PROCESS_BUDGET_MS,
  );

  it("the home is under the user's root and never under a temp directory in the product's own layout, under any spelling", () => {
    const product = join(homedir(), "Library", "Application Support", "VibeField", "users", "1");
    const home = agentShimHome(product);
    expect(home).toBe(join(product, "agents", "shims"));
    expect(shimHomeIsDurable(home)).toBe(true);
    expect(shimHomeIsDurable(home, "/var/folders/ab/cdef/T")).toBe(true);
    expect(
      shimHomeIsDurable("/var/folders/ab/cdef/T/godview-agent-shims-1", "/var/folders/ab/cdef/T"),
    ).toBe(false);
    // the temp directory by its other name, and a home not made yet
    const spelled = mkdtempSync(join(tmpdir(), "vf-durable-"));
    cleanup.push(() => rmSync(spelled, { recursive: true, force: true }));
    const real = realpathSync(spelled);
    expect(shimHomeIsDurable(agentShimHome(spelled), dirname(real))).toBe(false);
    expect(shimHomeIsDurable(agentShimHome(real), dirname(spelled))).toBe(false);
    expect(
      shimHomeIsDurable(agentShimHome(join(spelled, "not", "made", "yet")), dirname(real)),
    ).toBe(false);
    // a sibling whose name only begins like it is not inside it
    expect(shimHomeIsDurable("/var/folders/ab/cdef/Tother/shims", "/var/folders/ab/cdef/T")).toBe(
      true,
    );
  });

  it(
    "refresh removes the launcher of a row that stopped offering, gives it back when the row offers again, and heals a home that lost its files",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const launcher = join(spawnThroughLayout(box.home).shimDirectory, TYPED_COMMAND);
      expect(existsSync(launcher)).toBe(true);

      const at = box.catalog.findIndex((row) => row.id === TYPED_PROVIDER);
      const offering = box.catalog[at] as AgentCatalogEntry;
      box.catalog[at] = { ...offering, offers: { ...offering.offers, invoke: false } };
      await box.gateway.refresh();
      expect(existsSync(launcher)).toBe(false);
      expect(box.gateway.state().names).toEqual([]);
      expect([...box.gateway.launchers()]).toEqual([]);
      expect(await readLaunchProviders(box.home)).toEqual([]);
      expect(box.gateway.state().listening).toBe(true);

      box.catalog[at] = offering;
      await box.gateway.refresh();
      expect(existsSync(launcher)).toBe(true);

      // the OS's cleaner took the files and left the directories
      rmSync(launcher);
      rmSync(spawnThroughLayout(box.home).script);
      rmSync(join(box.home, "terminals.json"));
      await box.gateway.refresh();
      expect(existsSync(launcher)).toBe(true);
      expect(existsSync(spawnThroughLayout(box.home).script)).toBe(true);
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
      // one listener and one bearer for the daemon's whole life
      expect(box.kit.gateway.length).toBe(1);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a provider whose install disappears loses its launcher at the next refresh, said once at info by its id",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const launcher = join(spawnThroughLayout(box.home).shimDirectory, TYPED_COMMAND);
      expect(existsSync(launcher)).toBe(true);
      rmSync(box.script.real);
      await box.gateway.refresh();
      expect(existsSync(launcher)).toBe(false);
      await box.gateway.refresh();
      expect(withheldSaid(box)).toEqual([
        {
          level: "info",
          event: "fieldd.agents.gateway_launcher_withheld",
          attrs: { provider: TYPED_PROVIDER, why: "no-executable" },
        },
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "an adapter that does not classify gets no launcher — and the one a former run left for it is removed — said once at info by its id",
    async () => {
      const box = await unit({ provider: { classifies: false } });
      await materializeShims({
        home: box.home,
        names: [TYPED_COMMAND, "stale"],
        script: shimScript,
        runtime: { command: process.execPath },
      });
      onePane(box);
      await box.gateway.start();
      await box.gateway.refresh();
      expect(readdirSync(spawnThroughLayout(box.home).shimDirectory)).toEqual([]);
      expect(box.gateway.state().names).toEqual([]);
      expect(withheldSaid(box)).toEqual([
        {
          level: "info",
          event: "fieldd.agents.gateway_launcher_withheld",
          attrs: { provider: TYPED_PROVIDER, why: "does-not-classify" },
        },
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "with no launcher runtime the gateway still starts, offers NO launcher, removes every one it finds, and says why once",
    async () => {
      const box = await unit({
        launcher: null,
        // a packaged fieldd: a single executable
        runtimeFacts: { sea: true, electron: undefined },
      });
      await materializeShims({
        home: box.home,
        names: [TYPED_COMMAND, "stale"],
        script: shimScript,
        runtime: { command: process.execPath },
        strict: true,
      });
      onePane(box);
      await box.gateway.start();
      await box.gateway.refresh();
      expect(box.gateway.state()).toMatchObject({ listening: true, names: [] });
      expect(box.gateway.state().launcher).toHaveProperty("reason");
      expect([...box.gateway.launchers()]).toEqual([]);
      expect(readdirSync(spawnThroughLayout(box.home).shimDirectory)).toEqual([]);
      expect(await readLaunchProviders(box.home)).toEqual([]);
      const said = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_no_launcher_runtime",
      );
      expect(said.length).toBe(1);
      expect(said[0]?.level).toBe("warn");
      expect(String(said[0]?.attrs["reason"])).toContain("AR-7j");
      expect(withheldSaid(box)).toEqual([]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "with no bundled shim beside the daemon no launcher is offered, and a home that holds one has it removed",
    async () => {
      const box = await unit({ shimScript: join(tmpdir(), "vf-no-such-dir", "agent-shim.cjs") });
      await materializeShims({
        home: box.home,
        names: [TYPED_COMMAND],
        script: shimScript,
        runtime: { command: process.execPath },
      });
      await box.gateway.start();
      await box.gateway.refresh();
      expect(readdirSync(spawnThroughLayout(box.home).shimDirectory)).toEqual([]);
      expect(box.gateway.state().names).toEqual([]);
      const said = box.logged.filter((entry) => entry.event === "fieldd.agents.gateway_no_shim");
      expect(said.map((entry) => entry.level)).toEqual(["warn"]);
    },
    PROCESS_BUDGET_MS,
  );

  it("a daemon with no floor starts no gateway and writes nothing", async () => {
    const box = await unit({ floor: false });
    await box.gateway.start();
    expect(box.gateway.state().listening).toBe(false);
    expect(existsSync(box.home)).toBe(false);
    expect(box.kit.gateway).toEqual([]);
    expect(box.kit.materialized).toEqual([]);
    // and a refresh of a gateway that never came up is nothing
    await box.gateway.refresh();
    expect(existsSync(box.home)).toBe(false);
    expect(box.terminals.listeners()).toBe(0);
  });

  it(
    "stop closes the listener and withdraws ITS rendezvous — the provider table and the list of our shells stay, and a successor's rendezvous is not touched",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const port = box.gateway.state().port as number;
      expect(box.terminals.listeners()).toBe(3);
      await box.gateway.stop();
      expect(box.gateway.state().listening).toBe(false);
      expect(await readRendezvous(box.home)).toBeUndefined();
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
      expect((await readLaunchProviders(box.home))?.length).toBe(1);
      expect(existsSync(join(spawnThroughLayout(box.home).shimDirectory, TYPED_COMMAND))).toBe(
        true,
      );
      expect(await ask(port, { type: "launch" })).toBeUndefined();
      // nothing of the floor's is listened to any more, and a late event writes nothing
      expect(box.terminals.listeners()).toBe(0);
      box.terminals.lists([]);
      await sleep(50);
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
      await box.gateway.stop();

      const next = await unit();
      onePane(next);
      await next.gateway.start();
      // the fieldd that came next has already written its own
      await writeRendezvous(next.home, {
        port: 9,
        token: "the-successor",
        strict: true,
        launchProviders: [],
      });
      await next.gateway.stop();
      expect((await readRendezvous(next.home))?.token).toBe("the-successor");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a launch under way when the stop begins is answered; one that arrives after is left unanswered, for the fieldd that comes next",
    async () => {
      const box = await unit({ provider: { prepareDelayMs: 400 } });
      onePane(box);
      box.table.set(601, proc(601, 500));
      await box.gateway.start();
      const first = box.launch(600);
      await poll(() => (box.fold.identities > 0 ? true : undefined), 5_000);
      const stopped = box.gateway.stop();
      const second = box.launch(601);
      expect(await first).toMatchObject({ action: "exec" });
      expect(await second).toBeUndefined();
      await stopped;
      expect(box.fold.adopted.length).toBe(1);
      expect(box.fold.identities).toBe(1);
    },
    PROCESS_BUDGET_MS,
  );
});

// ── a shell born integrated ──

describe("a shell born integrated — the gateway answers the shell lane's seam (AR-7b × AR-7d)", () => {
  /** fieldd's own environment, as a row states it, for as long as `during` runs. */
  function withEnvironment<T>(over: Record<string, string | undefined>, during: () => T): T {
    const before = Object.keys(over).map((name) => [name, process.env[name]] as const);
    try {
      for (const [name, value] of Object.entries(over)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      return during();
    } finally {
      for (const [name, value] of before) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
  const warned = (box: Unit, event: string): Logged[] =>
    box.logged.filter((entry) => entry.event === event && entry.level === "warn");

  it(
    "the seam is handed the answer once the home is written, never twice, and is handed nothing at the stop — and the answer is the kit's own, for the shell being born, over this home, from fieldd's own environment",
    async () => {
      const box = await unit();
      onePane(box);
      const layout = spawnThroughLayout(box.home);
      // before the home is written nobody is handed anything, and a shell is born as before
      expect(box.integrations).toEqual([]);
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeUndefined();
      expect(existsSync(layout.zshenv)).toBe(false);

      await box.gateway.start();
      expect(box.integrations).toEqual([box.gateway.shellIntegration]);
      // what a born shell is pointed at was written BEFORE the seam was handed it
      expect(existsSync(layout.zshenv)).toBe(true);
      expect(existsSync(join(layout.shimDirectory, TYPED_COMMAND))).toBe(true);
      const integration = box.integrations[0] as ShellIntegration;

      withEnvironment({ ZDOTDIR: "/the/persons/own", PATH: "/usr/local/bin:/usr/bin:/bin" }, () => {
        // zsh — the three variables, together; the person's ZDOTDIR is fieldd's own
        expect(integration("/bin/zsh")).toEqual({
          ZDOTDIR: layout.zshDirectory,
          PUPPETEER_ORIGINAL_ZDOTDIR: "/the/persons/own",
          PUPPETEER_SHIM_DIR: layout.shimDirectory,
        });
        // any other shell — the kit's best effort: the launchers, then fieldd's own PATH
        expect(integration("/bin/sh")).toEqual({
          PUPPETEER_SHIM_DIR: layout.shimDirectory,
          PATH: `${layout.shimDirectory}:/usr/local/bin:/usr/bin:/bin`,
        });
        for (const shell of ["/bin/zsh", "-zsh", "/bin/bash", "/opt/homebrew/bin/fish", "/bin/sh"])
          expect(integration(shell), shell).toEqual(
            shellIntegrationEnvironment({ home: box.home, shell, environment: process.env }),
          );
      });
      // the environment is read at every birth, never kept from the start
      withEnvironment({ ZDOTDIR: undefined }, () =>
        expect(integration("/bin/zsh")).toMatchObject({ PUPPETEER_ORIGINAL_ZDOTDIR: "" }),
      );
      // nothing in a daemon's own classes: the terminal service would drop it
      for (const name of Object.keys({ ...integration("/bin/zsh"), ...integration("/bin/sh") }))
        expect(name).not.toMatch(/^FIELDD?_/u);

      await box.gateway.refresh();
      expect(box.integrations.length).toBe(1);

      await box.gateway.stop();
      expect(box.integrations).toEqual([box.gateway.shellIntegration, null]);
      // and whoever kept the answer is told nothing by it
      expect(integration("/bin/zsh")).toBeUndefined();
      expect(integration("/bin/sh")).toBeUndefined();
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "A2 — is handed the answer as soon as the INTEGRATION is written, ahead of the launchers: a shell born while the launchers are still being written is born integrated, and finds the launcher at its next lookup",
    async () => {
      const box = await unit({ slowHomeMs: 800 });
      onePane(box);
      const layout = spawnThroughLayout(box.home);
      const started = box.gateway.start();
      await poll(() => (box.kit.materialized.length > 0 ? true : undefined), 5_000);
      // the launchers are being written (slowly): the offered set is decided and no
      // launcher stands yet — but the integration does, and the seam has it
      expect(box.gateway.state().names).toEqual([TYPED_COMMAND]);
      expect(existsSync(join(layout.shimDirectory, TYPED_COMMAND))).toBe(false);
      expect(existsSync(layout.zshenv)).toBe(true);
      expect(box.integrations).toEqual([box.gateway.shellIntegration]);
      expect(box.gateway.shellIntegration("/bin/zsh")).toMatchObject({
        ZDOTDIR: layout.zshDirectory,
        PUPPETEER_SHIM_DIR: layout.shimDirectory,
      });
      await started;
      expect(existsSync(join(layout.shimDirectory, TYPED_COMMAND))).toBe(true);
      // handed over once, at the start's first write, and not again for the launchers
      expect(box.integrations).toEqual([box.gateway.shellIntegration]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "B3 — on win32 nothing is written and nothing offered: no home, no launcher, no listener, no rendezvous — the state says why, the seam is handed nothing and answers nothing, a refresh writes nothing either, and the stop has nothing to close",
    async () => {
      const box = await unit({ platform: "win32" });
      onePane(box);
      await box.gateway.start();
      expect(existsSync(box.home)).toBe(false);
      expect(box.gateway.state()).toEqual({
        home: box.home,
        listening: false,
        names: [],
        launcher: {
          reason: "the launchers are POSIX only: the shim execs in place, which win32 cannot",
        },
      });
      // what `agent.providers` reads to withdraw `invoke`: no launcher stands for anyone
      expect(box.gateway.launchers().size).toBe(0);
      expect(box.kit.materialized).toEqual([]);
      expect(box.kit.gateway).toEqual([]);
      expect(box.kit.rendezvous).toEqual([]);
      expect(box.integrations).toEqual([]);
      for (const shell of ["C:\\Windows\\System32\\cmd.exe", "/bin/zsh", "/bin/sh"])
        expect(box.gateway.shellIntegration(shell), shell).toBeUndefined();
      const said = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_unsupported_platform",
      );
      expect(said.map((entry) => entry.level)).toEqual(["info"]);
      expect(said[0]?.attrs).toEqual({ platform: "win32" });
      await box.gateway.refresh();
      expect(existsSync(box.home)).toBe(false);
      expect(box.kit.materialized).toEqual([]);
      expect(box.gateway.state().names).toEqual([]);
      await box.gateway.stop();
      expect(box.integrations).toEqual([null]);
      expect(existsSync(box.home)).toBe(false);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "A2 — answers wherever the integration stands, launcher or none — a former boot's home written again and emptied of launchers, a row that stopped offering — since a launcher that lands later is found by a shell born before it; and answers nothing only where no home is written at all: nothing to offer from, and nothing of ours on the device",
    async () => {
      // no program can run a launcher; a former boot's home is written again, emptied of
      // launchers — and still points a shell at itself
      const packaged = await unit({
        launcher: null,
        runtimeFacts: { sea: true, electron: undefined },
      });
      await materializeShims({
        home: packaged.home,
        names: [TYPED_COMMAND],
        script: shimScript,
        runtime: { command: process.execPath },
        strict: true,
      });
      onePane(packaged);
      await packaged.gateway.start();
      const packagedLayout = spawnThroughLayout(packaged.home);
      expect(packaged.gateway.state().names).toEqual([]);
      expect(existsSync(join(packagedLayout.shimDirectory, TYPED_COMMAND))).toBe(false);
      expect(existsSync(packagedLayout.zshenv)).toBe(true);
      expect(packaged.integrations).toEqual([packaged.gateway.shellIntegration]);
      expect(packaged.gateway.shellIntegration("/bin/zsh")).toMatchObject({
        ZDOTDIR: packagedLayout.zshDirectory,
      });
      expect(packaged.gateway.shellIntegration("/bin/sh")).toMatchObject({
        PUPPETEER_SHIM_DIR: packagedLayout.shimDirectory,
      });

      // nothing to offer from and nothing of ours on the device: nothing written, nothing handed over
      const unoffered = await unit({ provider: { classifies: false } });
      onePane(unoffered);
      await unoffered.gateway.start();
      expect(existsSync(unoffered.home)).toBe(false);
      expect(unoffered.integrations).toEqual([]);
      expect(unoffered.gateway.shellIntegration("/bin/zsh")).toBeUndefined();

      // a row that stops offering takes its launcher and not the answer: a shell born
      // meanwhile is managed the moment the row offers again and the launcher is written back
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const layout = spawnThroughLayout(box.home);
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeDefined();
      const at = box.catalog.findIndex((row) => row.id === TYPED_PROVIDER);
      const offering = box.catalog[at] as AgentCatalogEntry;
      box.catalog[at] = { ...offering, offers: { ...offering.offers, invoke: false } };
      await box.gateway.refresh();
      expect(box.gateway.state().names).toEqual([]);
      expect(existsSync(join(layout.shimDirectory, TYPED_COMMAND))).toBe(false);
      expect(box.gateway.shellIntegration("/bin/zsh")).toMatchObject({
        ZDOTDIR: layout.zshDirectory,
      });
      expect(box.gateway.shellIntegration("/bin/sh")).toMatchObject({
        PUPPETEER_SHIM_DIR: layout.shimDirectory,
      });
      box.catalog[at] = offering;
      await box.gateway.refresh();
      expect(box.gateway.state().names).toEqual([TYPED_COMMAND]);
      expect(existsSync(join(layout.shimDirectory, TYPED_COMMAND))).toBe(true);
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeDefined();
      // the seam was handed the answer once, whatever the launchers did since
      expect(box.integrations).toEqual([box.gateway.shellIntegration]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a home that lost the integration's file points no shell at it — said once, at warn — until the launchers are written again",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const layout = spawnThroughLayout(box.home);
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeDefined();
      // the OS's cleaner took the file and left the directory
      rmSync(layout.zshenv);
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeUndefined();
      expect(box.gateway.shellIntegration("/bin/sh")).toBeUndefined();
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeUndefined();
      const said = warned(box, "fieldd.agents.gateway_shell_integration_lost");
      expect(said.length).toBe(1);
      expect(said[0]?.attrs).toEqual({ home: box.home });
      await box.gateway.refresh();
      expect(existsSync(layout.zshenv)).toBe(true);
      expect(box.gateway.shellIntegration("/bin/zsh")).toMatchObject({
        ZDOTDIR: layout.zshDirectory,
      });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "never throws: what the kit cannot answer is a shell born as before, said at warn",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      // no shell at all: the kit reads its name and throws
      const nothing = undefined as unknown as string;
      expect(() => box.gateway.shellIntegration(nothing)).not.toThrow();
      expect(box.gateway.shellIntegration(nothing)).toBeUndefined();
      expect(() =>
        shellIntegrationEnvironment({ home: box.home, shell: nothing, environment: process.env }),
      ).toThrow();
      const said = warned(box, "fieldd.agents.gateway_shell_integration_failed");
      expect(said.length).toBe(2);
      expect(Object.keys(said[0]?.attrs ?? {})).toEqual(["error"]);
      // and the next shell is answered
      expect(box.gateway.shellIntegration("/bin/zsh")).toBeDefined();
    },
    PROCESS_BUDGET_MS,
  );
});

// ── our shells ──

describe("the list of our shells — terminals.json (AR-7b)", () => {
  const listed = async (home: string, expected: number[]): Promise<void> => {
    const pids = async (): Promise<number[] | undefined> =>
      (await readTerminals(home))?.map((shell) => shell.pid);
    await poll(
      async () => (JSON.stringify(await pids()) === JSON.stringify(expected) ? true : undefined),
      5_000,
    ).catch(async () => {
      expect(await pids()).toEqual(expected);
    });
  };

  it(
    "lists the shell of every session the floor lists at the start, each with its start as the process table reads it — and never a session whose process is gone or whose pid a later process holds",
    async () => {
      const box = await unit();
      box.terminals.lists([
        { sessionId: "alive", pid: 500 },
        // the floor keeps this session after its process ended
        { sessionId: "husk", pid: 510 },
        // … and this one's pid was given to a process that started an hour later
        { sessionId: "reused", pid: 520 },
        { sessionId: "pidless" },
      ]);
      box.table.set(500, proc(500, 77));
      box.table.set(520, proc(520, 1, "2026-09-27T21:00:00.000Z"));
      await box.gateway.start();
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
      // only what the floor lists as a shell: never fieldd itself
      box.table.set(process.pid, proc(process.pid, 1));
      expect(JSON.stringify(await readTerminals(box.home))).not.toContain(String(process.pid));
    },
    PROCESS_BUDGET_MS,
  );

  it("a shell's start stands with its session's birth or it is not that session's shell", () => {
    expect(startedWithSession(T0, Date.parse(T0))).toBe(true);
    expect(startedWithSession(T0, Date.parse(T0) + 59_000)).toBe(true);
    expect(startedWithSession(T0, Date.parse(T0) - 59_000)).toBe(true);
    expect(startedWithSession(T0, Date.parse(T0) + 61_000)).toBe(false);
    expect(startedWithSession(T0, Date.parse(T0) - 61_000)).toBe(false);
    expect(startedWithSession("not a time", Date.parse(T0))).toBe(false);
    // a floor that did not say when the session was born cannot be doubted this way
    expect(startedWithSession(T0, undefined)).toBe(true);
  });

  it(
    "is written again at a birth (before the inventory lists it), at an exit, and when a session leaves the inventory",
    async () => {
      const box = await unit();
      onePane(box);
      box.table.set(700, proc(700, 77, "2026-09-27T20:10:00.000Z"));
      box.table.set(800, proc(800, 77, "2026-09-27T20:20:00.000Z"));
      await box.gateway.start();
      await listed(box.home, [500]);

      box.terminals.born("s2", 700);
      await listed(box.home, [500, 700]);
      // the inventory catches up, with a third session beside it
      box.terminals.lists([
        { sessionId: "s1", pid: 500 },
        { sessionId: "s2", pid: 700, createdAt: Date.parse("2026-09-27T20:10:00.000Z") },
        { sessionId: "s3", pid: 800, createdAt: Date.parse("2026-09-27T20:20:00.000Z") },
      ]);
      await listed(box.home, [500, 700, 800]);

      // s2's process ends and the floor keeps the session
      box.terminals.exited("s2");
      await listed(box.home, [500, 800]);
      // s3 is closed
      box.terminals.lists([
        { sessionId: "s1", pid: 500 },
        { sessionId: "s2", pid: 700 },
      ]);
      await listed(box.home, [500]);
      expect(await readTerminals(box.home)).toEqual([{ pid: 500, startedAt: T0 }]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "reads a shell's start ONCE — and asks ONCE about a session that has no shell — so an inventory that changed nothing of ours reads and writes nothing",
    async () => {
      const box = await unit();
      onePane(box);
      // beside the pane, a session the floor keeps after its process ended
      const panes = [
        { sessionId: "s1", pid: 500 },
        { sessionId: "husk", pid: 510 },
      ];
      box.terminals.lists(panes);
      await box.gateway.start();
      const reads = box.reads.count;
      expect(reads).toBe(1);
      const written = statSync(join(box.home, "terminals.json")).mtimeMs;
      const text = readFileSync(join(box.home, "terminals.json"), "utf8");
      // a title changed, a directory changed: the floor publishes, our shells are who they were
      for (let n = 0; n < 20; n += 1) {
        box.terminals.lists(panes);
        if (n % 5 === 0) await sleep(10);
      }
      await sleep(150);
      expect(box.reads.count).toBe(reads);
      expect(statSync(join(box.home, "terminals.json")).mtimeMs).toBe(written);
      expect(readFileSync(join(box.home, "terminals.json"), "utf8")).toBe(text);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "serializes its writes: a burst of births and exits leaves the list of the LAST state, never an older one",
    async () => {
      const box = await unit();
      await box.gateway.start();
      for (let pid = 1_000; pid < 1_040; pid += 1) box.table.set(pid, proc(pid, 77));
      for (let count = 1; count <= 40; count += 1) {
        box.terminals.lists(
          Array.from({ length: count }, (_, n) => ({ sessionId: `s${1_000 + n}`, pid: 1_000 + n })),
        );
        if (count % 7 === 0) await sleep(1);
      }
      // and all but three of them end
      box.terminals.lists([
        { sessionId: "s1003", pid: 1_003 },
        { sessionId: "s1017", pid: 1_017 },
        { sessionId: "s1039", pid: 1_039 },
      ]);
      await listed(box.home, [1_003, 1_017, 1_039]);
      await sleep(100);
      expect((await readTerminals(box.home))?.map((shell) => shell.pid)).toEqual([
        1_003, 1_017, 1_039,
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a process table that cannot be read leaves a new shell out — said at warn — and the next change asks again",
    async () => {
      const box = await unit();
      let readable = false;
      const logged: Logged[] = [];
      const failing = new AgentGatewayService({
        userRoot: join(box.root, "second"),
        runtime: box.runtime,
        catalog: createAgentCatalogReaders(box.catalog),
        terminals: () => box.terminals,
        fold: box.fold,
        executables: () => new Map(),
        shimScript,
        launcher: { command: process.execPath },
        // `ps` failed, or timed out
        processTable: async () => (readable ? box.table : undefined),
        logger: capturingLogger(logged),
      });
      cleanup.push(() => failing.stop());
      onePane(box);
      await failing.start();
      const home = agentShimHome(join(box.root, "second"));
      expect(await readTerminals(home)).toEqual([]);
      expect(await failing.resolveTerminal({ pid: 600 })).toBeUndefined();
      expect(
        logged
          .filter((entry) => entry.event === "fieldd.agents.gateway_process_table_unread")
          .map((entry) => entry.level),
      ).toEqual(["warn", "warn"]);
      readable = true;
      box.terminals.lists([{ sessionId: "s1", pid: 500 }]);
      await listed(home, [500]);
      expect(await failing.resolveTerminal({ pid: 600 })).toEqual({ terminalSessionId: "s1" });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "holds the list to the kit's bound: with more shells than it may list, the lowest pids are listed and the rest wait for a place",
    async () => {
      const box = await unit();
      const rows: Array<{ sessionId: string; pid: number }> = [];
      for (let n = 0; n < 1_030; n += 1) {
        const pid = 10_000 + n;
        rows.push({ sessionId: `s${n}`, pid });
        box.table.set(pid, proc(pid, 77));
      }
      box.terminals.lists(rows);
      await box.gateway.start();
      const written = await readTerminals(box.home);
      expect(written?.length).toBe(1_024);
      expect(written?.[0]?.pid).toBe(10_000);
      expect(written?.[1_023]?.pid).toBe(11_023);
      // the shells above the bound are ours all the same: one of them ends,
      // and a place opens for the next
      box.terminals.exited("s0");
      await listed(
        box.home,
        rows.slice(1, 1_025).map((row) => row.pid),
      );
    },
    PROCESS_BUDGET_MS,
  );
});

// ── the ancestor walk ──

describe("which of our terminals holds a process — the ancestor walk (AR-7b)", () => {
  it(
    "answers the session whose shell is the process's parent, or an ancestor through a nested shell; reads the table once per question; and what a request SAYS its parent is decides nothing",
    async () => {
      const box = await unit();
      box.terminals.lists([
        { sessionId: "s1", pid: 500 },
        { sessionId: "s2", pid: 501 },
      ]);
      box.table.set(500, proc(500, 77));
      box.table.set(501, proc(501, 77));
      // typed at s1's prompt
      box.table.set(600, proc(600, 500));
      // s2: the shell ran a shell that ran a script that ran the launcher
      box.table.set(610, proc(610, 501));
      box.table.set(611, proc(611, 610));
      box.table.set(612, proc(612, 611));
      await box.gateway.start();

      const before = box.reads.count;
      expect(await box.gateway.resolveTerminal({ pid: 600, parentPid: 500 })).toEqual({
        terminalSessionId: "s1",
      });
      expect(box.reads.count).toBe(before + 1);
      expect(await box.gateway.resolveTerminal({ pid: 612, parentPid: 611 })).toEqual({
        terminalSessionId: "s2",
      });
      // B1 — the shell itself is never placed: the shell is never the agent
      expect(await box.gateway.resolveTerminal({ pid: 501 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 600, parentPid: 501 })).toEqual({
        terminalSessionId: "s1",
      });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "answers nothing for a process in no terminal of ours, for one the table does not hold, across a cycle, and past the walk's bound — logged at info with the pid and nothing else",
    async () => {
      const box = await unit();
      onePane(box);
      // an editor's terminal: started from a pane once, re-parented since
      box.table.set(700, proc(700, 1));
      box.table.set(701, proc(701, 700));
      // a cycle no real table has, which must still end
      box.table.set(800, proc(800, 801));
      box.table.set(801, proc(801, 800));
      // a chain under our shell, 40 deep
      for (let depth = 1; depth <= 40; depth += 1) {
        box.table.set(2_000 + depth, proc(2_000 + depth, depth === 1 ? 500 : 1_999 + depth));
      }
      await box.gateway.start();
      expect(await box.gateway.resolveTerminal({ pid: 701 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 800 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 424_242 })).toBeUndefined();
      // the kit walks 32 processes, the asking one among them
      expect(await box.gateway.resolveTerminal({ pid: 2_031 })).toEqual({
        terminalSessionId: "s1",
      });
      expect(await box.gateway.resolveTerminal({ pid: 2_032 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 2_040 })).toBeUndefined();

      const outside = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_outside_our_terminals",
      );
      expect(outside.map((entry) => entry.level)).toEqual(Array(5).fill("info"));
      expect(outside.map((entry) => entry.attrs)).toEqual([
        { pid: 701 },
        { pid: 800 },
        { pid: 424_242 },
        { pid: 2_032 },
        { pid: 2_040 },
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "an exited session's pid owns nothing: not while the floor still lists the session, and not when a later process holds the pid",
    async () => {
      const box = await unit();
      box.terminals.lists([
        { sessionId: "ended", pid: 900 },
        { sessionId: "reused", pid: 950 },
        { sessionId: "witnessed", pid: 960 },
      ]);
      // 900 is gone, and the table still names it as a parent
      box.table.set(901, proc(901, 900));
      // 950 belongs to a process that started long after the session was born
      box.table.set(950, proc(950, 1, "2026-09-28T09:00:00.000Z"));
      box.table.set(951, proc(951, 950));
      box.table.set(960, proc(960, 77));
      box.table.set(961, proc(961, 960));
      await box.gateway.start();
      expect(await box.gateway.resolveTerminal({ pid: 901 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 951 })).toBeUndefined();
      expect(await box.gateway.resolveTerminal({ pid: 961 })).toEqual({
        terminalSessionId: "witnessed",
      });
      // the floor says that session's process ended; it keeps listing the session
      box.terminals.exited("witnessed");
      expect(await box.gateway.resolveTerminal({ pid: 961 })).toBeUndefined();
      // … and a shell whose pid the system hands on LATER is not matched either: a start is its own
      box.terminals.lists([{ sessionId: "s1", pid: 500 }]);
      box.table.set(500, proc(500, 77));
      box.table.set(600, proc(600, 500));
      expect(await box.gateway.resolveTerminal({ pid: 600 })).toEqual({ terminalSessionId: "s1" });
      box.table.set(500, proc(500, 1, "2026-09-27T20:00:30.000Z"));
      expect(await box.gateway.resolveTerminal({ pid: 600 })).toBeUndefined();
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "places a launch in a shell born a moment ago, which the inventory has not listed yet",
    async () => {
      const box = await unit();
      box.terminals.lists([]);
      await box.gateway.start();
      box.table.set(500, proc(500, 77));
      box.table.set(600, proc(600, 500));
      expect(await box.gateway.resolveTerminal({ pid: 600 })).toBeUndefined();
      box.terminals.born("s1", 500);
      expect(await box.gateway.resolveTerminal({ pid: 600 })).toEqual({ terminalSessionId: "s1" });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "before the floor has been observed nobody can say, and nothing throws",
    async () => {
      const box = await unit();
      box.terminals.observed = false;
      box.table.set(500, proc(500, 77));
      box.table.set(600, proc(600, 500));
      await box.gateway.start();
      expect(await box.gateway.resolveTerminal({ pid: 600 })).toBeUndefined();
    },
    PROCESS_BUDGET_MS,
  );
});

// ── a launch ──

describe("a launch at the gateway — the real kit, puppeteer's real runtime, a request on the socket (AR-7b)", () => {
  const refusals = (box: Unit): Ledgered[] =>
    box.ledger.filter((entry) => entry.mutation.action === "agent.session.adopt_refused");
  const adoptions = (box: Unit): Ledgered[] =>
    box.ledger.filter((entry) => entry.mutation.action === "agent.session.adopt");

  it(
    "a session typed in one of our panes is ADOPTED: the run enters the fold with its process, its physical cwd and the identity a spawn is given, inside the audited act — and the answer is the adapter's recipe",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      // the request names the directory through a link
      const linked = join(box.root, "linked-work");
      symlinkSync(box.work, linked);
      const answer = await box.launch(600, { cwd: linked });
      expect(answer).toMatchObject({ action: "exec" });
      if (answer?.action !== "exec") throw new Error("not adopted");
      expect(answer.launch.command).toBe("/bin/sh");
      expect(answer.launch.args[1]).toContain("exec /bin/cat");

      expect(box.fold.adopted.length).toBe(1);
      const adopted = box.fold.adopted[0] as AgentAdoptionInput;
      expect(adopted.process).toEqual({ pid: 600, startedAt: "2026-09-27T20:05:00.000Z" });
      expect(adopted.cwd).toBe(box.work);
      expect(adopted.info.terminalSessionId).toBe("s1");
      expect(adopted.info.provider.id).toBe(TYPED_PROVIDER);
      // AR-4's identity: the claim, and the ingress the adapter bound BEFORE the launch
      expect(adopted.launched.creationRequestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(adopted.launched.ingress).toEqual(box.script.prepared[0]?.ingress);
      expect(adopted.launched.ingress?.token).toBe("typed-bearer-1");
      expect(box.script.prepared[0]?.adoptedIn).toBe("s1");
      expect(box.runtime.agent("s1")?.info.runtimeRunId).toBe(adopted.info.runtimeRunId);

      expect(adoptions(box)).toEqual([
        {
          mutation: {
            action: "agent.session.adopt",
            target: { kind: "agent-session", id: adopted.info.runtimeRunId },
            attrs: { provider: TYPED_PROVIDER, sessionId: "s1", spawnedBy: "user-shell" },
          },
          outcome: { outcome: "succeeded", attrs: { runtimeEpoch: adopted.info.runtimeEpoch } },
        },
      ]);
      expect(refusals(box)).toEqual([]);
      // what is never kept: the bearer, the ingress's bearer, the directory, a recipe
      const bearer = (await readRendezvous(box.home))?.token ?? "";
      const kept = JSON.stringify([box.ledger, box.logged]);
      expect(kept).not.toContain(bearer);
      expect(kept).not.toContain(box.work);
      expect(kept).not.toContain("linked-work");
      expect(kept).not.toContain("typed-bearer");
      expect(kept).not.toContain("exec /bin/cat");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "what is not a session runs as typed and leaves NOTHING — no row, no preparation, nothing in the ledger — but a count by code",
    async () => {
      const box = await unit();
      onePane(box);
      box.table.set(700, proc(700, 1));
      await box.gateway.start();
      const reads = box.reads.count;
      expect(await box.launch(600, { argv: ["--version"] })).toEqual({
        action: "fallback",
        code: "passthrough",
        reason: "a version query runs no agent",
      });
      expect(await box.launch(600, { argv: ["-p", "say hi"] })).toMatchObject({
        action: "fallback",
        code: "passthrough",
      });
      // a version query never waits on a look at the process table
      expect(box.reads.count).toBe(reads);
      // its output goes to a file: a one-shot run, whatever its arguments say
      expect(await box.launch(600, { interactive: false })).toMatchObject({
        action: "fallback",
        code: "not-interactive",
      });
      expect(await box.launch(600, { interactive: false, argv: ["--bogus"] })).toMatchObject({
        action: "fallback",
        code: "not-interactive",
      });
      // in an editor's terminal: not ours to manage, and not ours to refuse
      expect(await box.launch(700)).toMatchObject({
        action: "fallback",
        code: "outside-host-terminals",
      });
      expect(await box.launch(700, { argv: ["--bogus"] })).toMatchObject({
        action: "fallback",
        code: "outside-host-terminals",
      });
      expect(box.fold.adopted).toEqual([]);
      expect(box.ledger).toEqual([]);
      expect(box.script.prepared).toEqual([]);
      expect(Object.fromEntries(box.gateway.counts())).toEqual({
        passthrough: 2,
        "not-interactive": 2,
        "outside-host-terminals": 2,
      });
      const counted = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_ran_as_typed",
      );
      expect(counted.length).toBe(6);
      expect(counted.every((entry) => entry.level === "debug")).toBe(true);
      expect(counted[1]?.attrs).toEqual({ code: "passthrough", provider: TYPED_PROVIDER });
      expect(JSON.stringify(box.logged)).not.toContain("say hi");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "B1 — the shell is never the agent: a request naming one of our shells' OWN pid is declined `invalid-request` and runs as typed — never placed, nothing prepared, adopted or ledgered, said at warn with the pid and nothing else — while the shell's child is placed and adopted as before",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const answer = await box.launch(500, {
        argv: ["--resume", "conversation-of-the-persons"],
        cwd: join(box.root, "somewhere-private"),
      });
      expect(answer).toEqual({
        action: "fallback",
        code: "invalid-request",
        reason: "the request names a shell of this host's, which is never the agent",
      });
      expect(box.fold.adopted).toEqual([]);
      expect(box.fold.identities).toBe(0);
      expect(box.fold.released).toEqual([]);
      expect(box.script.prepared).toEqual([]);
      expect(box.ledger).toEqual([]);
      const said = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_shell_named",
      );
      expect(said.map((entry) => entry.level)).toEqual(["warn"]);
      expect(said[0]?.attrs).toEqual({ pid: 500 });
      expect(box.logged.filter((entry) => entry.level === "error")).toEqual([]);
      const kept = JSON.stringify(box.logged);
      expect(kept).not.toContain("conversation-of-the-persons");
      expect(kept).not.toContain("somewhere-private");
      expect(Object.fromEntries(box.gateway.counts())).toEqual({ "invalid-request": 1 });
      // the same shell's child is placed and adopted
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
      expect(box.fold.adopted.length).toBe(1);
      expect(box.fold.adopted[0]?.info.terminalSessionId).toBe("s1");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "B2 — a launch while the process table cannot be read: the table is asked ONCE MORE; unread twice, the launch runs as typed — answered fallback (the kit's `outside-host-terminals`, kept) although the host is strict, counted under `table-unread` and never as outside our terminals, said at warn with the pid and nothing else, nothing refused, prepared or recorded — and unread once, it is placed and adopted",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      box.unread.now = true;
      const reads = box.reads.count;
      const answer = await box.launch(600);
      expect(answer).toMatchObject({ action: "fallback", code: "outside-host-terminals" });
      expect(box.reads.count).toBe(reads + 2);
      expect(box.fold.adopted).toEqual([]);
      expect(box.fold.identities).toBe(0);
      expect(box.script.prepared).toEqual([]);
      expect(refusals(box)).toEqual([]);
      expect(box.ledger).toEqual([]);
      const unreadSaid = (): Logged[] =>
        box.logged.filter((entry) => entry.event === "fieldd.agents.gateway_process_table_unread");
      expect(unreadSaid().map((entry) => entry.level)).toEqual(["warn"]);
      expect(unreadSaid()[0]?.attrs).toEqual({ pid: 600 });
      expect(Object.fromEntries(box.gateway.counts())).toEqual({ "table-unread": 1 });
      const counted = box.logged.filter(
        (entry) => entry.event === "fieldd.agents.gateway_ran_as_typed",
      );
      expect(counted.map((entry) => entry.attrs)).toEqual([
        { code: "table-unread", provider: TYPED_PROVIDER },
      ]);
      // unread once and readable at the retry: the same launch is placed, and adopted
      box.unread.now = false;
      box.unread.times = 1;
      const again = box.reads.count;
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
      expect(box.reads.count).toBe(again + 2);
      expect(box.unread.times).toBe(0);
      expect(box.fold.adopted.length).toBe(1);
      expect(Object.fromEntries(box.gateway.counts())).toEqual({ "table-unread": 1 });
      expect(unreadSaid().length).toBe(1);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "what cannot be carried is REFUSED in VibeField's words, naming the argument — and the refusal is in the ledger by its code, without the argument",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const answer = await box.launch(600, { argv: ["--bogus", "and more"] });
      expect(answer).toEqual({
        action: "refuse",
        code: "rejected-argument",
        reason: "the scripted agent has no managed form for it (--bogus)",
        message: `${TYPED_COMMAND} was not started: a managed session cannot carry --bogus (the scripted agent has no managed form for it). Run ${TYPED_COMMAND} without it.`,
        placed: true,
      });
      expect(box.fold.adopted).toEqual([]);
      expect(box.script.prepared).toEqual([]);
      expect(refusals(box)).toEqual([
        {
          mutation: {
            action: "agent.session.adopt_refused",
            target: { kind: "agent-session", id: "pending" },
            reasonCode: "REJECTED_ARGUMENT",
            attrs: { provider: TYPED_PROVIDER, code: "rejected-argument", sessionId: "s1" },
          },
          outcome: { outcome: "denied", reasonCode: "REJECTED_ARGUMENT" },
        },
      ]);
      expect(JSON.stringify([box.ledger, box.logged])).not.toContain("--bogus");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "two agents at once in one pane: the second is refused — another agent is running in this pane — and the first is untouched",
    async () => {
      const box = await unit();
      onePane(box);
      // `a & a`: a second launcher under the same shell
      box.table.set(601, proc(601, 500));
      await box.gateway.start();
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
      // the fold holds that run, and its process runs
      box.fold.held.set("s1", { pid: 600, startedAt: "2026-09-27T20:05:00.000Z" });
      const second = await box.launch(601);
      expect(box.fold.released).toEqual([]);
      expect(second).toMatchObject({
        action: "refuse",
        code: "terminal-conflict",
        placed: true,
        message: `${TYPED_COMMAND} was not started: another agent is already running in this pane. Quit it first, or open another pane.`,
      });
      expect(box.fold.adopted.length).toBe(1);
      expect(box.runtime.agent("s1")?.info.runtimeRunId).toBe(
        box.fold.adopted[0]?.info.runtimeRunId,
      );
      expect(refusals(box).map((entry) => entry.mutation.reasonCode)).toEqual([
        "TERMINAL_CONFLICT",
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a typed run that ENDED in the pane a moment ago gives the pane up before the next launch is adopted there — also when a later process holds its pid — so a name typed again at once is never told the pane is taken",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      // what the real fold does when it lets a run go
      box.fold.onRelease = async (terminalSessionId) => {
        await box.runtime.handleProcessExit(terminalSessionId, {
          exitCode: null,
          signal: null,
          reason: "process-exited",
        });
      };
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
      box.fold.held.set("s1", { pid: 600, startedAt: "2026-09-27T20:05:00.000Z" });
      // the agent quits; its exit has not reached the fold; the name is typed again
      box.table.delete(600);
      box.table.set(602, proc(602, 500, "2026-09-27T20:06:00.000Z"));
      expect(await box.launch(602)).toMatchObject({ action: "exec" });
      expect(box.fold.released).toEqual(["s1"]);
      expect(box.fold.adopted.map((run) => run.process.pid)).toEqual([600, 602]);

      // the same, when the system has handed the pid on: a start is its own
      box.fold.held.set("s1", { pid: 602, startedAt: "2026-09-27T20:06:00.000Z" });
      box.table.set(602, proc(602, 1, "2026-09-27T20:30:00.000Z"));
      box.table.set(603, proc(603, 500, "2026-09-27T20:31:00.000Z"));
      expect(await box.launch(603)).toMatchObject({ action: "exec" });
      expect(box.fold.released).toEqual(["s1", "s1"]);
      // what is not a session, and what is in no pane of ours, asks the fold nothing
      box.fold.held.set("s1", { pid: 1, startedAt: "never" });
      box.table.set(700, proc(700, 1));
      await box.launch(603, { argv: ["--version"] });
      await box.launch(700);
      expect(box.fold.released).toEqual(["s1", "s1"]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a row that stopped offering between the start and the launch is refused in the catalog's words — and what is not a session still runs as typed",
    async () => {
      const box = await unit();
      onePane(box);
      box.table.set(700, proc(700, 1));
      await box.gateway.start();
      const at = box.catalog.findIndex((row) => row.id === TYPED_PROVIDER);
      const offering = box.catalog[at] as AgentCatalogEntry;
      box.catalog[at] = {
        ...offering,
        label: "The Catalog's Name",
        offers: { ...offering.offers, invoke: false },
      };
      const answer = await box.launch(600);
      expect(answer).toMatchObject({
        action: "refuse",
        code: "unsupported-agent",
        placed: true,
        message: `${TYPED_COMMAND} was not started: The Catalog's Name does not run as a managed session on this device now. See Settings → Agents.`,
      });
      expect(box.fold.adopted).toEqual([]);
      expect(box.script.prepared).toEqual([]);
      expect(await box.launch(600, { argv: ["--version"] })).toMatchObject({ action: "fallback" });
      expect(await box.launch(700)).toMatchObject({
        action: "fallback",
        code: "outside-host-terminals",
      });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a store that fails at adoption: the adoption is UNDONE — no run in puppeteer, no row in the fold — and the person is refused in words that quote no error",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      box.fold.refuses = new Error("EACCES: permission denied, open '/secret/path/record.json'");
      const answer = await box.launch(600);
      expect(answer).toEqual({
        action: "refuse",
        code: "adopt-failed",
        reason: "the host could not complete the launch",
        message: `${TYPED_COMMAND} was not started: VibeField could not record it as a managed session. Run ${TYPED_COMMAND} again.`,
        placed: true,
      });
      expect(box.fold.adopted).toEqual([]);
      expect(box.fold.withdrawn.map((entry) => entry.reason)).toEqual(["adopt-failed"]);
      const runtimeRunId = box.fold.withdrawn[0]?.runtimeRunId as string;
      expect(box.runtime.agent("s1")).toBeUndefined();
      expect(box.runtime.agent(runtimeRunId)).toBeUndefined();
      expect(box.runtime.monitorState(runtimeRunId)).toBeUndefined();
      // the pane is free again: the same name typed again is adopted
      box.fold.refuses = undefined;
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
      expect(adoptions(box).map((entry) => entry.threw === true)).toEqual([true, false]);
      expect(refusals(box).map((entry) => entry.mutation.reasonCode)).toEqual(["ADOPT_FAILED"]);
      expect(JSON.stringify(answer)).not.toContain("EACCES");
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "the handler never throws: a door that throws is answered with a coded decline — a refusal in our pane — and the raw message stays in the log",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const real = box.runtime.prepareInvocation;
      box.runtime.prepareInvocation = async () => {
        throw new Error("agent runtime is disposed — at /secret/stack/frame.ts");
      };
      const inOurs = await box.launch(600);
      box.runtime.prepareInvocation = real;
      expect(inOurs).toEqual({
        action: "refuse",
        code: "handler-failed",
        reason: "the host could not complete the launch",
        message: `${TYPED_COMMAND} was not started: VibeField could not take the launch. Run ${TYPED_COMMAND} again; if it happens twice, restart VibeField.`,
        placed: true,
      });
      expect(JSON.stringify(inOurs)).not.toContain("secret");
      expect(
        box.logged.some(
          (entry) =>
            entry.level === "error" && entry.event === "fieldd.agents.gateway_launch_failed",
        ),
      ).toBe(true);
      expect(refusals(box).map((entry) => entry.mutation.reasonCode)).toEqual(["HANDLER_FAILED"]);

      // a door that throws BEFORE the launch was placed: nobody can say it is a session in a
      // pane of ours, so it runs as typed — strict or not — and nothing is refused
      const classify = box.runtime.classifyInvocation;
      box.runtime.classifyInvocation = () => {
        throw new Error("the grammar fell over — at /secret/stack/frame.ts");
      };
      const unplaced = await box.launch(600);
      box.runtime.classifyInvocation = classify;
      expect(unplaced).toEqual({
        action: "fallback",
        code: "handler-failed",
        reason: "the host could not complete the launch",
      });
      expect(refusals(box).length).toBe(1);
      expect(box.fold.identities).toBe(1);
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "exec-failed: the launcher could not run the recipe — the row is withdrawn with that reason, the preparation cancelled, and the pane is free",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const answer = await box.launch(600);
      if (answer?.action !== "exec") throw new Error("not adopted");
      const runtimeRunId = box.fold.adopted[0]?.info.runtimeRunId as string;
      const token = (await readRendezvous(box.home))?.token;
      expect(
        await box.send({
          type: "exec-failed",
          token,
          preparationId: answer.preparationId,
          message: "ENOENT: no such file",
        }),
      ).toEqual({ action: "ack" });
      expect(box.fold.withdrawn).toEqual([{ runtimeRunId, reason: "exec-failed" }]);
      expect(box.runtime.agent("s1")).toBeUndefined();
      // a preparation nobody here adopted is cancelled all the same, and acknowledged
      expect(
        await box.send({ type: "exec-failed", token, preparationId: "unknown", message: "" }),
      ).toEqual({ action: "ack" });
      expect(box.fold.withdrawn.length).toBe(1);
      expect(await box.launch(600)).toMatchObject({ action: "exec" });
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "a wrong bearer gets the kit's own answer — the same for a request of the wrong shape — and nothing of it reaches the fold or the ledger",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const wrong = await box.launch(600, { token: "f".repeat(64) });
      expect(wrong).toMatchObject({
        action: "refuse",
        code: "unauthenticated",
        placed: false,
      });
      const bearer = (await readRendezvous(box.home))?.token;
      expect(await box.send({ type: "launch", token: bearer, surprise: true })).toEqual(wrong);
      expect(await box.send({ type: "launch", token: bearer, pid: -1 })).toEqual(wrong);
      expect(box.fold.identities).toBe(0);
      expect(box.fold.adopted).toEqual([]);
      expect(box.ledger).toEqual([]);
      expect(box.kit.hosts).toEqual([]);
    },
    PROCESS_BUDGET_MS,
  );
});

// ── a typed run's proof ──

describe("a typed run's proof — what its record must show before fieldd attaches to it (AR-7c)", () => {
  const AGENT_STARTED = "2026-09-27T20:05:00.000Z";
  const typedRecord = (over: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
    format: 1,
    runtimeRunId: "run-1",
    runtimeEpoch: 1,
    provider: TYPED_PROVIDER,
    cwd: "/work",
    terminalSessionId: "s1",
    continuation: { providerId: TYPED_PROVIDER, nativeSessionId: "native-1" },
    createdAt: AGENT_STARTED,
    updatedAt: AGENT_STARTED,
    spawnedBy: "user-shell",
    process: { pid: 600, startedAt: AGENT_STARTED },
    ...over,
  });
  const pane: TerminalInfo = { sessionId: "s1", pid: 500, createdAt: BORN };
  const running = (): Map<number, ProcessRecord> =>
    new Map([
      [500, proc(500, 77)],
      [600, proc(600, 500, AGENT_STARTED)],
    ]);
  const proof = (over: Partial<Parameters<typeof typedRunProof>[0]> = {}) =>
    typedRunProof({
      record: typedRecord(),
      verified: true,
      terminal: pane,
      table: running(),
      ...over,
    });

  it("holds for a process that runs, started when the record says, under the shell of the terminal the record names — directly, or through a shell the person started there", async () => {
    expect(await proof()).toEqual({ holds: true, shellPid: 500 });
    const nested = running();
    nested.set(550, proc(550, 500));
    nested.set(600, proc(600, 550, AGENT_STARTED));
    expect(await proof({ table: nested })).toEqual({ holds: true, shellPid: 500 });
  });

  it("fails for a record the store did not verify, whatever else it says", async () => {
    expect(await proof({ verified: false })).toEqual({ holds: false, why: "unverified" });
  });

  it("fails without a process on the record, without a shell on the terminal, and without a process table", async () => {
    const { process: _none, ...processless } = typedRecord();
    expect(await proof({ record: processless })).toEqual({ holds: false, why: "no-process" });
    expect(await proof({ terminal: { sessionId: "s1", createdAt: BORN } })).toEqual({
      holds: false,
      why: "no-shell",
    });
    expect(await proof({ table: undefined })).toEqual({ holds: false, why: "table-unread" });
  });

  it("fails for a process that is gone, and for a pid a LATER process holds: a pid is handed on, a start time is not", async () => {
    const gone = running();
    gone.delete(600);
    expect(await proof({ table: gone })).toEqual({ holds: false, why: "process-gone" });
    const reused = running();
    reused.set(600, proc(600, 500, "2026-09-27T21:00:00.000Z"));
    expect(await proof({ table: reused })).toEqual({ holds: false, why: "process-reused" });
    // a start the table could not read proves nothing
    const unread = running();
    unread.set(600, proc(600, 500, undefined));
    expect(await proof({ table: unread })).toEqual({ holds: false, why: "process-reused" });
  });

  it("fails for a process that runs OUTSIDE the terminal the record names: another pane's, an editor's, one whose shell is gone", async () => {
    const elsewhere = running();
    elsewhere.set(501, proc(501, 77));
    elsewhere.set(600, proc(600, 501, AGENT_STARTED));
    expect(await proof({ table: elsewhere })).toEqual({ holds: false, why: "outside-terminal" });
    const reparented = running();
    reparented.set(600, proc(600, 1, AGENT_STARTED));
    expect(await proof({ table: reparented })).toEqual({ holds: false, why: "outside-terminal" });
    const shellGone = running();
    shellGone.delete(500);
    expect(await proof({ table: shellGone })).toEqual({ holds: false, why: "no-shell" });
    // the record names a terminal that is another live shell of ours: the process is not in it
    expect(
      await proof({
        terminal: { sessionId: "s2", pid: 501, createdAt: BORN },
        table: elsewhere.set(600, proc(600, 500, AGENT_STARTED)),
      }),
    ).toEqual({ holds: false, why: "outside-terminal" });
  });

  it("B1 — fails for a record whose process IS the terminal's own shell, whatever the table says: the shell is never the agent, and such a record does not re-attach", async () => {
    // the shell's pid and its own start: everything the walk would match, at depth 0
    expect(await proof({ record: typedRecord({ process: { pid: 500, startedAt: T0 } }) })).toEqual({
      holds: false,
      why: "shell-named",
    });
    // and before the table is even looked at
    expect(
      await proof({
        record: typedRecord({ process: { pid: 500, startedAt: T0 } }),
        table: undefined,
      }),
    ).toEqual({ holds: false, why: "shell-named" });
  });

  it(
    "ends a typed run's PROCESS only when the table shows the pid to be the process the record names — and then with the signal asked, on that pid",
    async () => {
      // a pid no process can hold: whatever a broken rule did with it would reach nobody
      const NOBODY = 3_999_999;
      const table = running();
      expect(endTypedProcess({ pid: NOBODY, startedAt: AGENT_STARTED }, undefined)).toBe("unknown");
      expect(endTypedProcess({ pid: NOBODY, startedAt: AGENT_STARTED }, table)).toBe("gone");
      table.set(NOBODY, proc(NOBODY, 1, "2026-09-27T21:00:00.000Z"));
      expect(endTypedProcess({ pid: NOBODY, startedAt: AGENT_STARTED }, table)).toBe("not-it");

      // a process of the test's own, and the start the system gives it
      const child = spawn("/bin/sleep", ["120"], { stdio: "ignore" });
      const ended = new Promise<NodeJS.Signals | null>((resolve) =>
        child.once("exit", (_code, signal) => resolve(signal)),
      );
      cleanup.push(() => {
        child.kill("SIGKILL");
      });
      const pid = child.pid as number;
      const startedAt = await poll(async () => await processStartedAt(pid), 30_000);
      table.set(pid, proc(pid, process.pid, startedAt));
      // the record names another start: not that process, and it is left alone
      expect(endTypedProcess({ pid, startedAt: "2020-02-02T02:02:02.000Z" }, table)).toBe("not-it");
      await sleep(300);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      // the record names it: signalled, and it ends by that signal
      expect(endTypedProcess({ pid, startedAt }, table)).toBe("signalled");
      expect(await ended).toBe("SIGTERM");
    },
    PROCESS_BUDGET_MS,
  );
});

// ── the REAL floor ──
//
// From here a name is TYPED: a field-native the row spawns, a fieldd on it, a
// shell born through `terminal.create`, the launcher the gateway wrote, the
// kit's shim, and the scripted agent's recipe exec'd in place.

const REFUSED_BY_THE_KIT = 75;

describe("a name typed in a pane — the REAL floor (AR-7b)", () => {
  it(
    "row 1 — type it: the fold has a row for the pane's own shell, the record is signed and carries the process, the home is owner-only, and the ledger has the adoption",
    async () => {
      const box = await floor({ bundle: shimScript });
      const births: Array<{ sessionId: string; pid: number | null }> = [];
      box.daemon.terminals.onSessionBorn((born) => births.push(born));
      const pane = await openPane(box);
      // the birth was told the moment the floor answered it, with the shell's pid
      expect(births).toEqual([{ sessionId: pane.sessionId, pid: pane.pid }]);

      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      expect(row).toMatchObject({
        spawnedBy: "user-shell",
        tier: "managed",
        kind: TYPED_PROVIDER,
        label: "Scripted",
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
        continuation: { persisted: true, resumable: false },
      });
      // the pane is the person's shell: never the agent cell's
      expect(row.terminal?.workloadClass).not.toBe("agent");
      expect(listedRow(box, pane.sessionId)?.cell?.workloadClass).not.toBe("agent");

      // ── the record ──
      const record = readRecord(box.dataDir, row.runtimeRunId);
      expect(record).toMatchObject({
        provider: TYPED_PROVIDER,
        spawnedBy: "user-shell",
        terminalSessionId: pane.sessionId,
        // the launcher's own directory, by its physical path
        cwd: box.work,
        creationRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        ingress: box.script.prepared[0]?.ingress,
      });
      expect(record.signature).toMatch(/^[0-9a-f]{64}$/u);
      expect(box.records.verifies(record)).toBe(true);
      expect(record.exited).toBeUndefined();
      expect(mode(recordPath(box.dataDir, row.runtimeRunId))).toBe(0o600);

      // ── the process: ONE pid from the prompt to the agent, the shell its parent ──
      const adoptedProcess = record.process;
      if (adoptedProcess === undefined) throw new Error("the record carries no process");
      const running = await until(
        async () => {
          const seen = await processOf(adoptedProcess.pid);
          return seen?.command.endsWith("cat") === true ? seen : undefined;
        },
        FLOOR_WAIT_MS,
        "the recipe running in the launcher's pid",
      );
      expect(running.parentPid).toBe(pane.pid);
      expect(adoptedProcess.startedAt).toBe(await processStartedAt(adoptedProcess.pid));
      // the recipe ran, managed; the real executable did not
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
      expect(linesOf(box.script.managedLog)).toEqual([`MANAGED ${row.sessionId}`]);
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(box.script.prepared[0]).toMatchObject({ cwd: box.work, adoptedIn: pane.sessionId });

      // ── the home: owner-only, under the user's root ──
      expect(box.home).toBe(join(box.dataDir, "agents", "shims"));
      expect(mode(box.home)).toBe(0o700);
      expect(mode(box.shimDirectory)).toBe(0o700);
      for (const file of ["gateway.json", "launch-providers.json", "terminals.json"])
        expect(mode(join(box.home, file)), file).toBe(0o600);
      expect(mode(join(box.shimDirectory, TYPED_COMMAND))).toBe(0o700);
      expect((await readTerminals(box.home))?.map((shell) => shell.pid)).toContain(pane.pid);
      expect(await readRendezvous(box.home)).toMatchObject({
        strict: true,
        hostLabel: AGENT_GATEWAY_HOST_LABEL,
        pid: process.pid,
      });

      // ── what fieldd says it offers: `invoke` where a launcher stands, and nowhere else ──
      const offered = (await box.win.call("agent.providers", {})) as AgentProvidersResult;
      const invoke = Object.fromEntries(
        offered.providers.map((provider) => [provider.id, provider.offers?.invoke]),
      );
      expect(invoke[TYPED_PROVIDER]).toBe(true);
      const others = Object.entries(invoke).filter(([id]) => id !== TYPED_PROVIDER);
      // the table claims it for them; no launcher stands for them on this device
      expect(others.length).toBeGreaterThan(0);
      expect(TYPED_CATALOG.filter((row) => row.offers.invoke).length).toBeGreaterThan(1);
      expect(others.every(([, offers]) => offers === false)).toBe(true);
      expect([...(box.daemon.agentGateway?.launchers() ?? [])]).toEqual([TYPED_PROVIDER]);

      // ── the ledger ──
      const acts = await until(() => {
        const found = auditActs(box.dataDir, "agent.session.adopt");
        return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
      });
      expect(acts.length).toBe(1);
      expect(acts[0]?.attempt).toMatchObject({
        actor: { kind: "system" },
        target: { kind: "agent-session", id: row.runtimeRunId },
        attrs: { provider: TYPED_PROVIDER, sessionId: pane.sessionId, spawnedBy: "user-shell" },
      });
      expect(acts[0]?.outcome).toMatchObject({ outcome: "succeeded" });
      expect(auditActs(box.dataDir, "agent.session.adopt_refused")).toEqual([]);
      // never the bearer, the ingress's bearer, the directory or the recipe
      const ledger = auditText(box.dataDir);
      const bearer = (await readRendezvous(box.home))?.token ?? "";
      expect(bearer).toMatch(/^[0-9a-f]{64}$/u);
      expect(ledger).not.toContain(bearer);
      expect(ledger).not.toContain("typed-bearer");
      expect(ledger).not.toContain(box.work);
      expect(ledger).not.toContain("exec /bin/cat");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 2 — it exits, the shell stays: the row is WITHDRAWN (never held as an exited row), the record is stamped, and the pane answers at its prompt",
    async () => {
      const box = await floor({ bundle: shimScript });
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      const record = readRecord(box.dataDir, row.runtimeRunId);
      const pid = record.process?.pid as number;
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));

      // the agent ends the way a person ends it: end of input at its prompt
      await key(box, pane, END_OF_INPUT);
      await until(
        () => (rowOf(box, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the row leaving",
      );
      expect(box.daemon.agents.list().sessions).toEqual([]);
      expect(isAlive(pid)).toBe(false);
      const stamped = readRecord(box.dataDir, row.runtimeRunId);
      // a vanished pid tells no code and no signal, and none is invented
      expect(stamped.exited).toMatchObject({
        reason: "process-exited",
        exitCode: null,
        signal: null,
      });
      expect(box.records.verifies(stamped)).toBe(true);
      // the shell: still listed, still the same process, still answering
      expect(listedRow(box, pane.sessionId)?.pid).toBe(pane.pid);
      expect(isAlive(pane.pid)).toBe(true);
      await answers(box, pane, "alive");
      // and nothing brings the row back while the pane lives
      await quiet(2_000);
      expect(box.daemon.agents.list().sessions).toEqual([]);
      // puppeteer holds no run for that terminal: the next name typed there is a new one
      expect(box.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 3 — the shell exits under it: the run closes through the floor's own exit, the row leaves, and the record carries the terminal's word",
    async () => {
      // The floor ends a terminal by a ladder (an interrupt, then signals), so
      // the agent's process is gone seconds before the shell is. The watch's
      // grace is what gives the terminal's own report its turn: here it is
      // long, so the run can only have closed through the terminal's exit.
      const box = await floor({ bundle: shimScript, gateway: { watch: { graceMs: 30_000 } } });
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      const pid = readRecord(box.dataDir, row.runtimeRunId).process?.pid as number;
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
      expect(isAlive(pid)).toBe(true);

      const terminatedAt = Date.now();
      expect(await box.win.call("terminal.terminate", { sessionId: pane.sessionId })).toEqual({
        terminated: true,
      });
      await until(
        () => (rowOf(box, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the row leaving",
      );
      await until(() => (listedRow(box, pane.sessionId) === undefined ? true : undefined));
      await until(() => (isAlive(pid) ? undefined : true));
      expect(isAlive(pane.pid)).toBe(false);
      const stamped = await until(() => {
        const record = readRecord(box.dataDir, row.runtimeRunId);
        return record.exited === undefined ? undefined : record;
      });
      // the floor said how the TERMINAL ended; a vanished pid could only have said that it did
      expect(stamped.exited?.reason).not.toBe("process-exited");
      expect(stamped.exited?.reason).not.toBe("unknown");
      expect(Date.parse(stamped.exited?.at ?? "") - terminatedAt).toBeLessThan(30_000);
      expect(box.daemon.agents.list().sessions).toEqual([]);
      expect(box.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      // the list of our shells follows the pane out
      await until(async () =>
        (await readTerminals(box.home))?.some((shell) => shell.pid === pane.pid) === true
          ? undefined
          : true,
      );
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 4 — a second launch after the first ended is a NEW run; a launch while one is live is REFUSED on the pane's screen, nothing runs, and the ledger has the conflict",
    async () => {
      const box = await floor({ bundle: shimScript });
      // a recorded pane: what it shows is read from its own record, and the
      // launcher is a grandchild of the session's process
      const pane = await openPane(box, { recorded: true });
      await type(box, pane, TYPED_COMMAND);
      const first = await adopted(box, pane);
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
      await key(box, pane, END_OF_INPUT);
      await until(() => (rowOf(box, first.runtimeRunId) === undefined ? true : undefined));

      // the same name, in the same shell, again — held live in the background this time
      await type(box, pane, `${TYPED_COMMAND} &`);
      const second = await adopted(box, pane);
      expect(second.runtimeRunId).not.toBe(first.runtimeRunId);
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.spawnedBy).toBe("user-shell");
      await until(() => (linesOf(box.script.managedLog).length === 2 ? true : undefined));
      const live = readRecord(box.dataDir, second.runtimeRunId).process?.pid as number;
      expect(isAlive(live)).toBe(true);

      // a second process under the same shell, while that one lives
      const status = await statusOf(box, pane, TYPED_COMMAND, "conflict");
      expect(status).toBe(REFUSED_BY_THE_KIT);
      const sentence = `${TYPED_COMMAND} was not started: another agent is already running in this pane. Quit it first, or open another pane.`;
      await until(
        () => (screenOf(pane).includes(sentence) ? true : undefined),
        FLOOR_WAIT_MS,
        "the refusal on the pane's screen",
      );
      // said once, on one line
      expect(screenOf(pane).split(sentence).length - 1).toBe(1);
      // nothing ran: not the real executable, not a third recipe
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(linesOf(box.script.managedLog).length).toBe(2);
      // the run that holds the pane is untouched
      expect(rowOf(box, second.runtimeRunId)?.spawnedBy).toBe("user-shell");
      expect(isAlive(live)).toBe(true);
      expect(box.daemon.agents.list().sessions.length).toBe(1);

      const refused = await until(() => {
        const found = auditActs(box.dataDir, "agent.session.adopt_refused");
        return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
      });
      expect(refused.length).toBe(1);
      expect(refused[0]?.attempt).toMatchObject({
        actor: { kind: "system" },
        reasonCode: "TERMINAL_CONFLICT",
        target: { kind: "agent-session", id: "pending" },
        attrs: { provider: TYPED_PROVIDER, code: "terminal-conflict", sessionId: pane.sessionId },
      });
      expect(refused[0]?.outcome).toMatchObject({
        outcome: "denied",
        reasonCode: "TERMINAL_CONFLICT",
      });
      expect(auditActs(box.dataDir, "agent.session.adopt").length).toBe(2);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "the pane is free the moment the agent ends: the same name typed again AT ONCE is a new managed run, though the first run's exit had not reached the fold",
    async () => {
      // a grace this long holds the first run in the fold well past its end
      const box = await floor({ bundle: shimScript, gateway: { watch: { graceMs: 60_000 } } });
      const pane = await openPane(box, { recorded: true });
      await type(box, pane, TYPED_COMMAND);
      const first = await adopted(box, pane);
      const firstPid = readRecord(box.dataDir, first.runtimeRunId).process?.pid as number;
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));

      await key(box, pane, END_OF_INPUT);
      await type(box, pane, TYPED_COMMAND);
      const second = await until(
        () => {
          const row = typedRow(box, pane);
          return row !== undefined && row.runtimeRunId !== first.runtimeRunId ? row : undefined;
        },
        FLOOR_WAIT_MS,
        "the second run entering the fold",
      );
      await until(() => (linesOf(box.script.managedLog).length === 2 ? true : undefined));
      expect(isAlive(firstPid)).toBe(false);
      expect(rowOf(box, first.runtimeRunId)).toBeUndefined();
      expect(readRecord(box.dataDir, first.runtimeRunId).exited).toMatchObject({
        reason: "process-exited",
      });
      expect(second.spawnedBy).toBe("user-shell");
      expect(box.daemon.agents.list().sessions.map((row) => row.runtimeRunId)).toEqual([
        second.runtimeRunId,
      ]);
      // nothing was refused, and nothing ran unmanaged
      expect(auditActs(box.dataDir, "agent.session.adopt_refused")).toEqual([]);
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(screenOf(pane)).not.toContain("was not started");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "the stop verb reaches a typed run unchanged: agent.interrupt writes to the pane the run is in, the agent ends, and the shell stays",
    async () => {
      const box = await floor({ bundle: shimScript });
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      const pid = readRecord(box.dataDir, row.runtimeRunId).process?.pid as number;
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));

      expect(await box.win.call("agent.interrupt", { runtimeRunId: row.runtimeRunId })).toEqual({
        accepted: true,
      });
      // the interrupt is the pane's own: what runs in its foreground takes it
      await until(() => (isAlive(pid) ? undefined : true), FLOOR_WAIT_MS, "the agent ending");
      await until(() => (rowOf(box, row.runtimeRunId) === undefined ? true : undefined));
      expect(readRecord(box.dataDir, row.runtimeRunId).exited?.reason).toBe("process-exited");
      expect(isAlive(pane.pid)).toBe(true);
      await answers(box, pane, "after-the-interrupt");
      // a run that is over refuses the verb the way any other does
      const refused = (await box.win
        .call("agent.interrupt", { runtimeRunId: row.runtimeRunId })
        .then(
          () => undefined,
          (error: { rpc?: { data?: { details?: unknown } } }) => error.rpc?.data?.details,
        )) as { state?: string } | undefined;
      expect(refused?.state).toBe("not-alive");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "resume of a typed run that ended is the ordinary resume: a NEW run in a NEW terminal on the agent cell, which says nothing of where it came from — and the person's shell is not touched",
    async () => {
      const box = await floor({ bundle: shimScript });
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      const typed = await adopted(box, pane);
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
      // a live typed run refuses a resume the way any live run does
      const live = (await box.win.call("agent.resume", { runtimeRunId: typed.runtimeRunId }).then(
        () => undefined,
        (error: { rpc?: { data?: { details?: unknown } } }) => error.rpc?.data?.details,
      )) as { state?: string } | undefined;
      expect(live?.state).toBe("terminal-alive");

      await key(box, pane, END_OF_INPUT);
      await until(() => (rowOf(box, typed.runtimeRunId) === undefined ? true : undefined));

      const resumed = (await box.win.call("agent.resume", {
        runtimeRunId: typed.runtimeRunId,
      })) as { session: AgentSessionSummary; terminal: { sessionId: string } };
      expect(resumed.session.runtimeRunId).not.toBe(typed.runtimeRunId);
      // the conversation continued: the vendor's own id, carried from the record
      expect(resumed.session.sessionId).toBe(typed.sessionId);
      expect(box.script.created).toEqual([
        { runtimeSessionId: resumed.terminal.sessionId, resume: typed.sessionId },
      ]);
      // `app`: a door started it, and the row and the record say nothing
      expect(resumed.session.spawnedBy).toBeUndefined();
      expect(resumed.terminal.sessionId).not.toBe(pane.sessionId);
      const record = readRecord(box.dataDir, resumed.session.runtimeRunId);
      expect(record.spawnedBy).toBeUndefined();
      expect(record.process).toBeUndefined();
      expect(record.terminalSessionId).toBe(resumed.terminal.sessionId);
      const born = await until(() => {
        const row = listedRow(box, resumed.terminal.sessionId);
        return row?.cell === undefined ? undefined : row;
      });
      expect(born.cell?.workloadClass).toBe("agent");
      // the typed record names its successor, and is not continued twice
      expect(readRecord(box.dataDir, typed.runtimeRunId).reattach).toMatchObject({
        state: "resumed",
        replacedBy: resumed.session.runtimeRunId,
      });
      // the pane the agent was typed in is the person's shell: listed, alive, answering
      expect(listedRow(box, pane.sessionId)?.pid).toBe(pane.pid);
      await answers(box, pane, "after-the-resume");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a store that fails at adoption: nothing of the run is left — no run in puppeteer, no row in the fold — the person is refused in words, nothing ran, and the pane is free",
    async () => {
      const box = await floor({ bundle: shimScript });
      const pane = await openPane(box, { recorded: true });
      // the records' directory cannot be made: a file stands where it would be
      const sessions = join(box.dataDir, "agents", "sessions");
      expect(existsSync(sessions)).toBe(false);
      writeFileSync(sessions, "in the way");

      const status = await statusOf(box, pane, TYPED_COMMAND, "store");
      expect(status).toBe(REFUSED_BY_THE_KIT);
      const sentence = `${TYPED_COMMAND} was not started: VibeField could not record it as a managed session. Run ${TYPED_COMMAND} again.`;
      await until(() => (screenOf(pane).includes(sentence) ? true : undefined));
      // the error's own words never reach the pane
      expect(screenOf(pane)).not.toMatch(/ENOTDIR|EEXIST|not a directory|sessions/u);
      expect(box.daemon.agents.list().sessions).toEqual([]);
      expect(box.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      expect(linesOf(box.script.managedLog)).toEqual([]);
      expect(linesOf(box.script.realLog)).toEqual([]);
      const runtimeRunId = auditActs(box.dataDir, "agent.session.adopt")[0]?.attempt.target.id;
      expect(runtimeRunId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(box.daemon.agents.runtime.monitorState(runtimeRunId as string)).toBeUndefined();
      expect(auditActs(box.dataDir, "agent.session.adopt")[0]?.outcome?.outcome).toBe("failed");
      expect(
        auditActs(box.dataDir, "agent.session.adopt_refused").map((act) => act.attempt.reasonCode),
      ).toEqual(["ADOPT_FAILED"]);

      // the store can write again, and the same name is a managed run
      rmSync(sessions);
      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      expect(row.spawnedBy).toBe("user-shell");
      expect(row.runtimeRunId).not.toBe(runtimeRunId);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "adoption of a pid that is already dead withdraws at once: a launcher that left during a slow preparation leaves a stamped record and no row",
    async () => {
      const box = await floor({
        bundle: shimScript,
        provider: { prepareDelayMs: 4_000 },
        // nothing of this row may be the watch's doing
        gateway: { watch: { graceMs: 120_000 } },
      });
      const pane = await openPane(box);
      const pidFile = join(box.root, "launcher.pid");
      await type(box, pane, `${TYPED_COMMAND} & echo $! > '${pidFile}'`);
      const launcher = Number(
        await until(() =>
          existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() || undefined : undefined,
        ),
      );
      // the preparation is under way; the launcher is killed under it
      await until(() => (box.script.preparing.count === 0 ? undefined : true));
      expect(box.script.prepared).toEqual([]);
      process.kill(launcher, "SIGKILL");
      await until(() => (isAlive(launcher) ? undefined : true));

      const record = await until(
        () => {
          const records = box.records.list();
          return records[0]?.exited === undefined ? undefined : records[0];
        },
        FLOOR_WAIT_MS,
        "the record of the run that never ran",
      );
      expect(record).toMatchObject({
        spawnedBy: "user-shell",
        terminalSessionId: pane.sessionId,
        process: { pid: launcher },
        exited: { reason: "process-exited", exitCode: null, signal: null },
      });
      // at once: the stamp follows the record's birth by moments, not by a grace
      expect(Date.parse(record.exited?.at ?? "") - Date.parse(record.createdAt)).toBeLessThan(
        5_000,
      );
      expect(box.daemon.agents.list().sessions).toEqual([]);
      expect(box.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      expect(linesOf(box.script.managedLog)).toEqual([]);
      expect(linesOf(box.script.realLog)).toEqual([]);
      await answers(box, pane, "after-the-dead-launcher");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "exec-failed: a recipe the launcher cannot run — the row is withdrawn, the record says so, nothing runs unmanaged, and the pane is free",
    async () => {
      const box = await floor({
        bundle: shimScript,
        provider: { recipeCommand: "/nonexistent/vf-scripted-recipe" },
      });
      const pane = await openPane(box, { recorded: true });
      const status = await statusOf(box, pane, TYPED_COMMAND, "exec-failed");
      // a strict host's launcher refuses; it never falls through to the real executable
      expect(status).toBe(REFUSED_BY_THE_KIT);
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(linesOf(box.script.managedLog)).toEqual([]);
      await until(() => (screenOf(pane).includes("not started") ? true : undefined));

      const record = await until(() => {
        const records = box.records.list();
        return records[0]?.exited === undefined ? undefined : records[0];
      });
      expect(record).toMatchObject({
        spawnedBy: "user-shell",
        terminalSessionId: pane.sessionId,
        exited: { reason: "exec-failed", exitCode: null, signal: null },
      });
      expect(box.daemon.agents.list().sessions).toEqual([]);
      expect(box.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      await answers(box, pane, "after-exec-failed");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a daemon that hosts no gateway writes no home and listens nowhere, and what it says it offers is the catalog's own claim",
    async () => {
      const box = await floor({
        bundle: shimScript,
        gateway: { enabled: false },
        launchers: false,
      });
      expect(box.daemon.agentGateway).toBeNull();
      await openPane(box, { path: false });
      await quiet(500);
      expect(existsSync(box.home)).toBe(false);
      const offered = (await box.win.call("agent.providers", {})) as AgentProvidersResult;
      for (const provider of offered.providers) {
        const row = TYPED_CATALOG.find((candidate) => candidate.id === provider.id);
        expect(provider.offers?.invoke, provider.id).toBe(row?.offers.invoke);
      }
      expect(offered.providers.some((provider) => provider.offers?.invoke === true)).toBe(true);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "the doors that change an install write the launchers again: a home that lost a launcher has it back after agents.setActive and after agents.update, whatever those doors answered",
    async () => {
      const box = await floor({ bundle: shimScript });
      const admin = await windowOf(box.daemon, ["agents.manage"]);
      const launcher = join(box.shimDirectory, TYPED_COMMAND);
      for (const door of ["agents.setActive", "agents.update"]) {
        rmSync(launcher);
        // the scripted agent has no install to choose or update: the door refuses
        const answer = await admin
          .call(door, { provider: TYPED_PROVIDER, executable: box.script.real })
          .then(
            () => "answered",
            (error: { rpc?: { data?: { kind?: string } } }) => error.rpc?.data?.kind ?? "refused",
          );
        expect(answer, door).not.toBe("FORBIDDEN");
        await until(() => (existsSync(launcher) ? true : undefined), FLOOR_WAIT_MS, door);
      }
      // and the name typed after it is a managed run
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      expect((await adopted(box, pane)).spawnedBy).toBe("user-shell");
    },
    FLOOR_BUDGET_MS,
  );
});

// ── a typed run across a fieldd restart ──

describe("a typed run across a fieldd restart — the REAL floor (AR-7c)", () => {
  /** A typed run, live in a pane, and the fieldd that adopted it stopped. */
  async function typedThenStopped(config: Omit<Parameters<typeof floor>[0], "bundle"> = {}) {
    const first = await floor({ bundle: shimScript, ...config });
    const pane = await openPane(first);
    await type(first, pane, TYPED_COMMAND);
    const row = await adopted(first, pane);
    await until(() => (linesOf(first.script.managedLog).length === 1 ? true : undefined));
    const record = readRecord(first.dataDir, row.runtimeRunId);
    const pid = record.process?.pid as number;
    return { first, pane, row, record, pid };
  }
  const detailsOf = (call: Promise<unknown>) =>
    call.then(
      () => undefined,
      (error: { message?: string; rpc?: { data?: { kind?: string; details?: unknown } } }) => ({
        message: error.message,
        kind: error.rpc?.data?.kind,
        details: error.rpc?.data?.details as { state?: string } | undefined,
      }),
    );

  it(
    "row 5 — restart fieldd under it (the adapter attaches): the stop RELEASES the run, the next boot re-attaches it at the next epoch, the row says reattached, and the pid watch is armed again",
    async () => {
      const { first, pane, row, record, pid } = await typedThenStopped({ attach: true });
      await first.daemon.stop();
      // released, not ended: the agent runs, its record is not stamped, the pane lives
      expect(isAlive(pid)).toBe(true);
      expect(readRecord(first.dataDir, row.runtimeRunId).exited).toBeUndefined();
      expect(isAlive(pane.pid)).toBe(true);
      // the gateway is gone and says so; the list of our shells stays for the launchers
      expect(await readRendezvous(first.home)).toBeUndefined();
      expect((await readTerminals(first.home))?.map((shell) => shell.pid)).toContain(pane.pid);

      const second = await floor({ bundle: shimScript, attach: true, restartOf: first });
      const again = await until(
        () => {
          const found = rowOf(second, row.runtimeRunId);
          return found?.continuation?.reattached === true ? found : undefined;
        },
        FLOOR_WAIT_MS,
        "the run re-attached",
      );
      expect(again).toMatchObject({
        spawnedBy: "user-shell",
        runtimeEpoch: row.runtimeEpoch + 1,
        sessionId: row.sessionId,
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
        continuation: { persisted: true, resumable: false, reattached: true },
      });
      expect(second.script.attached).toEqual([
        { runtimeSessionId: pane.sessionId, sessionId: row.sessionId, ingress: record.ingress },
      ]);
      const kept = readRecord(second.dataDir, row.runtimeRunId);
      expect(kept).toMatchObject({
        spawnedBy: "user-shell",
        process: record.process,
        runtimeEpoch: row.runtimeEpoch + 1,
        reattach: { state: "attached" },
      });
      expect(second.records.verifies(kept)).toBe(true);
      const acts = await until(() => {
        const found = auditActs(second.dataDir, "agent.session.reattach");
        return found[0]?.outcome === undefined ? undefined : found;
      });
      expect(acts.length).toBe(1);
      expect(acts[0]?.attempt.actor.kind).toBe("system");
      expect(acts[0]?.outcome?.outcome).toBe("succeeded");
      // the same process, never touched
      expect(isAlive(pid)).toBe(true);
      expect((await processOf(pid))?.parentPid).toBe(pane.pid);

      // the watch is armed again: the agent ends, and THIS fieldd sees it
      await key(second, pane, END_OF_INPUT);
      await until(
        () => (rowOf(second, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the row leaving at the agent's end",
      );
      expect(readRecord(second.dataDir, row.runtimeRunId).exited).toMatchObject({
        reason: "process-exited",
      });
      expect(second.daemon.agents.list().sessions).toEqual([]);
      await answers(second, pane, "after-the-restart");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 6 — restart fieldd under it (the adapter cannot attach): the run is shown unobserved and is NEVER replaced — not at idle, where a run a door started IS, and not by hand — and its row leaves when its process does",
    async () => {
      const index = { afterMs: 1_000, pollMs: 200 };
      const { first, pane, row, pid } = await typedThenStopped({ index });
      // the control: a run one of our doors started, by the same adapter, in the same boot
      const app = (await first.win.call("agent.spawn", {
        provider: TYPED_PROVIDER,
        cwd: first.work,
      })) as { session: AgentSessionSummary; terminal: { sessionId: string } };
      await until(() => listedRow(first, app.terminal.sessionId));
      await first.daemon.stop();
      // the index says BOTH conversations have been still for a minute
      writeFileSync(
        first.sessionsFile,
        JSON.stringify([
          indexedSession(row.sessionId, 60_000),
          indexedSession(app.session.sessionId, 60_000),
        ]),
      );

      const second = await floor({ bundle: shimScript, restartOf: first, index });
      const held = await until(
        () => {
          const found = rowOf(second, row.runtimeRunId);
          return found?.continuation?.reason === undefined ? undefined : found;
        },
        FLOOR_WAIT_MS,
        "the typed run held",
      );
      expect(held).toMatchObject({
        spawnedBy: "user-shell",
        status: "unknown",
        observationLevel: "none",
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
        continuation: { persisted: true, resumable: false },
      });
      expect(held.continuation?.reason).toContain("cannot attach");
      // pending NOTHING: no word on the row promises a resume
      expect(held.continuation).not.toHaveProperty("pending");

      // the control IS replaced at idle, by the daemon itself …
      const resumed = await until(
        () =>
          auditActs(second.dataDir, "agent.session.resume").find(
            (act) =>
              act.attempt.target.id === app.session.runtimeRunId &&
              act.outcome?.outcome === "succeeded",
          ),
        FLOOR_WAIT_MS,
        "the door's run resumed at idle",
      );
      expect(resumed.attempt.actor.kind).toBe("system");
      await until(() =>
        listedRow(second, app.terminal.sessionId) === undefined ? true : undefined,
      );
      // … so the index was asked, and the thresholds were met — for that run only
      const asked = indexRequests(second);
      expect(asked.some((line) => line.includes(app.session.sessionId))).toBe(true);
      expect(asked.some((line) => line.includes(row.sessionId))).toBe(false);

      // by hand: refused, in words a person can act on
      const refused = await detailsOf(
        second.win.call("agent.resume", { runtimeRunId: row.runtimeRunId }),
      );
      expect(refused?.kind).toBe("PRECONDITION_FAILED");
      expect(refused?.details?.state).toBe("typed-run-alive");
      expect(refused?.message).toBe(
        "it is running in your shell; quit it and start it again to manage it",
      );

      // the person's shell and their agent: never ended, by anything
      await quiet(3_000);
      expect(indexRequests(second).some((line) => line.includes(row.sessionId))).toBe(false);
      expect(listedRow(second, pane.sessionId)?.pid).toBe(pane.pid);
      expect(isAlive(pane.pid)).toBe(true);
      expect(isAlive(pid)).toBe(true);
      expect(rowOf(second, row.runtimeRunId)?.continuation?.reason).toContain("cannot attach");
      expect(readRecord(second.dataDir, row.runtimeRunId).exited).toBeUndefined();
      const ledger = auditEntries(second.dataDir);
      expect(
        ledger.filter(
          (entry) =>
            entry.target.id === row.runtimeRunId &&
            (entry.action === "agent.session.resume" ||
              entry.action === "terminal.session.terminate"),
        ),
      ).toEqual([
        // the refused resume by hand is in the ledger as the caller's attempt, and failed
        expect.objectContaining({ action: "agent.session.resume", phase: "attempt" }),
        expect.objectContaining({ action: "agent.session.resume", outcome: "failed" }),
      ]);
      expect(
        ledger.filter(
          (entry) =>
            entry.target.id === pane.sessionId && entry.action === "terminal.session.terminate",
        ),
      ).toEqual([]);

      // the row leaves when the process does
      await key(second, pane, END_OF_INPUT);
      await until(
        () => (rowOf(second, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the held row leaving at the agent's end",
      );
      expect(readRecord(second.dataDir, row.runtimeRunId).exited).toMatchObject({
        reason: "process-exited",
      });
      await answers(second, pane, "after-the-held-run");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a pane that holds an unobserved typed run: the shell ITSELF asking is no launch at all (B1 — declined, never placed, nothing refused, the held row untouched); another process in that pane is refused as a conflict; and the SAME process asking again takes the run over — its row observed at last",
    async () => {
      const first = await floor({ bundle: shimScript });
      const pane = await openPane(first);
      // a bystander in the pane — a background job of the shell's — for the row to ask with.
      // It writes its own pid and execs the sleep in place: a `$!` typed at the pane's
      // interactive bash (3.2) is history-expanded — "event not found" — and the line is lost.
      const bystander = join(first.root, "bystander-pid");
      await type(first, pane, `sh -c 'printf "%s" "$$" > ${bystander}; exec sleep 600' &`);
      const otherPid = Number(
        await until(
          () => {
            if (!existsSync(bystander)) return undefined;
            const text = readFileSync(bystander, "utf8").trim();
            return text === "" ? undefined : text;
          },
          FLOOR_WAIT_MS,
          "the bystander's pid",
        ),
      );
      await type(first, pane, TYPED_COMMAND);
      const row = await adopted(first, pane);
      await until(() => (linesOf(first.script.managedLog).length === 1 ? true : undefined));
      const pid = readRecord(first.dataDir, row.runtimeRunId).process?.pid as number;
      await first.daemon.stop();
      const second = await floor({ bundle: shimScript, restartOf: first });
      await until(() =>
        rowOf(second, row.runtimeRunId)?.continuation?.reason === undefined ? undefined : true,
      );

      // the pane's shell, by its own pid: the shell is never the agent
      const shell = await askFloor(second, launchOf(second, pane.pid));
      expect(shell).toEqual({
        action: "fallback",
        code: "invalid-request",
        reason: "the request names a shell of this host's, which is never the agent",
      });
      expect(second.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      expect(rowOf(second, row.runtimeRunId)?.observationLevel).toBe("none");
      expect(auditActs(second.dataDir, "agent.session.adopt_refused")).toEqual([]);
      expect(isAlive(pane.pid)).toBe(true);

      // another process in that pane — the shell's background job — asks for a managed run
      const other = await askFloor(second, launchOf(second, otherPid));
      expect(other).toMatchObject({
        action: "refuse",
        code: "terminal-conflict",
        placed: true,
        message: `${TYPED_COMMAND} was not started: another agent is already running in this pane. Quit it first, or open another pane.`,
      });
      expect(second.daemon.agents.runtime.agent(pane.sessionId)).toBeUndefined();
      expect(rowOf(second, row.runtimeRunId)?.observationLevel).toBe("none");

      // the launcher that asked the last fieldd, asking the one that came next
      const same = await askFloor(second, launchOf(second, pid));
      expect(same).toMatchObject({ action: "exec" });
      const taken = await until(() => {
        const found = typedRow(second, pane);
        return found !== undefined && found.runtimeRunId !== row.runtimeRunId ? found : undefined;
      });
      expect(taken).toMatchObject({ spawnedBy: "user-shell" });
      expect(taken.observationLevel).not.toBe("none");
      expect(rowOf(second, row.runtimeRunId)).toBeUndefined();
      expect(readRecord(second.dataDir, row.runtimeRunId).exited?.reason).toBe("superseded");
      expect(readRecord(second.dataDir, taken.runtimeRunId).process?.pid).toBe(pid);
      expect(isAlive(pid)).toBe(true);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 7 — a reused pid: a record whose process started at ANOTHER time is stamped at the next boot, and nothing is attached, held or ended",
    async () => {
      const { first, pane, row, pid } = await typedThenStopped({ attach: true });
      await first.daemon.stop();
      // through the STORE, so the record stays signed: only the start time is another's
      const signed = first.records.read(row.runtimeRunId);
      if (signed?.process === undefined) throw new Error("no record to rewrite");
      first.records.write({
        ...signed,
        process: { pid: signed.process.pid, startedAt: "2020-02-02T02:02:02.000Z" },
      });
      expect(first.records.verifies(readRecord(first.dataDir, row.runtimeRunId))).toBe(true);

      const second = await floor({ bundle: shimScript, attach: true, restartOf: first });
      const stamped = await until(
        () => {
          const record = readRecord(second.dataDir, row.runtimeRunId);
          return record.exited === undefined ? undefined : record;
        },
        FLOOR_WAIT_MS,
        "the record stamped",
      );
      expect(stamped.exited).toMatchObject({ reason: "unknown", exitCode: null, signal: null });
      expect(second.script.attached).toEqual([]);
      expect(second.daemon.agents.list().sessions).toEqual([]);
      expect(auditActs(second.dataDir, "agent.session.reattach")).toEqual([]);
      // nothing was ended: the process the pid belongs to, and the pane
      await quiet(1_500);
      expect(isAlive(pid)).toBe(true);
      expect(listedRow(second, pane.sessionId)?.pid).toBe(pane.pid);
      expect(second.daemon.agents.list().sessions).toEqual([]);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "B4 — a typed run under a persona, held pending (the adapter cannot attach under a persona it does not know): a stop of that persona's sessions signals nothing — not the run, not its pane (the person's own shell) — counts it as remaining, and leaves its row and its record as they were",
    async () => {
      const { first, pane, row, pid } = await typedThenStopped({ attach: true });
      await first.daemon.stop();
      // through the STORE, so the record stays signed: the run is put under a persona,
      // as a typed launch one day may be
      const signed = first.records.read(row.runtimeRunId);
      if (signed === undefined) throw new Error("no record to rewrite");
      first.records.write({ ...signed, profileId: "persona-b4" });
      expect(first.records.verifies(readRecord(first.dataDir, row.runtimeRunId))).toBe(true);

      // the next boot proves the run and asks the adapter to attach under the persona; the
      // adapter knows no such persona, so the run is HELD — a pending typed row under it
      const second = await floor({ bundle: shimScript, attach: true, restartOf: first });
      const held = await until(
        () => {
          const found = rowOf(second, row.runtimeRunId);
          return found?.continuation?.reason === undefined ? undefined : found;
        },
        FLOOR_WAIT_MS,
        "the typed run held under the persona",
      );
      expect(held).toMatchObject({
        spawnedBy: "user-shell",
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
      });
      expect(readRecord(second.dataDir, row.runtimeRunId)).toMatchObject({
        profileId: "persona-b4",
        reattach: { state: "failed" },
      });
      const persona = new Set(["persona-b4"]);
      expect(second.daemon.agents.liveUnder(persona)).toBe(1);

      // the persona's sessions are stopped: the typed run is not among the targets, and
      // the stop waits its deadline out and reports it remaining
      const stop = await second.daemon.agents.stopUnder(persona);
      expect(stop).toEqual({ stopped: 0, remaining: 1 });
      // nothing was signalled: the run, its pane, its row and its record are as they were
      expect(isAlive(pid)).toBe(true);
      expect(isAlive(pane.pid)).toBe(true);
      expect((await processOf(pid))?.parentPid).toBe(pane.pid);
      expect(listedRow(second, pane.sessionId)?.pid).toBe(pane.pid);
      expect(rowOf(second, row.runtimeRunId)).toMatchObject({
        spawnedBy: "user-shell",
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
      });
      expect(readRecord(second.dataDir, row.runtimeRunId)).toMatchObject({
        profileId: "persona-b4",
        process: { pid },
      });
      expect(readRecord(second.dataDir, row.runtimeRunId).exited).toBeUndefined();

      // the agent ends by the person's hand; the pane is the person's shell still
      await key(second, pane, END_OF_INPUT);
      await until(
        () => (rowOf(second, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the row leaving at the agent's end",
      );
      await until(
        () => (second.daemon.agents.liveUnder(persona) === 0 ? true : undefined),
        FLOOR_WAIT_MS,
        "nothing left under the persona",
      );
      await answers(second, pane, "after-the-stop");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "row 8 — a forged record: one edited on disk without its signature, naming a live shell, is set aside by the store — nothing is attached, and the shell is untouched",
    async () => {
      const { first, pane, row, pid } = await typedThenStopped({ attach: true });
      const bystander = await openPane(first, { path: false });
      await first.daemon.stop();
      // a same-user process points the record at another live shell of ours, and at that
      // shell's own process — everything the proof would ask for, without the signature
      const path = recordPath(first.dataDir, row.runtimeRunId);
      const forged = JSON.parse(readFileSync(path, "utf8")) as AgentSessionRecord;
      const started = await processStartedAt(bystander.pid);
      forged.terminalSessionId = bystander.sessionId;
      forged.process = { pid: bystander.pid, startedAt: started ?? "" };
      writeFileSync(path, `${JSON.stringify(forged, null, 2)}\n`, { mode: 0o600 });

      const second = await floor({ bundle: shimScript, attach: true, restartOf: first });
      await until(
        () => (existsSync(path) ? undefined : true),
        FLOOR_WAIT_MS,
        "the record set aside",
      );
      const aside = readdirSync(dirname(path)).filter((name) => name.includes(".forged-"));
      expect(aside.length).toBe(1);
      expect(second.records.list()).toEqual([]);
      expect(second.script.attached).toEqual([]);
      await quiet(1_500);
      expect(second.daemon.agents.list().sessions).toEqual([]);
      expect(auditActs(second.dataDir, "agent.session.reattach")).toEqual([]);
      for (const shell of [pane, bystander]) {
        expect(listedRow(second, shell.sessionId)?.pid).toBe(shell.pid);
        expect(isAlive(shell.pid)).toBe(true);
      }
      expect(isAlive(pid)).toBe(true);
      await answers(second, bystander, "after-the-forgery");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a typed run that ENDED is not brought back by a restart: no row for it, exited or otherwise, though its terminal is a live shell the floor still lists",
    async () => {
      const { first, pane, row } = await typedThenStopped({ attach: true });
      await key(first, pane, END_OF_INPUT);
      await until(() => (rowOf(first, row.runtimeRunId) === undefined ? true : undefined));
      await first.daemon.stop();
      const second = await floor({ bundle: shimScript, attach: true, restartOf: first });
      await answers(second, pane, "after-the-second-boot");
      await quiet(2_500);
      expect(second.daemon.agents.list().sessions).toEqual([]);
      expect(second.script.attached).toEqual([]);
      expect(listedRow(second, pane.sessionId)?.pid).toBe(pane.pid);
      // and the name typed there again is a new managed run
      await type(second, pane, TYPED_COMMAND);
      const next = await adopted(second, pane);
      expect(next.runtimeRunId).not.toBe(row.runtimeRunId);
      expect(next.spawnedBy).toBe("user-shell");
    },
    FLOOR_BUDGET_MS,
  );
});
