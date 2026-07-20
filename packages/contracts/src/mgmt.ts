import { z } from "zod";

// Management channel (design-01 §5.2, M2 subset): native.lifecycle.* + the mesh
// facade P0 subset (peers / store / serve). Laws honored here:
// - survivor set only: desired state carries adoption + persistence policy,
//   NEVER interactive ops (design-02 §2.7);
// - facade state is rebuilt-not-persisted — fieldd replays its declarative set
//   on reconnect/rebuild ("re-serving is re-creating");
// - every inbound mesh delivery carries WhoIs identity (v0.5 requirement).

// ---- lifecycle ----

export const UnitState = z.enum(["starting", "up", "degraded", "crashed"]);
export type UnitState = z.infer<typeof UnitState>;

export const UnitHealth = z
  .object({
    /** "mgmt" | "mesh-gateway" | "terminal" | "mesh-bridge" | "process" */
    unit: z.string(),
    state: UnitState,
    detail: z.string().optional(),
    /** mesh-gateway during browser auth (design-02 §2.4) */
    authUrl: z.string().optional(),
  })
  .passthrough();
export type UnitHealth = z.infer<typeof UnitHealth>;

export const NativeHealth = z
  .object({
    state: z.enum(["starting", "up", "degraded"]),
    bootId: z.string(),
    units: z.array(UnitHealth),
  })
  .passthrough();
export type NativeHealth = z.infer<typeof NativeHealth>;

export const DesiredTerminal = z
  .object({
    sessionId: z.string(),
    /** ghosttea persistence-policy name — opaque passthrough (reference-don't-remodel) */
    persistence: z.string().optional(),
  })
  .passthrough();
export type DesiredTerminal = z.infer<typeof DesiredTerminal>;

export const DesiredWorker = z
  .object({
    id: z.string(),
    kind: z.string(),
    config: z.unknown().optional(),
  })
  .passthrough();
export type DesiredWorker = z.infer<typeof DesiredWorker>;

/** Gateway knobs fieldd may declare; deliberately empty at P0 (tolerant growth). */
export const MeshConfig = z.object({}).passthrough();
export type MeshConfig = z.infer<typeof MeshConfig>;

export const DesiredState = z
  .object({
    generation: z.number().int(),
    /** THE survivor set — sessions not listed run their terminate ladder */
    terminals: z.array(DesiredTerminal),
    workers: z.array(DesiredWorker),
    meshConfig: MeshConfig.optional(),
  })
  .passthrough();
export type DesiredState = z.infer<typeof DesiredState>;

export const ObservedTerminal = z
  .object({
    sessionId: z.string(),
    pid: z.number().int().optional(),
    /** epoch millis. LAW: wire timestamps are ALWAYS integers — bare z.number()
     * becomes f64 in generated Rust and drifts on re-serialization (caught by parity). */
    createdAt: z.number().int().optional(),
    persistence: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();
export type ObservedTerminal = z.infer<typeof ObservedTerminal>;

export const ObservedWorker = z
  .object({ id: z.string(), state: UnitState })
  .passthrough();
export type ObservedWorker = z.infer<typeof ObservedWorker>;

export const ObservedState = z
  .object({
    /** last applied desired generation (0 = none since boot) */
    generation: z.number().int(),
    bootId: z.string(),
    terminals: z.array(ObservedTerminal),
    workers: z.array(ObservedWorker),
  })
  .passthrough();
export type ObservedState = z.infer<typeof ObservedState>;

// ---- mesh facade (P0 subset: peers / store / serve) ----

/** The spoof-safe Tailscale-User-* triple, injected at the sidecar bridge. */
export const WhoIsIdentity = z
  .object({
    login: z.string(),
    deviceName: z.string().optional(),
    tailscaleId: z.string().optional(),
  })
  .passthrough();
export type WhoIsIdentity = z.infer<typeof WhoIsIdentity>;

/** Truffle peer, mirrored minimally (parity fixture vs truffle-core serde lands with the embedding). */
export const PeerInfo = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    online: z.boolean(),
    addresses: z.array(z.string()).optional(),
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type PeerInfo = z.infer<typeof PeerInfo>;

/** SyncedStore view: device-owned slices, merged at the reader. `store.set` writes OWN slice only. */
export const StoreSnapshot = z
  .object({
    storeId: z.string(),
    slices: z.record(z.unknown()),
  })
  .passthrough();
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;

export const ServeTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("port"), port: z.number().int().min(1).max(65535) }).passthrough(),
  z.object({ kind: z.literal("dir"), path: z.string() }).passthrough(),
]);
export type ServeTarget = z.infer<typeof ServeTarget>;

export const ServeConfig = z
  .object({
    name: z.string(),
    target: ServeTarget,
    /** per-route allow-globs (WhoIs-gated at the proxy) */
    allow: z.array(z.string()).optional(),
  })
  .passthrough();
export type ServeConfig = z.infer<typeof ServeConfig>;

export const ServeEntry = z
  .object({
    name: z.string(),
    target: ServeTarget,
    url: z.string(),
    allow: z.array(z.string()).optional(),
  })
  .passthrough();
export type ServeEntry = z.infer<typeof ServeEntry>;
