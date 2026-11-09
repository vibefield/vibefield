import {
  DRIVE_SERVICE,
  DriveUnavailableDetails,
  MeshNotUpDetails,
  RPC_ERROR_CODES,
} from "@vibefield/contracts";
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
// The two UNAVAILABLEs that ARE the drive's states are answered in DRIVE_SERVICE's words (DR-L8), their details
// `DriveUnavailableDetails`:
//  - a floor that cannot pull by a named root is STATE_UNBUILT, retryable false (W3's rider D: truffle T-3 is
//    adopted at the `=0.7.27` pin, but the floor pulls by it only from the substrate slice on, and nothing a retry
//    changes until VibeField moves. *Corrected 2026-11-08 (EL8-TRUFFLE, truffle 0.7.27): it said "truffle T-3 is
//    not adopted".*);
//  - the mesh facade's node gate (`MeshNotUpDetails`, a pull's or a lane's) is STATE_MESH_DOWN, its retryable flag
//    the floor's: what this desktop holds still serves here, and nothing moves between desktops. egress.ts:291-292
//    reads the node gate the same way.
// Any other UNAVAILABLE names its own `{service, state}` and passes as it came: a floor that is not answering
// (native-link.ts `refuseAtTheDoor`) or a link that closed is not a node that is down, and DRIVE_SERVICE has no word
// for either. So does every other refusal (CONFLICT, RESOURCE_EXHAUSTED, PRECONDITION_FAILED, a pull's FAILED_*
// word): mapping a failed pull to the drive's own error codes is the worker adapter's (DR-2).
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
  /** A landed file no pull of this fieldd's waits for, to adopt or sweep: a previous fieldd's pull's, or one of this
   * fieldd's whose held bound ended, or one it read refused that may have run. Returns a detach. */
  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void;
}

export interface DriveServiceOptions {
  relay: DriveLaneRelay;
  pulls: DrivePulls;
  holders: DriveHolders;
}

/** The node gate's service: `MeshNotUpDetails.service` is "always mesh-gateway" (mgmt.ts), a word no registry holds;
 * egress.ts:292 reads the same literal. */
const NODE_GATE_SERVICE = "mesh-gateway";

/** Whether a refusal is the mesh facade's node gate: no node is up (field-native `mgmt/mesh.rs` `unavailable`). */
function isNodeGate(error: RpcCallError): boolean {
  const details = MeshNotUpDetails.safeParse(error.details);
  return details.success && details.data.service === NODE_GATE_SERVICE;
}

/** The drive's refusal for what a part answered: DRIVE_SERVICE's UNAVAILABLE, or the error as it came. */
export function driveRefusal(error: unknown): unknown {
  if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") return error;
  if (isFileTransferUnsupported(error)) {
    return unavailable(DRIVE_SERVICE.STATE_UNBUILT, false, "this floor cannot move objects yet");
  }
  if (isNodeGate(error)) {
    return unavailable(DRIVE_SERVICE.STATE_MESH_DOWN, error.retryable, error.message);
  }
  return error;
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
   * table's subscribe can throw (doc-sync's start does the same), and then nothing after it runs: the next node-up
   * or `connected` arms all three. The pulls and the holders log what they could not do and never throw (pulls.ts
   * `start`, holders.ts `start`). */
  async start(): Promise<void> {
    await this.#relay.start();
    await this.#pulls.start();
    await this.#holders.start();
  }

  /** The node came up (MeshClient's "node-up"). The holders follow the pulls' subscribe and roots, each a request
   * NativeLink ends by its deadline (NATIVE_SUPERVISION.REQUEST_DEADLINE_MS). The lane table is asked beside them,
   * neither behind nor ahead (`connected`'s reason), once its own subscribes in flight have ended, and only while no
   * lane-table stream stands (a `start` refused, or not yet run) or a reconnect's re-subscribe was refused: it is not
   * the node's (lane-relay.ts `nodeUp`). None of the three throws. */
  async nodeUp(): Promise<void> {
    const pullsThenHolders = this.#pulls.nodeUp().then(() => this.#holders.nodeUp());
    await Promise.all([this.#relay.nodeUp(), pullsThenHolders]);
  }

  /** The mgmt link reconnected (NativeLink's "connected"): each part asks the floor again for what it hears. The
   * three share nothing, so none waits behind another: a lane table or a slice held up by the pulls' subscribe is a
   * lane unclaimed or a list stale for no reason. Each part's own wait is its requests, every one ended by NativeLink's
   * deadline (NATIVE_SUPERVISION.REQUEST_DEADLINE_MS), and none of the three throws. */
  async connected(): Promise<void> {
    await Promise.all([this.#relay.connected(), this.#pulls.connected(), this.#holders.nodeUp()]);
  }

  /** The mgmt link went down (NativeLink's "reconnecting"): nothing carries a pull's end now, so the held bound runs
   * through the outage, however long it lasts (pulls.ts `disconnected`). */
  disconnected(): void {
    this.#pulls.disconnected();
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
