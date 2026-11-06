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
//    the folder, failed FAILED_IO otherwise (mgmt.ts `NativeFileTransferSnapshot`). Only names matching that rule are
//    read; a `*.truffle-tmp` beside them is the floor's.
//  - `file-transfer-unsupported` is a fact of the floor's boot (mgmt.ts `MESH_FILE_TRANSFER`): cached for that boot,
//    asked again at a reconnect, as `FloorEgress` keeps `egress-unsupported` (egress.ts:143-158).
//
// Every payload from the floor is held to its contract (`safeParse`); one outside it is dropped and logged.

/** The floor's two verbs, as NativeLink answers them (native-link.ts:1159 `request`, :1274 `subscribe`). */
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
  logger?: Logger;
}

/** A pull this fieldd minted. */
interface OwnPull {
  readonly transferId: string;
  readonly digest: string;
  /** the floor answered it: from here a snapshot that does not list it says it ended */
  accepted: boolean;
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
  return { transferId, digest, accepted: false, landed, resolve, reject };
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

export class DrivePulls {
  readonly #opts: DrivePullsOptions;
  readonly #log: Logger;
  /** where a pull lands: FILE_TRANSFER_ROOTS.DRIVE_OBJECTS' `lands` row under the user root */
  readonly #landsDir: string;
  readonly #exists: (path: string) => Promise<boolean>;
  readonly #mintId: () => string;
  /** transferId → a pull this fieldd minted */
  readonly #own = new Map<string, OwnPull>();
  /** transferId → digest: a running row this fieldd did not mint (a previous fieldd's) */
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
  /** Stream events in arrival order, applied in a later macrotask. A pull's answer and a snapshot can arrive in one
   * read, and the answer's continuation (which marks the pull accepted) is a microtask the snapshot would otherwise
   * overtake: the pull, not yet accepted, would be skipped, and one that ended while the reader lagged would wait for
   * the next snapshot. Applied after it, the snapshot judges the pull by the lands rule. */
  #events: Array<{ payload: unknown; kind: "snapshot" | "delta" }> = [];
  #drain: ReturnType<typeof setImmediate> | null = null;
  readonly #adoptListeners = new Set<(candidate: DriveAdoptCandidate) => void>();
  /** Candidates no listener has taken yet. Bounded by the floor: only a previous fieldd's pulls become candidates,
   * and the floor runs at most DRIVE_LIMITS.PULLS_IN_FLIGHT at once. */
  readonly #unclaimed: DriveAdoptCandidate[] = [];
  #stopped = false;

  constructor(opts: DrivePullsOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "drive.pulls" });
    this.#landsDir = join(opts.userRoot, ...LAYOUT[FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.lands]);
    this.#exists = opts.exists ?? landedExists;
    this.#mintId = opts.mintId ?? (() => ulid());
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
      // retryable true is this side's choice: C1 names no flag for RESOURCE_EXHAUSTED, and the floor's arm that
      // answers it (W3's stack B, C6) is not built. UNVERIFIED parity with C6, an ask for VF-PM.
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
    own.accepted = true;
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
   * it lands; its caller here is told so. */
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

  async #arm(): Promise<void> {
    if (this.#stopped) return;
    await this.#subscribe();
    await this.declareRoots();
  }

  #subscribe(): Promise<void> {
    if (this.#subscribing === null) {
      this.#subscribing = this.#doSubscribe().finally(() => {
        this.#subscribing = null;
      });
    }
    return this.#subscribing;
  }

  async #doSubscribe(): Promise<void> {
    if (this.#stopped || this.#subscription !== null || this.unsupported()) return;
    const method = "native.mesh.fileTransfer.subscribe";
    let subscribed: { snapshot: unknown; dispose: () => void };
    try {
      subscribed = await this.#opts.floor.subscribe(method, {}, (payload, kind) =>
        this.#onEvent(payload, kind),
      );
    } catch (error) {
      this.#refused(method, error);
      return;
    }
    if (this.#stopped) {
      subscribed.dispose();
      return;
    }
    this.#subscription = { dispose: subscribed.dispose };
    this.#onEvent(subscribed.snapshot, "snapshot");
    // after the drain this snapshot scheduled, so `start` resolves with it applied
    await new Promise<void>((resolve) => setImmediate(resolve));
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
      if (!own.accepted) continue;
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

  #onEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (this.#stopped) return;
    this.#events.push({ payload, kind });
    if (this.#drain === null) this.#drain = setImmediate(() => this.#applyEvents());
  }

  #applyEvents(): void {
    this.#drain = null;
    for (const event of this.#events.splice(0)) {
      if (this.#stopped) return;
      if (event.kind === "snapshot") this.#onSnapshot(event.payload);
      else this.#onDelta(event.payload);
    }
  }

  /** P5: the snapshot is the truth. A row this fieldd did not mint is a previous fieldd's; an accepted pull of this
   * fieldd's, or a foreign one, that it no longer lists ended while the reader lagged. */
  #onSnapshot(payload: unknown): void {
    const snapshot = NativeFileTransferSnapshot.safeParse(payload);
    if (!snapshot.success) {
      this.#dropped("snapshot", issues(snapshot.error));
      return;
    }
    const listed = new Map<string, string>();
    for (const row of snapshot.data.transfers) listed.set(row.transferId, row.digest);
    for (const own of [...this.#own.values()]) {
      if (!own.accepted || listed.has(own.transferId)) continue;
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

  #untrack(own: OwnPull): void {
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
