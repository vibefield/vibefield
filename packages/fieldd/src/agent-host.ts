import { homedir } from "node:os";
import type {
  AgentHost,
  TerminalAutomationOperation,
  TerminalAutomationResult,
  TerminalSpec,
} from "@vibecook/puppeteer-core";
import { buildAgentEnvironment } from "@vibecook/puppeteer-runtime";
import { ENV_PREFIXES, type TerminalRuntimeSession } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import type { TerminalService } from "./terminal-service";

// The AgentHost over field-native (AR-3; thinking-ar-agent-plane.md §0/§2
// evidence 1, design-02 §3.3): puppeteer's two-method capability — spawn a
// terminal, write one semantic input to it — implemented over fieldd's
// TerminalService, which is to say over the floor's agent cell. The adapter
// owns the WHOLE launch recipe (command, argv, hooks, its own env variables);
// the host only composes the environment policy, finds a cell, and execs.
//
// EL7 at the seam: an agent PTY is born with a CLEAN environment — the
// allow-list below and the adapter's own `spec.env`, never the daemon's
// `process.env`, and never a `FIELD_*`/`FIELDD_*` key even if an adapter
// asked for one. `buildAgentEnvironment` is puppeteer's own policy for what a
// vendor TUI needs from a host (TERM, colour, the login identity a native
// credential store keys on); the rows added here are VibeField's: what the
// user's tools need to work as the user (a shell for the agent's own
// subprocesses, a locale, an ssh agent, the XDG roots the native-default
// profile's layout is discovered under). AR-L1 holds: no vendor variable is
// spelled in this repository — the one puppeteer sets is puppeteer's.

/** The keys VibeField passes through from the daemon's own environment when
 * present. Everything else the daemon inherited stays with the daemon. */
export const AGENT_ENV_PASSTHROUGH: readonly string[] = [
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
];

/** win32's essentials (a ConPTY child aborts without SystemRoot; the rest
 * are what `os.homedir()` and every tool read there). Folded by case. */
const AGENT_ENV_PASSTHROUGH_WIN32: readonly string[] = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "USERNAME",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

export interface AgentEnvironmentRequest {
  /** the adapter's own variables (puppeteer `TerminalSpec.env`) — layered LAST
   * among the allowed, so a recipe's binding wins over a passthrough */
  allowed?: Record<string, string> | undefined;
  /** the daemon's environment (default process.env) */
  parent?: NodeJS.ProcessEnv | undefined;
  platform?: NodeJS.Platform | undefined;
  /** the OS user's home (default os.homedir()) */
  home?: string | undefined;
}

/** The complete environment an agent PTY is born with. Pure. */
export function agentEnvironment(request: AgentEnvironmentRequest = {}): Record<string, string> {
  const platform = request.platform ?? process.platform;
  const parent = request.parent ?? process.env;
  const home = request.home ?? homedir();
  const passthrough: Record<string, string> = {};
  if (platform === "win32") {
    const folded = new Map<string, string>();
    for (const [key, value] of Object.entries(parent))
      if (value !== undefined) folded.set(key.toUpperCase(), value);
    for (const key of [...AGENT_ENV_PASSTHROUGH, ...AGENT_ENV_PASSTHROUGH_WIN32]) {
      const value = folded.get(key.toUpperCase());
      if (value !== undefined && value !== "") passthrough[key] = value;
    }
  } else {
    for (const key of AGENT_ENV_PASSTHROUGH) {
      const value = parent[key];
      if (value !== undefined && value !== "") passthrough[key] = value;
    }
  }
  // puppeteer's policy (TERM, colour, the login identity), with VibeField's
  // passthrough beneath the adapter's own variables
  const composed = buildAgentEnvironment({
    platform,
    home,
    ...(passthrough["PATH"] !== undefined ? { path: passthrough["PATH"] } : {}),
    ...(passthrough["LANG"] !== undefined ? { locale: passthrough["LANG"] } : {}),
    allowed: { ...passthrough, ...(request.allowed ?? {}) },
  });
  // EL7 — the strip is LAST: nothing an adapter asked for smuggles a daemon
  // secret class in (case-folded on win32, where the env itself folds)
  const fold = platform === "win32";
  const prefixes = fold ? ENV_PREFIXES.map((p) => p.toUpperCase()) : ENV_PREFIXES;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(composed)) {
    const probe = fold ? key.toUpperCase() : key;
    if (prefixes.some((prefix) => probe.startsWith(prefix))) continue;
    out[key] = value;
  }
  return out;
}

/** What the floor answered for a PTY the host spawned — kept by the host so
 * the daemon can mint the routed ticket the pane mounts (`createOpenResult`)
 * without a second inventory round trip (GT-1's point). */
export interface BornTerminal {
  sessionId: string;
  session: TerminalRuntimeSession;
  cellBootId?: string | undefined;
}

export interface TerminalAgentHostOptions {
  /** the terminal service, late-bound (the runtime is built before it): null
   * = no floor to lend, and the refusal is typed */
  terminals: () => TerminalService | null;
  /** the daemon's environment the passthrough reads from (default process.env) */
  environment?: NodeJS.ProcessEnv | undefined;
  home?: string | undefined;
  logger?: Logger | undefined;
}

export interface TerminalAgentHost extends AgentHost {
  /** The birth facts of a PTY this host spawned, once, by the floor's id. */
  born(sessionId: string): BornTerminal | undefined;
  /** Forget a birth (the session exited or was never adopted). */
  forget(sessionId: string): void;
  /** The floor's typed refusal from the most recent spawn attempt, when that
   * attempt refused (puppeteer folds host errors into its own failure code;
   * the door prefers the floor's own words). Cleared by the next attempt. */
  lastRefusal(): RpcCallError | undefined;
}

/** puppeteer's `AgentHost` over the floor's agent cell. */
export function createTerminalAgentHost(options: TerminalAgentHostOptions): TerminalAgentHost {
  const logger = options.logger ?? createNoopLogger();
  const births = new Map<string, BornTerminal>();
  let lastRefusal: RpcCallError | undefined;
  const noHost = (): RpcCallError =>
    new RpcCallError(
      "UNAVAILABLE",
      "agent terminals are not hosted: the terminal floor is not available to this daemon",
      true,
      { service: "agents", state: "no-terminal-host" },
    );
  return {
    async spawnTerminal(spec: TerminalSpec): Promise<{ runtimeSessionId: string }> {
      lastRefusal = undefined;
      const terminals = options.terminals();
      if (terminals === null) {
        lastRefusal = noHost();
        throw lastRefusal;
      }
      const variables = agentEnvironment({
        allowed: spec.env,
        ...(options.environment !== undefined ? { parent: options.environment } : {}),
        ...(options.home !== undefined ? { home: options.home } : {}),
      });
      let born: BornTerminal;
      try {
        born = await terminals.spawn({
          command: spec.command,
          args: spec.args,
          cwd: spec.cwd,
          variables,
          cols: spec.cols,
          rows: spec.rows,
        });
      } catch (error) {
        if (error instanceof RpcCallError) lastRefusal = error;
        throw error;
      }
      births.set(born.sessionId, born);
      logger.info("fieldd.agents.terminal_spawned", "Agent terminal spawned", {
        sessionId: born.sessionId,
        ...(born.cellBootId !== undefined ? { cellBootId: born.cellBootId } : {}),
        variables: Object.keys(variables).length,
      });
      return { runtimeSessionId: born.sessionId };
    },
    async automateTerminal(
      runtimeSessionId: string,
      operation: TerminalAutomationOperation,
    ): Promise<TerminalAutomationResult> {
      const terminals = options.terminals();
      if (terminals === null) return { accepted: false, reason: "no-terminal-host" };
      const result = await terminals.automate(runtimeSessionId, operation);
      return result.accepted
        ? { accepted: true }
        : { accepted: false, reason: result.reason ?? "human-input-conflict" };
    },
    born: (sessionId) => births.get(sessionId),
    forget: (sessionId) => {
      births.delete(sessionId);
    },
    lastRefusal: () => lastRefusal,
  };
}
