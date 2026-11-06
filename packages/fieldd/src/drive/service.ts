import { DRIVE_SERVICE, DriveUnavailableDetails, RPC_ERROR_CODES } from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { DriveHolders } from "./holders";
import type { DriveLaneRelay } from "./lane-relay";
import {
  type DriveAdoptCandidate,
  type DriveLanded,
  type DrivePullRequest,
  type DrivePulls,
  isFileTransferUnsupported,
} from "./pulls";

// DR-3b (W3, VF-RELAY) — the drive's transport port: the lane relay, the pulls and the holders slice composed into
// ONE VibeField-shaped port, which the files worker's adapter binds mille-drive's transport to at DR-2. No mille type
// rides it, `import type` included (R24, scripts/check-import-boundaries.mjs's R24 row).
//
// Every UNAVAILABLE it answers is DRIVE_SERVICE's (DR-L8), its details `DriveUnavailableDetails`:
//  - a floor that cannot pull by a named root is STATE_UNBUILT, retryable false (W3's rider D: truffle T-3 is not
//    adopted, and nothing a retry changes until VibeField moves);
//  - any other UNAVAILABLE on the way (the node gate, the mgmt link, a lane that will not open) is STATE_MESH_DOWN,
//    retryable true: what this desktop holds still serves here, and nothing moves between desktops.
// Every other refusal (CONFLICT, RESOURCE_EXHAUSTED, PRECONDITION_FAILED, a pull's FAILED_* word) passes as it came:
// mapping a failed pull to the drive's own error codes is the worker adapter's (DR-2).
//
// Nothing constructs it: the daemon's wiring is the integration lane's, after EL8-TRUFFLE (w3-plan.md §5.8).

/** The drive's transport, VibeField-shaped. */
export interface DriveTransportPort {
  /** One opaque record to a peer's drive: `true` once on the byte plane, `false` when dropped. */
  send(peer: string, record: Uint8Array): Promise<boolean>;
  /** Every record a peer sent, in its order. Returns a detach. */
  onFrame(listener: (peer: string, record: Uint8Array) => void): () => void;
  /** A peer's drive lane up, or down. Returns a detach. */
  onPeer(listener: (peer: string, up: boolean) => void): () => void;
  /** Pull one object from a peer's served root; resolves with where it landed, unverified. */
  pull(request: DrivePullRequest): Promise<DriveLanded>;
  /** A landed file a previous fieldd's pull left, to adopt or sweep. Returns a detach. */
  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void;
}

export interface DriveServiceOptions {
  relay: DriveLaneRelay;
  pulls: DrivePulls;
  holders: DriveHolders;
}

/** The drive's refusal for what a part answered: DRIVE_SERVICE's UNAVAILABLE, or the error as it came. */
export function driveRefusal(error: unknown): unknown {
  if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") return error;
  if (isFileTransferUnsupported(error)) {
    return unavailable(DRIVE_SERVICE.STATE_UNBUILT, false, "this floor cannot move objects yet");
  }
  return unavailable(DRIVE_SERVICE.STATE_MESH_DOWN, true, error.message);
}

function unavailable(state: string, retryable: boolean, message: string): RpcCallError {
  const details = DriveUnavailableDetails.parse({ service: DRIVE_SERVICE.SERVICE, state });
  return new RpcCallError("UNAVAILABLE", message, retryable, details, RPC_ERROR_CODES.UNAVAILABLE);
}

export class DriveService implements DriveTransportPort {
  readonly #relay: DriveLaneRelay;
  readonly #pulls: DrivePulls;
  readonly #holders: DriveHolders;

  constructor(opts: DriveServiceOptions) {
    this.#relay = opts.relay;
    this.#pulls = opts.pulls;
    this.#holders = opts.holders;
  }

  /** Claim the drive's lanes, arm the pulls' stream and roots, hear and publish the holders slice. Only the lane
   * table's subscribe can throw (doc-sync's start does the same); the other two degrade honestly. */
  async start(): Promise<void> {
    await this.#relay.start();
    await this.#pulls.start();
    await this.#holders.start();
  }

  /** The node came up (MeshClient's "node-up"). */
  async nodeUp(): Promise<void> {
    await this.#pulls.nodeUp();
    await this.#holders.nodeUp();
  }

  /** The mgmt link reconnected (NativeLink's "connected"). */
  async connected(): Promise<void> {
    await this.#pulls.connected();
    await this.#holders.nodeUp();
  }

  /** The drive opened, closed, or moved what it holds: publish the slice soon and declare the roots again. */
  async driveChanged(): Promise<void> {
    this.#holders.schedule();
    await this.#pulls.declareRoots();
  }

  async send(peer: string, record: Uint8Array): Promise<boolean> {
    try {
      return await this.#relay.send(peer, record);
    } catch (error) {
      throw driveRefusal(error);
    }
  }

  onFrame(listener: (peer: string, record: Uint8Array) => void): () => void {
    return this.#relay.onFrame(listener);
  }

  onPeer(listener: (peer: string, up: boolean) => void): () => void {
    return this.#relay.onPeer(listener);
  }

  async pull(request: DrivePullRequest): Promise<DriveLanded> {
    try {
      return await this.#pulls.pull(request);
    } catch (error) {
      throw driveRefusal(error);
    }
  }

  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void {
    return this.#pulls.onAdoptCandidate(listener);
  }

  async stop(): Promise<void> {
    this.#pulls.stop();
    this.#holders.stop();
    await this.#relay.dispose();
  }
}
