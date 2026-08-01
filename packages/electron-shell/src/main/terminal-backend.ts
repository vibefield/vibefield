import type { GhostteaElectronBackendOptions } from "@vibecook/ghosttea-electron/main";
import {
  IPC_CHANNELS,
  type TerminalBridgeStatus,
  TerminalBridgeStatus as TerminalBridgeStatusSchema,
  TerminalTicket,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";

// The terminal Backend host (GT-D3, design-03 A1): per window, lazy, and
// transport-only. The renderer redeems its own ticket over fieldd — the one
// product door (D27) — and hands main the socket paths and token it cannot
// reach from a sandboxed page. Main dials them, forks the bridge, and posts the
// two MessagePorts into the page. Nothing else: the connection is opaque bytes
// to this process, and no terminal product decision is made here.
//
// The Backend NEVER supervises a ghosttead. field-native already embeds that
// floor and outlives the shell (two-plane law), so external mode is the whole
// of what this shell can construct — enforced at the type level below.

/** The only arm of ghosttea's option union this shell can build. `managed`
 * carries a `TerminalSupervisorOptions`; extracting `external` makes the
 * supervisor path unreachable by construction rather than by discipline. */
export type ExternalBackendOptions = Extract<GhostteaElectronBackendOptions, { mode: "external" }>;

/** The slice of `GhostteaElectronBackend` this module consumes — the
 * DeviceService/TerminalLink pattern: no import coupling, trivially fakeable.
 * `unexpected-exit` is the single death signal upstream emits; it folds the
 * bridge's own exit AND a lost daemon connection into one event with a
 * `source` discriminator. */
export interface TerminalBackendLike {
  readonly running: boolean;
  start(): Promise<void>;
  attachRenderer(webContents: WebContents): void;
  stop(): void;
  on(event: "unexpected-exit", listener: (detail: BackendExitDetail) => void): unknown;
}

export interface BackendExitDetail {
  source?: string;
  code?: number | null;
  signal?: string | null;
  message?: string;
}

export interface TerminalBackendHostOptions {
  /** Absolute path to the staged bridge entry (dist/main/bridge-entry.mjs). */
  bridgeEntryPoint: string;
  createBackend: (options: ExternalBackendOptions) => TerminalBackendLike;
  logger?: Logger;
  /** Bounded, like the reference app's recoverBackend — a bridge that cannot be
   * rebuilt five times running is not going to be rebuilt by a sixth. */
  maxRebuildAttempts?: number;
  delay?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_REBUILD_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const describeExit = (detail: BackendExitDetail): string =>
  detail.message ??
  `${detail.source ?? "bridge"} exited (${detail.code ?? detail.signal ?? "unknown"})`;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One window's Backend. Constructed lazily — a window that never asks for a
 * terminal forks no bridge and opens no socket. */
export class TerminalBackendHost {
  private readonly logger: Logger | undefined;
  private readonly maxRebuildAttempts: number;
  private readonly delay: (ms: number) => Promise<void>;
  private backend: TerminalBackendLike | null = null;
  private connection: ExternalBackendOptions["connection"] | null = null;
  private pending: Promise<void> = Promise.resolve();
  private recovering: Promise<void> | null = null;
  /** Bumped by every connect. A recovery ladder from an older generation has
   * been superseded by a freshly redeemed ticket and must stop rebuilding the
   * connection the renderer already replaced. */
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly target: WebContents,
    private readonly opts: TerminalBackendHostOptions,
  ) {
    this.logger = opts.logger;
    this.maxRebuildAttempts = opts.maxRebuildAttempts ?? DEFAULT_MAX_REBUILD_ATTEMPTS;
    this.delay = opts.delay ?? sleep;
  }

  /** Supply or replace this window's connection, then post its ports.
   *
   * Serialized: two documents (or a document and a recovery) racing to build a
   * Backend would leave one bridge orphaned holding a live socket. A repeat
   * call with the SAME connection over a running Backend re-attaches instead of
   * rebuilding — ports are transferred per ATTACH and a renderer holds them for
   * the life of one runtime, so a page that rebuilt its runtime needs new
   * ports, not a new bridge. */
  async connect(rawTicket: unknown): Promise<{ attached: boolean }> {
    const ticket = TerminalTicket.parse(rawTicket);
    const connection = {
      controlSocket: ticket.controlSocket,
      frameSocket: ticket.frameSocket,
      authToken: ticket.token,
    };
    await this.enqueue(async () => {
      if (this.disposed) throw new Error("terminal backend host is disposed");
      this.generation += 1;
      if (this.backend !== null && this.backend.running && this.sameConnection(connection)) {
        this.backend.attachRenderer(this.target);
        return;
      }
      this.connection = connection;
      await this.build(connection, true);
    });
    return { attached: true };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
    this.connection = null;
  }

  // ---- internals ----

  /** One queue for every build, whoever asked. A reloaded document racing a
   * recovery ladder would otherwise leave one bridge orphaned on a live
   * socket — the renderer's reconnect and main's rebuild are the same
   * operation and must not both run. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.pending.then(task);
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private sameConnection(next: ExternalBackendOptions["connection"]): boolean {
    const current = this.connection;
    return (
      current !== null &&
      current.controlSocket === next.controlSocket &&
      current.frameSocket === next.frameSocket &&
      current.authToken === next.authToken
    );
  }

  /** `attach` is false for a recovery rebuild. Every attach makes the bridge
   * dial the floor again for one renderer's port pair, and a renderer whose
   * bridge just died is holding dead ports it cannot replace by itself — so
   * attaching there would open two sockets nobody will ever read. `bridge-up`
   * is the invitation to ask again; the ask is what attaches. */
  private async build(
    connection: ExternalBackendOptions["connection"],
    attach: boolean,
  ): Promise<void> {
    this.teardown();
    const backend = this.opts.createBackend({
      mode: "external",
      connection,
      bridge: { entryPoint: this.opts.bridgeEntryPoint },
    });
    this.backend = backend;
    backend.on("unexpected-exit", (detail) => this.onUnexpectedExit(backend, detail));
    await backend.start();
    if (!attach || this.disposed || this.target.isDestroyed()) return;
    backend.attachRenderer(this.target);
  }

  private onUnexpectedExit(source: TerminalBackendLike, detail: BackendExitDetail): void {
    // A death reported by a Backend we have already replaced is history.
    if (this.disposed || this.backend !== source) return;
    this.logger?.warn(
      "desktop.terminal.bridge_died",
      "The terminal bridge died; the shell is rebuilding it on the stored connection",
      { source: detail.source ?? "bridge", code: detail.code, signal: detail.signal },
    );
    this.publish({ state: "bridge-down", detail: describeExit(detail) });
    void this.recover();
  }

  /** The ladder. Same-boot death (a crashed bridge, a dropped daemon
   * connection) is recoverable HERE: field-native's socket paths are stable and
   * its per-boot token is still the one in hand, so a rebuild on the stored
   * connection is the whole fix. What this cannot fix is a field-native that
   * REBOOTED — the paths survive, the token does not, and no credential main
   * holds is valid any more. That case exits the ladder as `ticket-expired`,
   * whose only remedy is a renderer that redeems again. Main does not try to
   * tell the two apart from a connect failure: the remedy for an exhausted
   * ladder is a fresh ticket either way, and guessing at the cause would put a
   * classification we cannot verify into the renderer's hands. */
  private recover(): Promise<void> {
    const generation = this.generation;
    this.recovering ??= (async () => {
      let attempt = 0;
      let lastError: unknown;
      while (
        attempt < this.maxRebuildAttempts &&
        !this.disposed &&
        this.generation === generation
      ) {
        try {
          const rebuilt = await this.enqueue(async () => {
            const connection = this.connection;
            if (connection === null || this.disposed || this.generation !== generation)
              return false;
            await this.build(connection, false);
            return true;
          });
          // A ladder that was superseded mid-flight has nothing to announce —
          // the connect that superseded it owns the outcome now.
          if (rebuilt) this.publish({ state: "bridge-up", attempts: attempt });
          return;
        } catch (error) {
          lastError = error;
          attempt += 1;
          await this.delay(Math.min(MAX_BACKOFF_MS, 250 * 2 ** attempt));
        }
      }
      if (this.disposed || this.generation !== generation) return;
      this.logger?.error(
        "desktop.terminal.bridge_unrecoverable",
        "The terminal bridge could not be rebuilt; the renderer must redeem a fresh ticket",
        lastError,
        { attempts: attempt },
      );
      this.publish({ state: "ticket-expired", attempts: attempt, detail: message(lastError) });
    })().finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }

  private publish(status: TerminalBridgeStatus): void {
    if (this.target.isDestroyed()) return;
    this.logger?.info(
      "desktop.terminal.bridge_status",
      "The shell published this window's terminal bridge status",
      { state: status.state, attempts: status.attempts },
    );
    this.target.send(IPC_CHANNELS.terminalStatus, TerminalBridgeStatusSchema.parse(status));
  }

  private teardown(): void {
    const backend = this.backend;
    this.backend = null;
    backend?.stop();
  }
}

/** Per-window hosts, born on first ask and buried with their window. */
export class TerminalBackendRegistry {
  private readonly hosts = new Map<number, TerminalBackendHost>();

  constructor(private readonly opts: TerminalBackendHostOptions) {}

  ensure(target: WebContents): TerminalBackendHost {
    const existing = this.hosts.get(target.id);
    if (existing !== undefined) return existing;
    const host = new TerminalBackendHost(target, this.opts);
    this.hosts.set(target.id, host);
    target.once("destroyed", () => {
      this.hosts.delete(target.id);
      host.dispose();
    });
    return host;
  }

  dispose(): void {
    for (const host of this.hosts.values()) host.dispose();
    this.hosts.clear();
  }
}
