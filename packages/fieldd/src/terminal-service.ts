import { homedir, userInfo } from "node:os";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import {
  ObservedState,
  type TerminalCreateParams,
  type TerminalCreateResult,
  type TerminalEndpoints,
  type TerminalInfo,
  type TerminalTerminateResult,
  type TerminalTicket,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
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
  logger?: Logger;
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
  private readonly logger: Logger;
  private terminals: TerminalInfo[] = [];
  private client: GhostteaAutomationClient | null = null;
  /** the token the live client authenticated with — a new native boot mints a
   * new token, and a stale client must be rebuilt, not trusted */
  private clientToken: string | null = null;
  /** true once the observed subscription is armed; NativeLink replays it across
   * reconnects from then on (P5), so ensureStarted becomes a no-op */
  private subscribed = false;
  private starting: Promise<void> | null = null;

  constructor(private readonly opts: TerminalServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    // A new native boot invalidates the old control connection wholesale.
    opts.link.on("terminal-endpoints", () => this.dropClient());
  }

  /** Arm the observed-inventory subscription (P5; NativeLink replays it across
   * reconnects once it has EVER succeeded — a subscribe that FAILS is removed
   * from the replay map, which is why this must be re-armable, never
   * once-and-throw: the review's dead-forever-inventory blocker. Never throws
   * and never fatals a boot — the daemon re-arms it on every link "connected"
   * event until it takes. Tolerant: a payload that is not an ObservedState —
   * the mock mgmt server's generic `{n:0}` included — reads as "no inventory",
   * LOGGED (the tolerant-reader law has a logging half), never an error. The
   * last inventory deliberately survives a link drop: a dead mgmt connection
   * kills no PTYs, and fieldd's health already carries the outage. */
  ensureStarted(): Promise<void> {
    if (this.subscribed) return Promise.resolve();
    if (this.starting) return this.starting;
    const attempt = (async () => {
      const apply = (payload: unknown, where: string) => {
        const parsed = ObservedState.safeParse(payload);
        if (parsed.success) {
          this.terminals = parsed.data.terminals;
        } else {
          this.logger.debug(
            "fieldd.terminal.observed_unparsed",
            "An observed payload was not an ObservedState; inventory unchanged",
            { where },
          );
        }
      };
      const { snapshot } = await this.opts.link.subscribe(
        "native.lifecycle.observed.subscribe",
        {},
        (payload) => apply(payload, "delta"),
      );
      this.subscribed = true;
      apply(snapshot, "snapshot");
    })();
    this.starting = attempt
      .catch((error) => {
        this.logger.warn(
          "fieldd.terminal.observed_subscribe_failed",
          "The observed-inventory subscription failed; it re-arms on the next link connect",
          { error },
        );
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
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
   * titles come from the running program) — accepted here, recorded in the
   * daemon's audit attrs, unapplied to the PTY. */
  async create(params: TerminalCreateParams): Promise<TerminalCreateResult> {
    const client = await this.connectedClient();
    const explicit = params.shell !== undefined;
    const executable = params.shell ?? this.defaultShell();
    try {
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
    } catch (error) {
      // Failure classification (the NF-6 review's theme): a dead transport is
      // UNAVAILABLE, never INTERNAL — the floor is gone, not the request wrong.
      if (!client.connected) throw this.unavailable("the terminal floor died mid-create", error);
      const message = errorMessage(error);
      // a service-level spawn refusal on a live connection is the caller's
      // input (bad executable/cwd), not a daemon fault
      if (/spawn/i.test(message))
        throw new RpcCallError("PRECONDITION_FAILED", `create failed: ${message}`, false);
      throw new RpcCallError("INTERNAL", `create failed: ${message}`, true);
    }
  }

  /** Fire the ladder (interrupt → 2s → SIGTERM pgrp → 2s → SIGKILL pgrp —
   * upstream's, on its own thread) and return; the inventory carries the exit.
   * `source: "application"` is the honest classification for a product-plane
   * kill. An unknown/already-gone session is the normal race → terminated:false
   * (the method registry declares terminate idempotent) — but ONLY on a LIVE
   * connection: a dead transport is UNAVAILABLE, never a false (the review
   * measured the old rejection arm calling a SIGKILLed floor "already gone"
   * and auditing success — the honest-states law inverted). `client.connected`
   * is the discriminator: true when the service itself answered, false when
   * the socket died. */
  async terminate(sessionId: string): Promise<TerminalTerminateResult> {
    const client = await this.connectedClient();
    try {
      await client.terminate(sessionId, "application");
      return { terminated: true };
    } catch (error) {
      if (!client.connected) throw this.unavailable("the terminal floor died mid-terminate", error);
      if (isUnknownSession(error)) return { terminated: false };
      // a service-level refusal on a live connection: probe once for the
      // already-exited race; a probe that itself hits transport death is
      // UNAVAILABLE like any other
      const gone = await client.getSession(sessionId).then(
        (s) => Boolean((s as { exited?: unknown }).exited),
        (probeError) => client.connected && isUnknownSession(probeError),
      );
      if (gone) return { terminated: false };
      if (!client.connected) throw this.unavailable("the terminal floor died mid-terminate", error);
      throw new RpcCallError("INTERNAL", `terminate failed: ${errorMessage(error)}`, true);
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
    // The client emits connection-error/transport-error (never "error" — the
    // review measured it): the only diagnostic explaining WHY a control
    // connection dropped, so it goes to evidence instead of the void.
    client.on("connection-error", (error: unknown) => {
      this.logger.debug(
        "fieldd.terminal.control_connection_error",
        "The terminal control connection errored",
        { error },
      );
    });
    client.on("transport-error", (error: unknown) => {
      this.logger.debug(
        "fieldd.terminal.control_transport_error",
        "The terminal control transport errored",
        { error },
      );
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

  private unavailable(message: string, cause: unknown): RpcCallError {
    return new RpcCallError("UNAVAILABLE", message, true, {
      service: "terminal",
      state: "unreachable",
      detail: errorMessage(cause),
    });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The service's own "that session doesn't exist" refusal — the ONLY error
 * that actually means already-gone (verified against the pinned floor; the
 * review's finding was exactly that timeouts and closed connections were being
 * read as this). */
function isUnknownSession(error: unknown): boolean {
  return /unknown session/i.test(errorMessage(error));
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
