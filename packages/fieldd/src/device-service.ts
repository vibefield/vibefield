import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  type DeviceInfo,
  DeviceSlice,
  PeerInfo,
  type ProductEndpoint,
  STORES,
} from "@vibefield/contracts";
import type { MeshClient } from "./mesh-client";

// DeviceService (design-04 §3.1, D31 — C4 P1-lite): the device directory.
// Roster = self-slice ⋈ store peer-slices ⋈ tailnet peer liveness; presence
// heartbeats defer with the spec's own verify-item. The slice publishes on
// boot and on change (the serve's capability URL appearing/moving) through the
// C2 store facade; with the mesh down everything degrades honestly — a
// persisted local device-id keeps identity stable for solo operation (recorded
// deviation from D30's mesh-identity law: solo fields still need an id), the
// roster is self-only, and the slice stays unpublished until the mesh returns.

export interface DeviceServiceOptions {
  dataDir: string;
  mesh: MeshClient;
  bootId: string;
  fielddVersion: string;
  contractsVersion: string;
  /** Supplied by the daemon (it owns the serve secret + fused serve state):
   * the current product endpoint; `url` only while the serve is active. */
  productEndpoint: () => ProductEndpoint;
  now?: () => number;
}

interface PeerLiveness {
  online: boolean;
  lastSeen?: number;
}

export class DeviceService extends EventEmitter {
  private readonly now: () => number;
  /** the mesh identity once known (D30); the persisted local id until then */
  private deviceId: string;
  private meshIdentity = false;
  private slices = new Map<string, DeviceSlice>();
  private peerLiveness = new Map<string, PeerLiveness>();
  private storeSubscribed = false;
  private lastRosterSig = "";
  /** syncs SERIALIZE (the MeshClient chain law): each pass sees its trigger's state */
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly opts: DeviceServiceOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.deviceId = this.loadLocalId();
    // Re-sync on every mesh event that can change identity, reachability, or
    // the capability URL. "reconciled" also fires after every link reconnect.
    opts.mesh.on("reconciled", () => void this.sync());
    opts.mesh.on("serves-changed", () => void this.sync());
    opts.mesh.on("unavailable", () => this.emitRoster());
  }

  /** Idempotent, serialized: resolve identity → subscribe the store → refresh
   * peers → publish the self-slice. Mesh-down is a normal outcome, not an error. */
  sync(): Promise<void> {
    const run = this.chain.then(() => this.doSync());
    this.chain = run.catch(() => {});
    return run;
  }

  list(): DeviceInfo[] {
    return this.roster();
  }

  get(deviceId: string): DeviceInfo | undefined {
    return this.roster().find((d) => d.deviceId === deviceId);
  }

  dispose(): void {
    this.disposed = true;
    this.removeAllListeners();
  }

  // ---- internals ----

  private async doSync(): Promise<void> {
    if (this.disposed) return;
    try {
      // Identity first (D30): the store's own device id IS the mesh identity.
      const self = (await this.opts.mesh.getSlice(STORES.DEVICES)) as { deviceId?: unknown };
      if (typeof self.deviceId === "string" && self.deviceId.length > 0) {
        this.deviceId = self.deviceId;
        this.meshIdentity = true;
      }
      if (!this.storeSubscribed) {
        const snapshot = await this.opts.mesh.subscribeStore(STORES.DEVICES, (payload, kind) =>
          this.onStoreEvent(payload, kind),
        );
        this.storeSubscribed = true; // NativeLink replays across reconnects (P5)
        this.applyStoreSnapshot(snapshot);
      }
      await this.refreshPeers();
      await this.publish();
    } catch {
      // mesh down (disabled / auth pending / node building) — self-only roster,
      // local identity, unpublished slice; the next mesh event retries.
    }
    this.emitRoster();
  }

  /** The self-slice, published into `field.devices.v1` (D31 field set). */
  private async publish(): Promise<void> {
    const slice = this.selfSlice();
    await this.opts.mesh.setSlice(STORES.DEVICES, slice);
    this.slices.set(slice.deviceId, slice);
  }

  private selfSlice(): DeviceSlice {
    return {
      deviceId: this.deviceId,
      name: hostname(), // user-set display name deferred (D30: hostname fallback)
      platform: process.platform,
      headless: false, // the shell is the only launcher today
      fielddVersion: this.opts.fielddVersion,
      contractsVersion: this.opts.contractsVersion,
      // honest capabilities (D31): no TerminalService yet, DocumentService is B3-real
      capabilities: { terminalHost: false, docHost: true, push: false },
      productEndpoint: this.opts.productEndpoint(),
      bootId: this.opts.bootId,
      publishedAt: this.now(),
    };
  }

  private async refreshPeers(): Promise<void> {
    const raw = await this.opts.mesh.peers();
    this.peerLiveness.clear();
    for (const p of raw) {
      const parsed = PeerInfo.safeParse(p);
      if (!parsed.success) continue; // tolerant: a malformed peer never breaks the roster
      const lastSeen = (parsed.data as { lastSeen?: unknown }).lastSeen;
      this.peerLiveness.set(parsed.data.id, {
        online: parsed.data.online,
        ...(typeof lastSeen === "number" ? { lastSeen } : {}),
      });
    }
  }

  /** Store stream: snapshots replace the slice map wholesale (P5); deltas merge
   * by device. Every slice runs the tolerant gate — malformed slices drop. */
  private onStoreEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") {
      this.applyStoreSnapshot(payload);
      this.emitRoster();
      return;
    }
    const d = payload as { kind?: unknown; deviceId?: unknown; data?: unknown } | null;
    if (d === null || typeof d.deviceId !== "string") return;
    if (d.kind === "peerRemoved") this.slices.delete(d.deviceId);
    else this.adoptSlice(d.deviceId, d.data);
    this.emitRoster();
  }

  private applyStoreSnapshot(payload: unknown): void {
    const snap = payload as { slices?: Record<string, { data?: unknown }> } | null;
    if (snap === null || typeof snap.slices !== "object" || snap.slices === null) return;
    this.slices.clear();
    for (const [deviceId, wrapped] of Object.entries(snap.slices)) {
      this.adoptSlice(deviceId, wrapped?.data);
    }
  }

  private adoptSlice(deviceId: string, data: unknown): void {
    const parsed = DeviceSlice.safeParse(data);
    if (!parsed.success) return; // tolerant reader: never fatal, never fabricated
    this.slices.set(deviceId, parsed.data);
  }

  /** Fuse slices with liveness. Self is always online; a peer is online per the
   * tailnet (transport truth); lastSeenAt = the freshest honest fact we hold. */
  private roster(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    const seen = new Set<string>();
    for (const [deviceId, slice] of this.slices) {
      const self = deviceId === this.deviceId;
      const live = this.peerLiveness.get(deviceId);
      out.push({
        ...slice,
        self,
        online: self ? true : (live?.online ?? false),
        lastSeenAt: Math.max(slice.publishedAt, live?.lastSeen ?? 0),
      });
      seen.add(deviceId);
    }
    if (!seen.has(this.deviceId)) {
      // Unpublished (mesh down / first sync pending): the roster still shows
      // this device honestly rather than an empty list.
      out.push({ ...this.selfSlice(), self: true, online: true, lastSeenAt: this.now() });
    }
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  }

  private emitRoster(): void {
    const roster = this.roster();
    // publishedAt/lastSeenAt churn on every self-slice rebuild — signature the
    // stable facts so subscribers only wake on real roster changes.
    const sig = JSON.stringify(
      roster.map((d) => [d.deviceId, d.name, d.online, d.self, d.productEndpoint?.url ?? null]),
    );
    if (sig === this.lastRosterSig) return;
    this.lastRosterSig = sig;
    this.emit("changed", roster);
  }

  private loadLocalId(): string {
    const path = join(this.opts.dataDir, "fieldd", "device-id");
    try {
      const existing = readFileSync(path, "utf8").trim();
      if (existing.length > 0) return existing;
    } catch {
      /* first run */
    }
    const id = `local-${randomUUID()}`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, id, { mode: 0o600 });
    } catch {
      /* unwritable dataDir — a per-boot id is the honest floor */
    }
    return id;
  }
}
