import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  approvalSigningInput,
  type CallerContext,
  FREEWAY,
  FREEWAY_APPROVAL,
  type FreewayAdmitRow,
  type FreewayApprovalClaims,
  type FreewayApprovalProtected,
  FreewayApproveParams,
  type FreewayApproveResult,
  type FreewayDeclareParams,
  FreewayJoinRow,
  FreewayState,
  GRANT_ALG,
  GRANT_ENVELOPE_VERSION,
  PORTS,
  type SessionAttachRight,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";
import {
  RouteServeDriver,
  type RouteServeLog,
  routeServeSpec,
  type ServedProcess,
} from "./route-serve";
import { rightsFor } from "./terminal-grants";

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
// The phone's approval (`freeway.approve`, below) is fieldd's ONE mint for the link: the host
// mints every grant after it from its own keyring, and reports each join and leave, which fieldd
// audits (FW-L3: it is the only writer).

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

/** One `native.freeway.joins.subscribe` frame as fieldd audits it: the rows that parse, in order,
 * what the floor could not hold (`dropped`), and what did not parse — a row the audit cannot say
 * is counted, never silently skipped. */
export interface FreewayJoins {
  rows: FreewayJoinRow[];
  dropped: number;
  malformed: number;
}

/** The host whose keyrings a revoke walls: the floor boot and the host boot inside it. */
interface HostBoot {
  floorBootId: string;
  hostBootId: string;
}

const sameHost = (a: HostBoot, b: FreewayState | null): boolean =>
  b !== null && b.floorBootId === a.floorBootId && b.hostBootId === a.hostBootId;

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
 * - The joins: their own stream, armed the same way; each frame is emitted as `joins` for the
 *   audit. The floor drains its backlog into a subscription's first frame, so a reconnect's
 *   replay carries only what was held while fieldd was away.
 * - The links: each change is a system-log event (§6.4: a link grants nothing beyond what its
 *   streams' doors grant, so it is not an audit row).
 * - A revoke (`revokeAll`, on unlink or sign-out): every phone link closes and the host walls every
 *   keyring it holds. Owed until the floor answers, and owed to THAT host: said again at the next
 *   connect while it is still the floor's, and settled when it is gone, its keyrings with it — so
 *   an owed revoke never lands on the links of a host that came up after a relink.
 */
export class FreewayFloor extends EventEmitter {
  private readonly logger: Logger;
  private current: FreewayState | null = null;
  private armed = false;
  private arming: Promise<void> | null = null;
  private sent: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private stream: { dispose: () => void } | null = null;
  private joinsArmed = false;
  private joinsArming: Promise<void> | null = null;
  private joinsStream: { dispose: () => void } | null = null;
  private owed: HostBoot | null = null;
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

  /** The link is (re)connected: arm both streams if they are not, say an owed revoke, and declare.
   * Never throws. */
  async connected(): Promise<void> {
    if (this.disposed) return;
    this.sent = null;
    await Promise.all([this.arm(), this.armJoins()]);
    // an owed revoke is said again only to the host it was for: one gone took its keyrings with it
    const owed = this.owed;
    if (owed !== null) {
      if (sameHost(owed, this.current)) await this.revokeAll();
      else this.owed = null;
    }
    await this.declare();
  }

  /** Close every phone link and wall every keyring the host holds: unlink, sign-out, another
   * account. Never throws; a refusal is owed to the host it was meant for (the class's law). */
  async revokeAll(): Promise<void> {
    if (this.disposed) return;
    const state = this.current;
    const host =
      state?.up === true && state.hostBootId !== undefined
        ? { floorBootId: state.floorBootId, hostBootId: state.hostBootId }
        : null;
    try {
      await this.opts.native.request("native.freeway.revoke", {});
      this.owed = null;
    } catch (error) {
      this.owed = host;
      this.logger.warn(
        "fieldd.freeway.revoke_deferred",
        "The floor did not take the revoke; it is said again at the next connect while that host runs",
        { error: String(error) },
      );
    }
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
    this.joinsStream?.dispose();
    this.joinsStream = null;
    this.removeAllListeners();
  }

  private armJoins(): Promise<void> {
    if (this.joinsArmed) return Promise.resolve();
    this.joinsArming ??= this.subscribeJoins().finally(() => {
      this.joinsArming = null;
    });
    return this.joinsArming;
  }

  private async subscribeJoins(): Promise<void> {
    try {
      const stream = await this.opts.native.subscribe(
        "native.freeway.joins.subscribe",
        {},
        (payload) => this.joins(payload),
      );
      // disposed while it armed: the stream ends here, unheard
      if (this.disposed) return stream.dispose();
      this.joinsArmed = true;
      this.joinsStream = stream;
      this.joins(stream.snapshot);
    } catch (error) {
      this.logger.warn(
        "fieldd.freeway.joins_deferred",
        "The floor's freeway joins stream did not arm; the next connect arms it",
        { error: String(error) },
      );
    }
  }

  /** A joins frame, read row by row: one row that does not parse is counted, and the rest stand. */
  private joins(payload: unknown): void {
    const frame = payload as { rows?: unknown; dropped?: unknown } | null | undefined;
    if (!Array.isArray(frame?.rows)) return;
    const rows: FreewayJoinRow[] = [];
    let malformed = 0;
    for (const raw of frame.rows) {
      const row = FreewayJoinRow.safeParse(raw);
      if (row.success) rows.push(row.data);
      else malformed += 1;
    }
    const dropped =
      typeof frame.dropped === "number" && Number.isInteger(frame.dropped) && frame.dropped > 0
        ? frame.dropped
        : 0;
    if (rows.length === 0 && dropped === 0 && malformed === 0) return;
    this.emit("joins", { rows, dropped, malformed } satisfies FreewayJoins);
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
      if (this.disposed) return stream.dispose();
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

  /** Each link that changed, as a system-log event — the device and its state, never the state's
   * secrets. A new floor boot ended every link of the old one, and its own links are all new. */
  private logLinks(prev: FreewayState | null, next: FreewayState): void {
    const reborn = prev !== null && prev.floorBootId !== next.floorBootId;
    const before = linkStates(prev);
    const after = linkStates(next);
    const said = (deviceId: string, state: string) =>
      this.logger.info("fieldd.freeway.link", "A freeway link changed", { deviceId, state });
    for (const deviceId of before.keys())
      if (reborn || !after.has(deviceId)) said(deviceId, "down");
    for (const [deviceId, state] of after)
      if (reborn || before.get(deviceId) !== state) said(deviceId, state);
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
    this.logLinks(prev, next);
    this.emit("state", next);
  }
}

/** How a state's links read in the system log: one event per device whose link changed. */
function linkStates(state: FreewayState | null): Map<string, string> {
  return new Map((state?.links ?? []).map((link) => [link.deviceId, link.state]));
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

/** What `freeway.approve` reads of the roster: the calling node's device, and that device's row. */
export interface FreewayApprovalRoster {
  deviceIdByNodeId(nodeId: string): string | undefined;
  get(
    deviceId: string,
  ): { self: boolean; capabilities?: { docHost?: boolean } | undefined } | undefined;
}

export interface FreewayApproverOptions {
  /** the floor's state now (`FreewayFloor.state`): the key, its generation, the audience */
  state: () => FreewayState | null;
  roster: FreewayApprovalRoster;
  /** the approval's life (`FREEWAY.APPROVAL_TTL_MS`; a test seam, never longer — the host
   * refuses a longer one) */
  ttlMs?: number;
  now?: () => number;
  /** the approval's nonce (16 random bytes, base64url; a test seam) */
  nonce?: () => string;
}

/** What an approval is for, once every refusal has been said: the phone, as the roster knows it,
 * and what its link may do. */
export interface FreewayApprovalAsk {
  /** the phone's roster device id — the audit's target */
  deviceId: string;
  login: string;
  /** the sidecar-injected node id, which the roster correlated to the phone's row */
  tailscaleId: string;
  rights: SessionAttachRight[];
}

/**
 * F1 (FW-D1) — `freeway.approve {}`: fieldd approves a PHONE's link, once, and the host mints every
 * grant after it. The refusals, in the order a caller hears them:
 *  - a malformed ask: PRECONDITION_FAILED;
 *  - a self peer daemon forwarding for a phone (FW-D5): UNAVAILABLE `forwarding-unbuilt`, retryable
 *    false — F1b's;
 *  - anyone but this person's own device over the tailnet (a window, the shell, a plugin, an
 *    agent): FORBIDDEN_SCOPE — an approval is the phone's;
 *  - a door whose sidecar injected no node id: PRECONDITION_FAILED — an approval binds to the node
 *    that holds it (the host refuses one naming another node, 4403);
 *  - a node the roster does not correlate to a device: UNAVAILABLE `uncorrelated`, retryable — a
 *    phone that just joined is correlated a moment later;
 *  - a device the roster says is a desktop (`docHost`) or is this one: FORBIDDEN_SCOPE — a desktop
 *    link carries no approval (FW-D6), and the system Tailscale app's node publishes no device id
 *    at all, so it never correlates (Note 6);
 *  - the floor not read, or the host down: UNAVAILABLE `unread` / `down`, retryable.
 *
 * The approval: TPv3's envelope under the floor's FREEWAY key (per floor boot, read off the state
 * stream; memory-only, never logged), `principal.tailscaleId` the roster's correlation and never a
 * claim, `rights` by `rightsFor`, a fresh nonce, `FREEWAY.APPROVAL_TTL_MS`. A guest never gets here:
 * its preset holds no `terminal.attach`.
 */
export class FreewayApprover {
  constructor(private readonly opts: FreewayApproverOptions) {}

  /** Every refusal, before anything is minted or audited. */
  check(ctx: CallerContext, params: unknown): FreewayApprovalAsk {
    if (!FreewayApproveParams.safeParse(params ?? {}).success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected {}", false);
    const principal = ctx.principal;
    if (principal.kind === "peer-fieldd")
      throw new RpcCallError(
        "UNAVAILABLE",
        "an approval forwarded for a phone on another desktop is not served yet (FW-D5)",
        false,
        { service: FREEWAY_APPROVAL.SERVICE, state: FREEWAY_APPROVAL.STATE_FORWARDING_UNBUILT },
      );
    if (principal.kind !== "tailnet" || principal.self !== true)
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "an approval is the phone's: only this person's own phone, over the tailnet, holds one",
        false,
        { method: "freeway.approve", principal: principal.kind },
      );
    const tailscaleId = principal.tailscaleId;
    if (tailscaleId === undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the door injected no node id, and an approval binds to the node that holds it",
        false,
      );
    const deviceId = this.opts.roster.deviceIdByNodeId(tailscaleId);
    const row = deviceId === undefined ? undefined : this.opts.roster.get(deviceId);
    if (deviceId === undefined || row === undefined)
      throw new RpcCallError(
        "UNAVAILABLE",
        "this desktop's roster does not know the calling node yet",
        true,
        { service: FREEWAY_APPROVAL.SERVICE, state: FREEWAY_APPROVAL.STATE_UNCORRELATED },
      );
    if (row.self || row.capabilities?.docHost === true)
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "an approval is a phone's; a desktop's link carries none",
        false,
        { method: "freeway.approve", principal: "desktop" },
      );
    this.live();
    return { deviceId, login: principal.login, tailscaleId, rights: rightsFor(principal) };
  }

  /** The mint itself — called inside the audit's attempt (daemon.ts). The key, its generation and
   * the audience are read in ONE tick from the state answering now. */
  mint(ask: FreewayApprovalAsk): FreewayApproveResult {
    const state = this.live();
    const now = (this.opts.now ?? Date.now)();
    const header: FreewayApprovalProtected = {
      v: GRANT_ENVELOPE_VERSION,
      typ: "FreewayApproval",
      iss: "fieldd",
      alg: GRANT_ALG,
      kid: { floorBootId: state.floorBootId, keyGeneration: state.keyGeneration },
    };
    const claims: FreewayApprovalClaims = {
      audienceFloorBootId: state.floorBootId,
      // the minter's; the host's keyring id adds its own boot (`~<hostBootId>`)
      clientId: `freeway:${ask.login}#${ask.tailscaleId}`,
      principal: { kind: "tailnet", login: ask.login, tailscaleId: ask.tailscaleId },
      rights: ask.rights,
      issuedAt: now,
      expiresAt: now + (this.opts.ttlMs ?? FREEWAY.APPROVAL_TTL_MS),
      nonce: (this.opts.nonce ?? (() => randomBytes(16).toString("base64url")))(),
    };
    const mac = createHmac("sha256", Buffer.from(state.freewayKeyHex, "hex"))
      .update(approvalSigningInput(header, claims), "utf8")
      .digest("base64url");
    return { approval: { protected: header, claims, mac }, expiresAt: claims.expiresAt };
  }

  /** The state an approval can be minted under: read, the host up, the key said. */
  private live(): FreewayState & { freewayKeyHex: string; keyGeneration: number } {
    const state = this.opts.state();
    if (state === null)
      throw new RpcCallError(
        "UNAVAILABLE",
        "the floor has not said whether the freeway runs",
        true,
        { service: FREEWAY_APPROVAL.SERVICE, state: FREEWAY_APPROVAL.STATE_UNREAD },
      );
    const { freewayKeyHex, keyGeneration } = state;
    if (!state.up || freewayKeyHex === undefined || keyGeneration === undefined)
      throw new RpcCallError("UNAVAILABLE", "the freeway host is not running", true, {
        service: FREEWAY_APPROVAL.SERVICE,
        state: FREEWAY_APPROVAL.STATE_DOWN,
      });
    return { ...state, freewayKeyHex, keyGeneration };
  }
}
