import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  DEVICE_LIMITS,
  type DeviceInfo,
  DeviceSlice,
  LAYOUT,
  PeerInfo,
  type ProductEndpoint,
  STORES,
} from "@vibefield/contracts";
import { MESH_BUS_CARRIES_CONTENT } from "./mesh-bus";
import type { MeshClient } from "./mesh-client";

// DeviceService (design-04 §3.1, D31 — C4 P1-lite): the device directory.
// Roster = self-slice ⋈ store peer-slices ⋈ tailnet peer liveness; presence
// heartbeats defer with the spec's own verify-item. The slice publishes on
// boot and on change (the serve's capability URL appearing/moving) through the
// C2 store facade; with the mesh down everything degrades honestly — a
// persisted local device-id keeps identity stable for solo operation (recorded
// deviation from D30's mesh-identity law: solo fields still need an id), the
// roster is self-only, and the slice stays unpublished until the mesh returns.
//
// UA-P-0e (D2, 2026-09-15) — AND THE STORE HALF OF ALL THAT IS SWITCHED OFF.
// `MESH_BUS_CARRIES_CONTENT` is `false` (see mesh-bus.ts for the ruling and for
// why it is a switch rather than a deletion): this device publishes no slice,
// subscribes to no store, and fuses no peer slice, because the bus reaches
// every VibeField node on the tailnet and cannot be told to reach only this
// account's.
//
// The roster is then THE SELF-PEER SET: app peers from the tailnet's own
// registry whose WhoIs login equals this user's linked login. Liveness comes
// from the peer list, identity from truffle's durable ULID, and a door
// coordinate is DERIVED (the peer's authenticated MagicDNS name + the
// registry's product serve port) rather than published — UA-P-0d having moved
// the route secret to the sidecar's target path, so a coordinate carries no key.
//
// What a peer no longer says about itself — platform, versions, capabilities,
// bootId — is ABSENT on its row rather than guessed, which is why those fields
// are optional on `DeviceInfo`. SELF still carries all of them: it is this
// process. A reader that needs a peer's own claims asks the peer's door.

export interface DeviceServiceOptions {
  dataDir: string;
  mesh: MeshClient;
  bootId: string;
  fielddVersion: string;
  contractsVersion: string;
  /** Supplied by the daemon (it owns the serve secret + fused serve state):
   * the current product endpoint; `url` only while the serve is active. */
  productEndpoint: () => ProductEndpoint;
  /** NF-3 — honest capability (D31): true once the pairing hello delivered
   * terminal endpoints (the floor is real on this device). The daemon triggers
   * a re-sync when that flips so the published slice follows the truth. */
  terminalHost?: () => boolean;
  /** TM-2 (MF-1l), F-H2 — are this device's terminal doors on the tailnet?
   * The daemon answers off the LIVE terminal serve, the same reading the
   * routed-ticket mint uses, so the capability and the mint can never
   * disagree; the floor's own `terminalMesh` word is only one of the three
   * gates behind that. Re-published on "serves-changed" like the product
   * endpoint beside it. */
  terminalMesh?: () => boolean;
  /** UA-P-0e (D2) — THE ACCOUNT. A peer is in this roster only when the
   * tailnet's own WhoIs says its login is this one; `null` (unlinked, or a
   * capture still running) admits nobody, which is the same posture the door
   * and the serve take. */
  linkedLogin?: () => string | null;
  /** UA-P-0e — the peer door coordinate's port. Injected so the derivation has
   * one source and a test can name it; production passes the registry row. */
  productServePort?: number;
  now?: () => number;
}

/** UA-P-0e — what the tailnet's own registry says about one peer, which after
 * D2 is the whole of what a roster row for a peer can honestly be built from. */
interface SelfPeer {
  /** truffle's durable published ULID — the roster key (D30). A peer that has
   * not published one is uncorrelated and gets no row: absent, not guessed. */
  deviceId: string;
  tailscaleId: string;
  name: string;
  online: boolean;
  lastSeen: number;
  /** authenticated MagicDNS hostname, when WhoIs supplied one */
  dnsName?: string;
}

interface PeerLiveness {
  online: boolean;
  lastSeen?: number;
}

/** The PeerLink surface DeviceService folds into the roster (C5/D32): the live
 * per-device link verdict plus a change signal to re-emit on. Kept structural
 * so DeviceService never imports PeerLink (the daemon owns that wiring). */
interface PeerLinkView {
  linkState(deviceId: string): "connected" | "dialing" | "incompatible" | undefined;
  on(event: "link-changed", fn: (ev: unknown) => void): unknown;
}

export class DeviceService extends EventEmitter {
  private readonly now: () => number;
  /** the mesh identity once known (D30); the persisted local id until then */
  private deviceId: string;
  private slices = new Map<string, DeviceSlice>();
  /** keyed by the Tailscale stable node id (PeerInfo.id) — the tailnet's own
   * keyspace. NEVER keyed by the roster ULID; the two never collide (T1 §6). */
  private peerLiveness = new Map<string, PeerLiveness>();
  /** ULID deviceId → tailscale id, learned from the peer registry (PeerInfo
   * carries both). The ONLY lawful bridge between the two keyspaces: the
   * roster (ULID slice keys) reaches liveness through this map, and the rows
   * it produces carry `tailscaleId` so downstream consumers (doc-sync
   * liveness, the future node-id-header principal) join in the dial keyspace. */
  private tsByUlid = new Map<string, string>();
  /** ULID deviceId → authenticated MagicDNS hostname. This map is populated
   * in the same registry pass as tsByUlid and only after PeerInfo supplies the
   * durable ULID correlation; DeviceSlice can never assert this value. */
  private dnsByUlid = new Map<string, string>();
  /** UA-P-0e — the self-peer set, keyed by the roster ULID. Rebuilt whole on
   * every peer refresh; a peer that leaves the set leaves the roster. */
  private selfPeers = new Map<string, SelfPeer>();
  private storeSubscribed = false;
  private storeOff: (() => void) | null = null;
  /** UA-P-0e — the roster is built from the tailnet's peer registry now, so a
   * peer joining, leaving or being re-identified has to WAKE it. Nothing
   * subscribed to this stream before: the roster's peers came from the store,
   * and the peer list was only ever read to fuse liveness onto a slice that had
   * already arrived. */
  private peersSubscribed = false;
  private lastRosterSig = "";
  /** syncs SERIALIZE (the MeshClient chain law): each pass sees its trigger's state */
  private chain: Promise<void> = Promise.resolve();
  /** C5/D32 — wired post-construction (PeerLink is built after DeviceService) */
  private peers?: PeerLinkView;
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

  /** The current identity — the mesh device id once known, the persisted local
   * fallback until then (C5: PeerLink's own-id + the `device?` self check). */
  currentDeviceId(): string {
    return this.deviceId;
  }

  /** C5/D32 — fold PeerLink's live link verdict into the roster. The daemon
   * wires this after construction (PeerLink is built later, and owns the
   * own-id + endpoint sources). Each "link-changed" re-emits the roster so a
   * link transition wakes device.subscribe — the roster tells the truth about
   * reachability. */
  attachPeerLink(peers: PeerLinkView): void {
    this.peers = peers;
    peers.on("link-changed", () => this.emitRoster());
  }

  list(): DeviceInfo[] {
    return this.roster();
  }

  /** T1 §1 — the tailnet door's correlation: a sidecar-injected WhoIs node id
   * → the roster's ULID deviceId, through the same registry mapping the
   * roster join rides. A miss is honest (peer not yet published, roster
   * stale, mesh down) and leaves the door on its claim fallback. */
  deviceIdByNodeId(nodeId: string): string | undefined {
    for (const [ulid, ts] of this.tsByUlid) if (ts === nodeId) return ulid;
    return undefined;
  }

  get(deviceId: string): DeviceInfo | undefined {
    return this.roster().find((d) => d.deviceId === deviceId);
  }

  dispose(): void {
    this.disposed = true;
    this.storeOff?.();
    this.storeOff = null;
    this.removeAllListeners();
  }

  // ---- internals ----

  private async doSync(): Promise<void> {
    if (this.disposed) return;
    try {
      // Identity first (D30): the store's own device id IS the mesh identity.
      // UA-P-0e keeps this read — it asks the floor for OUR OWN durable ULID and
      // reaches no peer. Nothing is published by reading it, and the alternative
      // (a per-boot local id on a linked device) would break every roster key.
      const self = (await this.opts.mesh.getSlice(STORES.DEVICES)) as { deviceId?: unknown };
      if (typeof self.deviceId === "string" && self.deviceId.length > 0) {
        this.deviceId = self.deviceId; // the mesh identity supersedes the local fallback (D30)
      }
      // UA-P-0e — the PEER stream, which is the tailnet's own registry and not
      // a content store: it carries who is on this tailnet and the control
      // plane's WhoIs answer about each, both of which are facts about peers
      // rather than claims by them. The roster derives from it, so it must wake
      // on it. Not behind the bus switch for exactly that reason.
      if (!this.peersSubscribed) {
        await this.opts.mesh.subscribePeers(() => void this.sync());
        this.peersSubscribed = true; // NativeLink replays across reconnects (P5)
      }
      // UA-P-0e — the store leg, OFF. Not subscribed, so no foreign slice is
      // ever adopted; not published, so nothing of this device's goes out.
      // Both halves are the same ruling: the bus reaches every VibeField node
      // on the tailnet, and this account is not all of them.
      if (MESH_BUS_CARRIES_CONTENT && !this.storeSubscribed) {
        const subscription = await this.opts.mesh.subscribeStoreManaged(
          STORES.DEVICES,
          (payload, kind) => this.onStoreEvent(payload, kind),
        );
        if (this.disposed) {
          subscription.dispose();
          return;
        }
        this.storeOff = subscription.dispose;
        this.storeSubscribed = true; // NativeLink replays across reconnects (P5)
        this.applyStoreSnapshot(subscription.snapshot);
      }
      await this.refreshPeers();
      if (MESH_BUS_CARRIES_CONTENT) await this.publish();
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
      // honest capabilities (D31): terminalHost follows the NF-D8 hello
      // (true iff the floor delivered endpoints); DocumentService is B3-real.
      // TM-2: `terminalMesh` is the REMOTE half of the same question — this
      // device is really publishing its cell doors on the tailnet right now
      // (F-H2: the live serve, not the floor's word alone) — and the two are
      // deliberately separate facts, because a desktop can host terminals for
      // itself all day without offering one to another device.
      capabilities: {
        terminalHost: this.opts.terminalHost?.() ?? false,
        terminalMesh: this.opts.terminalMesh?.() ?? false,
        docHost: true,
        push: false,
      },
      productEndpoint: this.opts.productEndpoint(),
      bootId: this.opts.bootId,
      publishedAt: this.now(),
    };
  }

  private async refreshPeers(): Promise<void> {
    const raw = await this.opts.mesh.peers();
    // UA-P-0e (D2) — THE ACCOUNT, read once per pass. `null` admits nobody:
    // an unlinked or still-capturing desktop has no account to compare against,
    // and the same posture the door and the serve take is the one here.
    const account = this.opts.linkedLogin?.() ?? null;
    this.peerLiveness.clear();
    this.tsByUlid.clear();
    this.dnsByUlid.clear();
    this.selfPeers.clear();
    for (const p of raw) {
      const parsed = PeerInfo.safeParse(p);
      if (!parsed.success) continue; // tolerant: a malformed peer never breaks the roster
      const lastSeen = (parsed.data as { lastSeen?: unknown }).lastSeen;
      this.peerLiveness.set(parsed.data.id, {
        online: parsed.data.online,
        ...(typeof lastSeen === "number" ? { lastSeen } : {}),
      });
      // a peer without a published ULID stays uncorrelated — its slice (if
      // any) reads offline honestly rather than joining on a guessed key
      if (parsed.data.deviceId === undefined) continue;
      this.tsByUlid.set(parsed.data.deviceId, parsed.data.id);
      const dnsName = canonicalTailnetDnsName(parsed.data.whois?.deviceName);
      if (dnsName !== undefined) this.dnsByUlid.set(parsed.data.deviceId, dnsName);

      // UA-P-0e — SELF OR NOTHING. The login comes from the tailnet's control
      // plane (the floor WhoIs-es each peer's address), so it is a fact about
      // the peer and not a claim by it; the comparison is the same stored-login
      // one UA-D13 gives the door. A peer the tailnet will not name has no
      // login to compare and is therefore not this account's.
      const login = parsed.data.whois?.login;
      if (account === null || login === undefined || login.toLowerCase() !== account.toLowerCase())
        continue;
      this.selfPeers.set(parsed.data.deviceId, {
        deviceId: parsed.data.deviceId,
        tailscaleId: parsed.data.id,
        name: parsed.data.name ?? parsed.data.deviceId,
        online: parsed.data.online,
        lastSeen: typeof lastSeen === "number" ? lastSeen : 0,
        ...(dnsName !== undefined ? { dnsName } : {}),
      });
    }
  }

  /** UA-P-0e (D2) — the peers this account owns, in the DIAL keyspace. The one
   * reader every mesh service that has to ask "is this peer mine?" goes
   * through: doc-sync's fan-out, presence, and the inbound lane gate (UA-P-0f).
   * Built from the tailnet's own WhoIs, never from anything a peer published. */
  selfPeerIds(): string[] {
    return [...this.selfPeers.values()].map((peer) => peer.tailscaleId);
  }

  /** UA-P-0f (D5) — the fan-out list doc-sync and presence share, in the shape
   * they already take (`SyncPeer`: the dial id plus liveness).
   *
   * Built from the self-peer set and NOT from a second read of the floor's peer
   * list, so there is exactly one place the account boundary is applied and no
   * way for a caller to reach the wider list past it. Liveness rides along
   * because the set already carries it — the same `online` the roster shows. */
  selfSyncPeers(): Array<{ id: string; online: boolean }> {
    return [...this.selfPeers.values()].map((peer) => ({
      id: peer.tailscaleId,
      online: peer.online,
    }));
  }

  /** UA-P-0e — is this dial-keyspace peer one of this account's? */
  isSelfPeer(tailscaleId: string): boolean {
    for (const peer of this.selfPeers.values()) if (peer.tailscaleId === tailscaleId) return true;
    return false;
  }

  /** UA-P-0e — where a peer's product door is, DERIVED: its authenticated
   * MagicDNS name plus the registry's fixed product serve port, over plain `http`
   * because the product serve is declared `tls: false` — WireGuard is the wire's
   * privacy, and the listener speaks no TLS (UA-P-0g: the first cut said `https`,
   * a scheme the door does not answer; the phone builds its own address and never
   * read this, which is why it could sit wrong). Never published,
   * and never a secret — UA-P-0d put the route secret on the sidecar's target
   * path, so a coordinate is only a coordinate. Absent when the tailnet has not
   * named the host, because a door with no host is not a door. */
  doorLocator(deviceId: string): string | undefined {
    const peer = this.selfPeers.get(deviceId);
    const port = this.opts.productServePort;
    if (peer?.dnsName === undefined || port === undefined) return undefined;
    return `http://${peer.dnsName}:${port}`;
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
    if (
      snap === null ||
      typeof snap.slices !== "object" ||
      snap.slices === null ||
      Array.isArray(snap.slices)
    )
      return;
    this.slices.clear();
    const self = Object.hasOwn(snap.slices, this.deviceId) ? snap.slices[this.deviceId] : undefined;
    if (self !== undefined) this.adoptSlice(this.deviceId, self?.data);
    let remotes = 0;
    for (const deviceId in snap.slices) {
      if (!Object.hasOwn(snap.slices, deviceId)) continue;
      if (deviceId === this.deviceId) continue;
      if (remotes >= DEVICE_LIMITS.REMOTE_ORIGINS) break;
      const wrapped = snap.slices[deviceId];
      this.adoptSlice(deviceId, wrapped?.data);
      if (this.slices.has(deviceId)) remotes += 1;
    }
  }

  private adoptSlice(deviceId: string, data: unknown): void {
    if (deviceId.length === 0 || deviceId.length > DEVICE_LIMITS.DEVICE_ID_CHARS) return;
    if (
      deviceId !== this.deviceId &&
      !this.slices.has(deviceId) &&
      this.remoteSliceCount() >= DEVICE_LIMITS.REMOTE_ORIGINS
    )
      return;
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(data);
    } catch {
      return;
    }
    if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > DEVICE_LIMITS.SLICE_BYTES)
      return;
    const parsed = DeviceSlice.safeParse(data);
    if (!parsed.success || parsed.data.deviceId !== deviceId) return;
    // Tolerant readers may accept future fields. The retained roster is a
    // narrow writer: in particular, transport-derived DNS/node/link facts can
    // never survive here as peer-authored extension fields.
    this.slices.set(deviceId, narrowDeviceSlice(parsed.data));
  }

  private remoteSliceCount(): number {
    let count = 0;
    for (const deviceId of this.slices.keys()) if (deviceId !== this.deviceId) count += 1;
    return count;
  }

  /** Fuse slices with liveness. Self is always online; a peer is online per the
   * tailnet (transport truth); lastSeenAt = the freshest honest fact we hold.
   *
   * UA-P-0e — with the bus off there are no peer slices, so the loop below runs
   * over SELF alone and `selfPeerRows()` supplies the rest. The slice path is
   * kept whole for UA-P-4, when a scoped bus makes a peer's own claims
   * trustworthy again and the two sources fuse per device rather than
   * alternate. */
  private roster(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    const seen = new Set<string>();
    for (const [deviceId, slice] of this.slices) {
      const self = deviceId === this.deviceId;
      // ULID slice key → tailscale id → liveness. Joining peerLiveness by the
      // ULID directly is the T1 §6 bug: the map is keyed by the tailnet's own
      // node id, and the two keyspaces never intersect.
      const tailscaleId = self ? undefined : this.tsByUlid.get(deviceId);
      const tailnetDnsName = self ? undefined : this.dnsByUlid.get(deviceId);
      const live = tailscaleId !== undefined ? this.peerLiveness.get(tailscaleId) : undefined;
      // link is OUR verdict about the connection to a peer — never self (C5/D32)
      const link = self ? undefined : this.peers?.linkState(deviceId);
      out.push({
        deviceId: slice.deviceId,
        name: slice.name,
        platform: slice.platform,
        headless: slice.headless,
        fielddVersion: slice.fielddVersion,
        contractsVersion: slice.contractsVersion,
        capabilities: {
          terminalHost: slice.capabilities.terminalHost,
          // a peer older than TM-2 does not carry it; absence is a no
          terminalMesh: slice.capabilities.terminalMesh ?? false,
          docHost: slice.capabilities.docHost,
          push: slice.capabilities.push,
        },
        ...(slice.productEndpoint !== undefined
          ? {
              productEndpoint: {
                serve: slice.productEndpoint.serve,
                ...(slice.productEndpoint.url !== undefined
                  ? { url: slice.productEndpoint.url }
                  : {}),
              },
            }
          : {}),
        bootId: slice.bootId,
        publishedAt: slice.publishedAt,
        self,
        online: self ? true : (live?.online ?? false),
        lastSeenAt: Math.max(slice.publishedAt, live?.lastSeen ?? 0),
        ...(tailscaleId !== undefined ? { tailscaleId } : {}),
        ...(tailnetDnsName !== undefined ? { tailnetDnsName } : {}),
        ...(link !== undefined ? { link } : {}),
      });
      seen.add(deviceId);
    }
    if (!seen.has(this.deviceId)) {
      // Unpublished (mesh down / first sync pending): the roster still shows
      // this device honestly rather than an empty list.
      out.push({ ...this.selfSlice(), self: true, online: true, lastSeenAt: this.now() });
      seen.add(this.deviceId);
    }
    for (const row of this.selfPeerRows()) {
      if (seen.has(row.deviceId)) continue;
      out.push(row);
      seen.add(row.deviceId);
    }
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  }

  /** UA-P-0e (D2) — a roster row per SELF PEER, from the tailnet's own facts.
   *
   * What is here is what the control plane knows: the durable ULID, the
   * display name, liveness, the dial id, the authenticated MagicDNS name and a
   * derived door coordinate. What is NOT here — platform, versions,
   * capabilities, bootId — is absent rather than guessed, because those are
   * claims a device makes about itself and it has not made them through a door
   * that checked who it is. A reader that needs them asks that door. */
  private selfPeerRows(): DeviceInfo[] {
    const rows: DeviceInfo[] = [];
    for (const peer of this.selfPeers.values()) {
      if (peer.deviceId === this.deviceId) continue; // self is never a peer of itself
      const url = this.doorLocator(peer.deviceId);
      const link = this.peers?.linkState(peer.deviceId);
      rows.push({
        deviceId: peer.deviceId,
        name: peer.name,
        self: false,
        online: peer.online,
        lastSeenAt: peer.lastSeen,
        // a locator, not a capability: D7 left no secret in it
        productEndpoint: { serve: "product", ...(url !== undefined ? { url } : {}) },
        tailscaleId: peer.tailscaleId,
        ...(peer.dnsName !== undefined ? { tailnetDnsName: peer.dnsName } : {}),
        ...(link !== undefined ? { link } : {}),
      });
    }
    return rows;
  }

  private emitRoster(): void {
    const roster = this.roster();
    // publishedAt/lastSeenAt churn on every self-slice rebuild — signature the
    // stable facts so subscribers only wake on real roster changes.
    const sig = JSON.stringify(
      roster.map((d) => [
        d.deviceId,
        d.name,
        d.online,
        d.self,
        d.productEndpoint?.url ?? null,
        d.link ?? null,
        // a correlation appearing matters even while online stays false: it is
        // what lets doc-sync's liveness fold see the peer at all
        d.tailscaleId ?? null,
        // AH-2's URL binding wakes as soon as authenticated MagicDNS identity
        // appears, disappears, or changes even if liveness itself is stable.
        d.tailnetDnsName ?? null,
        // capabilities flip at runtime (terminalHost follows the NF-D8 hello);
        // omitting them made the flip invisible to device.subscribe (NF-6).
        // UA-P-0e: absent on a peer row, and absence is itself a fact worth
        // waking a subscriber for (it is how a row says "ask my door").
        d.capabilities ?? null,
      ]),
    );
    if (sig === this.lastRosterSig) return;
    this.lastRosterSig = sig;
    this.emit("changed", roster);
  }

  private loadLocalId(): string {
    const path = join(this.opts.dataDir, ...LAYOUT.DEVICE_ID);
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

function narrowDeviceSlice(slice: DeviceSlice): DeviceSlice {
  return {
    deviceId: slice.deviceId,
    name: slice.name,
    platform: slice.platform,
    headless: slice.headless,
    fielddVersion: slice.fielddVersion,
    contractsVersion: slice.contractsVersion,
    capabilities: {
      terminalHost: slice.capabilities.terminalHost,
      terminalMesh: slice.capabilities.terminalMesh ?? false,
      docHost: slice.capabilities.docHost,
      push: slice.capabilities.push,
    },
    ...(slice.productEndpoint !== undefined
      ? {
          productEndpoint: {
            serve: slice.productEndpoint.serve,
            ...(slice.productEndpoint.url !== undefined ? { url: slice.productEndpoint.url } : {}),
          },
        }
      : {}),
    bootId: slice.bootId,
    publishedAt: slice.publishedAt,
  };
}

/** Canonical form used by Artifact Hub URL binding: ASCII lowercase, exactly
 * one optional terminal root dot removed, and ordinary DNS hostname syntax.
 * A second trailing dot is rejected after the single permitted removal. */
export function canonicalTailnetDnsName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || !/^[!-~]+$/.test(value)) {
    return undefined;
  }
  let canonical = value.toLowerCase();
  if (canonical.endsWith(".")) canonical = canonical.slice(0, -1);
  if (canonical.length === 0 || canonical.length > 253 || !canonical.includes(".")) {
    return undefined;
  }
  const labels = canonical.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return undefined;
  }
  return canonical;
}
