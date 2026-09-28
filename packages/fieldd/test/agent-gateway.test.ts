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
import { execFile } from "node:child_process";
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
import type { BoundIngress } from "@vibecook/puppeteer-core";
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
  readLaunchProviders,
  readRendezvous,
  readTerminals,
  SPAWN_THROUGH_DECLINE_CODES,
  SPAWN_THROUGH_EXIT_UNAVAILABLE,
  type SpawnThroughHost,
  type SpawnThroughResponse,
  spawnThroughLayout,
  startSpawnThroughGateway,
  writeRendezvous,
} from "@vibecook/puppeteer-runtime/spawn-through";
import {
  type AgentCatalogEntry,
  createAgentCatalogReaders,
  type TerminalInfo,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  shimHomeIsDurable,
  startedWithSession,
} from "../src/agent-gateway";
import {
  type AgentAdoption,
  type AgentAdoptionInput,
  noTerminalHost,
  type SystemAudit,
} from "../src/agent-runtime";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import {
  TYPED_CATALOG,
  TYPED_COMMAND,
  TYPED_PROVIDER,
  type TypedProviderOptions,
  type TypedScript,
  typedProvider,
  typedScript,
} from "./agent-gateway-fixture";
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
});

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
    const path = [
      join(root, "linked"),
      `${shim}/`,
      shim,
      join(root, "elsewhere"),
      join(root, "absent"),
      join(root, "real"),
    ].join(":");
    expect(firstNodeOnPath(path, [shim])).toBe(real);

    const asked: string[] = [];
    const chosen = await chooseLauncherRuntime(
      facts({
        electron: "38.2.0",
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        nodeVersion: "22.19.0",
        path,
        shimDirectories: [shim, undefined],
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
  const catalog = [...TYPED_CATALOG];
  const logged: Logged[] = [];
  const ledger: Ledgered[] = [];
  const kit: Unit["kit"] = { gateway: [], materialized: [], rendezvous: [], hosts: [] };
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
    processTable: async () => {
      reads.count += 1;
      return table;
    },
    kit: {
      startSpawnThroughGateway: (given) => {
        kit.gateway.push(given);
        return startSpawnThroughGateway(given);
      },
      materializeShims: (given) => {
        kit.materialized.push(given);
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
    catalog,
    logged,
    ledger,
    kit,
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
    "reads a shell's start ONCE, and an inventory that changed nothing of ours reads and writes nothing",
    async () => {
      const box = await unit();
      onePane(box);
      await box.gateway.start();
      const reads = box.reads.count;
      const written = statSync(join(box.home, "terminals.json")).mtimeMs;
      const text = readFileSync(join(box.home, "terminals.json"), "utf8");
      // a title changed, a directory changed: the floor publishes, our shells are who they were
      for (let n = 0; n < 20; n += 1) box.terminals.lists([{ sessionId: "s1", pid: 500 }]);
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
      // the shell itself is in its own pane
      expect(await box.gateway.resolveTerminal({ pid: 501 })).toEqual({ terminalSessionId: "s2" });
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
      const second = await box.launch(601);
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
