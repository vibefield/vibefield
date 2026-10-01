import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  CONTRACTS_VERSION,
  DEVICE_LIMITS,
  type DeviceInfo,
  DeviceSlice,
  type DeviceState,
  LAYOUT,
  PeerInfo,
  type ProductEndpoint,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
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
// UA-P-0e (D2, 2026-09-15) switched the store half OFF; UA-P-4 (2026-09-16)
// switched it back ON, SCOPED — `MESH_BUS_CARRIES_CONTENT` is `true` again
// because RFC 025 gates the node on the account's login, refuses a foreign
// hello, and binds every slice to its sender's authenticated device id (the
// ruling and its three citations live in mesh-bus.ts).
//
// TWO SOURCES, AND THEY ARE NOT EQUALS. The tailnet's own peer registry says
// WHO EXISTS; a store slice says what a device CLAIMS ABOUT ITSELF. So:
//
//  - The registry is the authority on membership. `selfPeers` is app peers
//    whose WhoIs login equals this user's linked login, and a roster row
//    requires one — a slice for a device the registry does not list is DROPPED
//    with a log, never added. That is defence in depth over RFC 025 §3.5's
//    sender binding: one upstream bug should not be able to conjure a device
//    into somebody's roster, and the check costs a map lookup.
//  - A slice, having passed that, supplies what only a device can say about
//    itself: platform, versions, capabilities, bootId. Absent when there is no
//    slice yet, which is why those fields are optional on `DeviceInfo`.
//
// THE DOOR COORDINATE STAYS DERIVED for peers (UA-P-0d/D7): the peer's
// authenticated MagicDNS name plus the registry's product serve port, in
// preference to the `productEndpoint.url` the peer published. The gate makes a
// published URL an account peer's claim rather than a stranger's, but a claim
// is still what `peer-link` would dial, and a coordinate we derive from the
// control plane is not a claim at all. Either way it carries no key — the route
// secret is the sidecar's target path. SELF keeps its own published endpoint:
// it is this process, composed by the daemon that owns the serve.

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
  /** UA-P-4 — needed the moment the store leg came back: a slice the registry
   * does not vouch for is dropped, and a drop nobody can see is how a roster
   * goes quietly wrong. Defaults to the no-op logger for focused unit tests. */
  logger?: Logger;
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
  /** DS-L8 — the peer's door as last heard (PeerLink.doorState). Optional so
   * a view that cannot say leaves every online peer `awake`. */
  doorState?(deviceId: string): "answers" | "silent" | "incompatible" | undefined;
  /** S6 (the landing review, 2026-10-01) — forget a door's silence
   * (PeerLink.clearSilent). Called when the tailnet flips the node's `online`:
   * silence heard before a node slept says nothing about the daemon it wakes
   * with. Optional, like `doorState`. */
  clearSilent?(deviceId: string): void;
  on(event: "link-changed" | "door-changed", fn: (ev: unknown) => void): unknown;
}

const contractsMajor = (version: string): string => version.split(".")[0] ?? version;

/** DS-L9 — is a contracts version a device PUBLISHED another major than ours?
 * The door's own rule (`product-api.ts`'s hello compares the first dotted
 * part), applied to the version a peer's slice states, so the roster says
 * `incompatible` before anything is asked of the peer rather than after a
 * forward is refused. One helper for the roster (`deviceState`) and the mesh
 * board (`mesh-board.ts`), so the two cannot disagree (the landing review, S6,
 * 2026-10-01). No version — a peer row with no slice yet — is no verdict. */
export function isAnotherContractsMajor(published: string | undefined): boolean {
  if (published === undefined) return false;
  return contractsMajor(published) !== contractsMajor(CONTRACTS_VERSION);
}

/** DS-L8 — the roster's state for one row. Self is awake (it is this
 * process); a peer whose door refused our contracts major — or whose slice
 * PUBLISHES another major (DS-L9: not asked; S6, 2026-10-01) — is
 * `incompatible` whatever else is true (it is not asked until this daemon
 * restarts); a node the tailnet does not list online is `asleep`; a node it
 * does list whose door last went unanswered is `restarting` (field-native
 * outlives fieldd — the node's `online` is not the daemon's); everything else
 * is `awake`, including a peer never dialled: no answer yet is not silence. */
export function deviceState(
  self: boolean,
  online: boolean,
  door: "answers" | "silent" | "incompatible" | undefined,
  link: "connected" | "dialing" | "incompatible" | undefined,
  contractsVersion?: string | undefined,
): DeviceState {
  if (self) return "awake";
  if (
    door === "incompatible" ||
    link === "incompatible" ||
    isAnotherContractsMajor(contractsVersion)
  )
    return "incompatible";
  if (!online) return "asleep";
  if (door === "silent") return "restarting";
  return "awake";
}

export class DeviceService extends EventEmitter {
  private readonly now: () => number;
  private readonly logger: Logger;
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
  /** S6 (the landing review, 2026-10-01) — each correlated peer's `online` as
   * the last registry pass read it, keyed by the roster ULID (PeerLink's
   * keyspace). A FLIP clears the door's silent mark (`clearSilent`), or a
   * desktop that slept and woke read `restarting` until some call to it
   * happened to succeed. Kept across passes, bounded by this account's
   * devices. */
  private lastOnline = new Map<string, boolean>();
  private storeSubscribed = false;
  private storeOff: (() => void) | null = null;
  /** UA-P-0e — the roster is built from the tailnet's peer registry now, so a
   * peer joining, leaving or being re-identified has to WAKE it. Nothing
   * subscribed to this stream before: the roster's peers came from the store,
   * and the peer list was only ever read to fuse liveness onto a slice that had
   * already arrived. */
  private peersSubscribed = false;
  private lastRosterSig = "";
  /** UA-P-4 — device ids already warned about, so the drop is logged once per
   * device rather than once per roster projection. Cleared per device when the
   * registry starts listing it. */
  private unlistedLogged = new Set<string>();
  /** syncs SERIALIZE (the MeshClient chain law): each pass sees its trigger's state */
  private chain: Promise<void> = Promise.resolve();
  /** C5/D32 — wired post-construction (PeerLink is built after DeviceService) */
  private peers?: PeerLinkView;
  private disposed = false;

  constructor(private readonly opts: DeviceServiceOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.logger = (opts.logger ?? createNoopLogger()).child({ component: "devices" });
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
    // DS-L8 — a door going silent or answering again moves a row's `state`
    peers.on("door-changed", () => this.emitRoster());
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

  /** D1 (2026-10-01, the DS wave 1 review) — does the ROSTER row for this
   * device say it hosts documents (`capabilities.docHost`: a DESKTOP, DS-D7)?
   * The tailnet door's second fact for minting `peer-fieldd`, beside the node
   * correlation above. Read off the roster, so it carries the roster's own law:
   * a peer row exists only for a device the registry vouches for as this
   * account's, and its capabilities only once its slice has arrived — a peer
   * with no slice yet says nothing about itself, which is a no. Never true for
   * THIS device: self is not a peer of itself, and a node that correlates to
   * our own id is not one of our desktops dialling in. */
  isDocHost(deviceId: string): boolean {
    if (deviceId === this.deviceId) return false;
    const row = this.get(deviceId);
    return row !== undefined && !row.self && row.capabilities?.docHost === true;
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
      // UA-P-4 — THE REGISTRY FIRST, THEN THE STORE. The order is load-bearing
      // now that slices are fused against the self-peer set: subscribing first
      // would hand `applyStoreSnapshot` a whole store to judge against an empty
      // registry, and every row of it would read as a device the tailnet does
      // not list. Refreshing first means the first snapshot is judged against
      // real membership. (Deltas that arrive between passes are handled at the
      // FUSION point, not by dropping them — see `roster`.)
      await this.refreshPeers();
      // UA-P-4 — the store leg is back, scoped. Subscribed, so an account
      // peer's slice describes it; published, so this device's own claims reach
      // the account's other devices. Both halves are the same ruling as the
      // off-state was: the bus's audience is the account, and RFC 025 is what
      // finally makes that true of the transport rather than of the deployment.
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
    const flipped: string[] = [];
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
      // S6 — the node's `online` moved since the last pass (slept, or woke)
      const was = this.lastOnline.get(parsed.data.deviceId);
      this.lastOnline.set(parsed.data.deviceId, parsed.data.online);
      if (was !== undefined && was !== parsed.data.online) flipped.push(parsed.data.deviceId);
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
      // UA-P-4 — a device the registry now lists is no longer "unlisted": clear
      // its log latch so a LATER fall-out is reported instead of swallowed.
      this.unlistedLogged.delete(parsed.data.deviceId);
      this.selfPeers.set(parsed.data.deviceId, {
        deviceId: parsed.data.deviceId,
        tailscaleId: parsed.data.id,
        name: parsed.data.name ?? parsed.data.deviceId,
        online: parsed.data.online,
        lastSeen: typeof lastSeen === "number" ? lastSeen : 0,
        ...(dnsName !== undefined ? { dnsName } : {}),
      });
    }
    // S6 (the landing review, 2026-10-01) — a node that went offline or came
    // back online forgets what its door last said: silence heard before it
    // slept is not the daemon it woke with (DS-L8's `restarting` is a silent
    // door on a LIVE node). After the pass, so the roster a `door-changed`
    // re-emits is already whole.
    for (const deviceId of flipped) this.peers?.clearSilent?.(deviceId);
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

  /** UA-P-4 — log a dropped slice ONCE per device, not once per roster rebuild.
   * The roster is re-projected on every peer event, every link change and every
   * sync, so an unconditional warn would turn one unlisted device into a log
   * flood — and a flood is how a real signal stops being read. The id leaves
   * the set the moment the registry does list it (`refreshPeers`), so a peer
   * that arrives late is logged again if it ever falls out again. */
  private noteUnlistedSlice(deviceId: string): void {
    if (this.unlistedLogged.has(deviceId)) return;
    this.unlistedLogged.add(deviceId);
    this.logger.warn(
      "fieldd.devices.slice_from_unlisted_device",
      "A device slice named a device the tailnet registry does not list for this account; dropped",
      { deviceId },
    );
  }

  private remoteSliceCount(): number {
    let count = 0;
    for (const deviceId of this.slices.keys()) if (deviceId !== this.deviceId) count += 1;
    return count;
  }

  /** Fuse slices with liveness. Self is always online; a peer is online per the
   * tailnet (transport truth); lastSeenAt = the freshest honest fact we hold.
   *
   * UA-P-4 — AND THE FUSION IS WHERE THE REGISTRY WINS. A slice contributes a
   * row only for SELF or for a device the tailnet's own registry lists as this
   * account's peer; anything else is dropped here with a log and never reaches
   * a reader. Doing it at the fusion point rather than at adoption is
   * deliberate: a delta can legitimately arrive in the gap between two registry
   * passes, and dropping it on arrival would lose a real peer's row until it
   * happened to republish. Held, then judged, is both strict and race-free —
   * the roster is the thing anyone reads, so the roster is where "the registry
   * is the authority" has to be true. */
  private roster(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    const seen = new Set<string>();
    for (const [deviceId, slice] of this.slices) {
      const self = deviceId === this.deviceId;
      if (!self && !this.selfPeers.has(deviceId)) {
        this.noteUnlistedSlice(deviceId);
        continue;
      }
      // ULID slice key → tailscale id → liveness. Joining peerLiveness by the
      // ULID directly is the T1 §6 bug: the map is keyed by the tailnet's own
      // node id, and the two keyspaces never intersect.
      const tailscaleId = self ? undefined : this.tsByUlid.get(deviceId);
      const tailnetDnsName = self ? undefined : this.dnsByUlid.get(deviceId);
      const live = tailscaleId !== undefined ? this.peerLiveness.get(tailscaleId) : undefined;
      // link is OUR verdict about the connection to a peer — never self (C5/D32)
      const link = self ? undefined : this.peers?.linkState(deviceId);
      // UA-P-0d/D7, kept by UA-P-4 — a peer's door coordinate is DERIVED from
      // the control plane in preference to the one it published. The published
      // URL is now an account peer's claim rather than a stranger's, which is
      // the gate working; it is still a claim, and `peer-link` dials it.
      const endpoint = slice.productEndpoint;
      const derived = self ? undefined : this.doorLocator(deviceId);
      const url = self ? endpoint?.url : (derived ?? endpoint?.url);
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
        ...(endpoint !== undefined
          ? {
              productEndpoint: {
                serve: endpoint.serve,
                ...(url !== undefined ? { url } : {}),
              },
            }
          : {}),
        bootId: slice.bootId,
        publishedAt: slice.publishedAt,
        self,
        online: self ? true : (live?.online ?? false),
        state: deviceState(
          self,
          self ? true : (live?.online ?? false),
          self ? undefined : this.peers?.doorState?.(deviceId),
          link,
          // DS-L9 (S6) — the major the peer's slice PUBLISHES: another one
          // reads `incompatible` before anything is asked of it
          self ? undefined : slice.contractsVersion,
        ),
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
      out.push({
        ...this.selfSlice(),
        self: true,
        online: true,
        state: "awake",
        lastSeenAt: this.now(),
      });
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
        state: deviceState(false, peer.online, this.peers?.doorState?.(peer.deviceId), link),
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
        // DS-L8 — awake → restarting → asleep moves wake subscribers even
        // when `online` holds still (a silent daemon on a live node)
        d.state ?? null,
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
