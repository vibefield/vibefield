import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { AgentLaunchProvider } from "@vibecook/puppeteer-core";
import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import {
  type AdoptedSpawnThroughSession,
  boundSpawnThroughText,
  clearRendezvous,
  DEFAULT_RETRY_MS,
  declineSpawnThrough,
  findOwningProcess,
  isSpawnThroughCommandName,
  materializeShims,
  type ProcessTable,
  prepareSpawnThroughLaunch,
  processStartedAt,
  readProcessTable,
  type SpawnThroughDeclineCode,
  type SpawnThroughExecFailedRequest,
  type SpawnThroughGateway,
  type SpawnThroughHost,
  type SpawnThroughLaunchRequest,
  type SpawnThroughRefusal,
  type SpawnThroughRequest,
  type SpawnThroughResponse,
  type SpawnThroughShimRuntime,
  spawnThroughLayout,
  spawnThroughRefusalMessage,
  startSpawnThroughGateway,
  writeRendezvous,
  writeTerminals,
} from "@vibecook/puppeteer-runtime/spawn-through";
import { type AgentCatalogReaders, LAYOUT, type TerminalInfo } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentAdoption, SystemAudit } from "./agent-runtime";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";

// A TYPED AGENT IS A MANAGED AGENT (AR-7b; thinking-ar7-typed-agents.md §5.2,
// design-04 §8.4/§8.5 as amended 2026-09-12): the agent's name typed at the
// prompt of one of our panes starts a MANAGED session in that pane, in that
// process. puppeteer's spawn-through kit owns the mechanism — the gateway's
// wire and its strict parser, the shim, the launcher, the rendezvous files,
// the rule of refusal, the process table's walk. fieldd is the HOST, and this
// file is the whole of the host: which agents are given a launcher, which
// program runs the shim, which of our terminals holds a process, the words a
// refused person reads, the run's entry into the fold, and the list of our
// shells a shim reads while fieldd is away.
//
// STRICT, from the first release (RULED 2026-09-27: "Let's go strict"): in one
// of our panes an agent's interactive session runs managed or does not run.
// There is no mode here, no setting and no seam that turns it off — the four
// places the kit keeps strictness are set from ONE constant below. What strict
// governs is OUR PANES and nothing else: the launcher's directory leaks into
// everything a pane's shell starts (an editor, a multiplexer's server), and an
// agent typed there is not in a terminal of ours. It runs as typed, fieldd up
// or down. The kit holds that rule; fieldd's part is a truthful
// `resolveTerminal` and a current list of our shells.
//
// A ONE-SHOT RUN IS A REGULAR COMMAND (RULED the same day): a version query, a
// management subcommand, a print or exec mode, a launch whose input or output
// is not a terminal. The kit answers each `fallback` in every mode and fieldd
// adds nothing: no row, no record, nothing in the ledger. A debug line counts
// them by code — never an argument — for the leak detector that comes later.
//
// AR-L1 holds: no vendor, no vendor variable and no vendor command is spelled
// here. The names come from `runtime.launchProviders()`, the catalog decides
// which are offered, and an agent's label in a sentence is the catalog row's.
//
// What is never logged, audited or projected: the bearer, a recipe's
// environment, a request's environment, its arguments, its working directory.

/** THE one word for the four places the kit keeps strictness: the host's
 * declines, the gateway's own failures, the rendezvous, and each launcher's
 * say for the moment no rendezvous can be read. */
export const AGENT_GATEWAY_STRICT = true as const;

/** The host's name in the shim's own sentences ("waiting for VibeField to
 * start it as a managed session…"): the same in the rendezvous and in every
 * launcher. */
export const AGENT_GATEWAY_HOST_LABEL = "VibeField";

/** The imposter's route in the shim: a command of this name is never a real
 * agent's (the kit reads the provider from a flag after it). VibeField offers
 * no imposter, so the name gets no launcher. */
const KIT_RESERVED_COMMAND = "ai";

/** How far a shell's start may stand from its session's birth and still be
 * that session's shell. The floor's inventory row does not say whether a
 * session has exited, and a session kept after its process ended still lists
 * that process's pid — which the system hands to another process in time. A
 * pid read for the FIRST time is therefore the session's shell only if it
 * started when the session did: the floor forks the shell as it creates the
 * session, so the two are milliseconds apart, and a reused pid is minutes to
 * days later. Generous, because `ps` reports whole seconds and a loaded host
 * is slow; a pid read once is never read again, whatever the clock says. */
const SHELL_BIRTH_TOLERANCE_MS = 60_000;

/** The kit's own bound on the shells one host lists. */
const MAX_LISTED_SHELLS = 1_024;

/** How long a stop waits for a launch already under way to be answered. */
const STOP_LAUNCH_WAIT_MS = 3_000;

/** A sentence is one line, well inside the kit's bound: the shim prints the
 * command's name before it and holds the whole to the same limit. */
const REFUSAL_BUDGET = 320;
const ARGUMENT_BUDGET = 64;
const REASON_BUDGET = 120;

// ── the shim home ──

/** `<user root>/agents/shims` — the kit's home: the rendezvous, the provider
 * table, the list of our shells, the launchers. The path is FOREVER: it lives
 * in the environment of every shell a pane was born with, and those shells
 * outlive fieldd and an app update. Never versioned, never moved. */
export function agentShimHome(userRoot: string): string {
  return join(userRoot, ...LAYOUT.AGENT_SHIMS_DIR);
}

/** The physical path: every symlink resolved. A path that does not exist yet
 * is resolved as far up as it does, so a home about to be made under `/tmp`
 * already reads `/private/tmp/…`. */
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let existing = absolute;
  for (;;) {
    try {
      return join(realpathSync(existing), ...missing.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return absolute;
      missing.push(existing.slice(parent.length).replace(/^[\\/]+/u, ""));
      existing = parent;
    }
  }
}

/** Whether the home will still hold its files next week. macOS's nightly
 * cleaner empties a temp directory of files not read for about three days and
 * leaves the directories standing (seen 2026-09-27: 105 homes of the reference
 * app, each emptied to a bare directory) — so a home under the system's temp
 * directory loses its launchers while the shells that name it live on. */
export function shimHomeIsDurable(home: string, temp: string = tmpdir()): boolean {
  const within = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
  return !within(resolve(temp), resolve(home)) && !within(canonicalPath(temp), canonicalPath(home));
}

// ── the launcher's runtime ──

/** What `process.versions.node` prints. */
const NODE_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u;

/** `process.execve`, the shim's exec in place: Node's own record is "Added
 * in: v23.11.0, v22.15.0" — so 22.15 and later on the 22 line, 23.11 and later
 * on the 23 line, every 24 and later. 23.0–23.10 do NOT have it. */
export function nodeCanExecInPlace(version: string): boolean {
  const match = NODE_VERSION.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 24 || (major === 23 && minor >= 11) || (major === 22 && minor >= 15);
}

/** The first executable `node` on `path`, made absolute — never one in a
 * shim directory, under any spelling: a fieldd started from one of our panes
 * inherits that pane's launcher directory at the head of its PATH. */
export function firstNodeOnPath(
  path: string,
  shimDirectories: readonly (string | undefined)[],
): string | undefined {
  const shims = shimDirectories.filter(
    (directory): directory is string => directory !== undefined && directory !== "",
  );
  const spelled = new Set(shims.map((directory) => resolve(directory)));
  const canonical = new Set(shims.map(canonicalPath));
  const isShimDirectory = (directory: string): boolean =>
    spelled.has(resolve(directory)) || canonical.has(canonicalPath(directory));
  for (const entry of path.split(delimiter)) {
    if (entry === "" || isShimDirectory(entry)) continue;
    const candidate = resolve(entry, "node");
    if (isExecutableFile(candidate) && !isShimDirectory(dirname(canonicalPath(candidate))))
      return candidate;
  }
  return undefined;
}

/** `<node> -p process.versions.node`, run without a shell and bounded: the
 * version it reports, or undefined. */
export function probeNodeVersion(command: string, timeoutMs = 5_000): Promise<string | undefined> {
  return new Promise((answer) => {
    execFile(
      command,
      ["-p", "process.versions.node"],
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => answer(error === null ? stdout.trim() || undefined : undefined),
    );
  });
}

/** What the rule below reads, each injectable: a unit row states a case by
 * its facts and never by the machine it happens to run on. */
export interface LauncherRuntimeFacts {
  /** `FielddConfig.agentGateway.launcher` — a test's, or a packaged layout's own */
  configured?: SpawnThroughShimRuntime | undefined;
  /** `process.versions.electron`: set when this process is Electron, as Node or not */
  electron: string | undefined;
  /** this process is a single-executable application (a packaged fieldd, EDP-14) */
  sea: boolean;
  /** this process's own program, and the Node it carries */
  execPath: string;
  nodeVersion: string;
  /** fieldd's own PATH, as it started */
  path: string;
  /** spawn-through shim directories: never searched */
  shimDirectories: readonly (string | undefined)[];
  /** asks a candidate for its version (default: run it, no shell, bounded) */
  probe?: ((command: string) => Promise<string | undefined>) | undefined;
}

export type LauncherRuntimeChoice =
  | {
      runtime: SpawnThroughShimRuntime;
      source: "configured" | "own-node" | "path-node";
      version?: string | undefined;
    }
  | { runtime: undefined; reason: string };

/** THE LAUNCHER'S RUNTIME — the program every launcher execs on the shim —
 * chosen once, at the gateway's start.
 *
 * Electron as Node is NEVER it, not even as a fallback. MEASURED 2026-09-27 in
 * the reference app (lane U1b): under Electron-as-Node `process.execve` STALLS
 * FOR SECONDS — median 4.3 s from the call to the new program's first
 * instruction (78 ms – 11.3 s, 8 samples), against 65 ms under a real Node on
 * the same host at the same load; end to end through the launcher, 17.5 s
 * against 0.3 s. Every agent typed in a pane would wait for it.
 *
 * In order:
 *  1. the configured runtime, when one is given;
 *  2. fieldd under a real Node (not Electron, not a single executable) whose
 *     own version can exec in place: that Node, with no extra environment;
 *  3. otherwise, unless fieldd is a single executable: the first `node` on
 *     fieldd's own PATH (shim directories excluded), asked ONCE for its version
 *     — it qualifies when it has `process.execve`. A launcher naming a Node
 *     without it makes the shim leave 127 on every typed agent;
 *  4. none. The gateway then offers no launcher and removes any it finds, and
 *     a name typed in a pane runs as the shell runs it.
 *
 * A packaged build is case 4 until its own slice (AR-7j): its fieldd is a
 * single executable, its RunAsNode fuse is off, and nothing here pretends
 * otherwise. */
export async function chooseLauncherRuntime(
  facts: LauncherRuntimeFacts,
): Promise<LauncherRuntimeChoice> {
  if (facts.configured !== undefined) {
    return isAbsolute(facts.configured.command)
      ? { runtime: facts.configured, source: "configured" }
      : {
          runtime: undefined,
          reason: "the configured launcher runtime is not an absolute path",
        };
  }
  if (facts.sea) {
    return {
      runtime: undefined,
      reason:
        "fieldd is a single executable and carries no Node a launcher can run; a packaged build's launcher runtime is its own slice (AR-7j)",
    };
  }
  if (facts.electron === undefined && nodeCanExecInPlace(facts.nodeVersion)) {
    return {
      runtime: { command: facts.execPath },
      source: "own-node",
      version: facts.nodeVersion,
    };
  }
  const under =
    facts.electron === undefined
      ? `fieldd's own Node ${facts.nodeVersion} cannot exec in place`
      : "fieldd runs under Electron as Node, which is never the launcher's runtime";
  const node = firstNodeOnPath(facts.path, facts.shimDirectories);
  if (node === undefined) return { runtime: undefined, reason: `${under}; no node on PATH` };
  const version = await (facts.probe ?? probeNodeVersion)(node);
  if (version === undefined || !NODE_VERSION.test(version)) {
    return { runtime: undefined, reason: `${under}; the node on PATH reported no version` };
  }
  if (!nodeCanExecInPlace(version)) {
    return {
      runtime: undefined,
      reason: `${under}; the node on PATH is ${version}, which cannot exec in place (22.15, 23.11 or later)`,
    };
  }
  return { runtime: { command: node }, source: "path-node", version };
}

/** This process's own facts for the rule. */
function ownRuntimeFacts(
  shimDirectories: readonly (string | undefined)[],
): Omit<LauncherRuntimeFacts, "configured"> {
  let sea = false;
  try {
    const builtin = process.getBuiltinModule?.("node:sea") as { isSea?: () => boolean } | undefined;
    sea = builtin?.isSea?.() === true;
  } catch {
    // a Node with no such module is no single executable
  }
  return {
    electron: process.versions["electron"],
    sea,
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    path: process.env["PATH"] ?? "",
    shimDirectories,
  };
}

// ── the words of a refusal ──

function clip(text: string, budget: number): string {
  const characters = Array.from(boundSpawnThroughText(text).replace(/\n/gu, " "));
  return characters.length <= budget
    ? characters.join("")
    : `${characters.slice(0, budget - 1).join("")}…`;
}

/** What a sentence is made from: the command as it was typed, the catalog's
 * label for the agent, and — for a rejected argument only — the argument and
 * the adapter's own reason. */
interface RefusalFacts {
  command: string;
  label: string;
  argument?: string | undefined;
  reason: string;
}

/** THE TABLE: one sentence per code the kit defines (DESIGN.md §9 — what
 * happened and what to do next, plain, no apology). Each names the command as
 * typed, says that nothing was started, and says why in words a person can act
 * on. A code the kit adds later fails this file's typecheck and the row that
 * enumerates the kit's list. The first three and the three that mean "ran as
 * typed" are never printed today — the kit words its gateway's own refusals
 * itself, and never refuses what is not a session in a terminal of ours — and
 * are written so the table is whole. */
const REFUSAL_WORDS: Record<SpawnThroughDeclineCode, (facts: RefusalFacts) => string> = {
  unauthenticated: ({ command }) =>
    `${command} was not started: this pane's launcher is out of date. Open a new pane and run ${command} again.`,
  "request-too-large": ({ command }) =>
    `${command} was not started: its arguments are too long to carry into a managed session. Put the text in a file and name the file instead.`,
  "handler-failed": ({ command }) =>
    `${command} was not started: VibeField could not take the launch. Run ${command} again; if it happens twice, restart VibeField.`,
  "invalid-request": ({ command }) =>
    `${command} was not started: VibeField could not read the launch. Open a new pane and run ${command} again.`,
  passthrough: ({ command }) =>
    `${command} was not started as a managed session: this command is not a session.`,
  "not-interactive": ({ command }) =>
    `${command} was not started as a managed session: its input or output is not a terminal.`,
  "outside-host-terminals": ({ command }) =>
    `${command} was not started as a managed session: it is not running in a VibeField pane.`,
  "unsupported-agent": ({ command, label }) =>
    `${command} was not started: ${label} does not run as a managed session on this device now. See Settings → Agents.`,
  "invalid-invocation": ({ command, label }) =>
    `${command} was not started: ${label} could not be given this command line as a managed session. Run ${command} with no options, then set them inside the session.`,
  "rejected-argument": ({ command, argument, reason }) =>
    argument === undefined
      ? `${command} was not started: a managed session cannot carry these arguments (${reason}). Run ${command} without them.`
      : `${command} was not started: a managed session cannot carry ${argument} (${reason}). Run ${command} without it.`,
  "imposter-unavailable": ({ command, label }) =>
    `${command} was not started: VibeField has no stand-in for ${label}. Run ${label} by its own name.`,
  "prepare-failed": ({ command, label }) =>
    `${command} was not started: ${label} could not be prepared as a managed session. Run ${command} again.`,
  "terminal-conflict": ({ command }) =>
    `${command} was not started: another agent is already running in this pane. Quit it first, or open another pane.`,
  "adopt-failed": ({ command }) =>
    `${command} was not started: VibeField could not record it as a managed session. Run ${command} again.`,
};

/** VibeField's sentence for a refusal: one line, inside the kit's bound. The
 * adapter's reason is quoted only beside a rejected argument, and with the
 * argument taken off its end (the kit hands both; a sentence uses each once). */
export function agentRefusal(refused: SpawnThroughRefusal, label: string): string {
  const argument =
    refused.argument === undefined ? undefined : clip(refused.argument, ARGUMENT_BUDGET);
  const suffix = refused.argument === undefined ? "" : ` (${refused.argument})`;
  const reason = clip(
    suffix !== "" && refused.reason.endsWith(suffix)
      ? refused.reason.slice(0, -suffix.length)
      : refused.reason,
    REASON_BUDGET,
  );
  const words = REFUSAL_WORDS[refused.code]({
    command: clip(refused.command, ARGUMENT_BUDGET),
    label: clip(label, ARGUMENT_BUDGET),
    ...(argument === undefined || argument === "" ? {} : { argument }),
    reason,
  });
  return clip(words, REFUSAL_BUDGET);
}

/** A kit code as the ledger spells a reason (`[A-Z][A-Z0-9_]*`). */
export function refusalReasonCode(code: SpawnThroughDeclineCode): string {
  return code.toUpperCase().replace(/-/gu, "_");
}

// ── which agents are given a launcher ──

export type LauncherWithheld =
  | "not-visible"
  | "no-invoke"
  | "no-grammar"
  | "does-not-classify"
  | "no-name"
  | "no-executable";

export interface OfferedLaunch {
  /** the provider table a shim reads: each command naming its REAL executable */
  providers: AgentLaunchProvider[];
  /** one launcher per name */
  names: string[];
  /** who got none, and why */
  withheld: Array<{ provider: string; why: LauncherWithheld }>;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The offered set: the runtime's launch providers ∩ the catalog's visible
 * rows that offer `invoke` ∩ the adapters that CLASSIFY ∩ the agents with a
 * real executable on this device.
 *
 * `classifies` is what makes strict livable: an adapter that cannot tell a
 * version query from a session answers `rejected` for both, and a strict host
 * would refuse the version query. Such an agent gets no launcher, and its name
 * runs as the shell runs it.
 *
 * Every launcher's command names an absolute, executable file outside the
 * launcher directory: the shim looks for it BEFORE it asks anything, and with
 * none it leaves 127 without reaching the gateway. */
export function offeredLaunch(input: {
  launchProviders: readonly AgentLaunchProvider[];
  catalog: AgentCatalogReaders;
  /** provider id → the executable its managed launch runs */
  executables: ReadonlyMap<string, string>;
  shimDirectory: string;
}): OfferedLaunch {
  const { catalog } = input;
  const shimDirectory = canonicalPath(input.shimDirectory);
  const offered: OfferedLaunch = { providers: [], names: [], withheld: [] };
  const taken = new Set<string>();
  for (const provider of input.launchProviders) {
    const why = withheldBeforeExecutable(provider, catalog);
    if (why !== undefined) {
      offered.withheld.push({ provider: provider.id, why });
      continue;
    }
    const capability = provider.nativeInvocation;
    if (capability === undefined) continue;
    // a name a launcher can be written for, that no agent before this one took
    const named = capability.commands.filter(
      (command) =>
        command.name !== KIT_RESERVED_COMMAND &&
        isSpawnThroughCommandName(command.name) &&
        !taken.has(command.name),
    );
    if (named.length === 0) {
      offered.withheld.push({ provider: provider.id, why: "no-name" });
      continue;
    }
    const executable = input.executables.get(provider.id);
    const commands = named
      .map((command) => ({ ...command, executable: executable ?? command.executable }))
      .filter(
        (command) =>
          isAbsolute(command.executable) &&
          isExecutableFile(command.executable) &&
          dirname(canonicalPath(command.executable)) !== shimDirectory,
      );
    if (commands.length === 0) {
      offered.withheld.push({ provider: provider.id, why: "no-executable" });
      continue;
    }
    for (const command of commands) taken.add(command.name);
    offered.providers.push({ ...provider, nativeInvocation: { ...capability, commands } });
    offered.names.push(...commands.map((command) => command.name));
  }
  return offered;
}

/** The catalog's word and the adapter's, before any executable is looked for
 * — so no agent's install is read for an agent that would get no launcher. */
function withheldBeforeExecutable(
  provider: AgentLaunchProvider,
  catalog: AgentCatalogReaders,
): LauncherWithheld | undefined {
  if (!catalog.isVisible(provider.id)) return "not-visible";
  if (catalog.entry(provider.id)?.offers.invoke !== true) return "no-invoke";
  if (provider.nativeInvocation === undefined) return "no-grammar";
  if (provider.nativeInvocation.classifies !== true) return "does-not-classify";
  return undefined;
}

// ── our shells ──

/** One shell a pane runs: the process every descendant of which is IN that
 * pane. The kit's walk hands this record back, so it carries the session. */
export interface OwnedShell {
  pid: number;
  /** exactly what the kit's `processStartedAt` reports for the pid */
  startedAt: string;
  terminalSessionId: string;
}

/** Whether a process that started at `startedAt` is the shell of a session
 * born at `createdAt` (see `SHELL_BIRTH_TOLERANCE_MS`). A session whose birth
 * the floor did not report cannot be doubted this way. */
export function startedWithSession(startedAt: string, createdAt: number | undefined): boolean {
  if (createdAt === undefined) return true;
  const started = Date.parse(startedAt);
  return !Number.isNaN(started) && Math.abs(started - createdAt) <= SHELL_BIRTH_TOLERANCE_MS;
}

/** The slice of `TerminalService` the gateway reads: the floor's observed
 * inventory, and the three moments it changes. */
export interface GatewayTerminals {
  observation(): unknown;
  list(): readonly TerminalInfo[];
  onInventory(listener: (terminals: readonly TerminalInfo[]) => void): () => void;
  onSessionExited(listener: (event: { sessionId: string }) => void): () => void;
  onSessionBorn(listener: (born: { sessionId: string; pid: number | null }) => void): () => void;
}

// ── the service ──

/** The kit's functions, each replaceable by a unit row that reads what it is
 * called with; production never passes any. */
export interface SpawnThroughKit {
  startSpawnThroughGateway: typeof startSpawnThroughGateway;
  prepareSpawnThroughLaunch: typeof prepareSpawnThroughLaunch;
  materializeShims: typeof materializeShims;
  writeRendezvous: typeof writeRendezvous;
  clearRendezvous: typeof clearRendezvous;
  writeTerminals: typeof writeTerminals;
}

const KIT: SpawnThroughKit = {
  startSpawnThroughGateway,
  prepareSpawnThroughLaunch,
  materializeShims,
  writeRendezvous,
  clearRendezvous,
  writeTerminals,
};

export interface AgentGatewayOptions {
  /** this user's root: the shim home is `agentShimHome(userRoot)` */
  userRoot: string;
  /** puppeteer's */
  runtime: AgentRuntime;
  /** who is visible, who offers `invoke`, under which label */
  catalog: AgentCatalogReaders;
  /** the floor's terminal service, late-bound; null = no floor, no gateway */
  terminals: () => GatewayTerminals | null;
  /** the fold's entry points (`AgentRuntimeService`) */
  fold: AgentAdoption;
  /** provider id → the absolute executable its managed launch runs on this
   * device (the ACTIVE install's — the path the providers were composed with,
   * so a recipe never re-enters a launcher). Asked only for the agents that
   * passed the catalog and the adapter, so no install is read for an agent
   * that would get no launcher anyway. */
  executables: (
    providers: readonly string[],
  ) => ReadonlyMap<string, string> | Promise<ReadonlyMap<string, string>>;
  /** the bundled shim; default: `agent-shim.cjs` beside the daemon's bundle —
   * built from the kit the daemon was bundled with (the build's third step),
   * so a pin move re-bundles it */
  shimScript?: string | undefined;
  /** the launcher's runtime, when the caller names one (case 1 of the rule) */
  launcher?: SpawnThroughShimRuntime | undefined;
  /** how long a launcher in one of our panes waits for a fieldd that does not
   * answer before it refuses (default: the kit's) */
  retryMs?: number | undefined;
  /** test seam: the process table a launch is placed in (default: the kit's
   * one `ps` read, per request) */
  processTable?: (() => Promise<ProcessTable | undefined>) | undefined;
  /** test seam: when a pid started (default: the kit's) */
  processStartedAt?: ((pid: number) => Promise<string | undefined>) | undefined;
  /** test seam: this process's facts for the launcher's runtime */
  runtimeFacts?: Partial<Omit<LauncherRuntimeFacts, "configured">> | undefined;
  /** test seam: the kit's functions */
  kit?: Partial<SpawnThroughKit> | undefined;
  /** the ledger's system-actor entry; absent = logged, not audited (unit seams) */
  audit?: SystemAudit | undefined;
  logger?: Logger | undefined;
}

/** A launch placed in one of our panes. */
interface Placed {
  shell: OwnedShell;
  /** when the asking process started, as the table that placed it read it */
  startedAt: string | undefined;
}

/** What one launch has established so far, for the decline fieldd makes
 * itself when a door throws. */
interface LaunchProgress {
  placed?: Placed | undefined;
  /** puppeteer adopted the run and the fold could not enter it */
  adoptionUndone: boolean;
}

/** THE RULE OF REFUSAL, as the kit holds it (`prepare.ts`), for the one
 * decline the kit cannot make: a launch is refused only when the host is
 * strict, the launch is an interactive session, and the process is in a
 * terminal the host owns. */
function refuses(strict: boolean, interactive: boolean, placed: boolean): boolean {
  return strict && interactive && placed;
}

/** What the gateway holds up, without a secret in it. */
export interface AgentGatewayState {
  home: string;
  listening: boolean;
  port?: number | undefined;
  /** the launchers standing now */
  names: readonly string[];
  /** the launcher's runtime, or why there is none */
  launcher: { command: string; source: string } | { reason: string } | undefined;
}

/** fieldd as the host of puppeteer's spawn-through kit. */
export class AgentGatewayService {
  readonly home: string;
  private readonly logger: Logger;
  private readonly kit: SpawnThroughKit;
  private gateway: SpawnThroughGateway | undefined;
  private token: string | undefined;
  private choice: LauncherRuntimeChoice | undefined;
  private offered: OfferedLaunch = { providers: [], names: [], withheld: [] };
  /** every write to the home, one after another: each is atomic, two at once
   * race and the older list can win */
  private queue: Promise<unknown> = Promise.resolve();
  private bringingUp: Promise<void> | undefined;
  private published = false;
  /** our shells by session; a pid is read ONCE, when the session is first seen */
  private readonly shells = new Map<string, OwnedShell>();
  /** births the inventory has not listed yet */
  private readonly born = new Map<string, number>();
  /** sessions whose process ended while the floor still lists them */
  private readonly ended = new Set<string>();
  /** `<session>:<pid>` the process table has already denied: a session the
   * floor keeps after its shell ended, or a pid a later process holds */
  private readonly notShells = new Set<string>();
  private listed: string | undefined;
  private shellsPending = false;
  private readonly unlisten: Array<() => void> = [];
  private readonly said = new Set<string>();
  /** launches under way, for a stop to wait on */
  private readonly launching = new Set<Promise<unknown>>();
  /** the runs adopted here, by preparation — what `exec-failed` names */
  private readonly adoptions = new Map<string, { runtimeRunId: string }>();
  /** launches that ran as typed, by code (no argument, no provider's words) */
  private readonly ranAsTyped = new Map<SpawnThroughDeclineCode, number>();
  private stopping: Promise<void> | undefined;

  constructor(private readonly opts: AgentGatewayOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.kit = { ...KIT, ...opts.kit };
    this.home = agentShimHome(opts.userRoot);
  }

  // ── lifetime ──

  /** Bring the gateway up: the launcher's runtime chosen, the launchers
   * written for the agents offered (and none for any other), the listener
   * bound under a fresh bearer, the rendezvous and the list of our shells
   * published. Idempotent. A daemon with no floor starts nothing. */
  start(): Promise<void> {
    this.bringingUp ??= this.enqueue(() => this.bringUp());
    return this.bringingUp;
  }

  /** The install inventory or the catalog's answer changed: the launchers,
   * the provider table and the list of our shells are written again. A home
   * that lost a file heals here. */
  async refresh(): Promise<void> {
    if (this.bringingUp === undefined) return;
    await this.bringingUp;
    await this.enqueue(() => this.publish());
  }

  /** Close the gateway and withdraw the rendezvous — this bearer's, never a
   * successor's. The list of our shells is LEFT: while fieldd is away a
   * launcher in one of our panes waits for it and a launcher anywhere else
   * falls through at once, and both read the list. A launch already under
   * way is answered first; one that arrives now is left unanswered, so its
   * launcher waits for the fieldd that comes next. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      for (const off of this.unlisten.splice(0)) off();
      if (this.launching.size > 0) {
        await Promise.race([
          Promise.allSettled([...this.launching]),
          new Promise<void>((done) => {
            const timer = setTimeout(done, STOP_LAUNCH_WAIT_MS);
            timer.unref();
          }),
        ]);
      }
      await this.enqueue(async () => {
        const { gateway, token } = this;
        this.gateway = undefined;
        if (gateway !== undefined) await gateway.close();
        if (token !== undefined) await this.kit.clearRendezvous(this.home, { token });
      });
    })();
    return this.stopping;
  }

  /** The agents a launcher stands for now, by provider id. */
  launchers(): ReadonlySet<string> {
    return new Set(this.offered.providers.map((provider) => provider.id));
  }

  state(): AgentGatewayState {
    const choice = this.choice;
    return {
      home: this.home,
      listening: this.gateway !== undefined,
      ...(this.gateway !== undefined ? { port: this.gateway.port } : {}),
      names: [...this.offered.names],
      launcher:
        choice === undefined
          ? undefined
          : choice.runtime === undefined
            ? { reason: choice.reason }
            : { command: choice.runtime.command, source: choice.source },
    };
  }

  /** How many launches ran as typed, by the kit's code. */
  counts(): ReadonlyMap<SpawnThroughDeclineCode, number> {
    return new Map(this.ranAsTyped);
  }

  private async bringUp(): Promise<void> {
    if (this.stopping !== undefined) return;
    const terminals = this.opts.terminals();
    if (terminals === null) {
      this.logger.info(
        "fieldd.agents.gateway_no_floor",
        "No terminal floor is lent to this daemon; the agent gateway is not started",
      );
      return;
    }
    const layout = spawnThroughLayout(this.home);
    this.choice = await chooseLauncherRuntime({
      ...ownRuntimeFacts([layout.shimDirectory, process.env["PUPPETEER_SHIM_DIR"]]),
      ...this.opts.runtimeFacts,
      ...(this.opts.launcher !== undefined ? { configured: this.opts.launcher } : {}),
    });
    if (this.choice.runtime === undefined) {
      this.logger.warn(
        "fieldd.agents.gateway_no_launcher_runtime",
        "No program can run an agent's launcher here; no launcher is offered and a typed agent runs as the shell runs it",
        { reason: this.choice.reason },
      );
    } else {
      this.logger.info("fieldd.agents.gateway_launcher_runtime", "The launcher's runtime", {
        source: this.choice.source,
        command: this.choice.runtime.command,
        ...(this.choice.version !== undefined ? { version: this.choice.version } : {}),
      });
    }
    // our shells change at three moments: a birth, an exit, an inventory
    this.unlisten.push(
      terminals.onSessionBorn((born) => {
        if (born.pid !== null) this.born.set(born.sessionId, born.pid);
        this.shellsChanged();
      }),
      terminals.onSessionExited((event) => {
        this.born.delete(event.sessionId);
        this.ended.add(event.sessionId);
        this.shellsChanged();
      }),
      terminals.onInventory(() => this.shellsChanged()),
    );
    await this.publish();
  }

  /** The launchers, the listener, the rendezvous, the list — in the kit's own
   * order. With nothing to offer and no home on disk there is nothing of ours
   * on this device to keep true, and nothing is written. */
  private async publish(): Promise<void> {
    if (this.stopping !== undefined) return;
    const script = this.bundledShim();
    const runtime = this.choice?.runtime;
    this.offered =
      script === undefined || runtime === undefined
        ? { providers: [], names: [], withheld: [] }
        : await this.offer();
    this.sayWithheld();
    if (this.offered.names.length === 0 && !existsSync(this.home) && this.gateway === undefined) {
      return;
    }
    if (!shimHomeIsDurable(this.home)) {
      this.sayOnce("temp-home", () =>
        this.logger.warn(
          "fieldd.agents.gateway_home_in_temp",
          "The launchers' home is under the system's temp directory, which the OS empties of files it has not read for days",
          { home: this.home },
        ),
      );
    }
    const layout = spawnThroughLayout(this.home);
    // the shim to copy into the home: the bundle, else the home's own copy —
    // which a launcher-less home still needs read to have its launchers removed
    const copy = script ?? (existsSync(layout.script) ? layout.script : undefined);
    if (copy !== undefined) {
      await this.kit.materializeShims({
        home: this.home,
        names: this.offered.names,
        script: copy,
        // with no names no launcher is written, and the runtime is only a form
        runtime: runtime ?? { command: process.execPath },
        strict: AGENT_GATEWAY_STRICT,
        hostLabel: AGENT_GATEWAY_HOST_LABEL,
      });
    }
    if (this.gateway === undefined) {
      this.token = randomBytes(32).toString("hex");
      this.gateway = await this.kit.startSpawnThroughGateway({
        token: this.token,
        strict: AGENT_GATEWAY_STRICT,
        handle: (request) => this.handle(request),
      });
    }
    if (this.token === undefined) return;
    await this.kit.writeRendezvous(this.home, {
      port: this.gateway.port,
      token: this.token,
      strict: AGENT_GATEWAY_STRICT,
      retryMs: this.opts.retryMs ?? DEFAULT_RETRY_MS,
      launchProviders: this.offered.providers,
      hostLabel: AGENT_GATEWAY_HOST_LABEL,
    });
    this.published = true;
    this.listed = undefined;
    await this.writeShells();
    this.logger.info("fieldd.agents.gateway_published", "The agent gateway is up", {
      launchers: this.offered.names.length,
      providers: this.offered.providers.map((provider) => provider.id),
      shells: this.shells.size,
    });
  }

  private bundledShim(): string | undefined {
    const script =
      this.opts.shimScript ??
      (typeof __dirname === "string" ? join(__dirname, "agent-shim.cjs") : undefined);
    if (script !== undefined && isReadableFile(script)) return script;
    this.sayOnce("no-bundle", () =>
      this.logger.warn(
        "fieldd.agents.gateway_no_shim",
        "The bundled shim is missing beside the daemon; no launcher is offered and a typed agent runs as the shell runs it",
        { ...(script !== undefined ? { script } : {}) },
      ),
    );
    return undefined;
  }

  private async offer(): Promise<OfferedLaunch> {
    const launchProviders = this.opts.runtime.launchProviders();
    const asked = launchProviders
      .filter((provider) => withheldBeforeExecutable(provider, this.opts.catalog) === undefined)
      .map((provider) => provider.id);
    let executables: ReadonlyMap<string, string> = new Map();
    if (asked.length > 0) {
      try {
        executables = await this.opts.executables(asked);
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.gateway_installs_unread",
          "The agents' installs could not be read; a launcher stands only where the adapter names an executable itself",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    return offeredLaunch({
      launchProviders,
      catalog: this.opts.catalog,
      executables,
      shimDirectory: spawnThroughLayout(this.home).shimDirectory,
    });
  }

  /** Who got no launcher, once each, by id. */
  private sayWithheld(): void {
    const reason = this.choice?.runtime === undefined ? this.choice?.reason : undefined;
    if (reason !== undefined) return; // said at the start, for every agent at once
    for (const { provider, why } of this.offered.withheld) {
      // an agent the catalog does not show, or does not offer by name, is a
      // decision made elsewhere and not news
      if (why === "not-visible" || why === "no-invoke" || why === "no-grammar") continue;
      this.sayOnce(`${provider}:${why}`, () =>
        this.logger.info(
          "fieldd.agents.gateway_launcher_withheld",
          "An agent is given no launcher; its name runs as the shell runs it",
          { provider, why },
        ),
      );
    }
  }

  private sayOnce(key: string, say: () => void): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    say();
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch((error: unknown) => {
      this.logger.warn("fieldd.agents.gateway_write_failed", "The agent gateway's home is behind", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return next;
  }

  // ── our shells ──

  private shellsChanged(): void {
    if (this.shellsPending || this.stopping !== undefined) return;
    this.shellsPending = true;
    void this.enqueue(async () => {
      this.shellsPending = false;
      await this.writeShells();
    }).catch(() => undefined);
  }

  /** Bring `shells` to what the floor lists now. A session seen for the first
   * time has its shell's start read from ONE read of the process table (the
   * caller's, when it already read one) — the kit's own reading, the same its
   * `processStartedAt` gives — and never again. A table that cannot be read
   * leaves the new sessions out until the next change asks again. */
  private async syncShells(given?: ProcessTable | undefined): Promise<void> {
    const terminals = this.opts.terminals();
    const rows = new Map<string, { pid: number; createdAt?: number | undefined }>();
    if (terminals !== null && terminals.observation() !== undefined) {
      for (const row of terminals.list()) {
        if (row.pid === undefined) continue;
        rows.set(row.sessionId, { pid: row.pid, createdAt: row.createdAt });
        // placed by the inventory: its birth is no longer the only word on it
        this.born.delete(row.sessionId);
      }
      for (const sessionId of [...this.ended]) {
        if (!rows.has(sessionId)) this.ended.delete(sessionId);
      }
    }
    for (const [sessionId, pid] of this.born) rows.set(sessionId, { pid });
    for (const [sessionId, shell] of [...this.shells]) {
      const row = rows.get(sessionId);
      if (row === undefined || row.pid !== shell.pid || this.ended.has(sessionId)) {
        this.shells.delete(sessionId);
      }
    }
    for (const key of [...this.notShells]) {
      const sessionId = key.slice(0, key.lastIndexOf(":"));
      if (!rows.has(sessionId)) this.notShells.delete(key);
    }
    const unread = [...rows].filter(
      ([sessionId, row]) =>
        !this.shells.has(sessionId) &&
        !this.ended.has(sessionId) &&
        !this.notShells.has(`${sessionId}:${row.pid}`),
    );
    if (unread.length === 0) return;
    const table = given ?? (await (this.opts.processTable ?? readProcessTable)());
    if (table === undefined) {
      this.logger.warn(
        "fieldd.agents.gateway_process_table_unread",
        "The process table could not be read; new shells are listed at the next change",
        { unread: unread.length },
      );
      return;
    }
    for (const [sessionId, row] of unread) {
      const process = table.get(row.pid);
      // no such process: the session is kept by the floor after its shell
      // ended. A start the table could not read is asked again next time.
      if (process === undefined) this.notShells.add(`${sessionId}:${row.pid}`);
      if (process?.startedAt === undefined) continue;
      if (!startedWithSession(process.startedAt, row.createdAt)) {
        this.notShells.add(`${sessionId}:${row.pid}`);
        this.logger.info(
          "fieldd.agents.gateway_shell_gone",
          "A listed session's pid belongs to a later process; the session is not one of our shells",
          { sessionId, pid: row.pid },
        );
        continue;
      }
      this.shells.set(sessionId, {
        pid: row.pid,
        startedAt: process.startedAt,
        terminalSessionId: sessionId,
      });
    }
  }

  /** The list of our shells, written whole — only when it changed, and only
   * once there is a home to write it in. */
  private async writeShells(): Promise<void> {
    if (!this.published || this.stopping !== undefined) return;
    await this.syncShells();
    const shells = [...this.shells.values()]
      .sort((a, b) => a.pid - b.pid)
      .slice(0, MAX_LISTED_SHELLS);
    const listing = JSON.stringify(shells.map(({ pid, startedAt }) => [pid, startedAt]));
    if (listing === this.listed) return;
    await this.kit.writeTerminals(this.home, shells);
    this.listed = listing;
  }

  /** WHICH OF OUR TERMINALS HOLDS A PROCESS — the kit's own walk, from the pid
   * up through its parents to the shell of a session the floor lists. The
   * process table is read once, per request: a launcher that started a moment
   * ago is in no older table.
   *
   * This is the EL7 binding. A request's pid is self-asserted — anything that
   * holds the bearer can name any pid — and the answer is given only for a
   * terminal whose own shell is that process or an ancestor of it, matched by
   * pid AND start time. A caller can ask for a run only in a terminal that
   * really contains the process it names.
   *
   * Never throws. When the table cannot be read nobody can say where the
   * process is, and the launch runs as typed (the kit's choice, kept). */
  async resolveTerminal(process: {
    pid: number;
    parentPid?: number | undefined;
  }): Promise<{ terminalSessionId: string } | undefined> {
    const placed = await this.place(process.pid);
    return placed === undefined ? undefined : { terminalSessionId: placed.shell.terminalSessionId };
  }

  private async place(pid: number): Promise<Placed | undefined> {
    try {
      const table = await (this.opts.processTable ?? readProcessTable)();
      if (table === undefined) {
        this.logger.warn(
          "fieldd.agents.gateway_process_table_unread",
          "The process table could not be read; the launch cannot be placed and runs as typed",
          { pid },
        );
        return undefined;
      }
      await this.enqueue(() => this.syncShells(table));
      const shell = await findOwningProcess({
        pid,
        owners: [...this.shells.values()],
        processTable: table,
      });
      if (shell === undefined) {
        this.logger.info(
          "fieldd.agents.gateway_outside_our_terminals",
          "A launch came from a process that is in no terminal of ours; it runs as typed",
          { pid },
        );
        return undefined;
      }
      return { shell, startedAt: table.get(pid)?.startedAt };
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.gateway_place_failed",
        "A launch could not be placed; it runs as typed",
        { pid, error: error instanceof Error ? error.message : String(error) },
      );
      return undefined;
    }
  }

  // ── a request ──

  /** One authenticated, parsed request. NEVER throws: a throw here would put
   * its raw message in front of the person at the prompt. */
  private async handle(request: SpawnThroughRequest): Promise<SpawnThroughResponse> {
    if (this.stopping !== undefined) {
      // the listener is closing under this request: nothing of it reaches the
      // launcher, which then waits for the fieldd that comes next
      await this.stopping;
      return declineSpawnThrough({ code: "handler-failed", reason: "the host is stopping" });
    }
    const work = request.type === "launch" ? this.launch(request) : this.execFailed(request);
    this.launching.add(work);
    try {
      return await work;
    } finally {
      this.launching.delete(work);
    }
  }

  private async launch(request: SpawnThroughLaunchRequest): Promise<SpawnThroughResponse> {
    const progress: LaunchProgress = { adoptionUndone: false };
    let answer: SpawnThroughResponse;
    try {
      let identity: ReturnType<AgentAdoption["identity"]> | undefined;
      const host: SpawnThroughHost = {
        runtime: this.launchDoors(),
        strict: AGENT_GATEWAY_STRICT,
        resolveTerminal: async ({ pid }) => {
          progress.placed = await this.place(pid);
          return progress.placed === undefined
            ? undefined
            : { terminalSessionId: progress.placed.shell.terminalSessionId };
        },
        // the identity a spawn is given (AR-4): the claim the next boot
        // restores against, and the ingress the adapter binds. Asked for once
        // per launch, and only for a session already placed in a pane of ours.
        launchOptions: () => {
          identity = this.opts.fold.identity();
          return { creationRequestId: identity.creationRequestId, ingress: identity.ingress };
        },
        refusal: (refused) => this.words(refused),
        onAdopted: (adopted) => this.adopted(request, adopted, progress, identity?.launched()),
      };
      answer = await this.kit.prepareSpawnThroughLaunch(request, host);
    } catch (error) {
      // the kit lets a throwing door through (a disposed runtime, a fold that
      // could not enter the run). The message goes to the log, never the pane.
      this.logger.error(
        "fieldd.agents.gateway_launch_failed",
        "A typed launch failed inside the host; it is answered with a coded decline",
        error,
        { provider: request.providerId, placed: progress.placed !== undefined },
      );
      answer = this.declined(
        request,
        progress.placed,
        progress.adoptionUndone ? "adopt-failed" : "handler-failed",
      );
    }
    await this.account(request, answer, progress.placed);
    return answer;
  }

  /** puppeteer's launch doors as this host lends them to the kit: the agents
   * offered NOW — the launchers' own table, held to the catalog's word at this
   * moment, so a row that stopped offering `invoke` since the launchers were
   * written is declined as an agent that is not offered. */
  private launchDoors(): SpawnThroughHost["runtime"] {
    const { runtime, catalog } = this.opts;
    return {
      launchProviders: () =>
        this.offered.providers.filter(
          (provider) => withheldBeforeExecutable(provider, catalog) === undefined,
        ),
      classifyInvocation: (invocation) => runtime.classifyInvocation(invocation),
      prepareInvocation: (options) => runtime.prepareInvocation(options),
      adoptPrepared: (preparationId, options) => runtime.adoptPrepared(preparationId, options),
      cancelPrepared: (preparationId) => runtime.cancelPrepared(preparationId),
    };
  }

  /** A decline fieldd makes itself, for a launch that failed inside the host.
   * THE RULE OF REFUSAL is the kit's and is kept to the letter: a refusal
   * only where the launch is interactive and fieldd PLACED it — which the kit
   * asks for only after the adapter called it a session — and an answer built
   * by the kit's own function, never by hand (a shim reads an answer without
   * a code it knows, or without `placed`, as no answer at all). */
  private declined(
    request: SpawnThroughLaunchRequest,
    placed: Placed | undefined,
    code: SpawnThroughDeclineCode,
  ): SpawnThroughResponse {
    const decline = { code, reason: "the host could not complete the launch" };
    if (!refuses(AGENT_GATEWAY_STRICT, request.interactive, placed !== undefined)) {
      return declineSpawnThrough(decline);
    }
    return declineSpawnThrough(decline, {
      message: this.words({
        ...decline,
        providerId: request.providerId,
        command: request.command ?? request.providerId,
      }),
      placed: true,
    });
  }

  /** The sentence a refused person reads. Synchronous, and never a throw: the
   * kit would say its own sentence in place of one. */
  private words(refused: SpawnThroughRefusal): string {
    try {
      const label = this.opts.catalog.entry(refused.providerId)?.label ?? refused.command;
      return agentRefusal(refused, label);
    } catch {
      return spawnThroughRefusalMessage({ reason: "the host has no words for it" });
    }
  }

  /** puppeteer adopted the run: it enters the fold inside the audited act. If
   * it cannot, the adoption is UNDONE here — the kit does not undo it — and
   * the throw refuses the person in words. */
  private async adopted(
    request: SpawnThroughLaunchRequest,
    adopted: AdoptedSpawnThroughSession,
    progress: LaunchProgress,
    launched: ReturnType<ReturnType<AgentAdoption["identity"]>["launched"]> | undefined,
  ): Promise<void> {
    const { info, terminalSessionId, processId, preparationId } = adopted;
    try {
      if (launched === undefined) {
        throw new Error("the run was adopted without the identity a later boot restores against");
      }
      const startedAt =
        progress.placed?.startedAt ??
        (await (this.opts.processStartedAt ?? processStartedAt)(processId));
      if (startedAt === undefined) {
        throw new Error("the adopted process has no start time a later boot could compare");
      }
      const mutation: AuditMutation = {
        action: "agent.session.adopt",
        target: { kind: "agent-session", id: info.runtimeRunId },
        attrs: {
          provider: info.provider.id,
          sessionId: terminalSessionId,
          spawnedBy: "user-shell",
        },
      };
      await this.audited(
        mutation,
        () =>
          this.opts.fold.adopt({
            info,
            // the launcher's own working directory: already physical, and
            // held canonical so every later comparison meets the same path
            cwd: canonicalPath(request.cwd),
            process: { pid: processId, startedAt },
            launched,
          }),
        () => ({ outcome: "succeeded", attrs: { runtimeEpoch: info.runtimeEpoch } }),
      );
      this.adoptions.set(preparationId, { runtimeRunId: info.runtimeRunId });
      // `exec-failed` follows its `exec` by moments: a short memory is enough
      while (this.adoptions.size > 64) {
        const oldest = this.adoptions.keys().next().value;
        if (oldest === undefined) break;
        this.adoptions.delete(oldest);
      }
    } catch (error) {
      progress.adoptionUndone = true;
      await this.undo(adopted);
      throw error;
    }
  }

  /** Take an adoption back: the fold's row if it got that far, puppeteer's
   * run, the preparation. Each on its own — one that fails must not keep the
   * others from being tried. */
  private async undo(adopted: AdoptedSpawnThroughSession): Promise<void> {
    const steps: Array<() => Promise<unknown>> = [
      () =>
        this.opts.fold.withdraw(adopted.info.runtimeRunId, {
          exitCode: null,
          signal: null,
          reason: "adopt-failed",
        }),
      // puppeteer's own word for a run its host ended: a cancellation, never
      // a failure its monitor would keep for someone to acknowledge
      () =>
        this.opts.runtime.handleProcessExit(adopted.terminalSessionId, {
          exitCode: null,
          signal: null,
          reason: "runtime-terminated",
        }),
      () => this.opts.runtime.cancelPrepared(adopted.preparationId),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.gateway_undo_failed",
          "A step of taking an adoption back failed",
          {
            runtimeRunId: adopted.info.runtimeRunId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  /** The launcher could not run the recipe it was given: the run never
   * started. Its row is withdrawn and its record stamped first — while the
   * fold still holds it — then the preparation is cancelled. */
  private async execFailed(request: SpawnThroughExecFailedRequest): Promise<SpawnThroughResponse> {
    const adoption = this.adoptions.get(request.preparationId);
    this.adoptions.delete(request.preparationId);
    try {
      if (adoption !== undefined) {
        await this.opts.fold.withdraw(adoption.runtimeRunId, {
          exitCode: null,
          signal: null,
          reason: "exec-failed",
        });
      }
      await this.opts.runtime.cancelPrepared(request.preparationId);
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.gateway_exec_failed_cleanup",
        "A launch that could not run was not fully taken back",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    this.logger.warn(
      "fieldd.agents.gateway_exec_failed",
      "A launcher could not run the managed launch it was given; the run is withdrawn",
      { ...(adoption !== undefined ? { runtimeRunId: adoption.runtimeRunId } : {}) },
    );
    return { action: "ack" };
  }

  /** What an answer leaves behind. A refusal is in the ledger; a launch that
   * ran as typed leaves NOTHING but a count — it is a regular command. */
  private async account(
    request: SpawnThroughLaunchRequest,
    answer: SpawnThroughResponse,
    placed: Placed | undefined,
  ): Promise<void> {
    if (answer.action === "fallback") {
      this.ranAsTyped.set(answer.code, (this.ranAsTyped.get(answer.code) ?? 0) + 1);
      this.logger.debug("fieldd.agents.gateway_ran_as_typed", "A launch ran as typed", {
        code: answer.code,
        provider: request.providerId,
      });
      return;
    }
    if (answer.action !== "refuse") return;
    const reasonCode = refusalReasonCode(answer.code);
    this.logger.info("fieldd.agents.gateway_refused", "A typed launch was refused", {
      code: answer.code,
      provider: request.providerId,
      ...(placed !== undefined ? { sessionId: placed.shell.terminalSessionId } : {}),
    });
    try {
      await this.audited(
        {
          action: "agent.session.adopt_refused",
          // nothing was started, so there is no run to name
          target: { kind: "agent-session", id: "pending" },
          reasonCode,
          attrs: {
            provider: request.providerId,
            code: answer.code,
            ...(placed !== undefined ? { sessionId: placed.shell.terminalSessionId } : {}),
          },
        },
        async () => undefined,
        () => ({ outcome: "denied", reasonCode }),
      );
    } catch (error) {
      // the person is refused whatever the ledger could take
      this.logger.warn(
        "fieldd.agents.gateway_refusal_unledgered",
        "A refusal could not be written to the ledger",
        { code: answer.code, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private audited<T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describe: (value: T) => AuditMutationOutcome,
  ): Promise<T> {
    return this.opts.audit === undefined ? effect() : this.opts.audit(mutation, effect, describe);
  }
}

function isReadableFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
