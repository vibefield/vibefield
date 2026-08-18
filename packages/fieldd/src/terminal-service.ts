import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute } from "node:path";
import {
  GhostteaAutomationClient,
  GhostteaConfigDocumentConflictError,
  GhostteaRequestError,
} from "@vibecook/ghosttea-client";
import {
  ObservedState,
  TERMINAL_SCROLLBACK_CLASS_BYTES,
  TERMINAL_SESSION_CAP,
  type TerminalConfigDocument,
  type TerminalConfigWriteResult,
  type TerminalCreateParams,
  type TerminalEndpoints,
  type TerminalInfo,
  type TerminalObservation,
  type TerminalRouteSnapshot,
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
  /** Which floor observation `terminals` came from — undefined until the first
   * one applies, which is exactly the state `list`/`get` refuse in. */
  private lastObservation: TerminalObservation | undefined;
  private client: GhostteaAutomationClient | null = null;
  /** the token the live client authenticated with — a new native boot mints a
   * new token, and a stale client must be rebuilt, not trusted */
  private clientToken: string | null = null;
  /** in-flight control dial, keyed by the token it is authenticating with */
  private connecting: { token: string; promise: Promise<GhostteaAutomationClient> } | null = null;
  private disposed = false;
  /** true once the observed subscription is armed; NativeLink replays it across
   * reconnects from then on (P5), so ensureStarted becomes a no-op */
  private subscribed = false;
  private starting: Promise<void> | null = null;
  /** TC-D15 — the identity of the cell the last route reading named. Kept
   * across a link outage on purpose: a dead mgmt connection kills no PTYs, so
   * an ABSENCE must not overwrite the last cell fieldd actually saw. Holding it
   * is what lets a reconnect onto a DIFFERENT cell still be named as the loss
   * it is, while a reconnect onto the same one stays silent. */
  private cellBootId: string | undefined;

  constructor(private readonly opts: TerminalServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    // The link has usually paired BEFORE this service exists (the daemon builds
    // it after `native.connect()`), so the cell in hand at construction is the
    // baseline. Without seeding it, the first replacement after every boot
    // would have nothing to compare against and would go unrecorded — the one
    // case the receipt exists for.
    this.cellBootId = opts.link.terminalRoutes?.cells[0]?.cellBootId;
    opts.link.on("terminal-endpoints", () => this.onRouteChange());
  }

  /** The floor's coordinates moved. Two things follow, in this order.
   *
   * The old control connection is worthless either way — a new cell mints a new
   * token — so it is dropped wholesale, exactly as it was before TC-S2.
   *
   * Then the honesty half. If the cell was REPLACED (a different `cellBootId`)
   * while fieldd still held an observed inventory, every session on the old one
   * is gone: TC-S2's ceiling, stated as "a terminal-engine crash loses only its
   * class". The product owes that a receipt naming the sessions, because it is
   * the one moment the loss is knowable — the observed stream repairs the
   * inventory a beat later and no snapshot after that can reconstruct WHICH
   * sessions the replacement took.
   *
   * The receipt is a structured log and not an audit record, deliberately:
   * `AuditService`'s append surface is caller-scoped (it wants a CallerContext)
   * and nothing here has a caller — this is the floor's news arriving on an
   * event. Minting a synthetic principal to force it into the ledger would put
   * a fabricated caller on an EL7 surface to make a diagnostic prettier. */
  private onRouteChange(): void {
    this.dropClient();
    const routes = this.opts.link.terminalRoutes;
    const cellBootId = routes?.cells[0]?.cellBootId;
    // Absence is not evidence of loss: the link may merely be down, and a
    // pre-TC-S2 floor never says at all.
    if (routes === undefined || cellBootId === undefined) return;
    const previous = this.cellBootId;
    this.cellBootId = cellBootId;
    if (previous === undefined || previous === cellBootId) return;
    // Counted from the last inventory fieldd actually observed; before the
    // first observation there is nothing it can honestly claim was lost.
    const lostSessionIds = this.terminals.map((terminal) => terminal.sessionId);
    if (lostSessionIds.length === 0) return;
    this.logger.warn(
      "fieldd.terminal.cell_replaced",
      "The terminal engine was replaced and its sessions are gone — a terminal-engine crash loses only its class",
      {
        lostSessionIds,
        lostSessions: lostSessionIds.length,
        previousCellBootId: previous,
        cellBootId,
        revision: routes.revision,
      },
    );
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
   * (GT-1) while openTicket keeps its observed gate for existing sessions. */
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
   * daemon's audit attrs, unapplied to the PTY.
   *
   * Births the session and nothing else. The product result also carries a
   * ticket (GT-1), but that mint is its own audited grant, so the daemon
   * composes the two rather than this method quietly handing out a credential. */
  async create(params: TerminalCreateParams): Promise<{ sessionId: string }> {
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
    const client = await this.connectedClient();
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
      return { sessionId: summary.id };
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
   * to disk before a user can be shown the file they are about to write. */
  async readConfig(): Promise<TerminalConfigDocument> {
    const client = await this.connectedClient();
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
   * the one the write answered — the same comparison, one level up. */
  async writeConfig(text: string, revision: string): Promise<TerminalConfigWriteResult> {
    const client = await this.connectedClient();
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
    this.connecting = null;
    this.dropClient();
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
   * new field-native boot) or after a connection error surfaces.
   *
   * GT-5b: guarded in flight, the way `ensureStarted` guards its subscribe.
   * Without it two concurrent calls each built AND CONNECTED a client, and the
   * loser was never disposed — its close handler checks `this.client ===
   * client`, so it sat authenticated on the floor's control socket until the
   * process exited. Keyed by token, because two dials for two different native
   * boots are two different clients and joining them would be the bug. */
  private async connectedClient(): Promise<GhostteaAutomationClient> {
    const endpoints = this.endpoints();
    if (this.client !== null && this.clientToken === endpoints.authToken) {
      return this.client;
    }
    const inFlight = this.connecting;
    if (inFlight !== null && inFlight.token === endpoints.authToken) {
      return await inFlight.promise;
    }
    let tracked: Promise<GhostteaAutomationClient>;
    tracked = this.openClient(endpoints).finally(() => {
      if (this.connecting?.promise === tracked) this.connecting = null;
    });
    this.connecting = { token: endpoints.authToken, promise: tracked };
    return await tracked;
  }

  /** Build, connect, and install the control client for these endpoints. */
  private async openClient(endpoints: TerminalEndpoints): Promise<GhostteaAutomationClient> {
    this.dropClient();
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
    // The floor may have died or rebooted while this dial was in the air, and
    // the link is the authority on that — caching a client here would cache one
    // authenticated to a boot that is over. Likewise a service disposed
    // mid-dial: installing then leaks a connected client nothing will ever
    // close. Refuse; the next call dials whatever floor is actually there
    // (GT-5b).
    if (this.disposed || this.opts.link.terminalEndpoints?.authToken !== endpoints.authToken) {
      client.dispose();
      throw new RpcCallError("UNAVAILABLE", "the terminal floor changed while connecting", true, {
        service: "terminal",
        state: "rotated",
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
