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
    terminalHost: z.boolean(),
    docHost: z.boolean(),
    push: z.boolean(),
  })
  .passthrough();
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

/** How to reach this device's product surface. Recorded delta from the spec's
 * "(mesh.serve name)": the FULL capability URL rides here too — C3's secret-path
 * design means the serve name alone cannot be dialed, and this same-user-private
 * store is exactly the distribution channel C3 reserved for it. `url` is present
 * only while the serve is active. */
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

/** The roster row: a slice fused with liveness. `online` derives from tailnet
 * peer state (self is always online); `lastSeenAt` = max(publishedAt, peer
 * last-seen) — honest without heartbeats. `link` is PeerLink's live verdict
 * about OUR connection to the device (C5/D32) — absent when never dialed. */
export const DeviceInfo = DeviceSlice.extend({
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
}).passthrough();
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const DeviceListResult = z.object({ devices: z.array(DeviceInfo) }).passthrough();
export type DeviceListResult = z.infer<typeof DeviceListResult>;

export const DeviceGetParams = z.object({ deviceId: z.string() }).passthrough();
export type DeviceGetParams = z.infer<typeof DeviceGetParams>;
