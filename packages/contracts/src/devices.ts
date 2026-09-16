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
 * "same-user-private" and readers took that as a guarantee. It was not one.
 * truffle-core broadcast to EVERY tailnet node whose hostname started with
 * `truffle-vibefield-` — no WhoIs, no login check on the store's own path — so
 * the store's audience was the APP's tailnet peers, and same-user held by
 * DEPLOYMENT (UA-D5: the tailnet is this person's) rather than by construction.
 *
 * RESOLVED (2026-09-16, UA-P-4): it is same-account BY CONSTRUCTION now, and
 * the erratum above is kept because the reasoning it corrected is the reasoning
 * that must not come back. RFC 025 gates the node on the linked login, so a
 * store reaches only nodes whose owner's login matches (§3.3), a foreign hello
 * is refused before our identity block (§3.4), and a slice applies only under
 * its sender's authenticated device id (§3.5). GM-D10's posture question is
 * closed by UA-P-D2: the store is scoped to the login identity.
 *
 * WHAT DID NOT CHANGE, and is the more important half: this URL is a LOCATOR,
 * not a capability. UA-P-0d (D7) moved the route secret to the sidecar's target
 * path, so a caller dials a bare root and the sidecar adds the secret on
 * forward. The DOOR behind this URL is still the gate — WhoIs, scopes, the
 * `guestOk` choke — and the gate on the bus does not stand in for it. */
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
 * UA-P-0e (D2, 2026-09-15) — THE SLICE-DERIVED FACTS ARE OPTIONAL, and this row
 * no longer extends `DeviceSlice`. It used to: a roster row WAS a slice fused
 * with liveness, so every field a peer published was a field the roster
 * required. That coupling is what made the row undescribable the moment the bus
 * went quiet, and it stays broken on purpose.
 *
 * UA-P-4 (2026-09-16) — the slices are back (RFC 025 scopes the bus to the
 * account), so a peer row usually carries them again. They remain OPTIONAL
 * because their absence is a real and ordinary state: a self peer the registry
 * lists before its slice has arrived, a peer that published none, a mesh still
 * coming up. A row is then built from the tailnet's own facts — the peer
 * registry, its WhoIs login, a DERIVED door locator — and says nothing it
 * cannot source.
 *
 * Which is the tolerant-reader law applied to ourselves: a peer's OS, its
 * fieldd version, what it can host are claims a device makes about itself, and
 * absence is the honest answer until it has made them. SELF still carries every
 * field; it is this process, and nothing about it has to cross a wire.
 *
 * MEMBERSHIP IS NOT A SLICE'S TO GRANT. A row exists for a device the tailnet's
 * own registry lists for this account; a slice may describe such a device and
 * may never add one. */
export const DeviceInfo = z
  .object({
    deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    platform: z.string().min(1).max(DEVICE_LIMITS.PLATFORM_CHARS).optional(),
    headless: z.boolean().optional(),
    fielddVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    contractsVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    capabilities: DeviceCapabilities.optional(),
    /** UA-P-0e, kept by UA-P-4 — for a PEER this is a derived LOCATOR
     * (`http://<magicdns>:<the registry's product serve port>`) in preference
     * to anything the peer published, and never a secret: D7 moved the route
     * secret to the sidecar's target path, so a door coordinate is all there is
     * to hold. The scoped bus makes a published URL an account peer's claim
     * rather than a stranger's; it is still a claim, and `peer-link` dials it.
     * For SELF it is this daemon's own serve, `url` present only while it is
     * active. */
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
