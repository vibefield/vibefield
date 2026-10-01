import { z } from "zod";
import { TerminalCellRole, TerminalRouteCell, TerminalWorkloadClass } from "./envelope";
import { UnavailableDetails } from "./errors";
import { PORTS } from "./registries";

// Management channel (design-01 §5.2, M2 subset): native.lifecycle.* + the mesh
// facade P0 subset (peers / store / serve). Laws honored here:
// - survivor set only: desired state carries adoption + persistence policy,
//   NEVER interactive ops (design-02 §2.7);
// - facade state is rebuilt-not-persisted — fieldd replays its declarative set
//   on reconnect/rebuild ("re-serving is re-creating");
// - every inbound mesh delivery carries WhoIs identity (v0.5 requirement).

// ---- lifecycle ----

export const UnitState = z.enum(["starting", "up", "degraded", "crashed", "disabled"]);
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
    /** NF-D2(b) — adopt-before-authority: a set that would TERMINATE ≥1
     * running session must prove it saw THIS boot's inventory by echoing the
     * current native bootId; mismatch or absence ⇒ PRECONDITION_FAILED and
     * zero terminations. Retain-only sets may omit it (silence kills nothing —
     * NF-D2(a)). */
    observedBootId: z.string().optional(),
  })
  .passthrough();
export type DesiredState = z.infer<typeof DesiredState>;

/** TC-S3 — which cell a session lives on: the inventory's `cell` tag (§5).
 * Identity mirrors the route row (`cellBootId` is THE identity; the ordinal is
 * the socket-name suffix), so a reader can join inventory rows onto routes —
 * ticket routing, per-cell loss receipts ("blast counted"), and the observed
 * side of spawn-isolation all key on this. Deliberately WITHOUT endpoints or
 * token: the tag names placement, the route snapshot owns coordinates. */
export const ObservedTerminalCell = z
  .object({
    cellInstanceId: z.number().int(),
    cellBootId: z.string(),
    workloadClass: TerminalWorkloadClass.optional(),
    role: TerminalCellRole.optional(),
  })
  .passthrough();
export type ObservedTerminalCell = z.infer<typeof ObservedTerminalCell>;

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
    /** TC-S3 — the hosting cell. ABSENT on a pre-TC-S3 floor and in the
     * mesh-flagged in-process serve (there is no cell; tolerant readers fall
     * back to the legacy single-cell reading). */
    cell: ObservedTerminalCell.optional(),
  })
  .passthrough();
export type ObservedTerminal = z.infer<typeof ObservedTerminal>;

export const ObservedWorker = z.object({ id: z.string(), state: UnitState }).passthrough();
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

/** E-F1 — the payload of `native.lifecycle.terminal.routes` (the subscribe
 * result's `snapshot` and every `.delta`): the route snapshot, plus the floor's
 * LIVE answer to "are these doors published on the tailnet".
 *
 * WHY THE BOOLEAN RIDES HERE AT ALL. `HelloAck.terminalMesh` is read exactly
 * once, at a moment it is predictably FALSE: the floor's mesh node is installed
 * by a spawned bring-up task that returns long before the node exists
 * (`field-native/src/services/mesh.rs`), while the mgmt listener binds
 * immediately after `start_all` and fieldd hellos as soon as the socket
 * answers. tsnet bring-up takes seconds. So a cold boot with the flag set reads
 * `terminalMesh: false` and — the ack being the only writer — keeps reading
 * false until fieldd re-pairs for some unrelated reason: no routes declared,
 * the field's `terminal` joins withheld, `terminal.openTicket` refusing
 * `doors_not_published` on a floor whose doors came up seconds after the hello.
 * This field is the floor PUSHING the correction on the stream it already owns.
 *
 * TOLERANT BY CONSTRUCTION, and the tolerance is the whole contract: ABSENT
 * means "this payload says nothing about the mesh" and a reader KEEPS the value
 * the hello gave it. That is what a floor predating E-F1 sends on every delta,
 * so absence must never be read as `false` — it is not a reading at all. A
 * present boolean is authoritative and supersedes the hello's.
 *
 * Secret-free like the hello's (EL7): a boolean, never the node's name, the
 * capability, or a port. The snapshot half is unchanged — `revision` still
 * orders, `cells` is still the full state-transfer payload (TC-D15) — so a
 * reader that knows only `TerminalRouteSnapshot` parses this shape correctly
 * and ignores the extra key. */
export const TerminalRoutesStreamPayload = z
  .object({
    revision: z.number().int(),
    /** SPELLED OUT rather than `TerminalRouteSnapshot.extend(...)`, and that is
     * a codegen constraint, not a style choice: `.extend()` hands
     * zod-to-json-schema the SAME `z.array(TerminalRouteCell)` instance the
     * snapshot already emitted, which it dedupes into
     * `#/definitions/TerminalRouteSnapshot/properties/cells` — a nested path
     * `cargo typify` cannot resolve (it panics outright). A fresh array
     * instance renders as `items: {$ref: "#/definitions/TerminalRouteCell"}`
     * in both places, which is the shape the Rust side needs. */
    cells: z.array(TerminalRouteCell),
    terminalMesh: z.boolean().optional(),
  })
  .passthrough();
export type TerminalRoutesStreamPayload = z.infer<typeof TerminalRoutesStreamPayload>;

// ---- TC-S1 supervision (specs/terminal-custody.md TC-D1/TC-D2) ----

/** fieldd's EXTERNAL judgment of the floor + its link, surfaced in FielddHealth
 * and as UNAVAILABLE {service:"native", state} on doors that need the floor.
 * Deliberately NOT UnitState: a wedged floor cannot self-report — the whole
 * point (TC-D2) is distinguishing "crashed" (socket gone, kernel says so) from
 * "unresponsive" (alive, not answering the control path). */
export const NativeLinkState = z.enum(["connecting", "up", "unresponsive", "respawning", "gone"]);
export type NativeLinkState = z.infer<typeof NativeLinkState>;

/** native.lifecycle.ping — the TC-D2 heartbeat probe. Rides the SAME control
 * path as every real request end-to-end (socket → framing → dispatch → reply),
 * so a wedge anywhere on that path is exactly what it measures. The ack echoes
 * the boot id so a supervisor also notices a floor that restarted underneath a
 * surviving socket. */
export const PingAck = z.object({ bootId: z.string(), ts: z.number().int() }).passthrough();
export type PingAck = z.infer<typeof PingAck>;

/** TC-D1/TC-D2 supervision timings (fieldd-side). Detection-to-STATE is ≤250ms
 * (two misses of interval+deadline 100/100); the DESTRUCTIVE step (kill +
 * respawn of a wedged floor) waits out WEDGE_CONFIRM_MS of continued misses,
 * because a loaded-host scheduling stall (measured: vault-free round trips p99
 * 24–37ms at load ~40, max 69ms — spike LOCK-1) must never kill a healthy
 * floor. State is reversible; SIGKILL is not. */
export const NATIVE_SUPERVISION = {
  /** default deadline for ordinary mgmt requests (pre-TC-S1, rawRequest waited forever) */
  REQUEST_DEADLINE_MS: 10_000,
  HEARTBEAT_INTERVAL_MS: 100,
  HEARTBEAT_DEADLINE_MS: 100,
  /** stage 2 — fired immediately after a first miss */
  HEARTBEAT_PROBE_DEADLINE_MS: 50,
  HEARTBEAT_MISS_THRESHOLD: 2,
  /** unresponsive → kill+respawn only after this much CONTINUED silence */
  WEDGE_CONFIRM_MS: 3_000,
  /** TC-D1 — respawn only after this many failed redials AND a fresh endpoint
   * probe confirming no listener (the double-spawn probe stays in force) */
  RESPAWN_AFTER_REDIALS: 3,
  /** bounded intensity; past it: permanent honest degraded state + the restart verb */
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 60_000,
} as const;

/** TC-D6(e) — resource-pressure state spellings shared by emitters and readers
 * (UnavailableDetails.state / UnitHealth.detail). */
export const RESOURCE_PRESSURE_STATES = ["fd_pressure", "pty_exhausted"] as const;

// RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3): the
// mirror-write capability's mgmt shapes (MF-2a, GM-D5) —
// `NativeTerminalMirrorWriteCapabilityParams` and `...Result {configured,
// capability?}`, the one hop that ever carried the floor's durable write secret
// off the floor. Deleted with the verb, the mint, the key file and the env var;
// the write right is a claim in a per-client expiring attach grant now. No
// replacement shape belongs here: the grant is minted on the PRODUCT plane from
// the cell's own key, and the floor never hands a secret to fieldd for it.

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

/** Truffle peer, mirrored minimally (parity fixture vs truffle-core serde lands with the embedding).
 * TWO id keyspaces ride here, and truffle's contract says they never collide:
 * `id` is the Tailscale stable node id (what `lane.open`/`resolve_peer` dial);
 * `deviceId` is the durable published ULID — the SyncedStore slice key (D30).
 * Joins must never mix them (the T1 §6 keyspace bug). `deviceId` is absent for
 * peers that never published into the mesh registry. */
export const PeerInfo = z
  .object({
    id: z.string(),
    deviceId: z.string().optional(),
    name: z.string().optional(),
    online: z.boolean(),
    addresses: z.array(z.string()).optional(),
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type PeerInfo = z.infer<typeof PeerInfo>;

/** UA-3 — `native.mesh.self`: the node's OWN identity, including the S1
 * self-whois login (best-effort — absent means the sidecar could not answer
 * for self, or a tagged node has no user; never synthesized, EL7). This is
 * the left-hand side of UA-4's self/guest comparison, captured once at link
 * time into link.json, never looked up per request.
 *
 * UA-P-4 (RFC 025 §3.6) — `loginAllow` is the node's own GATE: the login globs
 * the installed node was BUILT with, which truffle fixes for its lifetime
 * (§3.1). `[]` is truffle's "no gate" and is the honest answer for capture mode
 * and for the `FIELD_NATIVE_MESH` development override; the product's linked
 * node carries exactly one entry, its account's login.
 *
 * REQUIRED, and deliberately not optional. The question it answers — "is this
 * node admitting only my account?" — has no third state: a floor either knows
 * what it built its node with or has no node to describe. An optional field
 * would let an absent value read as "ungated" at exactly the reader that most
 * needs to fail closed, which is the shape of every fail-open bug UA-P-0 spent
 * itself closing. It is NOT derived from the posture: between
 * `native.mesh.start {mode:"linked"}` and the rebuild that gate change forces,
 * the posture already says linked while the live node is still ungated, and
 * this field tracks the node. */
export const MeshSelfIdentity = z
  .object({
    deviceId: z.string(),
    deviceName: z.string().optional(),
    dnsName: z.string().optional(),
    tailscaleId: z.string().optional(),
    ip: z.string().optional(),
    login: z.string().optional(),
    loginAllow: z.array(z.string()),
  })
  .passthrough();
export type MeshSelfIdentity = z.infer<typeof MeshSelfIdentity>;

/** UA-P-0a (D1) — the mesh POSTURE, which derives from the link and from
 * nothing else. The floor runs no tailnet node until fieldd asks for one:
 *
 *  - `capture` — the user's Link act. The interactive login runs and
 *    `native.mesh.self` starts answering once the netmap loads. NOTHING may be
 *    declared or published in this mode: the floor itself refuses `serve.add`
 *    and `store.set` (the belt), and fieldd declares no serve and publishes no
 *    slice (the suspenders). The account is not known yet, so nothing can be
 *    scoped to it.
 *  - `linked` — a login was captured and IS the account. Every surface is
 *    scoped to it; the floor carries the login so a later upstream gate
 *    (UA-P-4) has it in hand without a second round trip.
 *
 * Unlinked is the absence of both: no node, no serve, no store, no lane. */
export const MeshMode = z.enum(["capture", "linked"]);
export type MeshMode = z.infer<typeof MeshMode>;

/** UA-P-0a — `native.mesh.start`: bring the node up in one posture, or move a
 * running node to another (capture → linked is the ordinary promotion at the
 * moment the login lands). `login` is REQUIRED in `linked` mode and refused in
 * `capture` mode — a captured login is the only thing that may name an
 * account, and pre-capture there is nothing to name. */
export const MeshStartParams = z
  .object({
    mode: MeshMode,
    login: z.string().min(1).optional(),
  })
  .passthrough();
export type MeshStartParams = z.infer<typeof MeshStartParams>;

/** `started: false` = the node was already up in this exact posture — an
 * idempotent re-ask, not a failure. A posture CHANGE always reports true. */
export const MeshStartResult = z
  .object({
    mode: MeshMode,
    started: z.boolean(),
  })
  .passthrough();
export type MeshStartResult = z.infer<typeof MeshStartResult>;

/** UA-P-0a — `native.mesh.stop`: drop the node without touching the identity
 * on disk. This is NOT unlink (`native.mesh.retire` archives the state dir and
 * mints a fresh identity on relink); it is the posture going offline — a
 * capture that could not learn a login, or a login another local user already
 * holds. `stopped: false` = there was no node — an honest no-op. */
export const MeshStopResult = z
  .object({
    stopped: z.boolean(),
  })
  .passthrough();
export type MeshStopResult = z.infer<typeof MeshStopResult>;

/** UA-3 — `native.mesh.retire`: unlink's native half. Stops the node (the
 * sidecar dies with it), archives the state dir to `mesh.retired-<ts>`
 * beside itself, and reports where. `retired: false` = nothing to retire
 * (no state on disk) — an honest no-op, not an error. Answered BEFORE the
 * node gate: retiring a half-authed or disabled mesh must still work. */
export const MeshRetireResult = z
  .object({
    retired: z.boolean(),
    archivedTo: z.string().nullable(),
  })
  .passthrough();
export type MeshRetireResult = z.infer<typeof MeshRetireResult>;

/** SyncedStore view: device-owned slices, merged at the reader. `store.set` writes OWN slice only. */
export const StoreSnapshot = z
  .object({
    storeId: z.string(),
    slices: z.record(z.unknown()),
  })
  .passthrough();
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;

/** TM-2 (TM-D2) — a route prefix as the floor's `parse_cell_routes` admits it
 * (`field-native/src/mgmt/mesh.rs`): ABSOLUTE, and with NO trailing slash
 * unless the prefix is the root itself.
 *
 * The trailing-slash rule is a measurement, not a preference (TM-2b,
 * 2026-09-14, sidecar-slim at the pinned truffle 0.7.12): `/cell/<boot>/` never
 * matched `/cell/<boot>/control` at all, while `/cell/<boot>` matched it and
 * handed the backend `/control`, which is the exact path a cell door requires.
 * The law and its evidence live on `remoteCellRoutePrefix`; this is the same
 * rule stated where the WIRE is described, so a spec that would be refused by
 * the floor is refused before it is sent. */
export const SERVE_ROUTE_PREFIX_PATTERN = "^\\/(?:[\\s\\S]*[^\\/])?$";

/** TM-2 (TM-D2) — one declared route on a `routes` serve: a path prefix onto
 * ONE loopback port, and DELIBERATELY nothing else.
 *
 * The narrowness is the EL7 argument, and it is the floor's: `parse_cell_routes`
 * admits a prefix and a port and refuses everything a truffle `ProxyRoute` can
 * otherwise carry — a static dir, a non-loopback target, a fallback, or a
 * per-route allow-list that would override the serve's login gate. `stripPrefix`
 * is not a field either: the floor sets it TRUE for every one of these, because
 * a cell's door matches `/control` and `/frames` exactly and answers anything
 * else with `HelloMalformed`. So the worst a compromised fieldd can publish
 * through this door is another loopback port on a machine it already owns. */
export const ServeRoute = z
  .object({
    prefix: z.string().regex(new RegExp(SERVE_ROUTE_PREFIX_PATTERN)),
    /** the cell's loopback T1 door; the floor composes `http://127.0.0.1:<port>` */
    targetPort: z.number().int().min(1).max(65535),
  })
  .passthrough();
export type ServeRoute = z.infer<typeof ServeRoute>;

export const ServeTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("port"),
      port: z.number().int().min(1).max(65535),
      scheme: z.enum(["http", "https"]).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("dir"),
      path: z.string(),
      fallback: z.literal("/index.html").optional(),
    })
    .passthrough(),
  /** TM-2 (TM-D2) — a serve whose ENTIRE surface is `ServeConfig.routes`, with
   * no implicit root route: the terminal-cell listener. The `port` arm mounts a
   * catch-all `/` at its target whenever a listener port is named, and a
   * catch-all on THIS listener would publish whatever single port the shape
   * happened to carry — fieldd's own control port, in the natural spelling — so
   * an unmatched path here reaches no backend at all.
   *
   * ADDED 2026-09-14 (F-H3): fieldd has been sending this kind and the floor has
   * been implementing it since TM-2, while the contract described two arms. The
   * typify'd Rust twin therefore could not deserialize the spec the daemon
   * really sends, and `serve-config.valid.json` pinned a shape nothing on this
   * seam uses — an EL9 golden blind to the live wire. */
  z
    .object({
      kind: z.literal("routes"),
    })
    .passthrough(),
]);
export type ServeTarget = z.infer<typeof ServeTarget>;

export const ServeConfig = z
  .object({
    /** Stable engine identity. Omitted by v1 callers, where it defaults to name. */
    serveId: z.string().min(1).optional(),
    name: z.string(),
    /** Tailnet listener, independent of a port target. Omitted preserves v1 behavior. */
    listenPort: z.number().int().min(1).max(65535).optional(),
    target: ServeTarget,
    /** per-route allow-globs (WhoIs-gated at the proxy, pre-injection, fails
     * closed on empty caller login — tagged nodes never reach the backend) */
    allow: z.array(z.string()).optional(),
    /** false = plain HTTP inside WireGuard (no MagicDNS-cert dependency —
     * the product-API serve's choice). Default true upstream. v2-sidecar. */
    tls: z.boolean().optional(),
    /** TM-2 — the declared path routes. ONLY meaningful for `target.kind:
     * "routes"`, where they are the serve's whole surface; every other kind
     * ignores them. The floor REFUSES an empty list on a routes serve, because
     * truffle reads `routes.is_empty()` as "use the single-target shape" and
     * would silently fall back to a default target — a caller with nothing to
     * publish removes the serve instead, which is what fieldd's driver does. */
    routes: z.array(ServeRoute).optional(),
    /** Optional app-owned static preview root mounted ahead of the source route. */
    previewDir: z.string().min(1).optional(),
    /** C3 provenance proof: when set, the serve is a single route
     * `/t/<pathSecret>` → the target with strip_prefix OFF, so the backend
     * sees the secret on every proxied request. Only the sidecar's route
     * config and the declaring daemon hold it — a same-uid local caller
     * (EL7's adversary) cannot mint tailnet identity without it. */
    pathSecret: z.string().optional(),
  })
  .passthrough();
export type ServeConfig = z.infer<typeof ServeConfig>;

/** ProxyStatus/ProxyEvent mirror — the serve's live runtime state. */
export const ServeStatus = z.enum(["starting", "running", "stopped", "error"]);
export type ServeStatus = z.infer<typeof ServeStatus>;

export const ServeEntry = z
  .object({
    serveId: z.string().min(1),
    name: z.string(),
    listenPort: z.number().int().min(1).max(65535),
    target: ServeTarget,
    url: z.string(),
    allow: z.array(z.string()).optional(),
    /** Benign declared listener policy, rehydrated from field-native's private config cache. */
    tls: z.boolean().optional(),
    status: ServeStatus.optional(),
    /** ProxyEvent::Error passthrough (SERVE_ERROR / CONNECTION_REFUSED / …) */
    error: z.string().optional(),
  })
  .passthrough();
export type ServeEntry = z.infer<typeof ServeEntry>;

// ---- MeshData lanes (C6 / D5) ----
//
// CONTROL ONLY. Lane bytes ride native/run/meshdata.sock (see meshdata.ts);
// nothing below ever carries a payload. That split is EL2 made structural: a
// lane is negotiated on a contract surface and then gets out of the way, so
// doc bytes never touch JSON-RPC and control never queues behind a snapshot.

/** Delivery class, mapped 1:1 from strata's DeliveryClass by fieldd's Channel
 * impl. `reliable` = one QUIC stream per lane (per-lane FIFO, flow control
 * propagates); `lossy` = bounded logical snapshots fragmented into datagrams,
 * latest-first healing, with reliable terminal replay on graceful close. */
export const MeshLaneClass = z.enum(["reliable", "lossy"]);
export type MeshLaneClass = z.infer<typeof MeshLaneClass>;

/** What the lane carries. The BRIDGE does not interpret this — it is dumb by
 * design (D5) — but fieldd routes inbound lanes by it, and it is what makes a
 * `lane.peerOpened` actionable without decoding a byte. */
export const MeshLaneProtocol = z.enum(["doc-sync", "presence"]);
export type MeshLaneProtocol = z.infer<typeof MeshLaneProtocol>;

/** native.mesh.lane.open — fieldd asks the bridge for a lane to a peer.
 * The caller mints laneId: it owns the numbering for lanes it opens, which
 * removes a round-trip and lets it send DATA as soon as the call returns. */
export const MeshLaneOpenRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    class: MeshLaneClass,
    /** truffle peer id, as carried by PeerInfo.id */
    peer: z.string(),
    protocol: MeshLaneProtocol,
    /** Document room this lane is for (`doc-sync` and `presence`). A snapshot
     * takes its own short-lived lane, so this is not unique per document. */
    docId: z.string().optional(),
  })
  .passthrough();
export type MeshLaneOpenRequest = z.infer<typeof MeshLaneOpenRequest>;

export const MeshLaneCloseRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    reason: z.string().optional(),
  })
  .passthrough();
export type MeshLaneCloseRequest = z.infer<typeof MeshLaneCloseRequest>;

/** Notification: a PEER opened a lane to us. Lane ids from the two directions
 * share no space, so the `inbound` flag is what keeps them apart rather than a
 * numbering convention nobody can enforce across a network. */
export const MeshLanePeerOpened = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.literal(true),
    class: MeshLaneClass,
    peer: z.string(),
    protocol: MeshLaneProtocol,
    docId: z.string().optional(),
    /** WhoIs-verified identity of the opening peer — every inbound delivery
     * carries it (the v0.5 requirement), so authorization never rests on a
     * self-declared id. */
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type MeshLanePeerOpened = z.infer<typeof MeshLanePeerOpened>;

/** Notification: a lane ended, from either side. Lanes are cheap and mortal —
 * D5's law is that a torn frame tears the LANE, never the daemon — so this is
 * an ordinary event, not an error path. */
export const MeshLaneClosed = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.boolean().optional(),
    /** "peer-closed" | "peer-unreachable" | "torn-frame" | "local" | … —
     * open vocabulary, logged verbatim (tolerant reader). */
    reason: z.string(),
  })
  .passthrough();
export type MeshLaneClosed = z.infer<typeof MeshLaneClosed>;

// ---- egress (DS-1 · design-02 §2.4's egress bullet · design-06 §3 · petition T7 = truffle RFC 026) ----
//
// The mirror image of `serve`. Serving publishes a loopback port ONTO the
// tailnet; egress lets a process on THIS desktop reach a peer THROUGH its own
// node, so no desktop-to-desktop path depends on the operating system's
// Tailscale app (DS-L5). Three rungs, all in the sidecar, so bytes cross a
// process boundary once per side as they do inbound:
//
//   E1 `proxy`      the node's own authenticated SOCKS5 (tsnet `Loopback()`);
//                   fieldd's PeerLink dials a peer's door through it.
//   E2 `route.*`    a loopback listener with a FIXED tailnet target, one per
//                   peer door; a renderer dials a remote cell as it dials a
//                   local one.
//   E3 `httpProxy`  an authenticated HTTP CONNECT proxy for the artifact and
//                   browser partition (Chromium cannot authenticate to SOCKS5).
//
// CONTROL ONLY: an address, a credential, a route row. Nothing that rides an
// egress path ever crosses this channel (EL2).
//
// Until the sidecar speaks RFC 026 the floor answers every verb
// `UNAVAILABLE {service: "mesh", state: "egress-unsupported"}`. That is a
// capability fact, not a transient: fieldd keeps dialling over the OS network
// and says so once per link (`mesh.egress.fallback_os_network`).
// Corrected 2026-10-01 (DS-1b, review D4 + D5): fieldd asks once per FLOOR
// BOOT and says it once per boot (`FloorEgress` in fieldd's egress.ts), and
// `egress-unsupported` is the ONLY answer that takes the OS network:
// `mesh-down`, a timeout or a mgmt link mid-reconnect fail the dial closed
// (DS-L5).

/** The egress registry. Generated into Rust (`registries::mesh_egress`) so the
 * floor's belt and fieldd's suspenders read ONE list, never two copies. */
export const MESH_EGRESS = {
  /** `UnavailableDetails.service` on every egress refusal. */
  SERVICE: "mesh",
  /** The sidecar predates RFC 026. A CAPABILITY fact that holds for the
   * floor's whole life, so a reader falls back instead of retrying. */
  STATE_UNSUPPORTED: "egress-unsupported",
  /** Egress exists, but no node is installed right now (the posture is
   * offline, or the node is starting or rebuilding). */
  STATE_MESH_DOWN: "mesh-down",
  /** DS-L6 — the ONLY tailnet ports an unauthenticated loopback route may
   * target: doors that demand their own grant. A terminal cell verifies a MAC
   * on its first frame; the product door trusts the node's login and is
   * reached only through the authenticated proxy (E1), never through a route.
   * A new row here is a claim about a door's authentication, made in review. */
  ROUTABLE_PORTS: [PORTS.TERMINAL_CELLS_SERVE],
} as const;

/** 1–65535 with no leading zero, as a PATTERN rather than a refinement so the
 * generated Rust twin checks the same rule (typify carries `pattern`; a zod
 * refinement never reaches it). */
const EGRESS_PORT =
  "(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";

/** A listener the floor bound for this desktop: a LITERAL loopback address and
 * a port. Never a name: a name is resolved, a resolver can be pointed
 * elsewhere, and whoever answered would be handed the credential. */
export const MESH_EGRESS_LOOPBACK_PATTERN = `^(?:127\\.0\\.0\\.1|\\[::1\\]):${EGRESS_PORT}$`;
export const MeshEgressLoopbackAddress = z
  .string()
  .regex(new RegExp(MESH_EGRESS_LOOPBACK_PATTERN), "a literal loopback host:port");
export type MeshEgressLoopbackAddress = z.infer<typeof MeshEgressLoopbackAddress>;

/** A route's FIXED tailnet target, `<peer-fqdn-or-ip>:<port>`: a DNS name
 * (MagicDNS), a dotted IPv4, or a bracketed IPv6. Syntax only. Whether the
 * target is a peer the node's login gate admits is the sidecar's refusal to
 * make (RFC 026 E2); which PORTS may be routed at all is DS-L6's
 * (`MESH_EGRESS.ROUTABLE_PORTS`), enforced by the floor. */
export const MESH_EGRESS_TARGET_PATTERN = `^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\\[[0-9A-Fa-f:.]{2,45}\\]):${EGRESS_PORT}$`;
export const MeshEgressTarget = z
  .string()
  .max(259)
  .regex(new RegExp(MESH_EGRESS_TARGET_PATTERN), "<peer-fqdn-or-ip>:<port>");
export type MeshEgressTarget = z.infer<typeof MeshEgressTarget>;

/** A route's name. The CALLER mints it (fieldd keys one per `{peer, port}`),
 * so an add replayed after a reconnect names the same route instead of
 * binding a second listener. A conservative charset, because the sidecar
 * carries it as its own key. */
export const MESH_EGRESS_ROUTE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export const MeshEgressRouteId = z.string().regex(new RegExp(MESH_EGRESS_ROUTE_ID_PATTERN));
export type MeshEgressRouteId = z.infer<typeof MeshEgressRouteId>;

/** `native.mesh.egress.proxy {}` (E1, SOCKS5) and `native.mesh.egress.httpProxy {}`
 * (E3, HTTP CONNECT): one answer shape for both, where the proxy listens and
 * the username and credential it demands (RFC 1929 for the SOCKS5, Basic for
 * the HTTP proxy). The username is the substrate's constant — tsnet's
 * loopback proxy fixes it (`LOOPBACK_SOCKS5_USERNAME = "tsnet"` in truffle-core
 * as built for RFC 026) — and rides the answer so no reader hardcodes it. The
 * credential is the only secret on this seam: it rides the paired channel
 * once per ask and lives in fieldd's memory, never a log, a file or an
 * environment (EL7). */
export const MeshEgressProxy = z
  .object({
    address: MeshEgressLoopbackAddress,
    username: z.string().min(1).max(255),
    credential: z.string().min(1).max(1024),
  })
  .passthrough();
export type MeshEgressProxy = z.infer<typeof MeshEgressProxy>;

/** `native.mesh.egress.route.add`: bind a loopback listener whose every
 * connection is dialled, through the node, to `target`. Idempotent per id:
 * the same id with the same target answers the route already bound, and the
 * same id with ANOTHER target is a CONFLICT, because a route never silently
 * re-aims. `login` is an optional allow-glob the sidecar checks against the
 * target's WhoIs at bind (RFC 026 E2's option). */
export const MeshEgressRouteAddParams = z
  .object({
    id: MeshEgressRouteId,
    target: MeshEgressTarget,
    login: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type MeshEgressRouteAddParams = z.infer<typeof MeshEgressRouteAddParams>;

/** The table's REVISION: the facade's change counter, bumped by every add,
 * remove and reset (TC-D15's discipline for route snapshots, reused). It
 * orders an answer against the stream: the table stream's forwarder runs
 * beside the handler, so a snapshot read just before an add can reach the
 * reader AFTER that add's answer, and without an order it would read as
 * "the route is gone". A snapshot whose revision is below the one a route was
 * bound at says nothing about that route.
 *
 * A revision orders only within ONE floor boot: a respawned floor counts from
 * zero again, so both shapes carry the floor's `bootId` beside it, and a table
 * from another boot is authoritative for every route — the routes of the boot
 * that bound them died with it. */
export const MeshEgressRevision = z.number().int().nonnegative();

/** `route.add`'s answer: the loopback address a local process dials, and the
 * table revision this binding is part of. */
export const MeshEgressRouteBound = z
  .object({
    id: MeshEgressRouteId,
    listen: MeshEgressLoopbackAddress,
    revision: MeshEgressRevision,
    /** the floor boot that bound it (`NativeHealth.bootId`) */
    bootId: z.string().min(1),
  })
  .passthrough();
export type MeshEgressRouteBound = z.infer<typeof MeshEgressRouteBound>;

/** `route.remove`'s params AND its answer: a route is named by its id alone.
 * An unknown id is NOT_FOUND, exactly as `serve.remove` answers, so a caller
 * releasing a route that a node rebuild already dropped reads it as done. */
export const MeshEgressRouteRef = z
  .object({
    id: MeshEgressRouteId,
  })
  .passthrough();
export type MeshEgressRouteRef = z.infer<typeof MeshEgressRouteRef>;

/** One row of the route table. */
export const MeshEgressRoute = z
  .object({
    id: MeshEgressRouteId,
    target: MeshEgressTarget,
    listen: MeshEgressLoopbackAddress,
  })
  .passthrough();
export type MeshEgressRoute = z.infer<typeof MeshEgressRoute>;

/** `route.list`'s answer, and the snapshot of `route.subscribe`. The table is
 * REBUILT-NOT-PERSISTED like every facade table (design-02 §2.4): a node
 * teardown or rebuild empties it, and the subscription says so with a fresh
 * snapshot. That snapshot is the facade's `reset` in the P5 idiom, and it is
 * how fieldd learns that every listen address it handed out is dead. */
export const MeshEgressRouteTable = z
  .object({
    routes: z.array(MeshEgressRoute),
    /** the facade's revision this table was read at or after (never before) */
    revision: MeshEgressRevision,
    /** the floor boot whose table this is (`NativeHealth.bootId`) */
    bootId: z.string().min(1),
  })
  .passthrough();
export type MeshEgressRouteTable = z.infer<typeof MeshEgressRouteTable>;

/** The facade's two degraded answers, as `UNAVAILABLE` details
 * (`MESH_EGRESS.STATE_*` says what each means). `gatewayState` rides beside
 * `mesh-down` with the mesh unit's own word, so a reader can say WHY without
 * asking twice. TS-side only: the floor writes these details as JSON, and the
 * `error-data.egress-*` goldens pin what it writes on both sides. */
export const MeshEgressUnavailableState = z.enum([
  MESH_EGRESS.STATE_UNSUPPORTED,
  MESH_EGRESS.STATE_MESH_DOWN,
]);
export type MeshEgressUnavailableState = z.infer<typeof MeshEgressUnavailableState>;
export const MeshEgressUnavailableDetails = UnavailableDetails.extend({
  service: z.literal(MESH_EGRESS.SERVICE),
  state: MeshEgressUnavailableState,
  gatewayState: UnitState.optional(),
}).passthrough();
export type MeshEgressUnavailableDetails = z.infer<typeof MeshEgressUnavailableDetails>;
