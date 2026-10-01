// DS-5d test fixture — the SyncedStore `field.docs.v1` as DocHoldersService
// sees it, in memory: every member writes its OWN slice; a subscriber gets a
// snapshot, then deltas; a member that leaves the mesh has its slice REMOVED
// (`peerRemoved`) — truffle's store does exactly that when the transport
// drops a peer, which is why the holders ledger has to remember what a slice
// said after the slice is gone.
import type { HoldersMesh } from "../src/library-doc";

type Handler = (payload: unknown, kind: "snapshot" | "delta") => void;

export class FakeHoldersStore {
  /** deviceId → the slice it last published (present members only). */
  readonly slices = new Map<string, unknown>();
  readonly #handlers = new Map<string, Handler>();

  /** One member's view: it writes its own slice and hears everyone's. */
  member(deviceId: string): HoldersMesh {
    return {
      setSlice: async (_storeId: string, data: unknown) => {
        this.slices.set(deviceId, data);
        this.#emit({ kind: "peerUpdated", deviceId, data });
        return undefined;
      },
      subscribeStoreManaged: async (_storeId: string, onEvent: Handler) => {
        this.#handlers.set(deviceId, onEvent);
        const slices = Object.fromEntries([...this.slices].map(([id, data]) => [id, { data }]));
        return { snapshot: { slices }, dispose: () => this.#handlers.delete(deviceId) };
      },
    };
  }

  /** The member drops off the mesh: its slice goes, and everyone hears it. */
  leave(deviceId: string): void {
    this.slices.delete(deviceId);
    this.#handlers.delete(deviceId);
    this.#emit({ kind: "peerRemoved", deviceId });
  }

  #emit(payload: unknown): void {
    for (const handler of [...this.#handlers.values()]) handler(payload, "delta");
  }
}
