import { homedir, userInfo } from "node:os";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import {
  ObservedState,
  type TerminalCreateParams,
  type TerminalCreateResult,
  type TerminalEndpoints,
  type TerminalInfo,
  type TerminalTicket,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// TerminalService (fieldd — NF-3, native-floor spec §6): the thin product seam
// over the terminal floor. It owns NO sessions and NO bytes — field-native's
// TerminalService is the PTY authority (NF-L1); this service holds the observed
// inventory fieldd learns over mgmt, mints D6 tickets from the NF-D8 endpoints
// the pairing hello delivered, and drives create/terminate over Ghosttea's own
// control socket (design-02 §2.7: interactive ops ride Ghosttea's plane, never
// the mgmt channel). The agent-session join (tier, claims) arrives with the AR
// track and widens `list` — not here.

/** The structural slice of NativeLink this service consumes (the DeviceService
 * pattern: no import coupling, trivially mockable). */
export interface TerminalLink {
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown }>;
  readonly terminalEndpoints: TerminalEndpoints | undefined;
  on(event: "terminal-endpoints", fn: () => void): unknown;
}

export interface TerminalServiceOptions {
  link: TerminalLink;
  /** injectable for tests; production = the user's login shell */
  defaultShell?: () => string;
}

/** Free-shell spawn geometry until an attached view claims resize authority
 * (03·A: the active view owns cols/rows; nothing has attached yet at birth). */
const SPAWN_COLS = 100;
const SPAWN_ROWS = 30;

/** Every session fieldd births carries this owner label — `close-session-owner`
 * gives a future "close everything VibeField spawned" op for free. */
const OWNER_ID = "vibefield.fieldd";

export class TerminalService {
  private terminals: TerminalInfo[] = [];
  private client: GhostteaAutomationClient | null = null;
  /** the token the live client authenticated with — a new native boot mints a
   * new token, and a stale client must be rebuilt, not trusted */
  private clientToken: string | null = null;

  constructor(private readonly opts: TerminalServiceOptions) {
    // A new native boot invalidates the old control connection wholesale.
    opts.link.on("terminal-endpoints", () => this.dropClient());
  }

  /** Subscribe the observed inventory (P5; NativeLink replays across
   * reconnects). Tolerant: a payload that is not an ObservedState — the mock
   * mgmt server's generic `{n:0}` included — reads as "no inventory", never an
   * error. The last inventory deliberately survives a link drop: a dead mgmt
   * connection kills no PTYs, and fieldd's health already carries the outage. */
  async start(): Promise<void> {
    const apply = (payload: unknown) => {
      const parsed = ObservedState.safeParse(payload);
      if (parsed.success) this.terminals = parsed.data.terminals;
    };
    const { snapshot } = await this.opts.link.subscribe(
      "native.lifecycle.observed.subscribe",
      {},
      (payload) => apply(payload),
    );
    apply(snapshot);
  }

  list(): TerminalInfo[] {
    return this.terminals;
  }

  get(sessionId: string): TerminalInfo | undefined {
    return this.terminals.find((t) => t.sessionId === sessionId);
  }

  /** D6: the ticket IS the endpoints — the single native service token, socket
   * paths stable across fieldd restarts. Fails honest when the floor is absent
   * (native down, terminal unit degraded, pre-NF-2 daemon). */
  ticket(): TerminalTicket {
    const endpoints = this.endpoints();
    return {
      controlSocket: endpoints.controlSocket,
      frameSocket: endpoints.frameSocket,
      token: endpoints.authToken,
    };
  }

  /** NF-D6, the free-shell door. Default = the user's LOGIN shell (`-l`): the
   * daemon's own environment is not the user's, and the login shell rebuilds
   * it; `environment: inherit` is inherit-minus-strip — field-native's
   * `with_private_env_prefixes` already removed every daemon secret class.
   * An EXPLICIT `shell` runs verbatim (no `-l` — it may be any program; tests
   * spawn /bin/cat). `title` has no upstream spawn option (SessionSummary
   * titles come from the running program) — accepted, recorded, unapplied. */
  async create(params: TerminalCreateParams): Promise<TerminalCreateResult> {
    const client = await this.connectedClient();
    const explicit = params.shell !== undefined;
    const executable = params.shell ?? this.defaultShell();
    const summary = await client.createSession({
      executable,
      args: explicit ? [] : ["-l"],
      cwd: params.cwd ?? homedir(),
      environment: { mode: "inherit" },
      cols: SPAWN_COLS,
      rows: SPAWN_ROWS,
      persistence: normalizePersistence(params.persistence),
      programKind: explicit ? "auto" : "interactive-shell",
      ownerId: OWNER_ID,
    });
    return { sessionId: summary.id };
  }

  /** Fire the ladder (interrupt → 2s → SIGTERM pgrp → 2s → SIGKILL pgrp —
   * upstream's, on its own thread) and return; the inventory carries the exit.
   * `source: "application"` is the honest classification for a product-plane
   * kill. An unknown/already-gone session is the normal race → terminated:false
   * — never an error (the method registry declares terminate idempotent). */
  async terminate(sessionId: string): Promise<{ terminated: boolean }> {
    const client = await this.connectedClient();
    try {
      await client.terminate(sessionId, "application");
      return { terminated: true };
    } catch (error) {
      const gone = await client.getSession(sessionId).then(
        (s) => Boolean((s as { exited?: unknown }).exited),
        () => true,
      );
      if (gone) return { terminated: false };
      throw new RpcCallError(
        "INTERNAL",
        `terminate failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  dispose(): void {
    this.dropClient();
  }

  // ---- internals ----

  private endpoints(): TerminalEndpoints {
    const endpoints = this.opts.link.terminalEndpoints;
    if (endpoints === undefined) {
      throw new RpcCallError("UNAVAILABLE", "the terminal floor is not available", true, {
        service: "terminal",
        state: "absent",
      });
    }
    return endpoints;
  }

  /** Lazy, per-native-boot control client. Rebuilt when the token rotates (a
   * new field-native boot) or after a connection error surfaces. */
  private async connectedClient(): Promise<GhostteaAutomationClient> {
    const endpoints = this.endpoints();
    if (this.client !== null && this.clientToken === endpoints.authToken) {
      return this.client;
    }
    this.dropClient();
    const client = new GhostteaAutomationClient(
      {
        controlSocket: endpoints.controlSocket,
        frameSocket: endpoints.frameSocket,
        authToken: endpoints.authToken,
      },
      { clientBuild: "vibefield-fieldd" },
    );
    try {
      await client.connect();
    } catch (error) {
      client.dispose();
      throw new RpcCallError("UNAVAILABLE", "the terminal control socket is unreachable", true, {
        service: "terminal",
        state: "unreachable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    // a dead socket drops the cached client so the next call redials
    client.on("close", () => {
      if (this.client === client) {
        this.client = null;
        this.clientToken = null;
      }
    });
    client.on("error", () => {
      /* close follows */
    });
    this.client = client;
    this.clientToken = endpoints.authToken;
    return client;
  }

  private dropClient(): void {
    this.client?.dispose();
    this.client = null;
    this.clientToken = null;
  }

  private defaultShell(): string {
    if (this.opts.defaultShell) return this.opts.defaultShell();
    try {
      const shell = userInfo().shell;
      if (typeof shell === "string" && shell.length > 0) return shell;
    } catch {
      /* fall through */
    }
    const env = process.env["SHELL"];
    if (typeof env === "string" && env.length > 0) return env;
    return "/bin/sh";
  }
}

/** Opaque passthrough with a typed default (NF-D3: keep-until-exit IS the
 * product promise — daemon-lifetime; the workbench's terminate-with-app
 * precedent is deliberately not copied). Unknown values pass through to the
 * service, whose parse is the authority (reference-don't-remodel). */
function normalizePersistence(
  value: string | undefined,
): "terminate-with-app" | "keep-until-exit" | "keep-until-explicit-close" {
  if (
    value === "terminate-with-app" ||
    value === "keep-until-exit" ||
    value === "keep-until-explicit-close"
  ) {
    return value;
  }
  if (value !== undefined) {
    throw new RpcCallError("PRECONDITION_FAILED", `unknown persistence policy: ${value}`, false);
  }
  return "keep-until-exit";
}
