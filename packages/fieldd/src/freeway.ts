import { EventEmitter } from "node:events";
import {
  type FreewayAdmitRow,
  type FreewayDeclareParams,
  FreewayState,
  PORTS,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";
import {
  RouteServeDriver,
  type RouteServeLog,
  routeServeSpec,
  type ServedProcess,
} from "./route-serve";

// F1 (draft/thinking-freeway.md v0.3 §3, §4.3, §6) — FIELDD'S HALF OF THE FREEWAY. The floor holds
// the link plane's listener and secrets for its boot and supervises the freeway host on them; what
// it is TOLD comes from here, in one declaration (who the host admits, with which hello, and the
// owner's word on off-device terminals), and what it SAYS comes back as one revisioned state
// stream (`up`, the host's boot, the listener's port and path secret, the freeway key). This
// module turns the two into the serve that puts the host on the tailnet: one static route, the
// bare root of `PORTS.FREEWAY_SERVE` onto the floor-held listener's `/f/<pathSecret>`.
//
// FW-L10 sets the serve's one rule of its own: the link outlives fieldd, so a fieldd restart must
// not touch the serve. The floor admits a freeway-door serve only onto its own listener with its
// own secret, which is what lets MeshClient ADOPT the one a predecessor declared; and this driver
// says nothing until the floor's state has been read, because a boot that has not heard the floor
// yet knows nothing it could withdraw on.
//
// The phone's approval (`freeway.approve`) and the audit of its joins are the next slices.

/** What fieldd's declaration reads of the roster: THIS desktop's own id (the welcome names it,
 * FW-L9), its self peers in the roster keyspace, and the ONE desktop predicate (FW-DF-1:
 * `capabilities.docHost`, a phone the rest). */
export interface FreewayRoster {
  currentDeviceId(): string;
  selfPeerDeviceIds(): readonly string[];
  isDocHost(deviceId: string): boolean;
}

/** fieldd's one declaration (§4.3), pure: the self peers, each with the hello its role opens
 * with; the doors the host splices product streams to (FD1's, none in F1); and the owner's word on
 * off-device terminals. A desktop whose slice has not arrived reads as a phone until it does
 * (FW-DF-1), and the roster's change then declares again. */
export function freewayDeclaration(
  roster: FreewayRoster,
  terminals: boolean,
): FreewayDeclareParams {
  const admit: FreewayAdmitRow[] = roster.selfPeerDeviceIds().map((deviceId) => ({
    deviceId,
    role: roster.isDocHost(deviceId) ? "desktop" : "phone",
  }));
  return { deviceId: roster.currentDeviceId(), admit, doors: {}, exposure: { terminals } };
}

/** The floor link, as far as the freeway needs it (`NativeLink`). */
export interface FreewayNative {
  request(method: string, params: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

export interface FreewayFloorOptions {
  native: FreewayNative;
  /** the declaration fieldd's policy calls for now (`freewayDeclaration`) */
  declaration: () => FreewayDeclareParams;
  logger?: Logger;
}

/**
 * The floor's link plane as fieldd reads it, and what fieldd tells it.
 *
 * - The state: armed at the first connect that takes it (a refused first subscription is not
 *   replayed by the link, so it is re-armed at the next), then kept current by the link's own
 *   replay across every reconnect. A new floor boot's snapshot replaces the old boot's; within one
 *   boot an older revision is stale and is ignored. It holds the floor boot's secrets, so nothing
 *   here logs it.
 * - The declaration: sent at every connect, because a new floor boot forgets it, and again
 *   whenever fieldd's word changes. Idempotent on the floor; sent only when it differs from the
 *   last one this link carried, and one at a time, so the floor keeps the newest.
 */
export class FreewayFloor extends EventEmitter {
  private readonly logger: Logger;
  private current: FreewayState | null = null;
  private armed = false;
  private arming: Promise<void> | null = null;
  private sent: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private stream: { dispose: () => void } | null = null;
  private disposed = false;

  constructor(private readonly opts: FreewayFloorOptions) {
    super();
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** The floor's state now: null before the first reading, and from a floor that predates the
   * freeway (it answers no such stream). */
  state(): FreewayState | null {
    return this.current;
  }

  /** The link is (re)connected: arm the state stream if it is not, and declare. Never throws. */
  async connected(): Promise<void> {
    if (this.disposed) return;
    this.sent = null;
    await this.arm();
    await this.declare();
  }

  /** fieldd's word may have changed: declare it, unless this link already carries exactly it.
   * Serialized, and the word is read when its turn comes, so two changes arriving together send
   * the newer last. Never throws: a floor that cannot hear it now hears it at the next connect. */
  declare(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const run = this.chain.then(async () => {
      if (this.disposed) return;
      const declaration = this.opts.declaration();
      const key = JSON.stringify(declaration);
      if (key === this.sent) return;
      try {
        await this.opts.native.request("native.freeway.declare", declaration);
        this.sent = key;
      } catch (error) {
        this.logger.warn(
          "fieldd.freeway.declare_deferred",
          "The floor did not take the freeway declaration; the next connect or change declares again",
          { error: String(error) },
        );
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return this.chain;
  }

  dispose(): void {
    this.disposed = true;
    this.stream?.dispose();
    this.stream = null;
    this.removeAllListeners();
  }

  /** Arm the state stream once; a connect that lands while it arms waits for the same arming. */
  private arm(): Promise<void> {
    if (this.armed) return Promise.resolve();
    this.arming ??= this.subscribe().finally(() => {
      this.arming = null;
    });
    return this.arming;
  }

  private async subscribe(): Promise<void> {
    try {
      const stream = await this.opts.native.subscribe(
        "native.freeway.state.subscribe",
        {},
        (payload) => this.apply(payload),
      );
      this.armed = true;
      this.stream = stream;
      this.apply(stream.snapshot);
    } catch (error) {
      this.logger.warn(
        "fieldd.freeway.state_deferred",
        "The floor's freeway state stream did not arm; the next connect arms it",
        { error: String(error) },
      );
    }
  }

  private apply(payload: unknown): void {
    const parsed = FreewayState.safeParse(payload);
    if (!parsed.success) return;
    const next = parsed.data;
    const prev = this.current;
    if (prev !== null && prev.floorBootId === next.floorBootId && next.revision <= prev.revision) {
      return;
    }
    this.current = next;
    this.emit("state", next);
  }
}

/** The engine identity and display name of the freeway's listener. */
export const FREEWAY_SERVE_ID = "freeway" as const;

/** F1 — the freeway host as a served process: its OWN listener, because a route list changes only
 * by remove-then-add, which drops every connection on it, and the freeway's one route never changes
 * while the floor lives (§3). */
export const FREEWAY_SERVED: ServedProcess = {
  serveId: FREEWAY_SERVE_ID,
  listenPort: PORTS.FREEWAY_SERVE,
};

const FREEWAY_SERVE_LOG: RouteServeLog = {
  declared: "fieldd.freeway_serve.declared",
  deferred: "fieldd.freeway_serve.declare_deferred",
  declaredMessage: "The freeway listener is declared",
  withdrawnMessage: "The freeway listener is withdrawn",
  deferredMessage: "The freeway listener's declaration did not land; the next reading retries",
};

/** The freeway's serve, pure: the host up on the floor-held listener and a linked login, or
 * nothing. The serve is gated on the LINKED LOGIN (route-serve's first gate); the terminal kinds
 * are the host's to gate, on the declaration's `exposure` (§3). */
export function freewayServeSpec(input: {
  state: FreewayState | null;
  linkedLogin: string | null;
}): ServeSpec | null {
  const state = input.state;
  const target =
    state?.up === true && state.port !== undefined && state.pathSecret !== undefined
      ? {
          kind: "secret" as const,
          port: state.port,
          pathSecret: state.pathSecret,
          door: "freeway" as const,
        }
      : null;
  return routeServeSpec(FREEWAY_SERVED, {
    published: target !== null,
    linkedLogin: input.linkedLogin,
    targets: target,
  });
}

export interface FreewayServeDriverOptions {
  state: () => FreewayState | null;
  linkedLogin: () => string | null;
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  serves?: () => readonly ServeState[];
  logger?: Logger;
}

/** Drives the freeway's serve: declared while the host is up and a login is linked, re-aimed at a
 * new floor boot (a new port and secret), withdrawn while the host is down.
 *
 * SILENT UNTIL THE FLOOR HAS BEEN READ. route-serve's first refresh always declares, and a null
 * spec there is a withdrawal (F-H1) — right for a reading this daemon holds at boot, wrong for this
 * one: before the state stream answers, fieldd knows nothing about the host, and a withdrawal then
 * would take the serve from under every phone link a restarted fieldd should have left alone
 * (FW-L10). The first refresh is the first state's. */
export class FreewayServeDriver extends RouteServeDriver {
  private readonly read: () => FreewayState | null;

  constructor(opts: FreewayServeDriverOptions) {
    super({
      desired: () => freewayServeSpec({ state: opts.state(), linkedLogin: opts.linkedLogin() }),
      declare: opts.declare,
      ...(opts.serves !== undefined ? { serves: opts.serves } : {}),
      log: FREEWAY_SERVE_LOG,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
    this.read = opts.state;
  }

  override refresh(): Promise<void> {
    if (this.read() === null) return Promise.resolve();
    return super.refresh();
  }
}
