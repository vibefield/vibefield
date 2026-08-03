import { z } from "zod";

// DeviceService wire shapes (design-04 §3.1, D31 — the C4 P1-lite subset).
// The roster fuses self-slices in the `field.devices.v1` SyncedStore with
// tailnet peer liveness; presence heartbeats (source 3) are deferred with the
// spec's own verify-item. TS-only — nothing here crosses to Rust (the store
// carries opaque JSON slices; field-native never reads them).

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
    serve: z.string(),
    url: z.string().optional(),
  })
  .passthrough();
export type ProductEndpoint = z.infer<typeof ProductEndpoint>;

/** One device's self-published slice in `field.devices.v1` (published on boot
 * and on change; the slice key IS the writer's mesh deviceId — D30). */
export const DeviceSlice = z
  .object({
    deviceId: z.string(),
    name: z.string(),
    platform: z.string(),
    headless: z.boolean(),
    fielddVersion: z.string(),
    contractsVersion: z.string(),
    capabilities: DeviceCapabilities,
    productEndpoint: ProductEndpoint.optional(),
    bootId: z.string(),
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
