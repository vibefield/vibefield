import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  DRIVE_LIMITS,
  FILE_TRANSFER_ROOTS,
  type FileTransferRootName,
  LAYOUT,
  MESH_FILE_TRANSFER,
  NativeFileTransferDelta,
  NativeFileTransferPullParams,
  NativeFileTransferPullResult,
  type NativeFileTransferRoot,
  NativeFileTransferRootsResult,
  NativeFileTransferSnapshot,
  RPC_ERROR_CODES,
  UnavailableDetails,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { ulid } from "@vibefield/users";
import { RpcCallError } from "../native-link";

// DR-3b (W3, VF-RELAY) — fieldd's half of the floor's file transfer (contracts mgmt.ts `NativeFileTransfer*`;
// DR-D7 (a); truffle T-3 = RFC 032), and the ONE owner of `native.mesh.fileTransfer.*` in fieldd.
//
// An object moves Rust to Rust through the desktop's one node (DR-L4, EL2): only CONTROL crosses here. fieldd mints a
// ULID per pull, names a root and a path below it (the CALLER's path: the files worker computes it with mille-drive's
// own layout, so fieldd never re-derives one), and learns the pull's end on one stream. What lands sits UNVERIFIED in
// the root's `lands` folder as `<digest>.<transferId>`; its reader checks the blake3 (DR-L3).
//
// Four rules the floor's contract leaves to this side:
//  - A running digest is refused HERE, in the floor's CONFLICT shape (-32004, retryable false, no details), and never
//    joined: one landed file handed to two of mille-drive's pulls is consumed by the first one's admit. The floor's
//    CONFLICT is the belt behind it (nit 9).
//  - field-native outlives fieldd, so the stream's first snapshot can list pulls a PREVIOUS fieldd started (the W3
//    critic's finding 4). Their digests are refused here like any running one, and their completions surface as
//    adopt candidates (`onAdoptCandidate`), never as an answer to a pull of this boot.
//  - A pull the stream's snapshot no longer lists ended while the reader lagged: completed when its landed name is in
//    the folder, failed FAILED_IO otherwise (mgmt.ts `NativeFileTransferSnapshot`). Only a snapshot written AFTER the
//    pull's answer says so (the snapshot write order, W3-16, VF-PM 2026-11-06). One that may have been written before
//    it and omits the pull HOLDS it (`#hold`, race#0 (b), VF-PM 2026-11-06): the stream is subscribed once more, and
//    that snapshot, built after the answer, judges the pull; with none, it ends FAILED_TIMEOUT at W3-4's idle bound.
//    Only names matching that rule are read; a `*.truffle-tmp` beside them is the floor's.
//  - `file-transfer-unsupported` is a fact of the floor's boot (mgmt.ts `MESH_FILE_TRANSFER`): cached for that boot,
//    asked again at a reconnect, as `FloorEgress` keeps `egress-unsupported` (egress.ts:143-158).
//
// Every payload from the floor is held to its contract (`safeParse`); one outside it is dropped and logged.

/** The floor's two verbs, as NativeLink answers them (native-link.ts:1159 `request`, :1274 `subscribe`). The snapshot
 * rule (`DrivePulls.#accept`) reads NativeLink's timing: an answer settles its promise as its line is read
 * (native-link.ts:899), and an event reaches `onEvent` as its line is read (:924), in the continuation of the answer
 * that carried it with the events queued behind it (:1110-1111), or at its subscribe's activation, a setImmediate
 * that subscribe's continuation sets (:1287-1290). A floor that put a macrotask (setImmediate, setTimeout, I/O)
 * between NativeLink and `onEvent`, or between the subscribe's answer and `subscribe` resolving, would break that
 * rule; a microtask between them only delays the event within the same turn, and an await on `request` only sets
 * the fence later. `subscribe` is asked again while a subscription stands, for a snapshot built after a held pull's
 * answer (`DrivePulls.#hold`). The floor replaces a connection's stream with the new one (W3-20, VF-PM 2026-11-06),
 * so the old subscription's `dispose` is called once the new one is answered, or at once when a re-subscribe the
 * floor may have run is refused, before one more subscribe (`DrivePulls.#doSubscribe`). */
export interface DrivePullsFloor {
  request(method: string, params: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

/** One object to pull from a peer's FILE_TRANSFER_ROOTS.DRIVE_OBJECTS. */
export interface DrivePullRequest {
  /** the holder's truffle peer id (`PeerInfo.id`) */
  peer: string;
  /** the blake3 the object is named by */
  digest: string;
  /** below the holder's root, in FILE_TRANSFER_PATH_PATTERN's grammar: never the holder's own path (EL7) */
  path: string;
}

/** A pull that landed: the file in this desktop's `lands` folder, UNVERIFIED by blake3. */
export interface DriveLanded {
  path: string;
}

/** A file a pull this fieldd did not start left in the `lands` folder (a previous fieldd's), for the drive to adopt
 * or sweep (mgmt.ts `NativeFileTransferSnapshot`). */
export interface DriveAdoptCandidate {
  transferId: string;
  digest: string;
  /** the landed file, in this desktop's `lands` folder */
  path: string;
}

/** A declared root as the floor last answered it: `served`; `held` (ROOT_UNGATED: the floor serves it from the next
 * node it builds gated for the same login); or `refused`, with the floor's word. */
export interface DriveRootState {
  name: FileTransferRootName;
  state: "served" | "held" | "refused";
  reason?: string;
}

/** A pull's end on the floor's stream, or the resync's: `reason` is a MESH_FILE_TRANSFER.FAILED_* word. Mapping it to
 * the drive's own error codes is the files worker adapter's (DR-2). */
export class DrivePullFailed extends Error {
  readonly reason: string;
  readonly transferId: string;

  constructor(reason: string, message: string, transferId: string) {
    super(message);
    this.name = "DrivePullFailed";
    this.reason = reason;
    this.transferId = transferId;
  }
}

export interface DrivePullsOptions {
  floor: DrivePullsFloor;
  /** This desktop's user root. A pull lands in FILE_TRANSFER_ROOTS.DRIVE_OBJECTS' `lands` LAYOUT row under it, which
   * this module reads from the registry: fieldd joins a landed NAME under its own row (mgmt.ts `FileTransferLanded`),
   * and no caller names the folder. */
  userRoot: string;
  /** The roots this desktop serves now, declared WHOLE: the drive's while it is open, none while it is closed. */
  roots: () => FileTransferRootName[];
  /** Whether this desktop's node is linked: neither unlinked nor capturing a login. The roots are declared only then,
   * "at every linked node-up and again after every reconnect" (C1's nit 8, mgmt.ts `NativeFileTransferRootsParams`),
   * as the daemon declares no serve without an account (daemon.ts `productServeSpec`). The floor's MESH_CAPTURING
   * refusal of a declaration is the belt; this is the suspenders. */
  linked: () => boolean;
  /** The floor's boot (`NativeHealth.bootId`). `file-transfer-unsupported` is cached for this boot alone; `undefined`
   * caches nothing (FloorEgress's rule, egress.ts:134-139). */
  bootId: () => string | undefined;
  /** Whether a landed file is in the folder (the resync rule). Default: `access`. */
  exists?: (path: string) => Promise<boolean>;
  /** A pull's id. Default: `ulid` (@vibefield/users). */
  mintId?: () => string;
  /** How long a held pull waits for its fresh snapshot (`DrivePulls.#hold`), in ms. Default: HELD_PULL_BOUND_MS. A
   * test shortens it. */
  heldBoundMs?: number;
  logger?: Logger;
}

/** A pull this fieldd minted. */
interface OwnPull {
  readonly transferId: string;
  readonly digest: string;
  /** null until the floor answered it; then its fence (`DrivePulls.#accept`): a snapshot that does not list it says
   * it ended only when that snapshot arrived once this fence had run, or is the re-subscribe's it was held for */
  fence: number | null;
  /** while it is HELD (`DrivePulls.#hold`): the bound's timer, which ends it FAILED_TIMEOUT; null otherwise */
  held: ReturnType<typeof setTimeout> | null;
  /** a re-subscribe left for it (`DrivePulls.#serve`): at most one ever does */
  asked: boolean;
  readonly landed: Promise<DriveLanded>;
  readonly resolve: (landed: DriveLanded) => void;
  readonly reject: (error: Error) => void;
}

function ownPull(transferId: string, digest: string): OwnPull {
  let resolve: (landed: DriveLanded) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const landed = new Promise<DriveLanded>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  // handled here, so an end that arrives before the caller awaits is never an unhandled rejection
  landed.catch(() => undefined);
  return { transferId, digest, fence: null, held: null, asked: false, landed, resolve, reject };
}

/** One event of the stream, as `DrivePulls.#onEvent` stamps it on arrival. */
interface StreamEvent {
  payload: unknown;
  kind: "snapshot" | "delta";
  /** the fences run when it arrived (`DrivePulls.#accept`) */
  fencesRun: number;
  /** a re-subscribe's snapshot: the held pulls it was asked for (`DrivePulls.#doSubscribe`); NO_PULLS otherwise */
  serves: ReadonlySet<OwnPull>;
}

const NO_PULLS: ReadonlySet<OwnPull> = new Set();

/** How long a held pull (`DrivePulls.#hold`) waits for a fresh snapshot before it ends FAILED_TIMEOUT: W3-4's idle
 * bound (VF-PM 2026-11-06), the floor's `PULL_IDLE_BOUND`, 60 s (field-native `src/services/file_transfer.rs:309`).
 * PROVISIONAL and RELAY-LOCAL, as the floor's is FLOOR-LOCAL: not in the registry, so moving it is no contract event,
 * and it moves with the floor's. */
const HELD_PULL_BOUND_MS = 60_000;

/** Whether a refused subscribe may still have RUN at the floor, and so replaced the stream this connection held
 * (W3-20, VF-PM 2026-11-06). Not run, for certain:
 *  - an UNAVAILABLE: NativeLink gives one unsent (its door gate, native-link.ts:1173-1183; no socket, :1210) or for a
 *    connection that closed under it (`failPending`, :1059-1061), whose stream ends with it while NativeLink replays
 *    the one this side holds (:1105-1111); the floor gives one before any subscribe runs
 *    (`file-transfer-unsupported`, mgmt.ts's header; its mesh worker stopped, field-native `mgmt/mod.rs:139-151`);
 *  - a RESOURCE_EXHAUSTED, the floor's mesh queue full as the request came (`mgmt/mod.rs`'s `mesh_queue_full`);
 *  - a floor that cannot pull (`cannotPull`), which answers so before its stream.
 * Any other may have run: fieldd's own TIMEOUT (native-link.ts:1247-1266), since the floor runs a request dequeued in
 * its deadline's last instants and its answer is then a late reply (:1086-1103; mgmt.ts `NativeDeadlinePassedDetails`
 * says the floor's own TIMEOUT reaches fieldd only so), or the floor's INTERNAL for a subscribe it ran and could not
 * answer with a snapshot. */
function mayHaveRun(error: unknown): boolean {
  if (!(error instanceof RpcCallError)) return true;
  if (cannotPull(error)) return false;
  return error.kind !== "UNAVAILABLE" && error.kind !== "RESOURCE_EXHAUSTED";
}

/** JSON-RPC's method-not-found. A floor before VF-FLOOR's facade answers these verbs so with a node up (mgmt.ts's
 * header; `mgmt/mesh.rs`'s `_` arm), read as egress.ts:295-297 reads a floor before DS-1. */
const METHOD_NOT_FOUND = -32601;

/** Every MESH_FILE_TRANSFER.FAILED_* word. The wire is open, and a word outside it reads FAILED_IO (mgmt.ts). */
const FAILED_WORDS: ReadonlySet<string> = new Set([
  MESH_FILE_TRANSFER.FAILED_REJECTED,
  MESH_FILE_TRANSFER.FAILED_UNSUPPORTED,
  MESH_FILE_TRANSFER.FAILED_TIMEOUT,
  MESH_FILE_TRANSFER.FAILED_INTEGRITY,
  MESH_FILE_TRANSFER.FAILED_TOO_LARGE,
  MESH_FILE_TRANSFER.FAILED_NO_SPACE,
  MESH_FILE_TRANSFER.FAILED_IO,
  MESH_FILE_TRANSFER.FAILED_NODE_DOWN,
]);

/** A failed pull's word as this side reads it: a word it does not know is FAILED_IO. */
export function failedWord(reason: string): string {
  return FAILED_WORDS.has(reason) ? reason : MESH_FILE_TRANSFER.FAILED_IO;
}

/** Whether an answer is the floor saying it cannot pull by a named root: the pin's golden
 * (`error-data.file-transfer-unsupported.json`), UNAVAILABLE `{service: "mesh", state:
 * "file-transfer-unsupported"}`. A boolean, never a type guard: `false` says nothing of the error's type (an
 * RpcCallError of another kind or state is still one, and a guard would have the compiler drop it). */
export function isFileTransferUnsupported(error: unknown): boolean {
  if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") return false;
  const details = UnavailableDetails.safeParse(error.details);
  return (
    details.success &&
    details.data.service === MESH_FILE_TRANSFER.SERVICE &&
    details.data.state === MESH_FILE_TRANSFER.STATE_UNSUPPORTED
  );
}

/** The floor's own unsupported answer, as this side repeats it while the boot is known to give it. */
function unsupportedRefusal(): RpcCallError {
  return new RpcCallError(
    "UNAVAILABLE",
    "this desktop's floor cannot pull by a named root",
    false,
    { service: MESH_FILE_TRANSFER.SERVICE, state: MESH_FILE_TRANSFER.STATE_UNSUPPORTED },
    RPC_ERROR_CODES.UNAVAILABLE,
  );
}

/** A pull asked of, or still running on, pulls that are stopped (fieldd's shutdown): UNAVAILABLE and retryable, as
 * fieldd's other services refuse while they stop (made-app-service.ts:1646-1650, mesh-board.ts:876-879), because the
 * next boot pulls again and adopts what a running pull lands. It names no `{service, state}`: DRIVE_SERVICE has no
 * word for a stopping drive (drive.ts `DriveUnavailableState`), and the floor's words are not this. */
function stoppedRefusal(message: string): RpcCallError {
  return new RpcCallError("UNAVAILABLE", message, true, undefined, RPC_ERROR_CODES.UNAVAILABLE);
}

/** Whether a floor cannot pull at all: the golden, or a floor before the facade (method not found). */
function cannotPull(error: unknown): boolean {
  if (isFileTransferUnsupported(error)) return true;
  if (!(error instanceof RpcCallError)) return false;
  return error.kind === "NOT_FOUND" && error.code === METHOD_NOT_FOUND;
}

function rootState(root: NativeFileTransferRoot): DriveRootState {
  if (root.registered) return { name: root.name, state: "served" };
  const reason = root.reason;
  if (reason === MESH_FILE_TRANSFER.ROOT_UNGATED) return { name: root.name, state: "held", reason };
  return { name: root.name, state: "refused", ...(reason !== undefined ? { reason } : {}) };
}

async function landedExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function issues(error: { issues: ReadonlyArray<unknown> }): number {
  return error.issues.length;
}

/** transferId → the index in `events` of the last terminal delta (`completed`, `failed`) that names it */
function terminalDeltas(events: readonly StreamEvent[]): Map<string, number> {
  const endsAt = new Map<string, number>();
  for (const [at, event] of events.entries()) {
    if (event.kind !== "delta") continue;
    const delta = NativeFileTransferDelta.safeParse(event.payload);
    if (delta.success && delta.data.kind !== "progress") endsAt.set(delta.data.transferId, at);
  }
  return endsAt;
}

export class DrivePulls {
  readonly #opts: DrivePullsOptions;
  readonly #log: Logger;
  /** where a pull lands: FILE_TRANSFER_ROOTS.DRIVE_OBJECTS' `lands` row under the user root */
  readonly #landsDir: string;
  readonly #exists: (path: string) => Promise<boolean>;
  readonly #mintId: () => string;
  readonly #heldBoundMs: number;
  /** transferId → a pull this fieldd minted */
  readonly #own = new Map<string, OwnPull>();
  /** transferId → digest: a running row this fieldd does not track: one it did not mint (a previous fieldd's), or one
   * of its own that its held bound ended (`#hold`) */
  readonly #foreign = new Map<string, string>();
  /** digest → transferId: every pull running that this fieldd knows of, its own and the foreign ones */
  readonly #running = new Map<string, string>();
  /** the floor boot that answered `file-transfer-unsupported` */
  #unsupportedBoot: string | null = null;
  #saidUnsupported: string | null = null;
  #subscription: { dispose: () => void } | null = null;
  #subscribing: Promise<void> | null = null;
  #declaring: Promise<unknown> = Promise.resolve();
  #roots: DriveRootState[] = [];
  /** Stream events in arrival order, each stamped with the fences run when it arrived (`#accept`), applied in a later
   * macrotask. A pull's answer and a snapshot can arrive in one read, in either order, and the answer's continuation
   * (which accepts the pull) runs after every line of that read: applied after it, a snapshot sees the pull accepted
   * whichever line came first, and its stamp says whether it may have been written before the answer. A
   * re-subscribe's snapshot also carries the held pulls it was asked for (`serves`, `#doSubscribe`). */
  #events: StreamEvent[] = [];
  #drain: ReturnType<typeof setImmediate> | null = null;
  /** fences set; a pull's fence is this count just after its own is set (`#accept`) */
  #fencesSet = 0;
  /** fences run, in the order set (setImmediate runs in that order): a pull's fence has run once this reaches it */
  #fencesRun = 0;
  readonly #adoptListeners = new Set<(candidate: DriveAdoptCandidate) => void>();
  /** Candidates no listener has taken yet. Only a row in `#foreign` becomes one (a previous fieldd's pull, or one
   * this fieldd's held bound ended), and the floor runs at most DRIVE_LIMITS.PULLS_IN_FLIGHT at once. */
  readonly #unclaimed: DriveAdoptCandidate[] = [];
  #stopped = false;

  constructor(opts: DrivePullsOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "drive.pulls" });
    this.#landsDir = join(opts.userRoot, ...LAYOUT[FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.lands]);
    this.#exists = opts.exists ?? landedExists;
    this.#mintId = opts.mintId ?? (() => ulid());
    this.#heldBoundMs = opts.heldBoundMs ?? HELD_PULL_BOUND_MS;
  }

  /** Subscribe the stream, then declare the roots. Never throws: a floor that cannot pull is cached for its boot,
   * and a node that is not up is asked again at `nodeUp`. Resolves once the first snapshot is applied. */
  async start(): Promise<void> {
    await this.#arm();
  }

  /** The node came up (MeshClient's "node-up", mesh-client.ts:144-150): the stream if a floor refused it, and the
   * roots, again. */
  async nodeUp(): Promise<void> {
    await this.#arm();
  }

  /** The mgmt link reconnected (NativeLink's "connected"): the floor may be a new boot, so its unsupported answer is
   * asked again. NativeLink has replayed the stream itself (native-link.ts:1105-1128), and the roots are declared
   * again: facade state is rebuilt, never persisted. */
  async connected(): Promise<void> {
    this.#unsupportedBoot = null;
    await this.#arm();
  }

  /** Whether the floor of the current boot said it cannot pull by a named root. */
  unsupported(): boolean {
    const bootId = this.#opts.bootId();
    return bootId !== undefined && this.#unsupportedBoot === bootId;
  }

  /** The roots as the floor last answered them. */
  roots(): readonly DriveRootState[] {
    return this.#roots;
  }

  /** Declare the WHOLE set of roots this desktop serves (an empty list serves none), one declaration at a time.
   * ROOT_UNGATED is HELD, never a refusal (mgmt.ts `NativeFileTransferRootsParams`). Never throws. */
  declareRoots(): Promise<readonly DriveRootState[]> {
    const run = this.#declaring.then(() => this.#declare());
    this.#declaring = run;
    return run;
  }

  /** Pull one object. Resolves once it has landed; rejects with the floor's refusal (untouched), a refusal of this
   * side's in the floor's own shape and the floor's order (C1's rider A: a floor that cannot pull first, then the
   * params, then CONFLICT and RESOURCE_EXHAUSTED), or `DrivePullFailed` with the floor's word. */
  async pull(request: DrivePullRequest): Promise<DriveLanded> {
    if (this.#stopped) throw stoppedRefusal("the drive's pulls are stopped");
    if (this.unsupported()) throw unsupportedRefusal();
    const asked = NativeFileTransferPullParams.safeParse({
      transferId: this.#mintId(),
      peer: request.peer,
      root: FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.name,
      path: request.path,
      digest: request.digest,
    });
    if (!asked.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `the pull is outside NativeFileTransferPullParams (${issues(asked.error)} issues)`,
        false,
        undefined,
        RPC_ERROR_CODES.PRECONDITION_FAILED,
      );
    }
    const params = asked.data;
    if (this.#running.has(params.digest)) {
      throw new RpcCallError(
        "CONFLICT",
        "a pull of this digest is running",
        false,
        undefined,
        RPC_ERROR_CODES.CONFLICT,
      );
    }
    if (this.#running.size >= DRIVE_LIMITS.PULLS_IN_FLIGHT) {
      // its golden, `error-data.file-transfer-exhausted.json` (W3-15, VF-PM 2026-11-06): retryable true and no
      // details, because a pull may be asked again once a running one ends; drive-pulls.test.ts holds this to it
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        `${DRIVE_LIMITS.PULLS_IN_FLIGHT} pulls are running`,
        true,
        undefined,
        RPC_ERROR_CODES.RESOURCE_EXHAUSTED,
      );
    }
    const own = ownPull(params.transferId, params.digest);
    this.#own.set(own.transferId, own);
    this.#running.set(own.digest, own.transferId);
    let answer: unknown;
    try {
      answer = await this.#opts.floor.request("native.mesh.fileTransfer.pull", params);
    } catch (error) {
      this.#untrack(own);
      if (!cannotPull(error)) throw error;
      this.#noteUnsupported();
      throw unsupportedRefusal();
    }
    const result = NativeFileTransferPullResult.safeParse(answer);
    if (!result.success || result.data.transferId !== own.transferId) {
      this.#untrack(own);
      throw new RpcCallError("INTERNAL", "the floor answered the pull outside its contract", false);
    }
    this.#accept(own);
    return await own.landed;
  }

  /** Every landed file a previous fieldd's pull left. One surfaced before any listener goes to the first. */
  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void {
    this.#adoptListeners.add(listener);
    for (const candidate of this.#unclaimed.splice(0)) listener(candidate);
    return () => {
      this.#adoptListeners.delete(listener);
    };
  }

  /** Close the stream. A pull still running goes on at the floor (it outlives fieldd), and the next boot adopts what
   * it lands; its caller here is told so. Every pull is untracked first, so no held pull's timer outlives this
   * (`#untrack`). */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#subscription?.dispose();
    this.#subscription = null;
    if (this.#drain !== null) clearImmediate(this.#drain);
    this.#drain = null;
    this.#events = [];
    for (const own of [...this.#own.values()]) {
      this.#untrack(own);
      own.reject(stoppedRefusal("fieldd stopped; the next boot adopts what this pull lands"));
    }
    this.#foreign.clear();
    this.#running.clear();
    this.#adoptListeners.clear();
    this.#unclaimed.length = 0;
  }

  /** The stream, then the roots. A re-subscribe in flight over a standing stream is not waited for (it can take up
   * to REQUEST_DEADLINE_MS): the roots are declared at every node-up whatever it answers. */
  async #arm(): Promise<void> {
    if (this.#stopped) return;
    const standing = this.#subscription !== null;
    const subscribing = this.#subscribe();
    if (!standing) await subscribing;
    await this.declareRoots();
  }

  /** One subscribe at a time: a caller while one is in flight shares it. A pull held while it was in flight was not
   * in its `serves` (it may have left before that pull's answer was read), so one more follows it for every such
   * pull. Each held pull is asked for once (`#serve`), so the chain ends. */
  #subscribe(): Promise<void> {
    if (this.#subscribing === null) {
      this.#subscribing = this.#doSubscribe().finally(() => {
        this.#subscribing = null;
        if (this.#owesFresh()) void this.#subscribe();
      });
    }
    return this.#subscribing;
  }

  /** Subscribe the stream; or, while a pull is held (`#hold`), subscribe it again for a snapshot built after that
   * pull's answer. The floor REPLACES a connection's file-transfer stream with the new one, and the old subId goes
   * quiet (W3-20, VF-PM 2026-11-06; mgmt.ts rider A's subscribe paragraph); NativeLink's dispose tells the floor
   * nothing (native-link.ts:1151-1157, `removeSubscription`), so the old subscription is disposed here as the new
   * one is made, and a reconnect replays one stream, never two.
   *  - A re-subscribe refused here may still have run at the floor (`mayHaveRun`: fieldd's TIMEOUT at its deadline,
   *    the floor's INTERNAL), and the floor then ends the old stream whatever this side read. So the old one is set
   *    aside and ONE plain subscribe follows at once; if that is refused too, the stream stands empty
   *    (`#subscription` null) until the next node-up or reconnect re-arms it (`#arm`), never a stream held silent.
   *  - A re-subscribe made while NativeLink replays its subscriptions after a redial is entered in the map that
   *    replay is iterating (native-link.ts:1106, :1282), so it is replayed too: one subscription, two requests. The
   *    later replaces the earlier at the floor (W3-20), both subIds route to its one entry (:883-896), and the
   *    replay's snapshot, asked after the held pull's answer was read, judges the pull: it converges. */
  async #doSubscribe(): Promise<void> {
    // The held pulls this subscribe is asked for, marked before anything can return: a held pull is asked for once,
    // and one no fresh snapshot comes for (refused, never answered) ends FAILED_TIMEOUT at its bound (`#hold`).
    const serves = this.#serve();
    if (this.#stopped || this.unsupported()) return;
    if (this.#subscription !== null && serves.size === 0) return;
    const method = "native.mesh.fileTransfer.subscribe";
    let subscribed: { snapshot: unknown; dispose: () => void };
    try {
      subscribed = await this.#opts.floor.subscribe(method, {}, (payload, kind) =>
        this.#onEvent(payload, kind),
      );
    } catch (error) {
      this.#refused(method, error);
      // only a re-subscribe is made while a subscription stands (the return above)
      const superseded = this.#subscription;
      if (this.#stopped || superseded === null || !mayHaveRun(error)) return;
      superseded.dispose();
      this.#subscription = null;
      // one plain subscribe: with `#subscription` null it is made, and its own refusal ends here
      await this.#doSubscribe();
      return;
    }
    if (this.#stopped) {
      subscribed.dispose();
      return;
    }
    this.#subscription?.dispose();
    this.#subscription = { dispose: subscribed.dispose };
    this.#onEvent(subscribed.snapshot, "snapshot", serves);
    // after the drain this snapshot scheduled, so `start` resolves with it applied
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  /** The held pulls no re-subscribe has left for yet, each marked asked: the subscribe being made serves them. Every
   * one was held after its answer was read (`#hold` needs its fence), and the subscribe request leaves after this
   * returns, so the floor's one FIFO mesh worker builds that snapshot after the pull's row went in. */
  #serve(): ReadonlySet<OwnPull> {
    const serves = new Set<OwnPull>();
    for (const own of this.#own.values()) {
      if (own.held === null || own.asked) continue;
      own.asked = true;
      serves.add(own);
    }
    return serves;
  }

  /** Whether a held pull still waits for its re-subscribe to leave. */
  #owesFresh(): boolean {
    for (const own of this.#own.values()) if (own.held !== null && !own.asked) return true;
    return false;
  }

  async #declare(): Promise<readonly DriveRootState[]> {
    if (this.#stopped || this.unsupported() || !this.#opts.linked()) return this.#roots;
    const method = "native.mesh.fileTransfer.roots";
    let answer: unknown;
    try {
      answer = await this.#opts.floor.request(method, { roots: this.#opts.roots() });
    } catch (error) {
      this.#refused(method, error);
      return this.#roots;
    }
    const parsed = NativeFileTransferRootsResult.safeParse(answer);
    if (!parsed.success) {
      this.#log.warn("fieldd.drive.roots_unparsed", "The floor's roots answer broke its contract", {
        issues: issues(parsed.error),
      });
      return this.#roots;
    }
    this.#roots = parsed.data.roots.map(rootState);
    for (const root of this.#roots) {
      if (root.state !== "refused") continue;
      this.#log.warn("fieldd.drive.root_refused", "The floor did not register a drive root", {
        root: root.name,
        ...(root.reason !== undefined ? { reason: root.reason } : {}),
      });
    }
    return this.#roots;
  }

  /** A refusal of the stream or the roots. `file-transfer-unsupported` is cached for the boot; anything else (the
   * node gate, a capture, a link that is down) is a moment, asked again at the next node-up or reconnect. */
  #refused(method: string, error: unknown): void {
    if (cannotPull(error)) {
      this.#noteUnsupported();
      return;
    }
    this.#log.info("fieldd.drive.file_transfer_refused", "The floor refused a file-transfer call", {
      method,
      error: String(error),
    });
  }

  #noteUnsupported(): void {
    const bootId = this.#opts.bootId();
    if (bootId !== undefined) this.#unsupportedBoot = bootId;
    // A pull the floor accepted ran on a boot that could pull. This one cannot, so that boot is gone.
    for (const own of [...this.#own.values()]) {
      if (own.fence === null) continue;
      this.#untrack(own);
      const word = MESH_FILE_TRANSFER.FAILED_NODE_DOWN;
      own.reject(new DrivePullFailed(word, "the floor that ran this pull is gone", own.transferId));
    }
    const key = bootId ?? "";
    if (this.#saidUnsupported === key) return;
    this.#saidUnsupported = key;
    this.#log.info("fieldd.drive.file_transfer_unsupported", "This floor cannot pull by a root", {
      ...(bootId !== undefined ? { floorBootId: bootId } : {}),
    });
  }

  /** The floor answered `own`: from here a snapshot that does not list it can say it ended, but only one written
   * after the answer can (the snapshot write order, W3-16, VF-PM 2026-11-06: a snapshot never omits a RUNNING pull
   * whose answer was written before it), and lines are not read one at a time. So the pull gets a FENCE: a
   * setImmediate set here, counted in `#fencesRun` when it runs, which `#onEvent` stamps on every event as it
   * arrives.
   *  - A snapshot written BEFORE the answer arrives before the fence runs. Its line was read before the answer's, and
   *    NativeLink hands it on as that line is read (native-link.ts:924), or in the continuation of the answer that
   *    carried it with the events queued behind it (:1110-1111; `#doSubscribe`), both before any macrotask, or at
   *    its subscribe's activation (:1287-1290), a setImmediate set in NativeLink's own continuation (:1284), which
   *    runs before this one: it was set in an earlier read, or in the same read after one await fewer than this one
   *    waits on (`request`'s, :1161, then `pull`'s). setImmediate runs in the order set.
   *  - So a snapshot that arrives once the fence has run was written after the answer: a pull it omits has ended, and
   *    the lands rule settles it (`#settleUnlisted`).
   *  - One that arrived before the fence cannot be ordered against the answer. It may predate the pull's row; or it
   *    was written after the answer and read in the same poll phase, as a fieldd catching up reads the answer and
   *    the `.snapshot` the floor owes once its outbox skipped the pull's end (field-native
   *    `MgmtOutbox::offer_rebuildable`); or the pull ended before the stream existed on this connection (at `start`,
   *    at a re-subscribe after a refusal, or answered on a redialed socket before NativeLink replayed the stream,
   *    native-link.ts:481, :493-494). Telling those apart takes the line order, which NativeLink does not hand on.
   *    So it is read for nothing of the pull, not even its landed name: the floor places a pull's file and can still
   *    fail it and remove the file while the row stands (field-native `services/file_transfer.rs`'s `finish`), and a
   *    snapshot written while the row stood can follow it and would hand a pull settled here back as a previous
   *    fieldd's. Omitting the pull, it HOLDS it (`#hold`, race#0 (b), VF-PM 2026-11-06): one re-subscribe, whose
   *    snapshot is built after the answer and judges the pull, or FAILED_TIMEOUT at the held bound.
   * A pull ends as any running one does: its terminal delta, matched by its id whatever its fence (`#onDelta`); a
   * snapshot built after its answer that omits it: one that arrives after the fence, such as the `.snapshot` the
   * floor owes when its stream loses a delta (field-native `mgmt/file_transfer.rs`'s `offer_snapshot`) or
   * NativeLink's replay at a reconnect (:1105-1128), or the re-subscribe's (`#hold`); the held bound, when that
   * snapshot never comes; the floor's idle bound, which ends a pull no byte reaches (W3-4); `failed` NODE_DOWN when
   * the node goes (W3-2); `#noteUnsupported`, when the floor of a new boot cannot pull; `stop`. A held pull has its
   * own bound; any other waits on the floor's, whose end reaches it as a delta or in the snapshot a lost one owes,
   * while this side holds a live stream. With none, it waits for the next re-arm, not for a bound: a subscribe
   * refused (at `start`, at a node-up, or the plain one after a refused re-subscribe, `#doSubscribe`) leaves the
   * stream empty until the next node-up or reconnect; and a replay NativeLink was refused stays silent until its
   * next reconnect (native-link.ts:1112-1126), which this side is not told. */
  #accept(own: OwnPull): void {
    this.#fencesSet += 1;
    own.fence = this.#fencesSet;
    setImmediate(() => {
      this.#fencesRun += 1;
    });
  }

  #onEvent(
    payload: unknown,
    kind: "snapshot" | "delta",
    serves: ReadonlySet<OwnPull> = NO_PULLS,
  ): void {
    if (this.#stopped) return;
    this.#events.push({ payload, kind, fencesRun: this.#fencesRun, serves });
    if (this.#drain === null) this.#drain = setImmediate(() => this.#applyEvents());
  }

  #applyEvents(): void {
    this.#drain = null;
    const events = this.#events.splice(0);
    const endsAt = terminalDeltas(events);
    for (const [at, event] of events.entries()) {
      if (this.#stopped) return;
      if (event.kind === "delta") this.#onDelta(event.payload);
      else this.#onSnapshot(event, (transferId) => (endsAt.get(transferId) ?? -1) > at);
    }
    // ONE re-subscribe for every pull these events held; one in flight is followed by the next (`#subscribe`)
    if (!this.#stopped && this.#owesFresh()) void this.#subscribe();
  }

  /** P5: the snapshot is the truth. A row this fieldd did not mint is a previous fieldd's, and a foreign row it no
   * longer lists ended while the reader lagged. An accepted pull of this fieldd's is judged only by a snapshot built
   * after its answer: one that arrived once its fence had run (`#accept`), or the re-subscribe's it was held for
   * (`serves`). Listed, it runs, and a hold is released; omitted, it ended, and the lands rule settles it. One that
   * arrived before the fence says nothing of a pull it lists, and holds one it omits (`#hold`).
   * An omitted pull whose terminal delta comes later in the same batch (`endsLater`) is left to that delta, which
   * carries its word: the floor forwards after a snapshot an end its table already shows (a stream's subscribe is
   * made before its snapshot is written, field-native `mgmt/file_transfer.rs`'s `subscribe`, "Subscribe BEFORE the
   * snapshot"; an owed `.snapshot` is built while later events wait in the broadcast), and the lands rule would read
   * that end as FAILED_IO. */
  #onSnapshot(event: StreamEvent, endsLater: (transferId: string) => boolean): void {
    const snapshot = NativeFileTransferSnapshot.safeParse(event.payload);
    if (!snapshot.success) {
      this.#dropped("snapshot", issues(snapshot.error));
      return;
    }
    const listed = new Map<string, string>();
    for (const row of snapshot.data.transfers) listed.set(row.transferId, row.digest);
    for (const own of [...this.#own.values()]) {
      if (own.fence === null) continue;
      const afterAnswer = event.fencesRun >= own.fence || event.serves.has(own);
      if (listed.has(own.transferId)) {
        if (afterAnswer) this.#release(own);
        continue;
      }
      if (endsLater(own.transferId)) continue;
      if (!afterAnswer) {
        this.#hold(own);
        continue;
      }
      this.#untrack(own);
      void this.#settleUnlisted(own);
    }
    for (const [transferId, digest] of [...this.#foreign]) {
      if (listed.has(transferId)) continue;
      this.#forgetForeign(transferId);
      void this.#adoptIfLanded(transferId, digest);
    }
    for (const [transferId, digest] of listed) {
      if (this.#own.has(transferId) || this.#foreign.has(transferId)) continue;
      this.#foreign.set(transferId, digest);
      this.#running.set(digest, transferId);
    }
  }

  #onDelta(payload: unknown): void {
    const parsed = NativeFileTransferDelta.safeParse(payload);
    if (!parsed.success) {
      this.#dropped("delta", issues(parsed.error));
      return;
    }
    const delta = parsed.data;
    // A progress ends nothing and releases no hold (`#hold`): a fresh stream forwards after its snapshot an event the
    // floor sent before it (field-native `mgmt/file_transfer.rs`'s `subscribe`, "Subscribe BEFORE the snapshot"), so
    // it does not say the pull still runs.
    if (delta.kind === "progress") return;
    const own = this.#own.get(delta.transferId);
    if (delta.kind === "failed") {
      if (own === undefined) {
        this.#forgetForeign(delta.transferId);
        return;
      }
      this.#untrack(own);
      own.reject(new DrivePullFailed(failedWord(delta.reason), delta.message, own.transferId));
      return;
    }
    const named = delta.incoming === `${delta.digest}.${delta.transferId}`;
    if (own === undefined) {
      const digest = this.#foreign.get(delta.transferId);
      if (digest === undefined) return;
      this.#forgetForeign(delta.transferId);
      if (named && delta.digest === digest) {
        const path = join(this.#landsDir, delta.incoming);
        this.#surface({ transferId: delta.transferId, digest, path });
      }
      return;
    }
    this.#untrack(own);
    if (!named || delta.digest !== own.digest) {
      const message = `the floor landed ${delta.incoming}, not the name this pull asked for`;
      own.reject(new DrivePullFailed(MESH_FILE_TRANSFER.FAILED_IO, message, own.transferId));
      return;
    }
    own.resolve({ path: join(this.#landsDir, delta.incoming) });
  }

  async #settleUnlisted(own: OwnPull): Promise<void> {
    const path = join(this.#landsDir, `${own.digest}.${own.transferId}`);
    if (await this.#landed(path)) {
      own.resolve({ path });
      return;
    }
    const message = "the pull ended while the stream lagged, and nothing landed";
    own.reject(new DrivePullFailed(MESH_FILE_TRANSFER.FAILED_IO, message, own.transferId));
  }

  async #adoptIfLanded(transferId: string, digest: string): Promise<void> {
    const path = join(this.#landsDir, `${digest}.${transferId}`);
    if (await this.#landed(path)) this.#surface({ transferId, digest, path });
  }

  async #landed(path: string): Promise<boolean> {
    try {
      return await this.#exists(path);
    } catch {
      return false;
    }
  }

  #surface(candidate: DriveAdoptCandidate): void {
    if (this.#stopped) return;
    if (this.#adoptListeners.size === 0) {
      this.#unclaimed.push(candidate);
      return;
    }
    for (const listener of [...this.#adoptListeners]) listener(candidate);
  }

  /** race#0 (b) (VF-PM 2026-11-06; W3-16): a snapshot that may predate `own`'s answer omits it, so it may have ended
   * or may not have begun. It is HELD: `#applyEvents` asks for ONE re-subscribe, whose snapshot the floor builds
   * after the pull's row went in (`#serve`), and `#onSnapshot` judges it by that one. If no such snapshot comes (the
   * re-subscribe refused, or never answered), it ends FAILED_TIMEOUT at the held bound, counted from here, never a
   * silent wait. A hold ends with the pull's settle (`#untrack`: its terminal delta, NODE_DOWN's included, a snapshot
   * built after its answer, `#noteUnsupported`, `stop`) or a snapshot built after its answer that lists it
   * (`#release`). The bound fires when this side cannot tell whether the pull still runs, so from there it is read
   * as a row this fieldd does not track (`#foreign`): its digest stays held (CONFLICT here, as the floor would answer
   * while it runs), what it lands is an adopt candidate, never an answer, and a snapshot that omits it, or its
   * `failed`, forgets it.
   * A re-subscribe can cost a pull that ends while the floor replaces its stream its word, held or not: the events
   * the old stream had not forwarded when it went quiet (W3-20) are lost with it, and the new snapshot omits the
   * pull, which the lands rule reads FAILED_IO. An end the new stream forwards after its snapshot keeps its word
   * (`#onSnapshot`'s `endsLater`). */
  #hold(own: OwnPull): void {
    if (own.held !== null) return;
    const timer = setTimeout(() => {
      if (this.#own.get(own.transferId) !== own) return;
      this.#untrack(own);
      this.#foreign.set(own.transferId, own.digest);
      this.#running.set(own.digest, own.transferId);
      const word = MESH_FILE_TRANSFER.FAILED_TIMEOUT;
      const message = "no snapshot built after the pull's answer came within the bound";
      own.reject(new DrivePullFailed(word, message, own.transferId));
    }, this.#heldBoundMs);
    timer.unref?.();
    own.held = timer;
  }

  /** A snapshot built after `own`'s answer lists it: it runs, and its hold ends. */
  #release(own: OwnPull): void {
    if (own.held === null) return;
    clearTimeout(own.held);
    own.held = null;
  }

  /** Every settle, and `stop`, comes through here, before the pull is settled: it leaves the tables, and every path
   * that settles a pull finds it in `#own` first, so none settles it twice; and its held bound's timer is cleared,
   * so none leaves a timer behind (item 196). */
  #untrack(own: OwnPull): void {
    this.#release(own);
    this.#own.delete(own.transferId);
    if (this.#running.get(own.digest) === own.transferId) this.#running.delete(own.digest);
  }

  #forgetForeign(transferId: string): void {
    const digest = this.#foreign.get(transferId);
    if (digest === undefined) return;
    this.#foreign.delete(transferId);
    if (this.#running.get(digest) === transferId) this.#running.delete(digest);
  }

  #dropped(what: "snapshot" | "delta", count: number): void {
    this.#log.warn("fieldd.drive.pull_event_dropped", "A file-transfer event broke its contract", {
      what,
      issues: count,
    });
  }
}
