import { EventEmitter } from "node:events";
import type { NativeLink } from "./native-link";
import { RpcCallError } from "./native-link";

// MeshClient (design-02 §3.4, C2): fieldd's face of the mesh facade.
// The serve set is DECLARATIVE and owned here — "re-serving is re-creating":
// on every (re)connect to field-native, the desired set is reconciled against
// the node's list (add missing, remove strays we once declared). Store and
// peer calls are thin passthroughs over the mgmt channel; UNAVAILABLE (mesh
// disabled / not yet authed) is a normal answer, surfaced not retried.

export interface ServeSpec {
  name: string;
  target: { kind: "port"; port: number } | { kind: "dir"; path: string };
  allow?: string[];
}

export interface ServeState extends ServeSpec {
  url?: string;
  /** last reconcile outcome for this entry */
  status: "active" | "pending" | "error";
  error?: string;
}

export class MeshClient extends EventEmitter {
  private desired = new Map<string, ServeSpec>();
  private states = new Map<string, ServeState>();
  /** reconciles SERIALIZE (never skip): a caller's pass always starts after
   * its own desired-set mutation — a skip-guard here silently no-ops. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly link: NativeLink) {
    super();
    link.on("connected", () => {
      void this.reconcile(); // fresh native boot may have an empty node — replay
    });
  }

  /** Replace the desired serve set and reconcile now. */
  async setServes(specs: ServeSpec[]): Promise<ServeState[]> {
    this.desired = new Map(specs.map((s) => [s.name, s]));
    await this.reconcile();
    return this.serves();
  }

  serves(): ServeState[] {
    return [...this.states.values()];
  }

  reconcile(): Promise<void> {
    const run = this.chain.then(() => this.doReconcile());
    this.chain = run.catch(() => {});
    return run;
  }

  private async doReconcile(): Promise<void> {
    try {
      const listed = (await this.link.request("native.mesh.serve.list", {})) as {
        serves: Array<{ name: string; url?: string }>;
      };
      const live = new Map(listed.serves.map((s) => [s.name, s]));

      for (const [name, spec] of this.desired) {
        const existing = live.get(name);
        if (existing) {
          this.states.set(name, {
            ...spec,
            status: "active",
            ...(existing.url ? { url: existing.url } : {}),
          });
          continue;
        }
        try {
          const added = (await this.link.request("native.mesh.serve.add", spec)) as {
            url?: string;
          };
          this.states.set(name, {
            ...spec,
            status: "active",
            ...(added.url ? { url: added.url } : {}),
          });
        } catch (e) {
          this.states.set(name, {
            ...spec,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      // strays: live entries we once declared but no longer desire
      for (const [name] of live) {
        if (!this.desired.has(name) && this.states.has(name)) {
          try {
            await this.link.request("native.mesh.serve.remove", { name });
          } catch {
            /* next reconcile retries */
          }
          this.states.delete(name);
        }
      }
      this.emit("reconciled", this.serves());
    } catch (e) {
      // mesh not up (disabled/auth pending) — mark everything pending, not failed
      if (e instanceof RpcCallError && e.kind === "UNAVAILABLE") {
        for (const [name, spec] of this.desired) {
          const prev = this.states.get(name);
          if (prev?.status !== "active") this.states.set(name, { ...spec, status: "pending" });
        }
        this.emit("unavailable", e.details);
      } else {
        throw e;
      }
    }
  }

  // ---- thin passthroughs ----

  async peers(): Promise<unknown[]> {
    const r = (await this.link.request("native.mesh.peers.list", {})) as { peers: unknown[] };
    return r.peers;
  }

  async subscribePeers(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<unknown> {
    const { snapshot } = await this.link.subscribe("native.mesh.peers.subscribe", {}, onEvent);
    return snapshot;
  }

  async openStore(storeId: string): Promise<unknown> {
    return await this.link.request("native.mesh.store.open", { storeId });
  }

  async setSlice(storeId: string, data: unknown): Promise<unknown> {
    return await this.link.request("native.mesh.store.set", { storeId, data });
  }

  async getSlice(storeId: string, deviceId?: string): Promise<unknown> {
    return await this.link.request("native.mesh.store.get", {
      storeId,
      ...(deviceId ? { deviceId } : {}),
    });
  }

  async subscribeStore(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<unknown> {
    const { snapshot } = await this.link.subscribe(
      "native.mesh.store.subscribe",
      { storeId },
      onEvent,
    );
    return snapshot;
  }
}
