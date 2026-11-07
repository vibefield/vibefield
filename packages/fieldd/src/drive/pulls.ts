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
//    adopt candidates (`onAdoptCandidate`), never as an answer to a pull of this boot. A pull of this boot read
//    refused that may have run is read the same way until a snapshot says (`DrivePulls.#askIfRan`); while a stream
//    stands and none has, a pull its row refuses asks for one, one retry delay later (`DrivePulls.#confirmLater`).
//  - A pull the stream's snapshot no longer lists ended while the reader lagged: completed when its landed name is in
//    the folder, failed FAILED_IO otherwise (mgmt.ts `NativeFileTransferSnapshot`). Only a snapshot written AFTER the
//    pull's answer says so (the snapshot write order, W3-16, VF-PM 2026-11-06). One that may have been written before
//    it and omits the pull HOLDS it (`#hold`, race#0 (b), VF-PM 2026-11-06): the stream is subscribed once more, and
//    that snapshot, built after the answer, judges the pull; with none, it ends FAILED_TIMEOUT at W3-4's idle bound.
//    While no stream stands, nothing carries a pull's end, so EVERY accepted pull is held the same way, and the
//    plain subscribe is retried while one is (W3-21, VF-PM 2026-11-06). A reconnect's stream stands only once a
//    subscribe is answered on the new connection: NativeLink's replay may have been refused or read TIMEOUT, and
//    this side is not told which, so a reconnect lets the stream go (`connected`) and holds every accepted pull. A
//    link going down holds them too (`disconnected`), so an outage no redial ends runs out their bound.
//    Only names matching that rule are read; a `*.truffle-tmp` beside them is the floor's.
//  - `file-transfer-unsupported` is a fact of the floor's boot (mgmt.ts `MESH_FILE_TRANSFER`): cached for that boot,
//    asked again at a reconnect, as `FloorEgress` keeps `egress-unsupported` (egress.ts:143-158).
//
// One subscribe is in flight at a time (`DrivePulls.#subscribe`), and two timers at most ask for the next: the
// series' (`#retry`, set only while no stream stands) and the confirm timer (`#confirm`, set only while one stands
// and a row read refused is unconfirmed), each one at a time. Every other timer is a held pull's own bound.
//
// Every payload from the floor is held to its contract (`safeParse`); one outside it is dropped and logged.

/** The floor's two verbs, as NativeLink answers them (native-link.ts:1159 `request`, :1274 `subscribe`). The snapshot
 * rule (`DrivePulls.#accept`) reads NativeLink's timing: an answer settles its promise as its line is read
 * (native-link.ts:899), and an event reaches `onEvent` as its line is read (:924), in the continuation of the answer
 * that carried it with the events queued behind it (:1110-1111), or at its subscribe's activation, a setImmediate
 * that subscribe's continuation sets (:1287-1290), before `subscribe` resolves, so a drain set after it resolves
 * runs behind it (`DrivePulls.#doSubscribe`). A floor that put a macrotask (setImmediate, setTimeout, I/O) between
 * NativeLink and `onEvent`, or between the subscribe's answer and `subscribe` resolving, would break that rule; a
 * microtask between them only delays the event within the same turn, and an await on `request` only sets the fence
 * later. `subscribe` is asked again while a subscription stands, for a snapshot built after a held pull's
 * answer (`DrivePulls.#hold`). The floor replaces a connection's stream with the new one (W3-20, VF-PM 2026-11-06),
 * so the old subscription's `dispose` is called once the new one is answered, or at once when a re-subscribe the
 * floor may have run is refused, before one more subscribe (`DrivePulls.#doSubscribe`), and at once at a reconnect,
 * before the subscribe on the new connection (`DrivePulls.connected`). */
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

/** A file left in the `lands` folder by a pull no caller here waits on, for the drive to adopt or sweep (mgmt.ts
 * `NativeFileTransferSnapshot`): a previous fieldd's pull, one of this fieldd's whose held bound ended, or one of
 * this fieldd's read refused that may have run (`DrivePulls.#foreign`). */
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
  /** The plain subscribe's retries while no stream stands and a pull is held (`DrivePulls.#follow`), in ms, each
   * counted from the refusal before it, the last repeated while a pull is held; and the wait before each ask a
   * foreign row's refusal makes (`DrivePulls.#askForForeign`), the first of them over a standing stream
   * (`DrivePulls.#confirmLater`). Default: `retryDelays(heldBoundMs)`. A test shortens them. */
  retryDelaysMs?: readonly number[];
  logger?: Logger;
}

/** A pull this fieldd minted. */
interface OwnPull {
  readonly transferId: string;
  readonly digest: string;
  /** null until the floor answered it; then its fence (`DrivePulls.#accept`): a snapshot that does not list it says
   * it ended only when that snapshot arrived once this fence had run, or is the snapshot of a subscribe made while
   * it was held (`DrivePulls.#serve`) */
  fence: number | null;
  /** while it is HELD (`DrivePulls.#hold`): the bound's timer, which ends it FAILED_TIMEOUT; null otherwise */
  held: ReturnType<typeof setTimeout> | null;
  /** a subscribe has left since this hold began (`DrivePulls.#serve`), so a snapshot built after its answer is on its
   * way or was refused: each hold clears it (`DrivePulls.#hold`), and a hold without one is asked for
   * (`DrivePulls.#follow`) */
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
  /** a subscribe's own snapshot: every pull held as that subscribe left, each one answered before it
   * (`DrivePulls.#serve`); NO_PULLS for a snapshot the stream pushed */
  serves: ReadonlySet<OwnPull>;
}

const NO_PULLS: ReadonlySet<OwnPull> = new Set();

/** How long a held pull (`DrivePulls.#hold`) waits for a fresh snapshot before it ends FAILED_TIMEOUT: W3-4's idle
 * bound (VF-PM 2026-11-06), the floor's `PULL_IDLE_BOUND`, 60 s (field-native `src/services/file_transfer.rs:309`).
 * PROVISIONAL and RELAY-LOCAL, as the floor's is FLOOR-LOCAL: not in the registry, so moving it is no contract event,
 * and it moves with the floor's. */
const HELD_PULL_BOUND_MS = 60_000;

/** The plain subscribe's retries while no stream stands and a pull is held (`DrivePulls.#follow`, W3-21, VF-PM
 * 2026-11-06), each counted from the refusal before it: 1/30, 1/15 and 2/15 of the held bound, so 2 s, 4 s and 8 s
 * at 60 s, then the last again while any pull is held. The holds bound the series, never a count: a refusal comes at
 * once (the floor's full mesh queue, field-native `mgmt/mod.rs:139-141`) or at fieldd's request deadline
 * (native-link.ts:1212-1213, NATIVE_SUPERVISION.REQUEST_DEADLINE_MS, 10 s, contracts mgmt.ts:355), and either way
 * the series asks until the last held pull ends, at its bound or by the snapshot an attempt brings. Every pull a
 * series serves was held by the time it opened (a later hold opens a series of its own, `#follow`), so it ends
 * within one bound of its opener, and the n-th retry leaves at least the first n delays after it: ONE series makes
 * at most 9 attempts inside a 60 s bound (at 0 s, then at 2, 6, 14, 22, 30, 38, 46 and 54 s at the earliest), one
 * in flight at a time. Outside a series' retries a subscribe is made only at once, as one of these, and with no
 * stream each opens the series again from its first delay:
 *  - a re-arm (`start`, a node-up, a reconnect): one per event at most;
 *  - a hold no subscribe has left for: at most one per hold. With no stream only a pull the floor accepted is
 *    held, and it keeps one of DRIVE_LIMITS.PULLS_IN_FLIGHT slots until it settles or its bound leaves its row
 *    foreign; over a stream ONE re-subscribe serves every such hold (race#0 (b));
 *  - the plain subscribe after a re-subscribe the floor may have run (`#doSubscribe`): one per such re-subscribe;
 *  - one for a pull read refused that may have run (`#askIfRan`): one per such pull, and it holds nothing, so with
 *    no stream a refusal of it opens no retries.
 * A pull a foreign row refuses (`#askForForeign`) makes no subscribe at once: it sets the series' timer when none is
 * set and none is in flight, so its asks each wait one of these delays and come at least the shortest apart (2 s at
 * 60 s), however fast a caller is refused. Over a standing stream only a row read refused and not yet confirmed
 * asks, by the confirm timer at the first of these delays, set the same way (`#confirmLater`). An attempt answered
 * after a pull's bound settles nothing of that pull, and forgets its row if it ended (`#hold`). */
function retryDelays(boundMs: number): number[] {
  return [boundMs / 30, boundMs / 15, (boundMs * 2) / 15];
}

/** The refusals `mayHaveRun` reads as not run. */
const NEVER_RAN: ReadonlySet<string> = new Set([
  "UNAVAILABLE",
  "RESOURCE_EXHAUSTED",
  "CONFLICT",
  "PRECONDITION_FAILED",
]);

/** Whether a refused subscribe or pull may still have RUN at the floor: a subscribe then replaced the stream this
 * connection held (W3-20, VF-PM 2026-11-06), and a pull runs on with no row here (`DrivePulls.#askIfRan`). Not run,
 * for certain:
 *  - an UNAVAILABLE: NativeLink gives one unsent (its door gate, native-link.ts:1173-1183; no socket, :1210) or for a
 *    connection that closed under it (`failPending`, :1059-1061), whose stream ends with it while NativeLink replays
 *    the one this side holds (:1105-1111); the floor gives one before any subscribe or pull runs
 *    (`file-transfer-unsupported`, mgmt.ts's header; its node gate; its mesh worker stopped, field-native
 *    `mgmt/mod.rs:142-154`). A pull's request can outlive a connection closed under it: nothing here tracks that
 *    pull, and the reconnect's snapshot lists it as a row this side does not track (`#onSnapshot`);
 *  - a RESOURCE_EXHAUSTED, the floor's mesh queue full as the request came (`mgmt/mod.rs`'s `mesh_queue_full`), or
 *    its pulls all running (`mgmt/file_transfer.rs`'s `refusal`);
 *  - a CONFLICT or a PRECONDITION_FAILED, the floor's refusal of a pull before it begins (`mgmt/file_transfer.rs`'s
 *    `refusal` and `malformed`, MESH_CAPTURING), which it never answers a subscribe;
 *  - a floor that cannot pull (`cannotPull`), which answers so before its stream.
 * Any other may have run: fieldd's own TIMEOUT (native-link.ts:1247-1266), since the floor runs a request dequeued in
 * its deadline's last instants and its answer is then a late reply (:1086-1103; mgmt.ts `NativeDeadlinePassedDetails`
 * says the floor's own TIMEOUT reaches fieldd only so), or the floor's INTERNAL for a subscribe it ran and could not
 * answer with a snapshot. */
function mayHaveRun(error: unknown): boolean {
  if (!(error instanceof RpcCallError)) return true;
  if (cannotPull(error)) return false;
  return !NEVER_RAN.has(error.kind);
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
  readonly #retryDelaysMs: readonly number[];
  /** transferId → a pull this fieldd minted */
  readonly #own = new Map<string, OwnPull>();
  /** transferId → digest: a running row this fieldd does not track: one it did not mint (a previous fieldd's), one of
   * its own that its held bound ended (`#hold`), or one of its own read refused that may have run (`#askIfRan`). A
   * snapshot that omits it, or its `completed` or `failed`, forgets it (`#onSnapshot`, `#onDelta`). While a stream
   * stands, it needs nothing asked (the DR lead's ruling on fold 3's
   * remnant): every pull the floor runs ends, by the substrate's own end, at the floor's idle bound (W3-4,
   * `PULL_IDLE_BOUND`, 60 s, field-native `src/services/file_transfer.rs:309`, raced in `run_pull`, :953-975), or at
   * a teardown (`detach`, :539-589, `failed` NODE_DOWN, W3-2); `finish` (:842-901) and `detach` (:583-587) send
   * that end, and the stream's forwarder carries it as a delta, or as the `.snapshot` a lag or a skipped line owes
   * (field-native `src/mgmt/file_transfer.rs`'s `spawn_forwarder`, :556-605). That holds only for a stream answered
   * on the connection it hears, which a stream that stands is (`connected` lets a reconnect's go), and only for a
   * row whose pull the floor still runs: a pull held because a snapshot it could not order omitted it, whose end
   * the stream had already lost, gets no delta, and its row waits for the next snapshot this side reads (a lag's,
   * a hold's re-subscribe, a reconnect's subscribe). A pull read refused that never ran has no end to hear at all,
   * so its row asks for that snapshot at once (`#askIfRan`), and until a snapshot lists or omits it, a pull it
   * refuses asks again one delay later (`#confirmLater`). With no stream, a pull any such row refuses asks for one
   * (`#askForForeign`). */
  readonly #foreign = new Map<string, string>();
  /** transferIds of the rows `#askIfRan` left in `#foreign` that no snapshot has listed or omitted yet: each may
   * never have run, so nothing will end it but a snapshot. A snapshot that lists one confirms it (it runs, and its end
   * comes on the stream), and one that omits it, or its `completed` or `failed`, forgets it (`#confirmed`). */
  readonly #unconfirmed = new Set<string>();
  /** digest → transferId: every pull running that this fieldd knows of, its own and the foreign ones */
  readonly #running = new Map<string, string>();
  /** the floor boot that answered `file-transfer-unsupported` */
  #unsupportedBoot: string | null = null;
  #saidUnsupported: string | null = null;
  #subscription: { dispose: () => void } | null = null;
  #subscribing: Promise<void> | null = null;
  /** a pull read refused may have run (`#askIfRan`), or the confirm timer fired for such a row with no subscribe in
   * flight (`#confirmLater`), and no subscribe has left since: one is owed, and `#serve` clears this as it leaves */
  #rowUnconfirmed = false;
  /** the plain subscribe's next attempt while no stream stands (`#follow`, `#askForForeign`): set only while none is
   * in flight */
  #retry: ReturnType<typeof setTimeout> | null = null;
  /** the next ask for a row in `#unconfirmed` while a stream stands (`#confirmLater`): armed only while no subscribe
   * is in flight, and cleared as the last such row goes (`#confirmed`) and at `stop`. One that fires while a subscribe
   * is in flight asks nothing: that flight left after the refusal that armed it, so its snapshot judges the row. */
  #confirm: ReturnType<typeof setTimeout> | null = null;
  /** the attempts of the series under way (`#follow`): back to 0 at a re-arm (`#arm`), as what is owed opens a series
   * (`#follow`), and as a subscription is made (`#doSubscribe`). Only a timer set while no stream stands counts it up
   * (`#schedule`), so it is 0 whenever a stream stands. */
  #retries = 0;
  #declaring: Promise<unknown> = Promise.resolve();
  #roots: DriveRootState[] = [];
  /** Stream events in arrival order, each stamped with the fences run when it arrived (`#accept`), applied in a later
   * macrotask. A pull's answer and a snapshot can arrive in one read, in either order, and the answer's continuation
   * (which accepts the pull) runs after every line of that read: applied after it, a snapshot sees the pull accepted
   * whichever line came first, and its stamp says whether it may have been written before the answer. A
   * subscribe's own snapshot also carries every pull held as that subscribe left (`serves`, `#serve`), and moves the
   * drain behind that stream's activation (`#doSubscribe`). */
  #events: StreamEvent[] = [];
  #drain: ReturnType<typeof setImmediate> | null = null;
  /** fences set; a pull's fence is this count just after its own is set (`#accept`) */
  #fencesSet = 0;
  /** fences run, in the order set (setImmediate runs in that order): a pull's fence has run once this reaches it */
  #fencesRun = 0;
  readonly #adoptListeners = new Set<(candidate: DriveAdoptCandidate) => void>();
  /** Candidates no listener has taken yet. Only a row in `#foreign` becomes one (a previous fieldd's pull, one this
   * fieldd's held bound ended, or one it read refused), and the floor runs at most DRIVE_LIMITS.PULLS_IN_FLIGHT at
   * once. */
  readonly #unclaimed: DriveAdoptCandidate[] = [];
  #stopped = false;

  constructor(opts: DrivePullsOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "drive.pulls" });
    this.#landsDir = join(opts.userRoot, ...LAYOUT[FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.lands]);
    this.#exists = opts.exists ?? landedExists;
    this.#mintId = opts.mintId ?? (() => ulid());
    this.#heldBoundMs = opts.heldBoundMs ?? HELD_PULL_BOUND_MS;
    this.#retryDelaysMs = opts.retryDelaysMs ?? retryDelays(this.#heldBoundMs);
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
   * asked again, and the roots are declared again: facade state is rebuilt, never persisted. NativeLink says so once
   * its replay of the stream has run (native-link.ts:494-501), answered, refused or read TIMEOUT: one not answered
   * keeps the entry `#subscription` names, with no route, until the next reconnect (:1112-1126), and this side is
   * not told which. So the replayed stream is let go (its `dispose`, which tells the floor nothing, :1151-1157), and
   * the stream is empty: every accepted pull is held (`#holdAll`, W3-21), one accepted from here is held as it is
   * (`#accept`), and one plain subscribe is made, or the one in flight is shared (`#arm`, `#subscribe`), whose answer
   * installs its route (:883-896) before `#subscription` is set: a stream that stands has been answered on the
   * connection it hears. Its snapshot, built after every held pull's answer, judges them all; refused, the series
   * retries it while a pull is held (`#follow`), and each ends at its bound at the latest. A shared flight can
   * already be answered, waiting in `#doSubscribe` behind its drain with the stream this reconnect has just let go:
   * with a hold `#follow` subscribes or runs the series, and with none no subscribe follows, so `#subscription` ends
   * null, as a refused subscribe leaves it with nothing held. No accepted pull waits on it, and the next hold or a
   * pull a foreign row refuses subscribes; until then a foreign row's end and its adopt candidate go unheard. The
   * floor holds ONE stream for this connection throughout (W3-20): the replay's, if it ran, until that subscribe or a
   * retry replaces it, its lines dropped here for want of a route (:915-918), so an end it carries meanwhile reaches
   * this side only as the new snapshot's omission (the lands rule), as an end lost to a replace does (`#hold`). It
   * costs one subscribe per reconnect, and the roots follow once that subscribe ends (within REQUEST_DEADLINE_MS). */
  async connected(): Promise<void> {
    this.#unsupportedBoot = null;
    this.#subscription?.dispose();
    this.#subscription = null;
    this.#holdAll();
    await this.#arm();
  }

  /** The mgmt link went down (NativeLink's "reconnecting", said as it goes and again at each failed dial): nothing
   * carries a pull's end until a dial answers, and that may be never (`#accept`), so every accepted pull is held
   * (`#holdAll`) and its bound runs through the outage. A pull held already keeps its bound, so a repeat of this, or
   * the `connected` that ends the outage, restarts none (`#hold`). The stream stays as it is: NativeLink keeps its
   * entry for the replay, and `connected` lets it go. */
  disconnected(): void {
    this.#holdAll();
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
   * params, then CONFLICT and RESOURCE_EXHAUSTED), or `DrivePullFailed` with the floor's word. A refusal the floor
   * may have run past keeps its row until a snapshot says (`#askIfRan`). */
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
    const blocker = this.#running.get(params.digest);
    if (blocker !== undefined) {
      if (this.#foreign.has(blocker)) this.#askForForeign();
      if (this.#unconfirmed.has(blocker)) this.#confirmLater();
      throw new RpcCallError(
        "CONFLICT",
        "a pull of this digest is running",
        false,
        undefined,
        RPC_ERROR_CODES.CONFLICT,
      );
    }
    if (this.#running.size >= DRIVE_LIMITS.PULLS_IN_FLIGHT) {
      if (this.#foreign.size > 0) this.#askForForeign();
      // an unconfirmed row holds one of the slots, with nothing but a snapshot to free it
      if (this.#unconfirmed.size > 0) this.#confirmLater();
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
      if (mayHaveRun(error)) {
        this.#askIfRan(own);
        throw error;
      }
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

  /** Every landed file a pull no caller here waits on left: a previous fieldd's, one of this fieldd's whose held
   * bound ended, or one of this fieldd's read refused that may have run. One surfaced before any listener goes to the
   * first. */
  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void {
    this.#adoptListeners.add(listener);
    for (const candidate of this.#unclaimed.splice(0)) listener(candidate);
    return () => {
      this.#adoptListeners.delete(listener);
    };
  }

  /** Close the stream. A pull still running goes on at the floor (it outlives fieldd), and the next boot adopts what
   * it lands; its caller here is told so. Every pull is untracked first, so no held pull's timer outlives this
   * (`#untrack`), and the retry's and the confirm's timers are cleared (item 196). */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#subscription?.dispose();
    this.#subscription = null;
    this.#clearRetry();
    this.#clearConfirm();
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
   * to REQUEST_DEADLINE_MS): the roots are declared at every node-up whatever it answers. A re-arm is the stream's
   * next attempt: a retry due is made now, and the series starts again (`#follow`). */
  async #arm(): Promise<void> {
    if (this.#stopped) return;
    this.#clearRetry();
    this.#retries = 0;
    const standing = this.#subscription !== null;
    const subscribing = this.#subscribe();
    if (!standing) await subscribing;
    await this.declareRoots();
  }

  /** One subscribe at a time: a caller while one is in flight shares it, so two are never in flight. As it ends,
   * `#follow` asks what the held pulls are owed next: a pull held while it was in flight was not in its `serves` (it
   * may have left before that pull's answer was read), so one more follows it for every such pull, and for a pull
   * read refused meanwhile (`#askIfRan`); and with no stream, the series' next retry. A hold or such a pull asks for
   * one at most (`#serve` marks it), so the chain ends. */
  #subscribe(): Promise<void> {
    if (this.#subscribing === null) {
      this.#subscribing = this.#doSubscribe().finally(() => {
        this.#subscribing = null;
        this.#follow();
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
   *    aside, every accepted pull is held (`#holdAll`, W3-21, VF-PM 2026-11-06), and ONE plain subscribe follows at
   *    once, the first of a series (`#follow`).
   *  - A plain subscribe refused (at `start`, at a node-up or reconnect, that one, or a retry) leaves the stream
   *    empty (`#subscription` null), never a stream held silent: every accepted pull is held, and `#follow` retries
   *    the subscribe inside the held bound while one is. One the floor may have run (fieldd's TIMEOUT) leaves the
   *    floor a stream this side has no entry for (NativeLink removed it, native-link.ts:1300-1302, and drops its
   *    subId's events, :915-918): the next subscribe on this connection replaces it (W3-20), and the connection's
   *    close ends it, so the floor holds ONE stream for this connection whatever the retries read.
   *  - A re-subscribe made while NativeLink replays its subscriptions after a redial is entered in the map that
   *    replay is iterating (native-link.ts:1106, :1282), so it is replayed too: one subscription, two requests. The
   *    later replaces the earlier at the floor (W3-20), both subIds route to its one entry (:883-896), and the
   *    replay's snapshot, asked after the held pull's answer was read, judges the pull. One order is not closed here.
   *    The replay's request sets that entry buffering (:1107, :1130-1137) while the first subId still routes to it,
   *    so a `.snapshot` the floor owes on the first stream inside that round trip is queued (:923), and reaches
   *    `#onEvent` behind the replay's own snapshot (:1110-1111, :1143-1149), older on the wire than the stamp it
   *    gets. A pull whose answer is read in an earlier read than the replay's answer then has its fence run before
   *    that stamp, so a snapshot written before the pull's row went in reads as written after it, and a running
   *    pull it omits is settled by the lands rule. It takes a lag's `.snapshot` inside one round trip of a redial,
   *    behind a subscribe made mid-replay. */
  async #doSubscribe(): Promise<void> {
    // a stream stands and none is owed: nothing to make (`#arm`'s at a node-up; a reconnect leaves none standing,
    // `connected`)
    if (this.#subscription !== null && !this.#owesFresh()) return;
    // Every pull held now, marked before anything can return: this subscribe leaves after each one's answer was
    // read, so its snapshot judges them all, and one no fresh snapshot comes for ends FAILED_TIMEOUT at its bound.
    const serves = this.#serve();
    if (this.#stopped || this.unsupported()) return;
    const method = "native.mesh.fileTransfer.subscribe";
    let subscribed: { snapshot: unknown; dispose: () => void };
    try {
      subscribed = await this.#opts.floor.subscribe(method, {}, (payload, kind) =>
        this.#onEvent(payload, kind),
      );
    } catch (error) {
      this.#refused(method, error);
      // A refused plain subscribe ends here, and `#follow` retries it while a pull is held; a re-subscribe refused
      // unrun leaves its stream standing, one answered on this connection (`connected`). Only a re-subscribe is
      // made while a subscription stands.
      const superseded = this.#subscription;
      if (this.#stopped || superseded === null || !mayHaveRun(error)) return;
      superseded.dispose();
      this.#subscription = null;
      // nothing carries an end now: every accepted pull is held, and one plain subscribe (with `#subscription` null
      // it is made) opens the series at its first delay: a stream stood, so `#retries` is 0 (`#retries`)
      this.#holdAll();
      await this.#doSubscribe();
      return;
    }
    if (this.#stopped) {
      subscribed.dispose();
      return;
    }
    this.#subscription?.dispose();
    this.#subscription = { dispose: subscribed.dispose };
    // the series ends with the stream it asked for
    this.#clearRetry();
    this.#retries = 0;
    // A line of the replaced stream read ahead of this answer set a drain that runs before this stream's activation,
    // and a delta that activation delivers can be the word of a pull this snapshot omits (`#onSnapshot`'s `endsLater`,
    // field-native `mgmt/file_transfer.rs`'s `Stream::end`). So the drain moves behind the activation, and the
    // snapshot and that delta are one batch.
    if (this.#drain !== null) clearImmediate(this.#drain);
    this.#drain = null;
    this.#onEvent(subscribed.snapshot, "snapshot", serves);
    // after the drain this snapshot scheduled, so `start` resolves with it applied
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  /** EVERY held pull, each marked asked: the subscribe being made serves them all. Every one was held after its
   * answer was read (`#hold` needs its fence, `#accept`), and the subscribe request leaves after this returns
   * (NativeLink writes it in the same synchronous run, native-link.ts:1274-1284, `rawRequest`'s write at :1269), so
   * the floor builds that snapshot after each pull's row went in: every `native.mesh.*` enters one queue
   * (field-native `mgmt/mod.rs:703-704`), which one worker drains in order, a request at a time (:227-258). The same
   * order pays what a pull read refused was owed (`#askIfRan`): this request leaves behind that pull's. */
  #serve(): ReadonlySet<OwnPull> {
    this.#rowUnconfirmed = false;
    const serves = new Set<OwnPull>();
    for (const own of this.#own.values()) {
      if (own.held === null) continue;
      own.asked = true;
      serves.add(own);
    }
    return serves;
  }

  /** Whether a subscribe is owed: a pull is held with none left since its hold began, or a pull read refused has none
   * left since that refusal (`#askIfRan`) or since the confirm timer fired for its row with no subscribe in flight
   * (`#confirmLater`). */
  #owesFresh(): boolean {
    if (this.#rowUnconfirmed) return true;
    for (const own of this.#own.values()) if (own.held !== null && !own.asked) return true;
    return false;
  }

  /** Whether any pull is held. */
  #holding(): boolean {
    for (const own of this.#own.values()) if (own.held !== null) return true;
    return false;
  }

  /** W3-21 (VF-PM 2026-11-06): the stream is gone (`#doSubscribe`), a reconnect let it go (`connected`), or the link
   * went down (`disconnected`), so every accepted pull is held (`#hold`); one held already keeps its bound. */
  #holdAll(): void {
    for (const own of this.#own.values()) if (own.fence !== null) this.#hold(own);
  }

  /** What the held pulls are owed next. Asked as each subscribe ends (`#subscribe`), as `#accept` holds a pull with
   * no stream, as a pull is read refused (`#askIfRan`), and after each batch of events (`#applyEvents`). While a
   * subscribe is in flight it asks nothing, and that subscribe's end asks again.
   *  - A stream stands: ONE re-subscribe for every hold no subscribe has left for (race#0 (b)), and for a pull read
   *    refused that may have run (`#askIfRan`).
   *  - None stands (W3-21, VF-PM 2026-11-06): either of those opens a series at once. Otherwise the plain subscribe
   *    is retried `#retryDelaysMs[n]` after the series' n-th refusal, and past the list after its last delay, while
   *    any pull is held; each held pull ends at its bound (`#hold`) or by the snapshot an attempt brings. With no
   *    pull held nothing is asked, and the bound that ends the last hold clears the timer: the next node-up or
   *    reconnect (`#arm`), the next pull accepted (`#accept`), or a pull a foreign row refuses (`#askForForeign`, at
   *    the series' next delay), asks again.
   * So one attempt is in flight at most and one series timer is set at most (the confirm timer, `#confirmLater`, is
   * the only other that asks, one at a time), and a series opens only at a hold (the stream
   * going, `#doSubscribe`; a pull accepted with none, `#accept`; one held while a subscribe was in flight; every
   * accepted pull at a reconnect, `connected`), a pull read refused, or a re-arm, and ends within one bound of its
   * opener (`retryDelays`). */
  #follow(): void {
    if (this.#stopped || this.unsupported() || this.#subscribing !== null) return;
    if (this.#subscription !== null) {
      if (this.#owesFresh()) void this.#subscribe();
      return;
    }
    if (this.#owesFresh()) {
      this.#clearRetry();
      this.#retries = 0;
      void this.#subscribe();
      return;
    }
    if (!this.#holding()) {
      this.#clearRetry();
      return;
    }
    if (this.#retry !== null) return;
    this.#schedule();
  }

  /** The series' next attempt: `#retryDelaysMs[n]` after its n-th, and past the list its last delay again, as the
   * holds bound the series, never a count (`retryDelays`). Set only while no stream stands and no subscribe is in
   * flight (`#follow`, `#askForForeign`), and made only if no stream stands when it fires and a pull is held or a
   * foreign row waits. */
  #schedule(): void {
    const delay = this.#retryDelaysMs[this.#retries] ?? this.#retryDelaysMs.at(-1);
    if (delay === undefined) return;
    this.#retries += 1;
    const timer = setTimeout(() => {
      this.#retry = null;
      if (this.#subscription !== null) return;
      if (this.#holding() || this.#foreign.size > 0) void this.#subscribe();
    }, delay);
    timer.unref?.();
    this.#retry = timer;
  }

  #clearRetry(): void {
    if (this.#retry === null) return;
    clearTimeout(this.#retry);
    this.#retry = null;
  }

  /** A pull refused here (CONFLICT, RESOURCE_EXHAUSTED) by a row this side does not track (`#foreign`) while no
   * stream stands asks for the stream. Nothing else would: a held bound that ends a pull with no stream, or a pull
   * read refused whose one ask was refused too, leaves its row foreign (`#hold`, `#askIfRan`), only a snapshot that
   * omits the row, or its `completed` or `failed`, forgets it (`#onSnapshot`, `#onDelta`), and the series asks only
   * while a pull is held (`#follow`). The ask rides the series
   * (`#schedule`): with no subscribe in flight and no attempt due, it sets the series' timer at its next delay, and
   * asks nothing more until that attempt has ended. So its subscribes come at least the shortest of `#retryDelaysMs`
   * apart (`retryDelays`), the first one delay after the refusal, however fast a caller is refused. It holds
   * nothing, so a refused one opens no series and the next refusal asks again; an answered one's snapshot forgets
   * every such row whose pull has ended (the floor ends one no byte reaches at its idle bound, W3-4). Over a
   * standing stream it asks nothing (`#foreign`): there only a row read refused that no snapshot has confirmed asks
   * (`#confirmLater`). */
  #askForForeign(): void {
    if (this.#subscription !== null || this.#subscribing !== null || this.#retry !== null) return;
    this.#schedule();
  }

  /** A pull refused here by a row in `#unconfirmed` while a stream stands (CONFLICT by its digest, or
   * RESOURCE_EXHAUSTED while such a row holds a slot): `#askIfRan`'s one ask was refused unrun (a full mesh queue,
   * RESOURCE_EXHAUSTED; or UNAVAILABLE from NativeLink's door gate while the floor is held unresponsive,
   * native-link.ts:1173-1183, a missing socket or a stopped mesh worker), and the stream stood, so no end will come
   * for a row that never ran, and no other ask is made over a standing stream (`#askForForeign`). So
   * ONE timer is set at the first of `#retryDelaysMs`, with no subscribe in flight and none set, and as it fires with
   * none in flight the row's ask is owed again (`#rowUnconfirmed`): one re-subscribe, whose snapshot lists the row or
   * forgets it (a subscribe in flight then is one that left after the refusal, and its snapshot says, `#confirm`). Its
   * asks come at least that delay apart however fast a caller is refused, each one delay after a refusal, and end
   * as the last such row is confirmed or forgotten (`#confirmed`); with no stream, the series asks
   * (`#askForForeign`). */
  #confirmLater(): void {
    if (this.#subscription === null || this.#subscribing !== null || this.#confirm !== null) return;
    const timer = setTimeout(() => {
      this.#confirm = null;
      // a flight now left after the refusal that armed this: its snapshot judges the row, and refused unrun, the
      // next refusal arms the timer again
      if (this.#subscribing !== null) return;
      this.#rowUnconfirmed = true;
      this.#follow();
    }, this.#retryDelaysMs[0]);
    timer.unref?.();
    this.#confirm = timer;
  }

  /** A row `#askIfRan` left is listed by a snapshot, or forgotten: it leaves `#unconfirmed`, and the confirm timer
   * goes with the last one. */
  #confirmed(transferId: string): void {
    this.#unconfirmed.delete(transferId);
    if (this.#unconfirmed.size === 0) this.#clearConfirm();
  }

  #clearConfirm(): void {
    clearTimeout(this.#confirm ?? undefined);
    this.#confirm = null;
  }

  /** A pull read refused may have run (`mayHaveRun`): fieldd's own TIMEOUT over a request the floor dequeued in its
   * deadline's last instants, or a loop stalled past the deadline with the answer in the socket. Forgotten, it would
   * be a pull the floor runs and nothing here knows: a retry would meet the floor's CONFLICT by digest, its end would
   * surface no adopt candidate (`#onDelta`), and the object would move again. So its row stays as one this side does
   * not track (`#foreign`): its digest is refused here, and what it lands is an adopt candidate, never an answer. It
   * may also never have run, and such a row has no end to hear, so over a standing stream it would pin its digest.
   * So ONE subscribe is owed (`#rowUnconfirmed`): made after this refusal, it enters the floor's one queue behind the
   * pull's request (`#serve`), and its snapshot lists the row or forgets it. One already in flight may have left
   * before the pull, so one more follows it (`#subscribe`). With no stream that subscribe is a plain one. It holds
   * nothing, so its refusal opens no retries. Refused unrun, the row stays unconfirmed (`#unconfirmed`) until a
   * snapshot lists or omits it: a pull it refuses asks again, one delay later over a standing stream
   * (`#confirmLater`), and at the series' next delay with no stream (`#askForForeign`). */
  #askIfRan(own: OwnPull): void {
    this.#leaveForeign(own);
    this.#unconfirmed.add(own.transferId);
    this.#rowUnconfirmed = true;
    this.#follow();
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
   * node gate, a capture, a link that is down) is a moment, asked again at the next node-up or reconnect, and the
   * stream also by the series while a pull is held (`#follow`). */
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
    // the series stops: every accepted pull ends below, and a floor that cannot pull accepts none to hold (`#follow`)
    this.#clearRetry();
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
   *    the lands rule settles it (`#settleUnlisted`). One order of a replay breaks this (`#doSubscribe`'s last point).
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
   * NativeLink's replay at a reconnect (:1105-1128), or a subscribe's own, made while it was held (`#serve`); the
   * held bound, when that snapshot never comes; the floor's idle bound, which ends a pull no byte reaches (W3-4);
   * `failed` NODE_DOWN when the node goes (W3-2); `#noteUnsupported`, when the floor of a new boot cannot pull;
   * `stop`. In either state of `#subscription`, none waits unbounded on this side (W3-21, VF-PM 2026-11-06):
   *  - set: a stream answered on the connection it hears (a reconnect's is let go, `connected`). A held pull ends by
   *    its own bound; any other by the floor's (W3-4), whose end reaches it as a delta, or in the snapshot a lost
   *    one owes, on that stream (`#foreign` cites the floor);
   *  - null (a subscribe refused at `start` or a node-up, or the plain one after a refused re-subscribe,
   *    `#doSubscribe`; and from a reconnect until a subscribe is answered on it, `connected`): nothing carries an
   *    end, so EVERY accepted pull is held, here as it is accepted and by `#holdAll` as the stream goes, and a hold
   *    is released only while a stream stands (`#onSnapshot`). The plain subscribe is retried while any pull is
   *    held (`#follow`), and its snapshot, built after every held pull's answer, judges them all; with none, each
   *    ends FAILED_TIMEOUT at its bound.
   * One silence lies outside those states: while NativeLink is disconnected, `#subscription` stays set and its entry
   * hears nothing (a close or a redial clears the routes, native-link.ts:982-983, :1040-1041), and NativeLink dials
   * at up to 10 s apart for as long as it is open (:992-1000, :1377-1380), past the point where the supervisor stops
   * respawning the floor and waits for the person (native-supervisor.ts:24-27, :873-876). So a dial may never
   * answer, and NativeLink's "reconnecting" (:997) holds every accepted pull (`disconnected`): each ends at its bound
   * if none does. That word comes as the link goes down and again at each failed dial, so a listing read in the
   * close's own poll, which releases a hold while the stream stands (`#onSnapshot`), is held again at the next one.
   * A `redial` says nothing until a dial fails (:1030-1057), so on that path the bound starts at the first failed
   * dial. A dial that answers ends the silence: NativeLink says "connected" once its replay has run, answered, refused
   * or read TIMEOUT (:494-501), and `connected` lets that entry go (a refused replay leaves it with no route,
   * :1112-1126), holds every accepted pull, and subscribes anew. That needs "reconnecting" handed to `disconnected`
   * and "connected" to `connected` (`DriveService`; the daemon's wiring). */
  #accept(own: OwnPull): void {
    this.#fencesSet += 1;
    own.fence = this.#fencesSet;
    setImmediate(() => {
      this.#fencesRun += 1;
    });
    if (this.#subscription !== null) return;
    // no stream can carry its end: it is held at once, and the stream is asked for (W3-21)
    this.#hold(own);
    this.#follow();
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
    // what the pulls these events held are owed: ONE re-subscribe for them all, or with no stream the series; one in
    // flight is followed by the next (`#subscribe`)
    this.#follow();
  }

  /** P5: the snapshot is the truth. A row this fieldd did not mint is a previous fieldd's, and a foreign row it no
   * longer lists ended while the reader lagged. An accepted pull of this fieldd's is judged only by a snapshot built
   * after its answer: one that arrived once its fence had run (`#accept`), or a subscribe's own made while it was
   * held (`serves`). Listed, it runs, and a hold is released, but only while a stream stands: with none (W3-21), a
   * listing the gone stream left queued names no route for the pull's end, and the hold stays for the next fresh
   * snapshot or the bound. Omitted, it ended, and the lands rule settles it. One that arrived before the fence says
   * nothing of a pull it lists, and holds one it omits (`#hold`).
   * An omitted pull whose terminal delta comes later in the same batch (`endsLater`) is left to that delta, which
   * carries its word: the floor forwards after a snapshot an end its table already shows (a stream's subscribe is
   * made before its snapshot is written, field-native `mgmt/file_transfer.rs`'s `subscribe`, "Subscribe BEFORE the
   * snapshot"; an owed `.snapshot` is built while later events wait in the broadcast), and the lands rule would read
   * that end as FAILED_IO. `#doSubscribe` keeps a subscribe's own snapshot in one batch with what its stream's
   * activation delivers. */
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
        if (afterAnswer && this.#subscription !== null) this.#release(own);
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
      if (listed.has(transferId)) {
        // it runs, so its end comes on the stream: an unconfirmed row needs no more asks
        this.#confirmed(transferId);
        continue;
      }
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
   * (`#onSnapshot`'s `endsLater`).
   * W3-21 (VF-PM 2026-11-06) holds EVERY accepted pull the same way while no stream stands (`#accept`, `#holdAll`),
   * as the link goes down (`disconnected`) and at a reconnect (`connected`), with the same bound; a pull held already
   * keeps the bound it has, so none of those restarts it. With no stream the plain subscribe is retried for them
   * (`#follow`). An end the floor sends while no stream stands (a `failed` NODE_DOWN at a teardown, W3-2, or any
   * other word) is lost with its word: the retry's snapshot omits the pull, and the lands rule settles it. A bound
   * that ends a pull with no stream leaves its row with nothing to clear it, so a pull that row refuses asks for the
   * stream (`#askForForeign`). Only a pull this side tracks is held, so a hold never outlives its pull's settle; a
   * new hold has had no subscribe yet (`asked`). */
  #hold(own: OwnPull): void {
    if (own.held !== null || this.#own.get(own.transferId) !== own) return;
    const timer = setTimeout(() => {
      if (this.#own.get(own.transferId) !== own) return;
      this.#leaveForeign(own);
      // the series asks only while a pull is held (`#follow`): the last hold's end clears its timer
      if (!this.#holding()) this.#clearRetry();
      const word = MESH_FILE_TRANSFER.FAILED_TIMEOUT;
      const message = "no snapshot built after the pull's answer came within the bound";
      own.reject(new DrivePullFailed(word, message, own.transferId));
    }, this.#heldBoundMs);
    timer.unref?.();
    own.held = timer;
    own.asked = false;
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

  /** `own` leaves this side's tracking and its row stays as one it does not track: its digest stays held. */
  #leaveForeign(own: OwnPull): void {
    this.#untrack(own);
    this.#foreign.set(own.transferId, own.digest);
    this.#running.set(own.digest, own.transferId);
  }

  #forgetForeign(transferId: string): void {
    const digest = this.#foreign.get(transferId);
    if (digest === undefined) return;
    this.#foreign.delete(transferId);
    if (this.#running.get(digest) === transferId) this.#running.delete(digest);
    this.#confirmed(transferId);
  }

  #dropped(what: "snapshot" | "delta", count: number): void {
    this.#log.warn("fieldd.drive.pull_event_dropped", "A file-transfer event broke its contract", {
      what,
      issues: count,
    });
  }
}
