import { createHash } from "node:crypto";
import {
  type CallerContext,
  INDEX_TICKET,
  type IndexOpenTicket,
  IndexOpenTicketParams,
  indexEndpointsFor,
  PORTS,
  type RemoteIndexEndpointSet,
  remoteIndexEndpointsFor,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import {
  MAX_GRANT_BYTES,
  mintGrant,
  SCOPE_FILES,
  SCOPE_READ,
} from "@vibefield/rosetta-protocol/grants";
import type { ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";
import {
  ROSETTAD_UNCONFIGURED,
  type RosettadCredentials,
  type RosettadHealth,
  type RosettadState,
} from "./rosettad-supervisor";
import {
  publishedServe,
  RouteServeDriver,
  type RouteServeLog,
  routeServeSpec,
  type ServedProcess,
} from "./route-serve";
import { clientIdFor } from "./terminal-grants";

// SP-3 (thinking-sync-planes.md §5.4, §6; thinking-desktop-sync-plane.md §6.4;
// design-06 §6, §8) — ROSETTAD'S SERVE: the route-per-process driver's SECOND
// user, after the cells.
//
// A session's transcript is read at the OWNER's rosettad, as rosetta's own
// stream (history to a stamp, the live tail, `resync`), with fieldd out of the
// byte path (SP-7's witness). So the owner publishes rosettad's loopback
// listener as ONE serve on a fixed port, `PORTS.INDEX_SERVE`, gated by the
// linked login like every serve: the WHOLE listener onto the daemon's
// ephemeral loopback port, nothing stripped (`kind: "port"`), so a client
// dials rosetta's own routes at the root — `RemoteIndexEndpointSet`'s one leg,
// `/ws/sessions/<id>` — and the asset paths a timeline names stay dialable.
//
// BEHIND A FLAG THAT IS OFF (`FielddConfig.indexDirectPlane`), and the reason
// is EL7, not caution for its own sake. The PINNED rosettad verifies no
// credential: RO-1's bearer on every route and RO-10's per-session grants are
// built on rosetta's `feat/direct-plane-grants` and unmerged, and the
// supervisor's own header says what that means — until RO-1, "the daemon's
// ORIGIN is the secret". Publishing it would put every transcript, and its two
// writes, one same-login node away. DS-7's pin move brings the bearer and the
// grant key: fieldd starts rosettad with both files, `index.openTicket` mints
// the grant, DS-L6's routable list gains this port, and the flag goes away.
//
// WHY A CONFIG FIELD, not a registry constant: it is a fact about THIS daemon's
// rosettad (is it started with a credential?), not wire truth two planes
// share — `registries.ts` is generated into Rust and mirrored by the kit, and
// a feature switch there is dead weight for both; the witness needs both
// positions in one test process, which a constant cannot give without module
// mocks; and no environment variable reaches it, so a same-uid process cannot
// turn it on by launching fieldd with one — only a code edit can (bin.ts sets
// nothing), which is DS-7's to make.
//
// A CONSTRUCTION-TIME FACT: with the flag off no driver exists and fieldd makes
// no index serve call at all — a boot is byte-for-byte what it was. The residue
// is F-H1's: a listener a flag-ON predecessor left in the floor stays there
// until the floor's unlink-retire, or until a flag-on successor's first refresh
// withdraws it. Tolerable while only tests turn the flag on; DS-7, which turns
// it on for good, inherits F-H1 through the driver as written.
//
// *Errata (2026-10-03, AR-8b): the pin moved to the RO-1 merge (`ee6724e`) and
// the premise above stopped holding. fieldd starts every rosettad behind a
// bearer with a grant key (rosettad-supervisor.ts), so the listener answers
// nothing without a credential and publishing it puts no transcript one node
// away. The flag is now ON unless a config says false, and the serve is
// declared only while the generation's ready line says it enforces both
// (`auth.bearer && auth.grants`). `index.openTicket` mints the grant below —
// for a window on this desktop, over the LOOPBACK set; a caller across the
// tailnet (the phone, SP-6) and another desktop's forward (DS-7) still hear
// `direct-plane-unbuilt`, because the set they would dial is this serve's and
// nothing hands it out yet. The flag stays a code seam with an honest off
// path (`direct-plane-off`), never an environment variable. F-H1's residue
// above is now every flag-on boot's to withdraw, which the driver's first
// refresh does.*

/** The engine identity and display name of rosettad's listener. */
export const INDEX_SERVE_ID = "index" as const;

/** SP-3 — rosettad as a served process. */
export const INDEX_SERVED: ServedProcess = {
  serveId: INDEX_SERVE_ID,
  listenPort: PORTS.INDEX_SERVE,
};

const INDEX_SERVE_LOG: RouteServeLog = {
  declared: "fieldd.index_serve.declared",
  deferred: "fieldd.index_serve.declare_deferred",
  declaredMessage: "The index serve was declared",
  withdrawnMessage: "The index serve was withdrawn",
  deferredMessage: "An index serve declaration did not reach the node; the next change retries",
};

/** The loopback port behind rosettad's origin (`http://127.0.0.1:<port>`,
 * `RosettadState.origin` while ready), or `undefined` for anything else — a
 * daemon that is not ready, or an origin that is not a literal loopback one
 * (the supervisor refuses those already; this does not trust that it did). */
export function indexTargetPort(origin: string | null): number | undefined {
  if (origin === null) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return undefined;
  const port = Number(url.port);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

/** The serve the current state calls for, or `null`. Pure: the route driver's
 * three gates — the flag is the owner's word, the link the login, a ready
 * rosettad the one routable target. */
export function indexServeSpec(input: {
  enabled: boolean;
  origin: string | null;
  linkedLogin: string | null;
}): ServeSpec | null {
  const port = indexTargetPort(input.origin);
  return routeServeSpec(INDEX_SERVED, {
    published: input.enabled,
    linkedLogin: input.linkedLogin,
    targets: port === undefined ? null : { kind: "port", port },
  });
}

export interface IndexServeDriverOptions {
  /** fieldd's `indexDirectPlane` (the owner's word; OFF until DS-7) */
  enabled: () => boolean;
  /** rosettad's loopback origin while ready (`RosettadSupervisor.state()`) */
  origin: () => string | null;
  /** the WhoIs login this daemon is linked to, or null */
  linkedLogin: () => string | null;
  /** remove-then-add through the mesh; true iff the node now matches (F-M5) */
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  /** the mesh's live serve view — a declaration found landed later (route-serve.ts) */
  serves?: () => readonly ServeState[];
  logger?: Logger;
}

/** Drives rosettad's serve: re-aimed at every restart (a new loopback port),
 * withdrawn while the daemon is down, never declared without a linked login. */
export class IndexServeDriver extends RouteServeDriver {
  constructor(opts: IndexServeDriverOptions) {
    super({
      desired: () =>
        indexServeSpec({
          enabled: opts.enabled(),
          origin: opts.origin(),
          linkedLogin: opts.linkedLogin(),
        }),
      declare: opts.declare,
      ...(opts.serves !== undefined ? { serves: opts.serves } : {}),
      log: INDEX_SERVE_LOG,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }
}

/** The set a ticket for one session names, read off the LIVE index serve: the
 * serve is active with a URL AND aimed at the rosettad answering NOW. A
 * restart moves rosettad's port; until the re-declare lands the serve forwards
 * to a dead port, and a URL into it is not one a client can act on — that is
 * `undefined`, as a cell whose route has not landed is. DS-7's door names this
 * beside the grant it mints; until then nothing hands it out. */
export function indexEndpointsFrom(
  serves: readonly ServeState[],
  origin: string | null,
  sessionId: string,
): RemoteIndexEndpointSet | undefined {
  const serve = publishedServe(serves, INDEX_SERVE_ID);
  if (serve === undefined) return undefined;
  const port = indexTargetPort(origin);
  if (port === undefined || serve.target.kind !== "port" || serve.target.port !== port)
    return undefined;
  return remoteIndexEndpointsFor(serve.url, sessionId);
}

/** AR-8b — is this generation one the direct plane may stand on: ready, and
 * its ready line said it enforces a bearer AND verifies grants. The
 * supervisor refuses any other daemon, so this is the belt to its braces. */
export function indexPlaneLive(state: RosettadState | null): boolean {
  return (
    state !== null &&
    state.phase === "ready" &&
    state.origin !== null &&
    state.auth?.bearer === true &&
    state.auth.grants === true
  );
}

export interface IndexTicketMinterOptions {
  /** fieldd's `indexDirectPlane` — the owner's word (ON unless config says false) */
  enabled: boolean;
  /** the supervisor's three readings, or null when no daemon is configured */
  supervisor: {
    health(): RosettadHealth;
    state(): RosettadState;
    credentials(): RosettadCredentials | null;
  } | null;
  /** this desktop's device id — the ticket's `device` */
  deviceId: () => string;
  /** the grant's life (`INDEX_TICKET.TTL_MS`; a test seam) */
  ttlMs?: number;
  now?: () => number;
}

/** What a mint is for, once every refusal has been said: the session, the
 * audit target that names it, and what its grant may do. */
export interface IndexTicketAsk {
  sessionId: string;
  /** the session id when it is a safe audit identity, else its digest */
  auditId: string;
  /** the grant's scopes — `indexTicketScopes(ctx)`, decided once, so the
   * mint and its audit record say the same thing */
  scope: readonly string[];
}

/** The desktop window: the shell-minted renderer bearer on the loopback door
 * (`rendererIdentity`'s proof in plugin-update-transport.ts, read here without
 * throwing). `clientKind` is a claim, so it only ever narrows. */
function isDesktopWindow(ctx: CallerContext): boolean {
  return (
    ctx.principal.kind === "local-token" &&
    ctx.principal.rendererParticipant !== undefined &&
    ctx.transport === "ws-loopback" &&
    ctx.clientKind === "renderer"
  );
}

/**
 * RO-13 (James, 2026-10-04) — what a ticket's grant may do, by who asked.
 * `read` opens the session's recorded history (its socket, its rows, its
 * plans, the assets). `files` beside it opens the session's recorded-file read
 * (rosetta docs/AUTH.md §5.4): rosettad reads the file a row names from THIS
 * desktop's disk as it is NOW, which is more than the transcript, so the scope
 * is minted per principal. The desktop WINDOW holds it — the History room opens
 * recorded files there. Every other holder keeps `read` alone until a law says
 * otherwise: the shell, a plain local token, and — refused a ticket today, but
 * the rule outlives the refusals — a plugin, an MCP agent, the phone, a guest,
 * another desktop's daemon.
 */
export function indexTicketScopes(ctx: CallerContext): readonly string[] {
  return isDesktopWindow(ctx) ? [SCOPE_READ, SCOPE_FILES] : [SCOPE_READ];
}

/** A session id as an audit target may carry it: rosetta's ids are any text
 * (its own grant vectors carry controls), and the audit ledger refuses control
 * characters and anything longer than 256 — such an id is named by its digest
 * instead, which is still one session's and never the text itself. */
function auditSessionId(sessionId: string): string {
  const printable = [...sessionId].every((character) => {
    const code = character.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  if (printable && sessionId.length <= 256 && !/tok_|bearer|\/t\//i.test(sessionId))
    return sessionId;
  return `sha256:${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

/**
 * SP-3 / AR-8b — `index.openTicket`. Declared by SP-3 answering
 * `direct-plane-unbuilt`; since AR-8b it MINTS, for a window on this desktop:
 * the loopback set (`IndexEndpointSet`: rosetta's session socket and the
 * daemon's origin) and, beside it, an RO-10 grant for exactly that session —
 * `sid` the session, `cid` the caller's client identity (`clientIdFor`, the
 * terminal grants' rule: a renderer window's participant, else the token's
 * principal), `scope` by who asked (`indexTicketScopes`: `["read", "files"]`
 * for the desktop window since RO-13, `["read"]` for everyone else),
 * `exp` = now + `INDEX_TICKET.TTL_MS` — signed with the key the current
 * generation verifies. Every answer is a
 * fresh grant (the method is not idempotent): `exp` only ever moves forward,
 * so two asks in one millisecond still get two grants.
 *
 * The refusals, in the order a caller hears them:
 *  - a malformed ask: PRECONDITION_FAILED (the caller's to fix);
 *  - a plugin or an MCP agent: FORBIDDEN_SCOPE — a ticket opens a transcript,
 *    and only a window or the shell may hold one (EL7: an agent is the
 *    adversary; a plugin's `index.read` buys the roll call, not a transcript);
 *  - the phone, or another desktop's daemon forwarding a `{device}` ask:
 *    UNAVAILABLE `direct-plane-unbuilt`, retryable false — their set is the
 *    tailnet serve's (SP-6, DS-7), and nothing hands it out yet;
 *  - the plane switched off: UNAVAILABLE `direct-plane-off`, retryable false;
 *  - no daemon ready: UNAVAILABLE `{service: "index", state: <phase>}`,
 *    retryable unless unconfigured — the other index doors' answer;
 *  - a ready daemon that does not enforce access (the supervisor refuses one,
 *    so this is the belt): `direct-plane-off` too, for that daemon's life.
 * A guest never gets here: its preset holds no scope.
 */
export class IndexTicketMinter {
  readonly #opts: IndexTicketMinterOptions;
  #lastExp = 0;

  constructor(opts: IndexTicketMinterOptions) {
    this.#opts = opts;
  }

  /** Every refusal, before anything is minted or audited. */
  check(ctx: CallerContext, params: unknown): IndexTicketAsk {
    const parsed = IndexOpenTicketParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected { sessionId: string, device?: string }",
        false,
      );
    // a lone surrogate is not text: no URL can carry it and rosetta's
    // canonical form refuses it, so the ask is the caller's to fix
    if (/\p{Cs}/u.test(parsed.data.sessionId))
      throw new RpcCallError("PRECONDITION_FAILED", "the session id is not Unicode text", false);
    const kind = ctx.principal.kind;
    if (kind === "plugin" || kind === "mcp-agent" || kind === "tailnet-guest")
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "a ticket opens a transcript; only a window or the shell on this desktop may hold one",
        false,
        { method: "index.openTicket", principal: kind },
      );
    if (kind === "tailnet" || kind === "peer-fieldd")
      throw new RpcCallError(
        "UNAVAILABLE",
        kind === "tailnet"
          ? "a ticket across the tailnet is not served yet: the phone's set is the index serve's (SP-6)"
          : "a ticket for another desktop's session is not served yet: it rides the egress route (DS-7)",
        false,
        { service: INDEX_TICKET.SERVICE, state: INDEX_TICKET.STATE_UNBUILT },
      );
    if (!this.#opts.enabled)
      throw new RpcCallError("UNAVAILABLE", "the direct plane is off on this desktop", false, {
        service: INDEX_TICKET.SERVICE,
        state: INDEX_TICKET.STATE_OFF,
      });
    const supervisor = this.#opts.supervisor;
    const health = supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    if (supervisor === null || health.phase !== "ready")
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index is ${health.phase}${health.detail ? `: ${health.detail}` : ""}`,
        health.phase !== "unconfigured",
        { service: INDEX_TICKET.SERVICE, state: health.phase },
      );
    // the supervisor refuses a daemon that does not enforce access; were one
    // ever to stand here, the plane is off for its life — never a grant it
    // would not check
    if (!indexPlaneLive(supervisor.state()))
      throw new RpcCallError(
        "UNAVAILABLE",
        "the agent index is not enforcing access, so the direct plane stays off",
        false,
        { service: INDEX_TICKET.SERVICE, state: INDEX_TICKET.STATE_OFF },
      );
    return {
      sessionId: parsed.data.sessionId,
      auditId: auditSessionId(parsed.data.sessionId),
      scope: indexTicketScopes(ctx),
    };
  }

  /** The mint itself — called inside the audit's attempt (daemon.ts). The
   * origin and the key are read in ONE tick from the generation answering now,
   * so a ticket never pairs one generation's port with another's key. */
  mint(ctx: CallerContext, ask: IndexTicketAsk): IndexOpenTicket {
    const supervisor = this.#opts.supervisor;
    const state = supervisor?.state() ?? null;
    const credentials = supervisor?.credentials() ?? null;
    if (supervisor === null || !indexPlaneLive(state) || credentials === null || state === null)
      throw new RpcCallError("UNAVAILABLE", "the agent index went away during the mint", true, {
        service: INDEX_TICKET.SERVICE,
        state: state?.phase ?? "unconfigured",
      });
    const endpoints = indexEndpointsFor(state.origin as string, ask.sessionId);
    if (endpoints === undefined)
      throw new RpcCallError("UNAVAILABLE", "the agent index has no loopback origin", true, {
        service: INDEX_TICKET.SERVICE,
        state: state.phase,
      });
    const now = (this.#opts.now ?? Date.now)();
    const exp = Math.max(now + (this.#opts.ttlMs ?? INDEX_TICKET.TTL_MS), this.#lastExp + 1);
    let grant: string;
    try {
      grant = mintGrant(credentials.grantKey, {
        cid: clientIdFor(ctx.principal),
        exp,
        scope: ask.scope,
        sid: ask.sessionId,
        v: 1,
      });
    } catch {
      // `check` refused what is not text; anything else rosetta's canonical
      // form would refuse is still the caller's id, never a half ticket
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "rosetta's grant form refuses this session id",
        false,
      );
    }
    if (grant.length > MAX_GRANT_BYTES)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `the session id is too long for a grant (rosetta reads at most ${MAX_GRANT_BYTES} bytes)`,
        false,
      );
    this.#lastExp = exp;
    return { device: this.#opts.deviceId(), endpoints, grant, expiresAt: exp };
  }
}
