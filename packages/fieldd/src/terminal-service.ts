import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute } from "node:path";
import {
  GhostteaAutomationClient,
  GhostteaConfigDocumentConflictError,
  GhostteaRequestError,
} from "@vibecook/ghosttea-client";
import {
  CELL_SUPERVISION,
  type CellEndpointSet,
  ObservedState,
  type RouteBinding,
  TERMINAL_SCROLLBACK_CLASS_BYTES,
  TERMINAL_SESSION_CAP,
  type TerminalConfigDocument,
  type TerminalConfigWriteResult,
  type TerminalCreateOpenResponse,
  type TerminalCreateParams,
  type TerminalEndpoints,
  type TerminalInfo,
  type TerminalObservation,
  type TerminalOpenTicket,
  type TerminalOpenTicketResponse,
  type TerminalRenewAttachParams,
  type TerminalRenewAttachResult,
  type TerminalRosterResult,
  type TerminalRouteCell,
  type TerminalRouteSnapshot,
  TerminalRuntimeSession,
  TerminalRuntimeSessionsResult,
  type TerminalTerminateResult,
  type TerminalWorkloadClass,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError, terminalCreateTarget } from "./native-link";
import {
  type CellGrantKey,
  type GrantPrincipal,
  projectRoster,
  TerminalGrantMinter,
} from "./terminal-grants";

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
  /** TC-D15 — the revisioned snapshot those endpoints were derived from, when
   * the link has one. OPTIONAL, because a pre-TC-S2 floor's link has none and
   * this seam must keep working from the legacy mirror alone; what it adds is
   * IDENTITY — `cellBootId` is the only field that tells a replaced engine
   * apart from a re-pair to the same one. */
  readonly terminalRoutes?: TerminalRouteSnapshot | undefined;
  on(event: "terminal-endpoints", fn: () => void): unknown;
}

export interface TerminalServiceOptions {
  link: TerminalLink;
  logger?: Logger;
  /** injectable for tests; production = the user's login shell */
  defaultShell?: () => string;
  /** Test seam for the unresponsive-floor classification; production leaves it
   * to the client's own 10s default. */
  requestTimeoutMs?: number;
  /** TC-S2 test seam: the cell-birth wait budget. Production defaults to the
   * cell's own hello deadline (the genned CELL_SUPERVISION authority). */
  birthWaitMs?: number;
}

/** Free-shell spawn geometry until an attached view claims resize authority
 * (03·A: the active view owns cols/rows; nothing has attached yet at birth). */
const SPAWN_COLS = 100;
const SPAWN_ROWS = 30;

/** Every session fieldd births carries this owner label — `close-session-owner`
 * gives a future "close everything VibeField spawned" op for free. */
const OWNER_ID = "vibefield.fieldd";

/** TC-S3 — the connection key for a floor that publishes no routes at all (a
 * pre-TC-S2 daemon, whose legacy `terminal` mirror is the only reading there
 * is). A NUL cannot appear in a floor-minted `cellBootId`, so this key can
 * never collide with a real cell's. */
const LEGACY_CELL_KEY = "\u0000legacy-mirror";

/** TC-S3 — one cell, resolved for one operation: the connection key (its
 * `cellBootId`, THE identity) and the coordinates to dial. Resolved per call,
 * never cached: a route change can replace the row under us, and the token
 * inside is a live credential (GT-5b). */
interface CellTarget {
  key: string;
  endpoints: TerminalEndpoints;
  /** TP-S1 — the row's per-cell-boot grant key, when the floor minted one;
   * absent = a pre-TP floor / the legacy mirror: no grants are minted. */
  grantKey?: CellGrantKey;
  /** TP-S3a — the cell's T1 doors, when it serves them (the route row's
   * `doors`); they become `TerminalOpenTicket.endpoints` and nothing else
   * reads them. Absent = the ticket carries no endpoints (honest: a renderer
   * shows `transport-not-landed`), never a made-up URL. */
  doors?: CellEndpointSet;
}

/** What a route row adds to a cell target beyond its dial coordinates: the
 * grant key in the minter's shape (TP-S1) and the T1 doors (TP-S3a) — each
 * present only when the row carries it. */
function rowExtrasOf(row: TerminalRouteCell): Pick<CellTarget, "grantKey" | "doors"> {
  return {
    ...(row.grantKey === undefined
      ? {}
      : {
          grantKey: {
            cellBootId: row.cellBootId,
            keyHex: row.grantKey,
            keyGeneration: row.grantKeyGeneration ?? 1,
          },
        }),
    ...(row.doors === undefined ? {} : { doors: row.doors }),
  };
}

/** One live control connection to one cell. */
interface CellClient {
  client: GhostteaAutomationClient;
  /** the token it authenticated with — a rotation makes it stale (GT-5b) */
  token: string;
}

export class TerminalService {
  private readonly logger: Logger;
  private terminals: TerminalInfo[] = [];
  /** Which floor observation `terminals` came from — undefined until the first
   * one applies, which is exactly the state `list`/`get` refuse in. */
  private lastObservation: TerminalObservation | undefined;
  /** TC-S3 — one control connection PER CELL, keyed by `cellBootId` (THE
   * identity: a row's replacement is a new cellBootId, so a new client; pids
   * recycle and ordinals repeat). GT-5b's staleness laws are kept per entry —
   * an entry whose cell left the snapshot, or whose token rotated, is dropped,
   * and ONLY that entry. That is the connection-plane half of "a terminal-engine
   * crash loses only its class": the surviving cell keeps serving its sessions
   * through the connection it already has. */
  private clients = new Map<string, CellClient>();
  /** in-flight control dials, keyed like `clients`, each remembering the token
   * it is authenticating with (two dials for two boots are two clients) */
  private connecting = new Map<
    string,
    { token: string; promise: Promise<GhostteaAutomationClient> }
  >();
  private disposed = false;
  /** true once the observed subscription is armed; NativeLink replays it across
   * reconnects from then on (P5), so ensureStarted becomes a no-op */
  private subscribed = false;
  private starting: Promise<void> | null = null;
  /** TC-D15/TC-S3 — the ROWS of the last route reading fieldd actually saw, the
   * baseline the per-cell loss diff runs against. Kept across a link outage on
   * purpose: a dead mgmt connection kills no PTYs, so an ABSENCE must not
   * overwrite the cells fieldd last saw. Holding them is what lets a reconnect
   * onto DIFFERENT cells still be named as the loss it is, while a reconnect
   * onto the same ones stays silent. It is the rows and no longer one id
   * because with K=2 class cells a change is a DIFF, not a replacement:
   * "which cells vanished" is the question the receipt answers. */
  private cells: readonly TerminalRouteCell[] | undefined;
  /** TP-S1 — the TPv3 grant issuer: generation ledgers in memory, MACs over
   * the route row's per-cell-boot key (terminal-grants.ts). */
  private readonly minter = new TerminalGrantMinter();

  constructor(private readonly opts: TerminalServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    // The link has usually paired BEFORE this service exists (the daemon builds
    // it after `native.connect()`), so the cells in hand at construction are the
    // baseline. Without seeding them, the first replacement after every boot
    // would have nothing to compare against and would go unrecorded — the one
    // case the receipt exists for.
    this.cells = opts.link.terminalRoutes?.cells;
    opts.link.on("terminal-endpoints", () => this.onRouteChange());
  }

  /** The floor's cells moved. Two things follow, in this order.
   *
   * The control connections of the cells that CHANGED are worthless — a fresh
   * cell mints a fresh token — so those are dropped; the ones whose row is
   * still there, at the same token, are kept. Before TC-S3 this was a wholesale
   * drop, which was right when there was one cell and is wrong now: hanging up
   * on the interactive cell because the agent cell crashed would make fieldd's
   * own connections the blast radius the cells exist to bound.
   *
   * Then the honesty half, "blast counted". Every cell that VANISHED from the
   * snapshot took its sessions with it: TC-S2's ceiling, now stated per class —
   * "a terminal-engine crash loses only its class". The product owes each one a
   * receipt naming ITS sessions, because this is the one moment the loss is
   * knowable: the observed stream repairs the inventory a beat later and no
   * snapshot after that can reconstruct which cell held what. The join is the
   * inventory's `cell` tag (TC-S3) — the reason that tag exists.
   *
   * The receipt is a structured log and not an audit record, deliberately:
   * `AuditService`'s append surface is caller-scoped (it wants a CallerContext)
   * and nothing here has a caller — this is the floor's news arriving on an
   * event. Minting a synthetic principal to force it into the ledger would put
   * a fabricated caller on an EL7 surface to make a diagnostic prettier. */
  private onRouteChange(): void {
    this.pruneClients();
    const routes = this.opts.link.terminalRoutes;
    // Absence is not evidence of loss: the link may merely be down, and a
    // pre-TC-S2 floor never says at all. An EMPTY `cells` is a READING, though
    // (the floor is up and has no engine right now) — a cell that vanished into
    // one is as lost as a cell that vanished into a replacement.
    if (routes === undefined) return;
    const previous = this.cells;
    this.cells = routes.cells;
    if (previous === undefined) return;
    const live = new Set(routes.cells.map((cell) => cell.cellBootId));
    // TC-S3 — an UNTAGGED session can be attributed to exactly one reading: a
    // pre-TC-S3 floor, whose single cell declared no class and whose inventory
    // carries no `cell` tag at all. That is today's receipt, preserved. With
    // more than one cell in the previous reading an untagged session names no
    // cell, and a guess about which one took it would be worse than silence.
    const legacySingleCell = previous.length === 1 && previous[0]?.workloadClass === undefined;
    for (const gone of previous) {
      if (live.has(gone.cellBootId)) continue;
      // Counted from the last inventory fieldd actually observed; before the
      // first observation there is nothing it can honestly claim was lost.
      const lostSessionIds = this.terminals
        .filter((terminal) =>
          terminal.cell === undefined
            ? legacySingleCell
            : terminal.cell.cellBootId === gone.cellBootId,
        )
        .map((terminal) => terminal.sessionId);
      if (lostSessionIds.length === 0) continue;
      this.logger.warn(
        "fieldd.terminal.cell_replaced",
        "The terminal engine was replaced and its sessions are gone — a terminal-engine crash loses only its class",
        {
          lostSessionIds,
          lostSessions: lostSessionIds.length,
          // the VANISHED cell is the subject: with K cells there is no single
          // "replacement" to name, and the loss is this row's
          cellBootId: gone.cellBootId,
          ...(gone.workloadClass === undefined ? {} : { workloadClass: gone.workloadClass }),
          ...(gone.role === undefined ? {} : { role: gone.role }),
          revision: routes.revision,
        },
      );
    }
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
          // Kept, not discarded (GT-5b): these two fields are what let a
          // consumer tell an inventory apart from a LATER floor's, and their
          // presence is also the flag that `list`/`get` are answerable at all.
          this.lastObservation = { bootId: parsed.data.bootId, generation: parsed.data.generation };
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

  /** The observed inventory — or a refusal, if nothing has been observed yet.
   *
   * GT-5b, and the sharpest of the honest-states cases because the dishonest
   * answer was WELL-FORMED. Before the first snapshot applies this returned
   * `[]`, which reads as "this floor holds no sessions" and is a claim fieldd
   * had made no observation to support. The costly case is the two-plane one
   * the whole design exists for: fieldd restarts while field-native keeps
   * running, its first observed-subscribe is refused (swallowed by design, it
   * re-arms), and the empty answer tells the Godview's restore that every
   * saved pane is dead — offering "start clean", which DELETES the layout of
   * sessions that are alive one plane down.
   *
   * Refusing instead reaches the deck's existing correct branch: it mounts
   * unarmed on a failed list, commented that guessing every saved pane is dead
   * would be the one answer certain to be wrong. The flag is one-way. A link
   * drop does NOT un-observe: a dead mgmt connection kills no PTYs, the last
   * inventory is the last thing fieldd actually saw, and health carries the
   * outage. */
  list(): TerminalInfo[] {
    this.requireObserved();
    return this.terminals;
  }

  get(sessionId: string): TerminalInfo | undefined {
    this.requireObserved();
    return this.terminals.find((t) => t.sessionId === sessionId);
  }

  /** Which floor observation `list` is answering from; undefined only when
   * `list` would refuse. */
  observation(): TerminalObservation | undefined {
    return this.lastObservation;
  }

  /** D6: the ticket IS the endpoints — the single native service token, socket
   * paths stable across fieldd restarts. Fails honest when the floor is absent
   * (native down, terminal unit degraded, pre-NF-2 daemon).
   *
   * That sentence was a comment asserting a protection that did not exist
   * until GT-5b: `terminalEndpoints` was assigned on the pairing hello and
   * cleared nowhere, so once a floor had EVER said hello this minted forever —
   * after a field-native SIGKILL it handed out socket paths that no longer
   * existed plus a dead boot's token, and the audit recorded the grant as a
   * success. NativeLink now clears the endpoints whenever the mgmt link stops
   * being live, which is what makes `endpoints()` below reachable again.
   *
   * Deliberately NOT session-scoped: the credential is the floor's, not the
   * session's, so minting one for a just-created session needs no inventory
   * lookup — which is exactly what lets terminal.create answer with a ticket
   * (GT-1) while openTicket keeps its observed gate for existing sessions.
   *
   * TC-S3's SESSIONLESS mint (`ticket()`, GT-D10's connect ticket) and the
   * bridge-era `ticketForSession`/`ticketForCell` RETIRED at TP-S3e with the
   * legacy trio: every remaining mint is session-scoped and routed
   * (`openTicket`/`createOpenResult` below), and a cell that cannot serve the
   * T1 doors answers UNAVAILABLE instead of a half ticket. */

  /** `terminal.openTicket` — exactly `TerminalOpenTicket` since TP-S3e: the
   * session's OWN cell (the inventory's `cell` tag), its doors and both
   * grants; a keyless or doorless cell is UNAVAILABLE, never a half ticket. */
  openTicket(principal: GrantPrincipal, sessionId: string): TerminalOpenTicketResponse {
    const cell = this.sessionCell(sessionId);
    return this.ticketFor(cell, principal, sessionId);
  }

  /** The create result (GT-1's atomic mint) for the cell the session LANDED
   * on — id + the authoritative birth summary + the routed ticket spread. The
   * legacy nested `ticket` retired at TP-S3e; a legacy floor (no cell tag) has
   * no doors to mint against and is UNAVAILABLE like every other keyless cell
   * — the session exists, and the reader's face says the transport does not. */
  createOpenResult(
    principal: GrantPrincipal,
    created: {
      sessionId: string;
      session: TerminalRuntimeSession;
      cellBootId?: string | undefined;
    },
  ): TerminalCreateOpenResponse {
    if (created.cellBootId === undefined)
      throw new RpcCallError(
        "UNAVAILABLE",
        "this floor serves no terminal doors (legacy mirror) — no routed ticket can be minted",
        true,
        { service: "terminal", state: "transport_not_landed" },
      );
    const cell = this.cellByBootId(created.cellBootId);
    return {
      sessionId: created.sessionId,
      session: created.session,
      ...this.ticketFor(cell, principal, created.sessionId),
    };
  }

  /** TP-S1 — `terminal.renewAttach`: CAS on the generation the caller holds,
   * idempotent by requestId (terminal-grants.ts). A cell that mints no grants
   * has nothing to renew — UNAVAILABLE, the honest state. */
  renewAttach(
    principal: GrantPrincipal,
    params: TerminalRenewAttachParams,
  ): TerminalRenewAttachResult {
    const cell = this.sessionCell(params.sessionId);
    if (cell.grantKey === undefined)
      throw new RpcCallError(
        "UNAVAILABLE",
        "the terminal cell hosting this session mints no grants yet (pre-TP floor)",
        true,
        { service: "terminal", state: "grants_not_landed" },
      );
    const attachGrant = this.minter.renewAttach({
      key: cell.grantKey,
      principal,
      sessionId: params.sessionId,
      route: this.routeBinding(cell.key),
      expectGeneration: params.expectGeneration,
      requestId: params.requestId,
    });
    return { attachGrant };
  }

  /** TP-D4 — the UI's roster projection (no placement). Refuses before the
   * first observation exactly like `list` (GT-5b's honesty). */
  roster(): TerminalRosterResult {
    this.requireObserved();
    return {
      items: projectRoster(this.terminals),
      ...(this.lastObservation === undefined ? {} : { observation: this.lastObservation }),
    };
  }

  /** The one routed-ticket assembly (TP-S3e): grants + doors or an honest
   * refusal. `grants_not_landed` = the cell mints no grants (keyless
   * bootstrap); `transport_not_landed` = grants but no doors reported. */
  private ticketFor(
    cell: CellTarget,
    principal: GrantPrincipal,
    sessionId: string,
  ): TerminalOpenTicket {
    if (cell.grantKey === undefined)
      throw new RpcCallError(
        "UNAVAILABLE",
        "the terminal cell hosting this session mints no grants (keyless bootstrap)",
        true,
        { service: "terminal", state: "grants_not_landed" },
      );
    if (cell.doors === undefined)
      throw new RpcCallError(
        "UNAVAILABLE",
        "the terminal cell hosting this session serves no T1 doors",
        true,
        { service: "terminal", state: "transport_not_landed" },
      );
    return this.minter.mintTicket({
      key: cell.grantKey,
      principal,
      sessionId,
      route: this.routeBinding(cell.key),
      doors: cell.doors,
    });
  }

  /** The route binding at mint time. `leaseEpoch` stays absent until the
   * floor exposes custody's per-session lease epoch (TP-S3a); a key only ever
   * comes from a route row, so `routes` is defined whenever this is reached. */
  private routeBinding(cellBootId: string): RouteBinding {
    return { cellBootId, routeRevision: this.opts.link.terminalRoutes?.revision ?? 0 };
  }

  /** NF-D6, the free-shell door. Default = the user's LOGIN shell (`-l`): the
   * daemon's own environment is not the user's, and the login shell rebuilds
   * it; `environment: inherit` is inherit-minus-strip — field-native's
   * `with_private_env_prefixes` already removed every daemon secret class.
   * An EXPLICIT `shell` runs verbatim (no `-l` — it may be any program; tests
   * spawn /bin/cat). `title` has no upstream spawn option (SessionSummary
   * titles come from the running program) — accepted here, recorded in the
   * daemon's audit attrs, unapplied to the PTY.
   *
   * Births the session and nothing else. The product result also carries a
   * ticket (GT-1), but that mint is its own audited grant, so the daemon
   * composes the two rather than this method quietly handing out a credential —
   * which is why the answer names the CELL the session landed on (TC-S3) and
   * not its endpoints: the daemon needs to know where to mint from, not to be
   * handed the credential to mint. */
  async create(params: TerminalCreateParams): Promise<{
    sessionId: string;
    session: TerminalRuntimeSession;
    cellBootId?: string | undefined;
  }> {
    // TC-D6(d) — the per-pair session cap at the create seam, counted from the
    // observed inventory WHEN THERE IS ONE. Before the first observation the
    // cap has nothing to count and create must NOT gate on observation —
    // that is GT-1's whole point (create outruns the inventory by design; the
    // first draft here called list(), which re-fenced create behind
    // requireObserved and two gate rows caught it). The native admission
    // ledger and the kernel stay the authorities beneath either way. Inside
    // create — not in front of the audit — so a refused attempt is a RECORDED
    // attempt with a failed outcome, never a silent bounce.
    if (this.observation() !== undefined && this.terminals.length >= TERMINAL_SESSION_CAP) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        `the terminal session cap is reached (${TERMINAL_SESSION_CAP}); terminate sessions before creating more`,
        false,
        { service: "terminal", state: "session_cap" },
      );
    }
    // TC-D6(c) — ENFORCED since ghosttea 0.10.0 (petition G16): a DECLARED
    // workloadClass maps through the genned contracts table to the floor's
    // per-session byte cap, which the floor validates (reject-not-clamp) and
    // echoes back in SessionSummary. No class sends nothing — the floor's
    // global default governs, byte-identical to a pre-G16 create — because
    // inventing a class here would fake a policy the caller never declared.
    // The pinned client refuses a pre-1.15 floor rather than let the field be
    // silently ignored; that refusal is classified in the catch below.
    //
    // TC-D6(b) — pre-flight an ABSOLUTE shell before the wire: answered here
    // it costs no spawn and quotes the caller's own path. Refusals that DO
    // reach the floor come back typed since ghosttea 0.10.0 (G17) and are
    // classified in the catch below. PATH-relative names stay the spawner's
    // business — a second resolver would only disagree with the real one.
    if (params.shell !== undefined && isAbsolute(params.shell) && !existsSync(params.shell))
      throw new RpcCallError("NOT_FOUND", `shell not found: ${params.shell}`, false);
    // TC-S3 — the class is the PLACEMENT: it picks the cell this session is
    // born in, through the create-target discipline. The routing default is the
    // contract's tolerant-reader default (`TerminalCreateParams`: absent =
    // interactive), so an unchanged caller lands exactly where it always did.
    const workloadClass = params.workloadClass ?? "interactive";
    const cell = await this.awaitClassCell(workloadClass);
    const client = await this.connectedClient(cell);
    const explicit = params.shell !== undefined;
    const executable = params.shell ?? this.defaultShell();
    const scrollbackBytes = classScrollbackBytes(params.workloadClass);
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
        // spread, not `undefined`: an undeclared class must not put the KEY on
        // the wire either (exactOptionalPropertyTypes agrees)
        ...(scrollbackBytes === undefined ? {} : { scrollbackBytes }),
      });
      // The cell that took it, for the daemon's nested mint. The legacy key
      // names no cell — there is no row to name — and the mirror answers there.
      return {
        sessionId: summary.id,
        // The routed renderer needs the engine's real decimal handle before it
        // can mount. Carry the summary from the birth that already has it;
        // waiting for observed inventory here would recreate GT-1's race.
        session: TerminalRuntimeSession.parse(summary),
        ...(cell.key === LEGACY_CELL_KEY ? {} : { cellBootId: cell.key }),
      };
    } catch (error) {
      // Failure classification (the NF-6 review's theme): a dead transport is
      // UNAVAILABLE, never INTERNAL — the floor is gone, not the request wrong.
      if (!client.connected) throw this.unavailable("the terminal floor died mid-create", error);
      // GT-5b: `connected` is `authenticated && socket !== undefined` in the
      // pinned client, and a request TIMEOUT leaves both untouched — so a
      // wedged floor used to answer INTERNAL(retryable) here. It is worse than
      // a misnomer for create: the PTY may have been born and merely replied
      // late, so fieldd reported a fault for an effect that happened, the
      // caller retried, and the first session was left unnamed. UNAVAILABLE
      // says what is true (the floor is not answering) without claiming to
      // know whether the spawn landed.
      if (isRequestTimeout(error)) throw this.unresponsive("create", error);
      const message = errorMessage(error);
      // G16's honest-refusal half: the pinned CLIENT refuses to ask a
      // pre-1.15 floor for a per-session cap — silence would be a cap the
      // caller believes in and nothing enforces. Same classification as the
      // config-document floor below it: no amount of retrying teaches an old
      // floor a new field.
      if (NO_SESSION_SCROLLBACK.test(message))
        throw new RpcCallError("UNAVAILABLE", `create refused: ${message}`, false, {
          service: "terminal",
          state: "unsupported",
        });
      // TC-D6(b) — typed classification (ghosttea 0.10.0, petition G17): wire
      // refusals now carry {stage, code, osError} beside a byte-identical
      // message. `code` is upstream's STABLE vocabulary, typed at the failure
      // site and never string-parsed (its own unit rows pin that). The
      // openpty stage is the negotiated exception: portable-pty stringifies
      // the errno inside openpty() itself, so that arm still reads the
      // message — now fenced by stage, so spawn-stage prose can never borrow
      // it. Spelling authority for pressure states stays contracts
      // RESOURCE_PRESSURE_STATES, same as the native emitters.
      const meta = error instanceof GhostteaRequestError ? error : undefined;
      if (
        meta?.code === "file-descriptor-exhausted" ||
        ((meta?.stage === undefined || meta.stage === "openpty") &&
          classifyOpenptyPressure(message) !== null)
      )
        throw new RpcCallError(
          "RESOURCE_EXHAUSTED",
          `create refused: file descriptors are exhausted at the floor — terminate sessions before creating more (${message})`,
          false,
          { service: "terminal", state: "fd_pressure" },
        );
      // The two caller's-input codes the floor names. NOT_FOUND matches the
      // absolute-path pre-flight's own answer — this arm is the PATH-relative
      // and TOCTOU half the pre-flight cannot reach.
      if (meta?.code === "executable-not-found")
        throw new RpcCallError("NOT_FOUND", `shell not found: ${executable}`, false);
      if (meta?.code === "permission-denied")
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `create failed: ${executable} is not executable (permission denied)`,
          false,
        );
      // The flattened-string fallback: a refusal with NO typed code — the
      // shape every pre-0.10.0 floor emitted, kept as the tolerant-reader
      // floor (anchored: the floor's `session spawn task stopped` is ITS
      // fault, not the caller's, and must stay INTERNAL). A code that IS
      // present but unknown here refuses the caller's-input claim — upstream's
      // vocabulary can grow (`resource-exhausted` is emitted for spawn-time
      // OOM today), and a guessed blame is worse than INTERNAL retryable with
      // the triple carried for diagnosis.
      if (meta?.code === undefined && SPAWN_REFUSAL.test(message))
        throw new RpcCallError("PRECONDITION_FAILED", `create failed: ${message}`, false);
      throw new RpcCallError(
        "INTERNAL",
        meta?.code === undefined
          ? `create failed: ${message}`
          : `create failed: ${message} [stage=${meta.stage ?? "?"} code=${meta.code}${
              meta.osError === undefined ? "" : ` osError=${meta.osError}`
            }]`,
        true,
      );
    }
  }

  /**
   * G23's transport-private session inventory.
   *
   * `terminal.list` remains the floor-observation answer and `terminal.roster`
   * remains the placement-free UI projection.  This read exists for the
   * routed runtime alone: a pane cannot mount without Ghosttea's real numeric
   * session handle.  Resolve every observed cell independently, list each once,
   * and filter back to the observed ids so a control-plane race cannot leak a
   * session the product inventory has not admitted yet.
   */
  async runtimeSessions(): Promise<TerminalRuntimeSessionsResult> {
    const observed = this.list();
    if (observed.length === 0) return { sessions: [] };

    const wanted = new Set(observed.map((terminal) => terminal.sessionId));
    const cells = new Map<string, CellTarget>();
    for (const terminal of observed) {
      const cell = this.sessionCell(terminal.sessionId);
      cells.set(cell.key, cell);
    }

    const batches = await Promise.all(
      [...cells.values()].map(async (cell) => {
        const client = await this.connectedClient(cell);
        try {
          return await client.listSessions();
        } catch (error) {
          if (!client.connected)
            throw this.unavailable("the terminal floor died while listing runtime sessions", error);
          if (isRequestTimeout(error)) throw this.unresponsive("runtime session inventory", error);
          throw new RpcCallError(
            "INTERNAL",
            `runtime session inventory failed: ${errorMessage(error)}`,
            true,
          );
        }
      }),
    );

    const byId = new Map<string, TerminalRuntimeSession>();
    for (const summary of batches.flat()) {
      if (!wanted.has(summary.id)) continue;
      const parsed = TerminalRuntimeSession.parse(summary);
      byId.set(parsed.id, parsed);
    }
    return TerminalRuntimeSessionsResult.parse({
      sessions: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    });
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
   * the socket died.
   *
   * TC-S3 — dialed at the session's OWN cell (the inventory's `cell` tag), not
   * at any class's create target: only the cell holding the PTY can fire its
   * ladder, and a filled solo cell is never a target again. */
  async terminate(sessionId: string): Promise<TerminalTerminateResult> {
    const client = await this.connectedClient(await this.sessionCellForOp(sessionId));
    try {
      await client.terminate(sessionId, "application");
      return { terminated: true };
    } catch (error) {
      if (!client.connected) throw this.unavailable("the terminal floor died mid-terminate", error);
      // GT-5b: a floor that never answered is unresponsive, not internally
      // broken — and emphatically not "already gone", which is what the
      // probe below would eventually have to guess.
      if (isRequestTimeout(error)) throw this.unresponsive("terminate", error);
      if (isUnknownSession(error)) return { terminated: false };
      // a service-level refusal on a live connection: probe once for the
      // already-exited race; a probe that itself hits transport death or a
      // timeout is UNAVAILABLE like any other
      const probe = await client.getSession(sessionId).then(
        (session) => ({ answered: true as const, exited: Boolean(session.exited) }),
        (probeError: unknown) => ({ answered: false as const, probeError }),
      );
      if (probe.answered) {
        if (probe.exited) return { terminated: false };
      } else {
        if (isRequestTimeout(probe.probeError))
          throw this.unresponsive("terminate", probe.probeError);
        if (client.connected && isUnknownSession(probe.probeError)) return { terminated: false };
      }
      if (!client.connected) throw this.unavailable("the terminal floor died mid-terminate", error);
      throw new RpcCallError("INTERNAL", `terminate failed: ${errorMessage(error)}`, true);
    }
  }

  /** GT-3: read the app-owned `config.ghostty` overlay.
   *
   * Through the floor's OWN document door, not through `fs`. Three reasons, all
   * load-bearing: the file lives beside field-native and fieldd has no business
   * deriving that path a second time (the service is asked where it is); the
   * service holds a document lock that a bare read would ignore; and a
   * not-yet-created overlay comes back as `exists: false` with empty text
   * rather than an ENOENT to invent a policy for — ghosttea's loader treats a
   * missing app overlay as a valid empty config, so nothing has to be written
   * to disk before a user can be shown the file they are about to write.
   *
   * TC-S3 — served by the INTERACTIVE class's cell. There is one overlay FILE
   * beneath every cell (it is field-native's, not a cell's), so any cell can
   * answer this and the deterministic choice is the one the deck already uses.
   *
   * NAMED S3 DEBT — a WRITE reloads the configuration in the cell that served
   * it and in that cell only. Other live cells keep the config they booted with
   * and restyle at their next respawn, so a font change can be visible in the
   * interactive panes and not in the agent ones until then. The fix is a floor
   * verb that fans the reload across cells (TC-S6's neighbourhood), not a
   * fieldd loop dialing every cell to re-read a file it does not own. */
  async readConfig(): Promise<TerminalConfigDocument> {
    const client = await this.connectedClient(await this.awaitClassCell("interactive"));
    try {
      const document = await client.getConfigDocument();
      return {
        path: document.path,
        text: document.contents,
        revision: document.revision,
        exists: document.exists,
      };
    } catch (error) {
      throw this.configFailure("read", client, error);
    }
  }

  /** GT-3: replace the overlay and let the floor reload itself.
   *
   * `replaceConfigDocument` is one operation on the service's side: revision
   * check → same-directory temp file → fsync → recheck → atomic persist →
   * reload → `config-changed` to every attached client. A fieldd-side
   * write-then-ask-for-a-reload would be two operations with a window between
   * them, performed by a process that is not the file's owner.
   *
   * `effectiveChanged` is derived rather than reported: the service computes it
   * to decide whether to push `config-changed` and does not put it on the wire,
   * so this compares the effective-config revision from before the write with
   * the one the write answered — the same comparison, one level up.
   *
   * TC-S3 — through the interactive cell, and the read above carries the named
   * debt this write is the reason for: the reload lands in THIS cell. */
  async writeConfig(text: string, revision: string): Promise<TerminalConfigWriteResult> {
    const client = await this.connectedClient(await this.awaitClassCell("interactive"));
    let before: string | undefined;
    try {
      before = (await client.getConfig()).revision;
    } catch (error) {
      // The caller asked to WRITE. This step is a read, but naming it one told
      // an editor that its read had failed when nothing it did was a read
      // (GT-5b); the stage says where the write broke instead of relabelling
      // the operation.
      throw this.configFailure("write", client, error, "reading the effective configuration");
    }
    try {
      const update = await client.replaceConfigDocument(revision, text);
      // Mapped field by field rather than forwarded: the contract shape is what
      // the renderer parses, and passing the library's object straight through
      // would put whatever it grows next on our wire without a decision.
      const diagnostics = (update.config.diagnostics ?? []).map((diagnostic) => ({
        severity: String(diagnostic.severity),
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.source !== undefined ? { source: diagnostic.source } : {}),
        ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
        ...(diagnostic.key !== undefined ? { key: diagnostic.key } : {}),
      }));
      return {
        // The loader's verdict on what it just read, not our summary of it: an
        // unknown key is a diagnostic and not a refusal in Ghostty syntax, so a
        // write can land, reload, and still leave the config in a state the
        // user has to see.
        ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
        document: {
          path: update.document.path,
          text: update.document.contents,
          revision: update.document.revision,
          exists: update.document.exists,
        },
        effectiveChanged: update.config.revision !== before,
        diagnostics,
      };
    } catch (error) {
      // A stale revision is the one refusal that is neither our fault nor the
      // floor's: the file moved under this editor. It gets its own kind so the
      // panel can say so and re-read, rather than showing a transport error for
      // something no retry fixes.
      if (isConfigConflict(error)) {
        throw new RpcCallError(
          "CONFLICT",
          "the terminal configuration changed since it was read",
          false,
        );
      }
      throw this.configFailure("write", client, error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.connecting.clear();
    for (const key of [...this.clients.keys()]) this.dropClient(key);
  }

  // ---- internals ----

  /** The refusal `list`/`get` owe a caller before the first snapshot applies. */
  private requireObserved(): void {
    if (this.lastObservation !== undefined) return;
    throw new RpcCallError("UNAVAILABLE", "the terminal inventory has not been observed", true, {
      service: "terminal",
      state: "unobserved",
    });
  }

  /** TC-S2 — the cell-birth wait, per class since TC-S3. A create that arrives
   * while the engine is being spawned (fresh floor boot, cell replacement)
   * deserves the engine's own hello budget before an UNAVAILABLE, because the
   * endpoints ARE coming: the routes delta lands the moment the cell hellos.
   * One shared waiter per absence episode PER CLASS (a listener per CALL would
   * accumulate on the link), and the timer resolves rather than rejects —
   * `classCell()` then refuses with the same honest shape as always. GT-1's
   * spirit one level up: create may outrun the inventory, but it must not
   * outrun the engine's BIRTH.
   *
   * Per class, because with K=2 the classes are born independently: a snapshot
   * that MOVED but still names no cell for this class is not the birth this
   * caller is waiting for, so the wait re-checks and keeps waiting to the
   * budget rather than resolving on someone else's news. */
  private birthWaits = new Map<TerminalWorkloadClass, Promise<void>>();
  private awaitEndpoints(workloadClass: TerminalWorkloadClass): Promise<void> {
    if (this.hasCellFor(workloadClass)) return Promise.resolve();
    // Wait ONLY on evidence a cell system exists: a route snapshot (even an
    // empty one — the floor publishes {revision: 1, cells: []} before its
    // first spawn). A floor that never spoke routes and never gave endpoints
    // is absent, and absent refuses NOW — the pre-TC-S2 behavior.
    if (this.opts.link.terminalRoutes === undefined) return Promise.resolve();
    const pending = this.birthWaits.get(workloadClass);
    if (pending !== undefined) return pending;
    const wait = new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.birthWaits.delete(workloadClass);
        resolve();
      };
      this.opts.link.on("terminal-endpoints", () => {
        if (this.hasCellFor(workloadClass)) done();
      });
      const timer = setTimeout(done, this.opts.birthWaitMs ?? CELL_SUPERVISION.HELLO_DEADLINE_MS);
      timer.unref?.();
    });
    this.birthWaits.set(workloadClass, wait);
    return wait;
  }

  /** Is there a cell this class can land on right now? */
  private hasCellFor(workloadClass: TerminalWorkloadClass): boolean {
    const routes = this.opts.link.terminalRoutes;
    if (routes !== undefined && terminalCreateTarget(routes, workloadClass) !== undefined)
      return true;
    // A snapshot with ROWS that names no cell for this class is a class still
    // being born, and the wait is for ITS hello — someone else's cell arriving
    // is not the news this caller is waiting for, so the mirror does not count.
    // An EMPTY snapshot is the pre-first-cell window, where the mirror IS the
    // evidence a cell arrived at all (TC-S2's birth wait, unchanged).
    if (routes !== undefined && routes.cells.length > 0) return false;
    return this.opts.link.terminalEndpoints !== undefined;
  }

  /** The birth wait and the resolution, in the order every class-routed op
   * needs them: give a cell that is being spawned its hello budget, then read
   * whatever the snapshot actually says. */
  private async awaitClassCell(workloadClass: TerminalWorkloadClass): Promise<CellTarget> {
    await this.awaitEndpoints(workloadClass);
    return this.classCell(workloadClass);
  }

  /** TC-S3 — the cell a NEW session of this class belongs in: the create-target
   * discipline against the current snapshot. */
  private classCell(workloadClass: TerminalWorkloadClass): CellTarget {
    const routes = this.opts.link.terminalRoutes;
    if (routes !== undefined) {
      const target = terminalCreateTarget(routes, workloadClass);
      if (target !== undefined)
        return { key: target.cellBootId, endpoints: target.endpoints, ...rowExtrasOf(target) };
      // This class has no cell of its own. Class is a PLACEMENT HINT and a
      // policy selector, never a permanent failure domain (TC-D4), so the
      // session lands on the floor's interactive target rather than being
      // refused by a floor that can perfectly well host it — the scrollback cap
      // the class selects rides the create either way. Debug, not warn: the
      // budget above has already been spent waiting for the class's own cell,
      // and the fallback is a placement, not a fault.
      const fallback = terminalCreateTarget(routes, "interactive");
      if (fallback !== undefined) {
        this.logger.debug(
          "fieldd.terminal.class_cell_absent",
          "No cell hosts this workload class; the session lands on the interactive cell",
          { workloadClass, revision: routes.revision },
        );
        return {
          key: fallback.cellBootId,
          endpoints: fallback.endpoints,
          ...rowExtrasOf(fallback),
        };
      }
    }
    // No snapshot at all (a pre-TC-S2 floor), or one that names no cell:
    // the legacy mirror is the only reading there is, and `endpoints()` refuses
    // honestly when it is absent too.
    return { key: LEGACY_CELL_KEY, endpoints: this.endpoints() };
  }

  /** TC-S3 — the cell a KNOWN session lives on, from the observed inventory's
   * `cell` tag. Deliberately not the target rule: a cell stops being a target
   * long before it stops serving (every filled solo cell), so per-session ops
   * follow the tag or they follow nothing. */
  private sessionCell(sessionId: string): CellTarget {
    const tag = this.sessionCellTag(sessionId);
    // Untagged, or a session this inventory has never named: the legacy
    // reading. On a pre-TC-S3 floor that IS the one cell; on a K=2 floor it is
    // the interactive target, which is the best fieldd can honestly do for a
    // session no observation has placed yet.
    if (tag === undefined) return this.classCell("interactive");
    return this.cellByBootId(tag.cellBootId);
  }

  private sessionCellTag(sessionId: string): TerminalInfo["cell"] {
    return this.terminals.find((terminal) => terminal.sessionId === sessionId)?.cell;
  }

  /** The async half of `sessionCell`: a session whose cell is UNKNOWN may be
   * waiting on a cell that is still being born, and it gets the same budget
   * every other op gets. A TAGGED session needs no wait — its cell is either in
   * the snapshot now or gone, and gone is an answer. */
  private async sessionCellForOp(sessionId: string): Promise<CellTarget> {
    if (this.sessionCellTag(sessionId) === undefined) await this.awaitEndpoints("interactive");
    return this.sessionCell(sessionId);
  }

  /** One named cell's coordinates, or the honest state of its absence. */
  private cellByBootId(cellBootId: string): CellTarget {
    const routes = this.opts.link.terminalRoutes;
    // No reading at all — the link is down, or the floor predates TC-S2. That
    // is `absent`, not a dead cell, and `endpoints()` says so (refusing when
    // the mirror is gone with it).
    if (routes === undefined) return { key: LEGACY_CELL_KEY, endpoints: this.endpoints() };
    const row = routes.cells.find((cell) => cell.cellBootId === cellBootId);
    if (row !== undefined)
      return { key: row.cellBootId, endpoints: row.endpoints, ...rowExtrasOf(row) };
    // TC-S3 — the cell that held this session is gone from the snapshot, so the
    // session went with it and the observed stream is about to say so. Honest
    // and retryable: never a ticket into a dead cell's socket, never a blank,
    // and never the LIVE cell's coordinates for a session it does not have.
    throw new RpcCallError("UNAVAILABLE", "the terminal cell holding this session is gone", true, {
      service: "terminal",
      state: "cell_gone",
      cellBootId,
    });
  }

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

  /** Lazy, per-CELL control client (TC-S3). Rebuilt when the token rotates (a
   * fresh cell mints a fresh one) or after a connection error surfaces.
   *
   * GT-5b: guarded in flight, the way `ensureStarted` guards its subscribe.
   * Without it two concurrent calls each built AND CONNECTED a client, and the
   * loser was never disposed — its close handler checks that the map still
   * holds it, so it sat authenticated on the floor's control socket until the
   * process exited. Keyed by cell AND checked against the token, because two
   * dials for two different cells (or two boots of one) are two different
   * clients and joining them would be the bug. */
  private async connectedClient(cell: CellTarget): Promise<GhostteaAutomationClient> {
    const live = this.clients.get(cell.key);
    if (live !== undefined && live.token === cell.endpoints.authToken) {
      return live.client;
    }
    const inFlight = this.connecting.get(cell.key);
    if (inFlight !== undefined && inFlight.token === cell.endpoints.authToken) {
      return await inFlight.promise;
    }
    let tracked: Promise<GhostteaAutomationClient>;
    tracked = this.openClient(cell).finally(() => {
      if (this.connecting.get(cell.key)?.promise === tracked) this.connecting.delete(cell.key);
    });
    this.connecting.set(cell.key, { token: cell.endpoints.authToken, promise: tracked });
    return await tracked;
  }

  /** Build, connect, and install the control client for one cell. */
  private async openClient(cell: CellTarget): Promise<GhostteaAutomationClient> {
    const { key, endpoints } = cell;
    this.dropClient(key);
    const client = new GhostteaAutomationClient(
      {
        controlSocket: endpoints.controlSocket,
        frameSocket: endpoints.frameSocket,
        authToken: endpoints.authToken,
      },
      {
        clientBuild: "vibefield-fieldd",
        ...(this.opts.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: this.opts.requestTimeoutMs }
          : {}),
      },
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
    // The cell may have died or been replaced while this dial was in the air,
    // and the link is the authority on that — caching a client here would cache
    // one authenticated to a boot that is over. Likewise a service disposed
    // mid-dial: installing then leaks a connected client nothing will ever
    // close. Refuse; the next call dials whatever cell is actually there
    // (GT-5b, now asked of THIS cell's row rather than of the floor's mirror).
    if (this.disposed || this.currentToken(key) !== endpoints.authToken) {
      client.dispose();
      throw new RpcCallError("UNAVAILABLE", "the terminal cell changed while connecting", true, {
        service: "terminal",
        state: "rotated",
      });
    }
    // a dead socket drops the cached client so the next call redials
    client.on("close", () => {
      if (this.clients.get(key)?.client === client) this.clients.delete(key);
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
    this.clients.set(key, { client, token: endpoints.authToken });
    return client;
  }

  private dropClient(key: string): void {
    const entry = this.clients.get(key);
    if (entry === undefined) return;
    entry.client.dispose();
    this.clients.delete(key);
  }

  /** GT-5b per cell (TC-S3). A control client is worth exactly as long as the
   * row that vouched for it: a cell that left the snapshot, or whose token
   * rotated, loses its client — and every other cell keeps its own. The token
   * is the check rather than mere presence because a REPLACEMENT can reuse
   * nothing but the name: a new cellBootId is a new key anyway, and a new token
   * under the same key (a re-pair to a re-minted cell) is just as stale. */
  private pruneClients(): void {
    for (const [key, entry] of [...this.clients]) {
      if (this.currentToken(key) === entry.token) continue;
      this.dropClient(key);
    }
  }

  /** The token the CURRENT reading gives this cell — undefined when the cell is
   * gone from the snapshot, when the link is down, or (legacy key) when the
   * mirror has been cleared. */
  private currentToken(key: string): string | undefined {
    if (key === LEGACY_CELL_KEY) return this.opts.link.terminalEndpoints?.authToken;
    return this.opts.link.terminalRoutes?.cells.find((cell) => cell.cellBootId === key)?.endpoints
      .authToken;
  }

  private unavailable(message: string, cause: unknown): RpcCallError {
    return new RpcCallError("UNAVAILABLE", message, true, {
      service: "terminal",
      state: "unreachable",
      detail: errorMessage(cause),
    });
  }

  /** A floor whose socket is up and whose service did not answer inside the
   * request budget. Distinct from `unreachable`, because the connection is
   * fine and the DAEMON is wedged, and distinct from INTERNAL, because
   * nothing here says the request was wrong. */
  private unresponsive(operation: string, cause: unknown): RpcCallError {
    return new RpcCallError("UNAVAILABLE", `the terminal floor did not answer ${operation}`, true, {
      service: "terminal",
      state: "unresponsive",
      detail: errorMessage(cause),
    });
  }

  /** Classify a config-document failure the way create/terminate classify
   * theirs (NF-6): a dead transport is UNAVAILABLE, and so is a live floor that
   * has no app-owned overlay to edit — that is a degraded SERVICE state (an
   * older field-native, or a floor whose service was never pointed at our
   * file), not a malformed request, and the panel owes it an honest face rather
   * than an error toast. Anything else is the service refusing on its own
   * terms, reported verbatim. */
  private configFailure(
    operation: "read" | "write",
    client: GhostteaAutomationClient,
    error: unknown,
    stage?: string,
  ): RpcCallError {
    if (!client.connected) {
      return this.unavailable(`the terminal floor died mid-config-${operation}`, error);
    }
    if (isRequestTimeout(error)) return this.unresponsive(`config ${operation}`, error);
    if (NO_OVERLAY.test(errorMessage(error))) {
      return new RpcCallError(
        "UNAVAILABLE",
        "this terminal floor has no app-owned configuration file",
        false,
        { service: "terminal", state: "no-overlay", detail: errorMessage(error) },
      );
    }
    // GT-5b: the comment above promises honesty for "an older field-native",
    // and this is the shape that actually arrives from one. The overlay case
    // is the floor's own `ConfigDocumentError::Unavailable`; a floor below
    // protocol 1.11 never gets asked at all — the pinned CLIENT refuses first,
    // with its own prose — and that refusal was landing as INTERNAL, i.e. as a
    // bug in us rather than as the capability gap it is. Not retryable: no
    // amount of asking again teaches an old daemon a new command.
    if (NO_CONFIG_DOCUMENTS.test(errorMessage(error))) {
      return new RpcCallError(
        "UNAVAILABLE",
        "this terminal floor is too old to serve configuration documents",
        false,
        { service: "terminal", state: "unsupported", detail: errorMessage(error) },
      );
    }
    const where = stage === undefined ? "" : ` while ${stage}`;
    return new RpcCallError(
      "INTERNAL",
      `config ${operation} failed${where}: ${errorMessage(error)}`,
      true,
    );
  }

  private defaultShell(): string {
    if (this.opts.defaultShell) return this.opts.defaultShell();
    if (process.platform === "win32") {
      // GT-D10: Windows has no login shell (`userInfo().shell` is null) and no
      // `$SHELL`, so the unix chain below would fall to `/bin/sh` and every
      // default `terminal.create` would die at SPAWN_REFUSAL. COMSPEC is the
      // shell on Windows; a missing one is not a real Windows.
      const comspec = process.env["COMSPEC"];
      if (typeof comspec === "string" && comspec.length > 0) return comspec;
      return "C:\\Windows\\System32\\cmd.exe";
    }
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

/** The floor's OWN spawn refusal, anchored (GT-5b). The message is byte-
 * identical across the G17 landing (`ghosttea-0.10.0 session.rs:1281` keeps
 * the exact string beside the new typed fields), so this anchor now serves as
 * the ABSENT-METADATA fallback: when a refusal carries a typed `code`, the
 * structural arms in `create` classify it and this regex is never consulted
 * for blame.
 *
 * Anchored because the old unanchored `/spawn/i` was a substring test over free
 * prose, and the floor has a second spawn-bearing refusal —
 * `session spawn task stopped` (its blocking task falling over), which is the
 * FLOOR failing and was being reported to the caller as bad input,
 * non-retryable. Without a typed code the bare string still covers a bad
 * executable AND a resource exhaustion and fieldd cannot tell them apart; it
 * classifies the case it can name and leaves everything else INTERNAL. */
const SPAWN_REFUSAL = /^failed to spawn PTY command$/;

/** TC-D6(b) — the openpty half of create classification. portable-pty renders
 * the errno into its message INSIDE openpty() (upstream `unix.rs:45` — the
 * returned error carries no typed io::Error source), so even the G17 floor
 * can only stamp `stage: "openpty"` on this path: the errno is still read
 * from the string, exactly as negotiated in the petition. 24 = EMFILE,
 * 23 = ENFILE. The caller fences this with `stage` so spawn-stage prose can
 * never borrow the match; spawn-stage refusals classify by their typed
 * `code` instead (ghosttea 0.10.0). Retires when the errno is typed upstream
 * of ghosttea (the recorded portable-pty follow-up). Exported for its unit
 * rows. */
export function classifyOpenptyPressure(message: string): "fd_pressure" | null {
  if (!/failed to openpty/i.test(message)) return null;
  return /code:\s*2[34]\b|EMFILE|ENFILE/.test(message) ? "fd_pressure" : null;
}

/** The pinned client's own refusal when a per-session cap is REQUESTED of a
 * floor below protocol 1.15 (G16): thrown before anything reaches the wire,
 * so absent enforcement is a refusal the caller hears, never a silent
 * pretend. */
const NO_SESSION_SCROLLBACK = /does not support per-session scrollback limits/i;

/** TC-D6(c) — the class→bytes authority is the genned contracts table (the
 * same registry field-native reads), never a literal here. Undeclared maps to
 * undefined: the field never rides the wire and the floor's global default
 * governs, echoed per-session in SessionSummary either way since 1.15. */
function classScrollbackBytes(
  workloadClass: TerminalCreateParams["workloadClass"],
): number | undefined {
  if (workloadClass === undefined) return undefined;
  return workloadClass === "agent"
    ? TERMINAL_SCROLLBACK_CLASS_BYTES.AGENT
    : TERMINAL_SCROLLBACK_CLASS_BYTES.INTERACTIVE;
}

/** The pinned CLIENT's own refusal when the server's protocol minor is below
 * the config-document floor (1.11) — thrown before anything reaches the wire,
 * so it is the client's prose and not the service's. */
const NO_CONFIG_DOCUMENTS = /does not support configuration documents/i;

/** The pinned client's request-budget expiry: `Ghosttea request timed out:
 * <command>`, thrown from its own timer with the socket untouched. Anchored to
 * the start so a floor that quotes the phrase inside a longer refusal of its
 * own does not read as a transport state. */
const REQUEST_TIMEOUT = /^Ghosttea request timed out\b/;

function isRequestTimeout(error: unknown): boolean {
  return REQUEST_TIMEOUT.test(errorMessage(error));
}

/** The service's refusal when no explicit overlay path was configured
 * (`ConfigDocumentError::Unavailable`, verbatim from the pinned crate). Matched
 * on the message because the wire carries only a string — the same bargain
 * `isUnknownSession` strikes, and the same narrowness: this pattern must not
 * catch an IO failure that merely mentions a path. */
const NO_OVERLAY = /unavailable without an explicit overlay/i;

/** A revision that moved under the editor. The client throws its own error
 * class for exactly this, so it is identified by type and not by prose. */
function isConfigConflict(error: unknown): boolean {
  return error instanceof GhostteaConfigDocumentConflictError;
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
