import {
  DRIVE_PROTOCOL,
  type DriveHolderState,
  DriveHoldersSlice,
  STORES,
  StoreSnapshot,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// DR-3b (W3, VF-RELAY) — `field.drive.v1`, this desktop's holders slice (contracts drive.ts `DriveHoldersSlice`):
// DocHoldersService's shape (library-doc.ts:382-559) for the drive. DEVICE-OWNED (DS-L2): this desktop writes its own
// slice under its mesh deviceId and holds every other desktop's as the store last said it.
//
// The slice is DISCOVERY (drive.ts): a desktop dials a `drive` lane only to a peer whose slice names a protocol it
// speaks, so it is published per the contract, while the drive is OPEN, whatever the floor's file transfer can do
// (the W3 critic's finding 2, VF-PM's W3-9). A floor that cannot pull by a named root says so at the pull
// (MESH_FILE_TRANSFER.STATE_UNSUPPORTED, read as DRIVE_SERVICE.STATE_UNBUILT), never by this slice's absence. The
// integration lane that wires the drive comes after EL8-TRUFFLE (w3-plan.md §5.8), so no released build publishes a
// slice from a floor that cannot serve.
//
// A closed drive publishes no slice (drive.ts `DriveHolderState`: "publishes no slice at all"). The store has no verb
// that withdraws one (`native.mesh.store.*` is open, get, set, subscribe), so a drive that closes after it published
// writes ONE null slice: the floor's `store.set` asks only that `data` be present (field-native `mgmt/mesh.rs`'s
// `store.set` arm, `store_data_allowed`), and every reader of STORES.DRIVE holds nothing for a slice that does not
// parse (`#adopt` below). UNVERIFIED that a null slice is DS-L2's own word for "none": an ask for VF-PM's records.
//
// Nothing is published or withdrawn while the node is not linked (`linked`): a capture has no account to scope a
// slice to, and the floor refuses `store.set` in one (MESH_CAPTURING, the belt; this is the suspenders).

/** The mesh store, narrowed to the two calls the slice makes: MeshClient's `setSlice` and `subscribeStoreManaged`
 * (mesh-client.ts:492, :515), as `HoldersMesh` narrows them for the docs slice (library-doc.ts:337-343). */
export interface DriveHoldersMesh {
  setSlice(storeId: string, data: unknown): Promise<unknown>;
  subscribeStoreManaged(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

/** The drive as this desktop holds it, while it is open: what its slice says. Mapping mille-drive's status to it is
 * DR-2's. */
export interface DriveHolding {
  state: DriveHolderState;
  held: { objects: number; bytes: number };
}

export interface DriveHoldersOptions {
  mesh: DriveHoldersMesh;
  /** This desktop's mesh deviceId (D30): the store's own owner key. */
  deviceId: () => string;
  /** The drive now, or `null` while it is not open: then nothing is published, and a slice published before is
   * withdrawn. */
  drive: () => DriveHolding | null;
  /** Whether this desktop's node is linked: neither unlinked nor capturing a login. The slice is written only then,
   * as the daemon declares no serve without an account (daemon.ts `productServeSpec`). */
  linked: () => boolean;
  logger?: Logger;
  /** Coalesce a burst of changes into one publish (default 1 s). */
  debounceMs?: number;
  /** The clock `publishedAt` reads (tests move it). */
  now?: () => number;
}

export class DriveHolders {
  readonly #opts: DriveHoldersOptions;
  readonly #log: Logger;
  /** deviceId → that desktop's slice, as the store last said it */
  readonly #slices = new Map<string, DriveHoldersSlice>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dispose: (() => void) | null = null;
  #subscribing: Promise<void> | null = null;
  /** a slice of this desktop's may be in the store: the next close withdraws it. Marked as a publish leaves, because
   * a close during its flight must withdraw it, and one read as refused may have run at the floor all the same; a
   * close after a publish that never ran writes one null slice, which every reader holds as nothing (`#adopt`). */
  #published = false;
  #stopped = false;

  constructor(opts: DriveHoldersOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "drive.holders" });
  }

  /** Hear the store, then publish. Never throws: a store the node cannot serve yet (no node up) is heard again at
   * `nodeUp`, a publish that fails goes again on the next change, and a slice outside its contract is logged and not
   * written (`publish`). */
  async start(): Promise<void> {
    await this.#subscribe();
    await this.publish();
  }

  /** The node came up, or the link came back: hear the store anew, and publish again (a node built anew holds no
   * slice of this desktop's). A stream that stands proves nothing here. A node built anew leaves it on the old store,
   * whose forwarder keeps that store (field-native `mgmt/mesh.rs`, `spawn_store_forwarder`). A floor that restarted
   * has no node, so NativeLink's replay meets the node gate and its entry stays with no route, which this side is not
   * told (native-link.ts `replaySubscriptions`). So ONE subscribe is made, as `DrivePulls.connected` does, once a
   * subscribe in flight has ended: it may have left before this node. The stream that stood is let go (its `dispose`,
   * which tells the floor nothing) only once that one is answered (`#doSubscribe`), so a subscribe refused here leaves
   * the store heard as it was, the live store when the node was not built anew, and the next node-up or reconnect
   * asks again. The cost: a stream let go keeps its forwarder writing to the connection until it closes, every change
   * of the drive store it opened (the old store, when the node was built anew), and fieldd drops those lines; so does
   * a subscribe the floor ran that read TIMEOUT here, the replay included, because no route is made for an answer read
   * late. `native.mesh.store.subscribe` adds a forwarder per call it runs, so beyond the one fieldd routes, one stays
   * per other subscribe the floor ran on this connection. */
  async nodeUp(): Promise<void> {
    await this.#subscribing;
    await this.#subscribe(true);
    await this.publish();
  }

  /** Publish soon: changes arrive in bursts. */
  schedule(): void {
    if (this.#stopped || this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.publish().catch(() => undefined);
    }, this.#opts.debounceMs ?? 1_000);
    this.#timer.unref?.();
  }

  /** This desktop's slice, now, into STORES.DRIVE; while the drive is closed, nothing, or the one withdrawal of a
   * slice a publish may have written (`#published`). Never throws: a slice outside its contract (an empty deviceId
   * before the mesh identity is known, a count that is no integer) is logged and not written. */
  async publish(): Promise<void> {
    if (this.#stopped || !this.#opts.linked()) return;
    const drive = this.#opts.drive();
    if (drive === null) {
      await this.#withdraw();
      return;
    }
    const slice = DriveHoldersSlice.safeParse({
      deviceId: this.#opts.deviceId(),
      protocol: DRIVE_PROTOCOL,
      state: drive.state,
      held: { objects: drive.held.objects, bytes: drive.held.bytes },
      publishedAt: (this.#opts.now ?? Date.now)(),
    });
    if (!slice.success) {
      this.#log.warn("fieldd.drive.holders_slice_invalid", "The drive's slice broke its contract", {
        issues: slice.error.issues.length,
      });
      return;
    }
    this.#published = true;
    try {
      await this.#opts.mesh.setSlice(STORES.DRIVE, slice.data);
    } catch (error) {
      // the mesh is down: the slice is a fact about now, and the next change publishes it again
      this.#log.info("fieldd.drive.holders_unpublished", "The drive's slice was not published", {
        error: String(error),
      });
    }
  }

  /** Every OTHER desktop whose slice names DRIVE_PROTOCOL: the peers a `drive` lane may be dialled to. */
  holders(): DriveHoldersSlice[] {
    const self = this.#opts.deviceId();
    const out: DriveHoldersSlice[] = [];
    for (const slice of this.#slices.values()) {
      if (slice.deviceId !== self && slice.protocol === DRIVE_PROTOCOL) out.push(slice);
    }
    return out.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#dispose?.();
    this.#dispose = null;
    this.#slices.clear();
  }

  /** The drive closed after it published: ONE null slice, so no reader holds it (the header). A withdrawal that fails
   * goes again on the next change. The mark falls as it leaves, so a publish made during its flight keeps its own. */
  async #withdraw(): Promise<void> {
    if (!this.#published) return;
    this.#published = false;
    try {
      await this.#opts.mesh.setSlice(STORES.DRIVE, null);
    } catch (error) {
      this.#published = true;
      this.#log.info("fieldd.drive.holders_unwithdrawn", "The drive's slice was not withdrawn", {
        error: String(error),
      });
    }
  }

  /** One subscribe at a time, shared by a caller while it is in flight. While a stream stands, only a renewal makes
   * one (`nodeUp`), so a flight is always a subscribe made. */
  #subscribe(renew = false): Promise<void> {
    if (this.#stopped || (this.#dispose !== null && !renew)) return Promise.resolve();
    if (this.#subscribing === null) {
      this.#subscribing = this.#doSubscribe().finally(() => {
        this.#subscribing = null;
      });
    }
    return this.#subscribing;
  }

  /** Answered, the new stream replaces the one that stood, which is let go only then; refused, that one stays and
   * still hears. Stopped during the flight, the answer is let go, as `stop` let the one that stood go. */
  async #doSubscribe(): Promise<void> {
    let subscribed: { snapshot: unknown; dispose: () => void };
    try {
      subscribed = await this.#opts.mesh.subscribeStoreManaged(STORES.DRIVE, (payload, kind) =>
        this.#onStoreEvent(payload, kind),
      );
    } catch (error) {
      this.#log.info("fieldd.drive.holders_unheard", "The drive's holders store was not heard", {
        error: String(error),
      });
      return;
    }
    if (this.#stopped) {
      subscribed.dispose();
      return;
    }
    this.#dispose?.();
    this.#dispose = subscribed.dispose;
    this.#onStoreEvent(subscribed.snapshot, "snapshot");
  }

  /** A snapshot REPLACES what was heard; a delta merges one desktop's slice (`peerUpdated`, `localChanged`) or drops
   * it (`peerRemoved`). The store's snapshot is held to `StoreSnapshot`; one outside it is dropped. */
  #onStoreEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (this.#stopped) return;
    if (kind === "snapshot") {
      const snapshot = StoreSnapshot.safeParse(payload);
      if (!snapshot.success) {
        this.#log.warn("fieldd.drive.holders_snapshot_dropped", "A holders snapshot was dropped", {
          issues: snapshot.error.issues.length,
        });
        return;
      }
      this.#slices.clear();
      for (const [deviceId, wrapped] of Object.entries(snapshot.data.slices)) {
        this.#adopt(deviceId, (wrapped as { data?: unknown } | null)?.data);
      }
      return;
    }
    const delta = payload as { kind?: unknown; deviceId?: unknown; data?: unknown } | undefined;
    const deviceId = delta?.deviceId;
    if (typeof deviceId !== "string") return;
    if (delta?.kind === "peerRemoved") this.#slices.delete(deviceId);
    else this.#adopt(deviceId, delta?.data);
  }

  /** Tolerant reader: a slice that does not parse, or names another desktop than its key, holds nothing. */
  #adopt(deviceId: string, data: unknown): void {
    const parsed = DriveHoldersSlice.safeParse(data);
    if (!parsed.success || parsed.data.deviceId !== deviceId) {
      this.#slices.delete(deviceId);
      return;
    }
    this.#slices.set(deviceId, parsed.data);
  }
}
