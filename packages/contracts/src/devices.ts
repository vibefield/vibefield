import { z } from "zod";
import { MESH_CONTROL_LIMITS } from "./registries";

// DeviceService wire shapes (design-04 §3.1, D31 — the C4 P1-lite subset).
// The roster fuses self-slices in the `field.devices.v1` SyncedStore with
// tailnet peer liveness; presence heartbeats (source 3) are deferred with the
// spec's own verify-item. TS-only — the shape does not cross to Rust (the store
// carries opaque JSON; field-native enforces only generated transport budgets).

/** Hostile-store and projection bounds. Device slices are tiny identity rows;
 * accepting arbitrary strings here would let one peer amplify every roster and
 * Artifact Hub snapshot that names it. */
export const DEVICE_LIMITS = {
  REMOTE_ORIGINS: MESH_CONTROL_LIMITS.REMOTE_ORIGINS,
  SLICE_BYTES: MESH_CONTROL_LIMITS.DEVICE_SLICE_BYTES,
  DEVICE_ID_CHARS: MESH_CONTROL_LIMITS.OWNER_CHARS,
  NAME_CHARS: 128,
  PLATFORM_CHARS: 64,
  VERSION_CHARS: 64,
  BOOT_ID_CHARS: 256,
  ENDPOINT_SERVE_CHARS: 128,
  ENDPOINT_URL_CHARS: 2_048,
} as const;

/** Honest per-device capability facts (D31: "capabilities honest per device"). */
export const DeviceCapabilities = z
  .object({
    /** This device HAS a terminal floor — the local fact. True iff the
     * pairing hello delivered the floor's endpoints; it says nothing about
     * whether anyone else can reach them (QA 2026-09-13 finding 2 turned on
     * exactly that distinction). */
    terminalHost: z.boolean(),
    /** TM-2 (MF-1l) — this device's terminal doors are PUBLISHED ON THE
     * TAILNET, the floor's own word from its hello, which is the fact a
     * REMOTE reader needs: `terminalHost` true with this false means the
     * desktop is running terminals it will not let anyone attach to from
     * another device, and a card drawn on the first fact alone is tappable
     * and dead.
     *
     * OPTIONAL, and absence reads as FALSE. A slice published by a peer older
     * than TM-2 simply does not carry it, and the tolerant-reader law says a
     * missing field is "it did not say" — which for a promise of reachability
     * is a no. */
    terminalMesh: z.boolean().optional(),
    docHost: z.boolean(),
    push: z.boolean(),
  })
  .passthrough();
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

/** How to reach this device's product surface. Recorded delta from the spec's
 * "(mesh.serve name)": the FULL capability URL rides here too — C3's secret-path
 * design means the serve name alone cannot be dialed, and this store is the
 * distribution channel C3 reserved for it. `url` is present only while the
 * serve is active.
 *
 * ERRATA (2026-09-13, EL7 M1): this paragraph called the store
 * "same-user-private" and readers took that as a guarantee. It is not one.
 * truffle-core broadcasts to EVERY tailnet node whose hostname starts with
 * `truffle-vibefield-` — no WhoIs, no login check on the store's own path — so
 * the store's audience is the APP's tailnet peers. Same-user holds by
 * DEPLOYMENT (UA-D5: the tailnet is this person's), never by construction.
 * What refuses a guest is the DOOR behind this URL (WhoIs + scopes + the
 * `guestOk` choke), which the store does not go through: the capability URL
 * published here is a dial coordinate, and the door is the gate. The posture
 * ruling — what may ride a broadcast store at all — is GM-D10, open. */
export const ProductEndpoint = z
  .object({
    serve: z.string().min(1).max(DEVICE_LIMITS.ENDPOINT_SERVE_CHARS),
    url: z.string().min(1).max(DEVICE_LIMITS.ENDPOINT_URL_CHARS).optional(),
  })
  .passthrough();
export type ProductEndpoint = z.infer<typeof ProductEndpoint>;

/** One device's self-published slice in `field.devices.v1` (published on boot
 * and on change; the slice key IS the writer's mesh deviceId — D30). */
export const DeviceSlice = z
  .object({
    deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    platform: z.string().min(1).max(DEVICE_LIMITS.PLATFORM_CHARS),
    headless: z.boolean(),
    fielddVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS),
    contractsVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS),
    capabilities: DeviceCapabilities,
    productEndpoint: ProductEndpoint.optional(),
    bootId: z.string().min(1).max(DEVICE_LIMITS.BOOT_ID_CHARS),
    publishedAt: z.number().int(),
  })
  .passthrough();
export type DeviceSlice = z.infer<typeof DeviceSlice>;

/** The roster row. `online` derives from tailnet peer state (self is always
 * online); `lastSeenAt` = max(publishedAt, peer last-seen) — honest without
 * heartbeats. `link` is PeerLink's live verdict about OUR connection to the
 * device (C5/D32) — absent when never dialed.
 *
 * UA-P-0e (D2, 2026-09-15) — THE SLICE-DERIVED FACTS ARE OPTIONAL NOW, and this
 * row no longer extends `DeviceSlice`. It used to: a roster row WAS a slice
 * fused with liveness, so every field a peer published was a field the roster
 * required. Under D2 nothing content-bearing rides the bus until truffle can
 * gate a store by login, so there are no peer slices to fuse — a peer row is
 * built from the tailnet's own facts (the peer registry plus its WhoIs login)
 * and from a DERIVED door locator, and the things only a slice could have said
 * are simply not said.
 *
 * Which is the tolerant-reader law applied to ourselves: a peer's OS, its
 * fieldd version, what it can host — these are claims a device makes about
 * itself, and until it makes them through a door that checked who it is, the
 * honest answer is absence, not a guess. SELF still carries every field; it is
 * this process, and nothing about it has to cross a wire to be known.
 *
 * They return, per device, when a reader asks the peer's own door for them, or
 * when UA-P-4 lands the scoped bus and the slices come back. */
export const DeviceInfo = z
  .object({
    deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    platform: z.string().min(1).max(DEVICE_LIMITS.PLATFORM_CHARS).optional(),
    headless: z.boolean().optional(),
    fielddVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    contractsVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    capabilities: DeviceCapabilities.optional(),
    /** UA-P-0e — for a PEER this is a derived LOCATOR (`https://<magicdns>:<the
     * registry's product serve port>`), never a published value and never a
     * secret: D7 moved the route secret to the sidecar's target path, so a door
     * coordinate is all there is to hold. For SELF it is this daemon's own
     * serve, `url` present only while it is active. */
    productEndpoint: ProductEndpoint.optional(),
    bootId: z.string().min(1).max(DEVICE_LIMITS.BOOT_ID_CHARS).optional(),
    publishedAt: z.number().int().optional(),
    self: z.boolean(),
    online: z.boolean(),
    lastSeenAt: z.number().int(),
    link: z.enum(["connected", "dialing", "incompatible"]).optional(),
    /** The Tailscale stable node id, when the peer registry correlates it to
     * this device (PeerInfo.deviceId ⋈ slice key). This is the DIAL/liveness
     * keyspace — `lane.open`, doc-sync peers, the C5 endpoint door — distinct
     * from `deviceId` (the durable ULID roster key, D30); the two never collide
     * and must never be joined against each other (T1 §6). Absent for self and
     * for devices the registry does not currently list. */
    tailscaleId: z.string().optional(),
    /** Authenticated MagicDNS hostname derived from PeerInfo.whois.deviceName
     * only after the lawful ULID → Tailscale-id registry join. It is deliberately
     * absent from DeviceSlice: a peer may not self-assert the host used to bind
     * an Artifact Hub URL. */
    tailnetDnsName: z.string().min(1).max(253).optional(),
  })
  .passthrough();
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const DeviceListResult = z.object({ devices: z.array(DeviceInfo) }).passthrough();
export type DeviceListResult = z.infer<typeof DeviceListResult>;

export const DeviceGetParams = z.object({ deviceId: z.string() }).passthrough();
export type DeviceGetParams = z.infer<typeof DeviceGetParams>;
