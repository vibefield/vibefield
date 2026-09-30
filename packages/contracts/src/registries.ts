// Registries-as-code (design-01 §7, P8): ports, stores, namespaces, env prefixes,
// scopes, app id, socket names exist HERE and nowhere else.

export const APP_ID = "vibefield" as const;

/** Installed desktop identity. This deliberately differs from APP_ID, which is
 * the truffle mesh namespace and data-root slug. Windows shortcuts, taskbar
 * grouping, notifications, and the installer all use this frozen value. */
export const DESKTOP_APP_ID = "com.jamesyong.vibefield" as const;

/** Stable native status-item identity, frozen in the release-identity ledger.
 * macOS uses it in development and packaged builds so a user-selected menu-bar
 * position survives relaunches. Windows must wait for a signed package before
 * consuming the same identity (EDP §5.6). */
export const DESKTOP_TRAY_GUID = "c524c40e-05b6-4d89-bbb9-82ba4e97ea91" as const;

/** Development-only MessagePort handoff channels. The Electron Studio graph
 * consumes them, while production entries have no edge to that graph. */
export const STUDIO_PRODUCT_PORT_CHANNEL = "vibefield:studio:product-port:v1" as const;
export const STUDIO_PUBLISHER_PORT_CHANNEL = "vibefield:studio:publisher-port:v1" as const;

/** One place for every port VibeField binds or reserves. */
export const PORTS = {
  /** fieldd product API — renderer control plane (loopback WS, JSON-RPC text). D27.
   * UA-D12: LEGACY DEFAULT, documentation only — every pair binds ephemeral
   * (port 0) since UA-5 and product.json is the only discovery. */
  FIELDD_WS_CONTROL: 9410,
  /** fieldd product API — renderer data lanes (loopback WS, binary, D5 framing). D27.
   * UA-D12: LEGACY DEFAULT, documentation only — see FIELDD_WS_CONTROL. */
  FIELDD_WS_DATA: 9411,
  /** reserved by truffle's own WS bus — never bind. */
  TRUFFLE_WS_RESERVED: 9417,
  // RETIRED 2026-09-14 (TM-1): `GHOSTTEA_TSP1_QUIC` 9420 and `GHOSTTEA_TSP1_TCP`
  // 9421, the ghosttea-truffle TSP1 terminal mirror's two listeners. The floor's
  // in-process serve and its TSP1 adapter retired whole in that slice, so nothing
  // on this device binds either number any more.
  //
  // CORRECTED 2026-09-14 (TM-3): this note said the numbers stayed SPOKEN FOR
  // because "the phone's GhostteaKit still dials 9421 until TM-5". TM-5 landed
  // (`13120801`, `87d13ec9`) — the phone's attachment is a routed T1 client over
  // the sidecar's proxy now, and no VibeField code on any plane dials either
  // port. They are free. The design is `thinking-terminal-mesh-cells.md` (T,
  // ruled 2026-09-14); under it no fixed TSP1 port exists and the cells' proxy
  // listener is `TERMINAL_CELLS_SERVE` below.
  /** TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D2) — the tailnet listener
   * carrying ONE reverse-proxy route per live terminal cell,
   * `/cell/<cellBootId>/control|frames` → that cell's loopback T1 door. fieldd
   * declares it; the sidecar serves it; the floor is never in the byte path.
   *
   * ITS OWN PORT, not the product serve's, and the reason is truffle's API,
   * not taste: `Proxy` offers `add` and `remove` and NO update
   * (truffle-core 0.7.12 `src/proxy/mod.rs`), and a same-id add is
   * `PROXY_EXISTS` — so changing a serve's route list is remove-then-add,
   * which drops every live connection on that listener. Cell routes change
   * whenever a cell is born or exits; the product door is the channel a
   * dropped client would have to re-dial to get a replacement ticket, so
   * bouncing it on cell churn would break the recovery path itself. Confining
   * the churn here costs a terminal data leg a reconnect, which the routed
   * client already handles.
   *
   * ERRATUM 2026-09-14 (N-M3): this sentence used to end "(`STALE_ROUTE` →
   * re-ticket)", which names a mechanism that is UNBUILT. `STALE_ROUTE` (4000)
   * has no production caller — the cell's only raise is `Door::close_set`,
   * reached from tests alone (`field-native/src/tp/door.rs`, which carries the
   * same note and the reason it cannot simply be called). The reconnect this
   * paragraph describes is REAL, but a routed client observes it as a plain
   * TRANSPORT DEATH: the remove-then-add above happens in the sidecar and tears
   * the connections down there, so no cell-side close frame can precede it. The
   * kit's 4000 arm is recovery for an event nothing currently raises. */
  TERMINAL_CELLS_SERVE: 9422,
  /** UA-P-0e (D2) — the product door's TAILNET listener. Fixed, and the reason
   * is the account boundary rather than convenience.
   *
   * Under D2 nothing content-bearing rides the synced-store bus until truffle
   * can gate a store by login, so `field.devices.v1` carries no capability URL
   * any more — it carries nothing, because it is not published. A peer that
   * wants to reach another desktop's door therefore has to DERIVE where it is,
   * and a derivation needs a number that is the same on every device.
   *
   * The serve used to listen on whatever ephemeral port the LOOPBACK control
   * plane happened to bind (UA-D12), which made the port a published fact and
   * the publication the only way to learn it. The two planes are separate now:
   * loopback stays ephemeral, the tailnet listener is this.
   *
   * No host-level collision between two local users: each user's pair has its
   * OWN truffle node with its own tailnet address, and the sidecar's listener
   * binds there — the same reason `TERMINAL_CELLS_SERVE` above can be fixed. */
  FIELDD_PRODUCT_SERVE: 9423,
  /** doc-sync lanes over the mesh (QUIC, snapshot-per-stream). */
  DOC_SYNC_QUIC: 9440,
  /** presence + device heartbeats (UDP, lossy). */
  PRESENCE_UDP: 9441,
  /** push relay (Cloudflare Worker). */
  RELAY_HTTPS: 443,
} as const;

/** SyncedStore ids (device-owned slices unless noted). */
export const STORES = {
  // RETIRED 2026-09-14 (TM-1): `TERMINAL_HOSTS: "terminal.v1.hosts"`, the TSP1
  // adapter's advertisement store (title, cwd label, activity, `quicPort`,
  // `hostInstanceId`, re-advertised every 5 s). Its only publisher was
  // `ghosttea-truffle`, which left this floor with the in-process serve; no
  // consumer ever subscribed — the phone enumerates tailnet peers and dials each
  // one's `list-sessions` (`FieldStoreID.terminalHosts` is declared in the kit and
  // never subscribed, the phone lane's to retire at TM-5), and the deck's palette
  // stopped at GT-D17. Discovery under T is the ticket, not a store: the join
  // walks a fold row to `terminal.runtimeSessionId` and asks fieldd for a
  // `TerminalOpenTicket` (TM-D5).
  DOCS: "field.docs.v1",
  ARTIFACTS: "field.artifacts.v1",
  PUSH: "field.push.v1",
  DEVICES: "field.devices.v1",
  /** MF-1 (§10, D4's hybrid) — the content-free agent field, one slice per
   * device: replication, catch-up on join and removal on leave, with no
   * fieldd in a reader's path. The product API serves the SAME rows as
   * `agent.subscribe {projection: "field"}` for a reader that prefers the
   * door. */
  AGENT_FIELD: "field.agents.v1",
} as const;

/** Cross-plane bounds for the opaque SyncedStore → native mgmt → fieldd path
 * and its ProductAPI projection. Generated into Rust with the store names so
 * neither side can silently accept a larger trust envelope than the other. */
export const MESH_CONTROL_LIMITS = {
  REMOTE_ORIGINS: 256,
  OWNER_CHARS: 256,
  ARTIFACT_SLICE_BYTES: 256 * 1024,
  DEVICE_SLICE_BYTES: 64 * 1024,
  AGENT_FIELD_SLICE_BYTES: 64 * 1024,
  MGMT_FRAME_BYTES: 80 * 1024 * 1024,
  MGMT_QUEUED_BYTES: 96 * 1024 * 1024,
  MGMT_OUTBOX_MESSAGES: 64,
  /** P0-H2 (design-02 §2.7, the Phase 0 correction) — how many `native.mesh.*`
   * requests the floor holds for its one mesh worker before answering
   * `RESOURCE_EXHAUSTED`; the byte budget above still counts every one of them,
   * the in-flight request included. Enqueue never waits, so the socket reader
   * that answers the heartbeat is never behind a mesh listener that is. */
  MGMT_PENDING_MESH_REQUESTS: 32,
  PRODUCT_FRAME_BYTES: 128 * 1024 * 1024,
  PRODUCT_QUEUED_BYTES: 128 * 1024 * 1024,
} as const;

/** Per-CONNECTION bounds on the product API (EL7). A subscription is not a
 * read: it is WORK this daemon does on every tick for as long as the socket
 * lives, and the field projection makes that concrete — each subscriber costs a
 * list plus a JSON encode per row per flush, so the cost of one connection is
 * linear in the number of subscriptions it holds. Nothing bounded that, and a
 * single `agent.observe` holder (a phone left in a drawer, a plugin in a loop)
 * could buy the whole daemon's tick budget with one socket. TS-only on purpose:
 * this is the ProductAPI's own admission rule and the native plane has no
 * subscriptions of this kind. */
export const PRODUCT_API_LIMITS = {
  /** Generous for every real client — the desktop's busiest window holds a
   * handful — and small enough that a runaway is refused in the same second it
   * starts. A caller past it gets RESOURCE_EXHAUSTED and keeps everything it
   * already had: the refusal never disturbs live subscriptions. */
  SUBSCRIPTIONS_PER_CONNECTION: 32,
} as const;

/** TC-D6(c) — per-class scrollback byte caps, enforced at the NATIVE create
 * seam (so they live in the genned registry, one authority both planes read).
 * This is a byte cap, not a row cap. The 2026-09-27 review corrects BASE-1's
 * plain-row estimate: at 120 columns both plain and styled rows cost roughly
 * 1–1.3 KiB; depth depends strongly on width. Agents < interactive. */
export const TERMINAL_SCROLLBACK_CLASS_BYTES = {
  AGENT: 2 * 1024 * 1024,
  INTERACTIVE: 10 * 1024 * 1024,
} as const;

/** MF-1 (§5, §10.1) — the field feed's cadences. ONE authority for fieldd's
 * two publishers (the subscription's per-subscriber floor and the store's
 * coalescer) and for every reader that ages a slice out.
 *
 * The floors are TRAILING-EDGE, like the fold's own 16 ms tick: a change is
 * never dropped, only delayed to the next window. 250 ms is the phone's
 * foreground number — the swarm's 30 Hz physics interpolates between states,
 * so a status flood needs no faster feed, and an idle board costs NOTHING at
 * any interval because an unchanged projection bumps no revision.
 *
 * The expiry pair is the store's honesty clause: a desktop that dies without
 * clearing its slice leaves rows behind, so the publisher stamps
 * `expiresAt = now + STORE_EXPIRY_MS` and refreshes it every
 * STORE_HEARTBEAT_MS while it has rows. EXPIRY ≥ 3 × HEARTBEAT so two lost
 * heartbeats do not blank a live desktop's field on a reader. */
export const AGENT_FIELD = {
  MIN_INTERVAL_MS: 250,
  STORE_MIN_INTERVAL_MS: 250,
  STORE_HEARTBEAT_MS: 10_000,
  STORE_EXPIRY_MS: 30_000,
} as const;

/** TC-S2 — the floor's supervision budget for a `field-terminal-host` cell
 * (TC-D3's extraction; NO panic-abort until custody separates at TC-S4).
 * The shape mirrors NATIVE_SUPERVISION one level down. HELLO covers a cold
 * font discovery (the cell's slowest start step, measured seconds on a cold
 * cache); DRAIN mirrors upstream's own sweep budget (G7's 6s); EXIT_GRACE is
 * the gap between pipe-EOF and the kill escalation. Respawns are
 * intensity-bounded — a cell that cannot stay up is a fault to SURFACE, not
 * to hide behind infinite restarts. */
export const CELL_SUPERVISION = {
  HELLO_DEADLINE_MS: 15_000,
  DRAIN_BUDGET_MS: 6_000,
  EXIT_GRACE_MS: 2_000,
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 60_000,
} as const;

/** TC-S3/TC-D4 — spawn-isolation policy. An intensity breach whose window
 * holds an Exact-attributed offender (only Exact strikes count; Infrastructure
 * and Unknown blame NO session — row 13) flips the class to solo placement:
 * creates land on fresh single-session cells, so a recurring poison workload
 * can only crash itself. WINDOW bounds how long the class stays in that mode
 * (TC-S6's quarantine migration replaces the whole mechanism); MAX_SOLO_CELLS
 * is the TC-D6(f) bound — at the cap the newest solo cell becomes the shared
 * overflow target, logged, rather than unbounded process growth. */
export const CELL_ISOLATION = {
  ISOLATION_WINDOW_MS: 300_000,
  MAX_SOLO_CELLS: 8,
} as const;

/** TPv3 — the terminal pipeline's numbers (terminal-pipeline-v3 §5.1, §8; §20
 * item 5 "numeric limits with owners"). ONE authority for the cell (Rust, by
 * generation), fieldd (the grant TTLs) and the renderer. Every value is
 * PROVISIONAL until the post-S0 numeric ratification checkpoint (spec §15/§16)
 * — change it here, never in a consumer. Owners: the protocol version is the
 * wire's; heartbeat/pre-auth/connection caps are the CELL's door hygiene; the
 * grant validity bounds are shared by minter (fieldd) and verifier (cell); the
 * CELL_* receive caps bound what a worker may advertise (the leg's windows are
 * the MIN of both); the ProtocolLimits block is what `ConnectionAccepted`
 * announces. The TTL inequality (§5.4) holds by construction:
 * HEARTBEAT_TTL_MS ≥ HEARTBEAT_INTERVAL_MS + detection + jitter. */
export const TERMINAL_PIPELINE = {
  PROTOCOL_MAJOR: 1,
  PROTOCOL_MINOR: 0,
  HEARTBEAT_INTERVAL_MS: 5_000,
  HEARTBEAT_TTL_MS: 15_000,
  HELLO_DEADLINE_MS: 5_000,
  PRE_AUTH_MAX_BYTES: 65_536,
  PRE_AUTH_CONNECTION_CAP: 64,
  MAX_CONNECTION_SETS: 256,
  MAX_CLOCK_SKEW_MS: 5_000,
  MAX_GRANT_LIFETIME_MS: 600_000,
  TRANSPORT_GRANT_TTL_MS: 60_000,
  CELL_CONNECTION_CREDIT_BYTES: 16_777_216,
  CELL_PER_ACTIVATION_CREDIT_BYTES: 4_194_304,
  CELL_STAGING_BYTES_PER_SESSION: 8_388_608,
  CELL_STAGING_BYTES_TOTAL: 67_108_864,
  CELL_MAX_CONCURRENT_ACTIVATIONS: 256,
  CELL_MAX_CONCURRENT_SEEDS: 4,
  MAX_CONTROL_MESSAGE_BYTES: 262_144,
  MAX_PRESENTATION_CHUNK_BYTES: 1_048_576,
  MAX_BATCH_LATENCY_MS: 4,
  MAX_CREDIT_RETURN_DELAY_MS: 16,
  MAX_SCENE_APPLIED_DELAY_MS: 1_000,
  SCENE_APPLIED_REFRESH_MS: 2_000,
  PRESENTATION_STATUS_REFRESH_MS: 2_000,
  ACTIVATION_ATTACH_DEADLINE_MS: 5_000,
  MAX_ACTIVATION_CATCHUP_MS: 3_000,
  MAX_CATCHUP_BYTES: 8_388_608,
  CREDIT_ACCOUNT_DRAIN_TTL_MS: 5_000,
  // TP-S3b — the cell's own activation numbers. CELL_LEASE_TTL_MS ≥
  // SCENE_APPLIED_REFRESH_MS + detection + jitter (the TTL inequality, §5.4);
  // INPUT_LAG_SUSPEND_REVISIONS is the cell's lag call (input → suspended
  // {lagging} when newest − accepted exceeds it, or when no SceneApplied
  // arrives within MAX_SCENE_APPLIED_DELAY_MS after a unit was sent);
  // ATTACH_RENEWAL_MARGIN_MS closes input that far before the attach grant
  // expires without a renewal; SEED_FRAME_WAIT_MS bounds the wait for the
  // engine's full frame after a refresh.
  CELL_LEASE_TTL_MS: 6_000,
  INPUT_LAG_SUSPEND_REVISIONS: 64,
  ATTACH_RENEWAL_MARGIN_MS: 60_000,
  SEED_FRAME_WAIT_MS: 2_000,
  // TP-S3d — the writer/admission fairness FLOOR (§8). URGENT_RESERVE_BYTES of
  // connection credit is carved out for the urgent class: BULK admission (seed /
  // catch-up transfers) may consume connection credit only DOWN TO this reserve,
  // so an urgent incremental always has room (URGENT_RESERVE_BYTES ≥
  // MAX_URGENT_PRESENTATION_UNIT_BYTES). MAX_BULK_BYTES_ADMITTED_AHEAD bounds the
  // bulk bytes queued to the frames writer ahead of what it has written — the
  // bulk-induced-HOL bound is that plus the one chunk being written (so it is ≥
  // MAX_PRESENTATION_CHUNK_BYTES). A presentation unit larger than
  // MAX_URGENT_PRESENTATION_UNIT_BYTES is not an urgent incremental — it becomes
  // a (bulk) catch-up transfer.
  URGENT_RESERVE_BYTES: 2_097_152,
  MAX_BULK_BYTES_ADMITTED_AHEAD: 4_194_304,
  MAX_URGENT_PRESENTATION_UNIT_BYTES: 1_048_576,
} as const;

/** TPv3 — WebSocket close codes on the cell doors (terminal-pipeline-v3 §5.1):
 * `1008` = EVERY pre-authentication failure, silent by policy (no body, no
 * code on the wire — the reason lives in the cell's audit line); `1011` server
 * error; 4000+ protocol-specific and always named in the close reason. One
 * authority for the cell (Rust, by generation) and the renderer. */
export const TERMINAL_PIPELINE_CLOSE_CODES = {
  GOING_AWAY: 1001,
  POLICY_PRE_AUTH: 1008,
  SERVER_ERROR: 1011,
  STALE_ROUTE: 4000,
  FENCED: 4001,
  SUPERSEDED: 4002,
  PROTOCOL: 4003,
  LEG_TIMEOUT: 4004,
} as const;

/** Mesh namespaces. `ss:*` is reserved to SyncedStore; `x.<pluginId>.*` is the dynamic service namespace (D19). */
export const NAMESPACES = {
  RPC: "field.rpc",
  APPROVAL: "field.approval",
  DYNAMIC_PREFIX: "x.",
} as const;

/** Env prefixes registered with Ghosttea's strip list (G1′) — daemon secrets never enter agent PTYs (EL7).
 * Note: "FIELDD_" does NOT match the "FIELD_" prefix (5th char) and needs its own entry. */
export const ENV_PREFIXES = ["FIELD_", "FIELDD_"] as const;

/** LOG-44 — physical diagnostic streams. The value is the ONLY category /
 * basename pair callers may resolve beneath the platform log root. Dynamic
 * component, window, session, and plugin identities belong in record fields,
 * never in filenames. */
export const LOG_STREAMS = {
  SYSTEM_DESKTOP: "system/desktop",
  SYSTEM_RENDERER: "system/renderer",
  SYSTEM_UTILITY: "system/utility",
  SYSTEM_FIELDD: "system/fieldd",
  SYSTEM_FIELD_NATIVE: "system/field-native",
  PLUGINS_RENDERER: "plugins/renderer",
  PLUGINS_SERVICE: "plugins/service",
  PLUGINS_UTILITY: "plugins/utility",
} as const;
export type LogStream = (typeof LOG_STREAMS)[keyof typeof LOG_STREAMS];

/** LOG §12.4 — the renderer logging data plane is one bounded MessagePort per
 * WebContents generation. These are transport limits, so the browser-side
 * queue and the Electron accepting host consume the same tiny root constants
 * without importing the zod-heavy logging schema subpath into the boot chunk. */
export const LOG_TRANSPORT_LIMITS = {
  RENDERER_BATCH_RECORDS: 50,
  RENDERER_BATCH_BYTES: 256 * 1024,
  RENDERER_QUEUE_RECORDS: 1_000,
  RENDERER_QUEUE_BYTES: 2 * 1024 * 1024,
  RENDERER_RECORD_BYTES: 64 * 1024,
  RENDERER_BATCHES_PER_SECOND: 10,
  RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND: 10,
  RENDERER_ENVELOPE_BATCHES_PER_SECOND: 20,
  FIRST_PARTY_PARTIAL_LINE_BYTES: 64 * 1024,
  PLUGIN_PARTIAL_LINE_BYTES: 16 * 1024,
  PLUGIN_RECORD_BYTES: 16 * 1024,
  PLUGIN_MESSAGE_BYTES: 4 * 1024,
  PLUGIN_STRING_BYTES: 4 * 1024,
  PLUGIN_STACK_BYTES: 8 * 1024,
  PLUGIN_OBJECT_DEPTH: 4,
  PLUGIN_OBJECT_KEYS: 50,
  PLUGIN_ARRAY_ITEMS: 50,
  PLUGIN_ERROR_CAUSES: 2,
  PLUGIN_RATE_PER_SECOND: 20,
  PLUGIN_RATE_BURST: 100,
  PLUGIN_RATE_HIGH_SEVERITY_RESERVE: 20,
  PLUGIN_RATE_TRACKED_ENTRIES: 1_024,
  DIAGNOSTIC_PAGE_BYTES: 8 * 1024 * 1024,
  DIAGNOSTIC_PORT_REQUEST_BYTES: 64 * 1024,
  DIAGNOSTIC_PORT_RESPONSE_BYTES: 8 * 1024 * 1024,
} as const;

/** Every grantable capability (design-01 §7 + design-03 §8 + design-04). */
export const SCOPES = [
  "canvas.read",
  "canvas.write",
  "agent.spawn",
  "agent.control",
  "agent.observe",
  "agent.bless", // D38 — single-purpose, PTY-bound (spawn-through shims)
  "terminal.attach",
  // GT-8a (GT-D22) — open a link a terminal printed (`terminal.link.open`: a
  // web link in the browser, a file SHOWN in Finder). Its own scope and not
  // `shell.open`, which renderer plugins may be granted: this door must not be
  // reachable without a person's click, so only the window's token holds it —
  // Electron main mints it there and nowhere else. Local-only forever: in no
  // TAILNET preset, and absent from every plugin eligibility table.
  "terminal.link",
  "doc.read",
  "doc.write",
  "artifact.publish",
  "index.read",
  "approval.respond",
  "push.manage",
  "workspace.read",
  "native.admin",
  "services.provide",
  "process.spawn",
  "storage.self",
  "net.outbound",
  "background",
  "mcp.consume",
  "mcp.contribute",
  "shell.windows",
  "shell.dialog",
  "shell.clipboard",
  "shell.open",
  "shell.webcontents",
  "plugins.read", // registry snapshot (plugins.list/get/subscribe) — local-only like plugins.manage
  "plugins.manage",
  // P8b (ESP §8.4): resolve a module token to the bytes' path. SHELL-MAIN ONLY —
  // it is the one surface that hands out a filesystem path, so it is deliberately
  // NOT plugins.read (which the renderer holds). Local-only forever, like the
  // rest of plugins.*; it must never enter TAILNET_SCOPES.
  "plugins.serve",
  "diagnostics.read", // LOG §14 — trusted shell only; excluded from every federated preset
  "diagnostics.manage", // diagnostic leases/support mutations; trusted shell only
  "audit.append", // shell-originated audit actions; local-only
  "settings.manage", // trusted desktop shell/renderer app-preference surface
  "tokens.mint", // shell-main only: mint per-window renderer tokens (Track A bootstrap)
  // DT-D3 (thinking-devtools-pack.md) — the live-surface doors. Deliberately
  // three: `attach` redeems view tickets and drives demand on any kind;
  // `browser` creates browser sources (and later carries their human input +
  // navigation); `capture` creates SCK window/Simulator sources — split out
  // because capturing OTHER apps' windows is a different consent class
  // (Screen Recording gravity, A5/EL7). `surface.control` (the DT-5 agent
  // lane) is reserved and deliberately NOT minted by any v1 manifest.
  // None of these enter TAILNET_SCOPES: a surface is a window on THIS device.
  "surface.attach",
  "surface.browser",
  "surface.capture",
  // AR-1 (thinking-ar-data-topology.md §7, AR-D15…D22) — the agent-index and
  // agent-distribution management doors. `index.manage` mutates THIS user's
  // consent record: which discovered agent roots rosettad may read, which
  // runtimes are retired (`index.enroll`/`index.retire`; reads stay on
  // `index.read`). `agents.manage` mutates the MACHINE-scope distribution
  // record — the active executable per provider, updates — the native.admin
  // posture. Both are local-only forever: consent is an act of the person at
  // this device; neither enters TAILNET_SCOPES or any plugin eligibility table.
  "index.manage",
  "agents.manage",
  // AR-5b (the review's EL7 lens) — two CONTENT reads, split off the census
  // scopes the AR-5 doors first rode. `index.search` covers `index.sessions`
  // + `index.search`: transcript search over every consented root — which a
  // plugin that asked `index.read` to draw the roll call must never gain on
  // an upgrade with no re-consent. `agent.usage` covers `agents.usage` + its
  // subscription: the account's billing state, and a credentialed vendor call
  // per reading — not what `agent.observe` (the fold) was consented for.
  // Both are local-only forever (a person's transcripts and accounts are on
  // the device in front of them) and in NO plugin eligibility table:
  // `plugins.ts` names neither, and absence is the safe default there.
  "index.search",
  "agent.usage",
] as const;
export type Scope = (typeof SCOPES)[number];

/** The D32 tailnet-caller preset (C3): the scopes a WhoIs-authenticated tailnet
 * principal is granted on a served product surface. Broad product access MINUS
 * D32's local-only-forever set (doc.*, artifact mutations, tokens.mint,
 * native.admin, push.manage, plugins.*) and MINUS plugin-runtime/shell powers — those are capability
 * grants for local runtimes, meaningless (and dangerous) as remote-caller
 * scopes. Document replication uses its dedicated authenticated sync protocol;
 * the renderer's persistence API and lane tickets never federate. */
export const TAILNET_SCOPES: readonly Scope[] = [
  "canvas.read",
  "canvas.write",
  "agent.spawn",
  "agent.control",
  "agent.observe",
  "terminal.attach",
  "index.read",
  "approval.respond",
  "workspace.read",
  "mcp.consume",
] as const;

/** UA-4 (spec §7.3, UA-D5): the guest preset — a WhoIs-verified tailnet peer
 * whose login does not match this user's stored link. Deliberately empty:
 * guests get a polite hello and typed refusals, not capabilities. Any future
 * guest surface grows from the `guestOk` method column, never from scopes. */
export const TAILNET_GUEST_SCOPES: readonly Scope[] = [] as const;

/** Socket file names under the daemon run dirs; paths are stable across restarts (external-mode law). */
export const SOCKETS = {
  FIELDD: "fieldd.sock",
  MGMT: "mgmt.sock",
  MESHDATA: "meshdata.sock",
  /** NF — Ghosttea control/frame endpoints under native/run/: bound by
   * field-native (which owns creation, permissions, and stale-unlink), dialed
   * by ticket holders. Path stability across fieldd restarts is what lets
   * ghosttea clients read endpoints once at construction.
   * RENAMED 2026-08-05 (UA-D9 regression, live dev root): the user tree
   * (`users/<fuid>/`) pushed `terminal-control.sock` to 108 bytes on the
   * repo-nested dev root — past the macOS sun_path ceiling — so field-native
   * could not bind and the terminal plane crashed while mgmt.sock (96) sailed
   * through the old shortest-name guard. Socket names live under the tightest
   * path budget in the product; keep them ≤ 14 chars (registry lint). */
  TERMINAL_CONTROL: "termctl.sock",
  TERMINAL_FRAME: "termframe.sock",
} as const;

/** P8b (ESP §8.4) — the URL scheme staged plugin modules are served on.
 *
 * It lives HERE, unlike electron-shell's own `APP_SCHEME`, because two packages
 * that share nothing else must agree on it: fieldd MINTS these URLs and Electron
 * main SERVES them. A scheme only one package uses is that package's business; a
 * scheme spanning the daemon and the shell is wire truth.
 *
 * Deliberately NOT the product window's origin. §8.4 requires the CSP to admit
 * "only the chosen plugin module origin", which is a statement you can only make
 * about an origin that is not already `'self'` — keeping plugin bytes off the
 * app scheme means admitting them never widens what `'self'` means for the
 * product document. */
export const PLUGIN_MODULE_SCHEME = "vibefield-plugin" as const;

/** PA-29 / plugin spec §11.6 — the host-singleton externals list. React,
 * ReactDOM, three, R3F/drei, ICE/strata, Loro, and the SDK runtime are
 * host-provided singletons; a plugin bundle that carries a second copy of any
 * of them refuses activation.
 *
 * Declared in EXACTLY ONE place: here. `tooling/plugin-build` re-exports it, so
 * the renderer library-mode bundle, the esbuild service bundle, and the
 * pack-time duplicate-singleton check (§5.4 item 1, stage "artifact checks")
 * read THIS constant rather than hand-listing bundler externals. No plugin,
 * built-in or third-party, configures its own externals list.
 *
 * It is registry data rather than build-tool data because the two halves of the
 * PA-29 contract sit in different processes: pack time externalizes these
 * specifiers, and load time BINDS them (§11.6 — a host-injected import map in
 * the renderer, a `module.register` resolve hook in the service worker). The
 * renderer and Electron main must read the same list without depending on a
 * Node build tool, and one list hand-copied into two planes is the R4 drift
 * class. */
export const HOST_SINGLETON_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@vibefield/plugin-sdk",
  "@vibecook/ice",
  "loro-crdt",
] as const;

export type HostSingletonExternal = (typeof HOST_SINGLETON_EXTERNALS)[number];

/** §11.6 — the EXACT set of bare specifiers the renderer's host-injected import
 * map binds, and therefore the exact set a built plugin artifact is allowed to
 * emit.
 *
 * A superset of HOST_SINGLETON_EXTERNALS, because the bundler externalizes a
 * singleton AND its subpaths by prefix: an artifact emits subpath specifiers
 * the root list never names. The additions below are measured, not guessed —
 * every one appears bare in a shipping plugin's `dist/renderer.js`.
 *
 * ENUMERATED, never prefixed, and that is forced: an import map maps a trailing
 * slash only across a URL path segment, and PLUGIN_MODULE_SCHEME refuses path
 * segments. A specifier without its own entry does not resolve.
 *
 * The build refuses an artifact that emits anything outside this list ("artifact
 * checks"), which is §11.6's "unmapped fails loudly" moved from import time to
 * pack time. Widening the host surface is a deliberate edit HERE — never a
 * plugin's private decision. Renderer truth only: the service worker's resolve
 * hook binds the SDK alone, and node builtins are legitimately its own. */
export const HOST_SINGLETON_MODULE_SPECIFIERS = [
  ...HOST_SINGLETON_EXTERNALS,
  "@vibefield/plugin-sdk/ui",
  "@vibefield/plugin-sdk/canvas",
  "@vibefield/plugin-sdk/behavior",
] as const;

export type HostSingletonModuleSpecifier = (typeof HOST_SINGLETON_MODULE_SPECIFIERS)[number];

/** File names VibeField owns beneath a daemon's own data directory. A name here
 * is resolved by the plane that OWNS the file and by nobody else — GT-3's
 * `config.ghostty` is field-native's, so the native plane joins it to its data
 * dir and every reader asks the service where the file is rather than deriving
 * the same path a second time (two derivations of one path is the R4 drift
 * class wearing a different hat). */
export const FILES = {
  /** The app-owned Ghostty-syntax overlay the embedded terminal service loads
   * AFTER the user's own Ghostty files (GT-3 rider; ghosttea `with_config_path`). */
  TERMINAL_CONFIG: "config.ghostty",
  /** TC-L1f — the machine-wide custody admission ledger (flock'd; PTY budget
   * shared across EVERY user-pair on the machine). Resolves under the
   * VibeField ROOT — never under a user root: per-vault caps are subordinate
   * to one machine-wide budget, and kernel refusal stays the final authority. */
  CUSTODY_ADMISSION_LEDGER: "custody-admission.v1.json",
} as const;

/** UA-D10 — the on-disk layout under a data root, as REGISTRY DATA: relative
 * path segments, one authority, consumers join and never respell (the seven
 * hand-copied derivations the UA census found are the R4 drift class again).
 * Socket/file basenames compose from their own registries above. Generated
 * into Rust by `pnpm gen` and pinned on both sides by
 * `fixtures/layout.vector.json`; non-TS consumers (dev-runner .mjs) read the
 * committed `gen/layout.json`. The tree these segments describe is the CURRENT
 * flat-v1 layout — UA-1 re-roots the same segments under `users/<fuid>/` by
 * changing the ROOT, never the segments. */
export const LAYOUT = {
  FIELDD_RUN_DIR: ["fieldd", "run"],
  PRODUCT_JSON: ["fieldd", "run", "product.json"],
  SHELL_TOKEN: ["fieldd", "run", "shell.token"],
  DEVICE_ID: ["fieldd", "device-id"],
  SETTINGS_DOC: ["fieldd", "settings", "doc.loro"],
  REGISTRIES_DIR: ["registries"],
  DOCS_DIR: ["docs"],
  ARTIFACT_PREVIEWS_DIR: ["artifacts", "previews"],
  AUDIT_DIR: ["audit"],
  PLUGINS_INSTALLED_DIR: ["plugins", "installed"],
  NATIVE_DIR: ["native"],
  NATIVE_RUN_DIR: ["native", "run"],
  PAIRING_FILE: ["native", "pairing"],
  MESH_STATE_DIR: ["native", "mesh"],
  LINK_FILE: ["fieldd", "link.json"],
  /** SB-2 (AR-7g) — which shells fieldd birthed under an Agent Profile
   * (`TerminalBindingsFile`, 0600): session → profile set, never a variable.
   * fieldd's, because nothing below it can hold a session's metadata, and on
   * disk because the floor outlives fieldd — a restarted fieldd still says
   * which profile a surviving shell was born under. */
  TERMINAL_BINDINGS_FILE: ["fieldd", "terminal-bindings.json"],
  TERMINAL_CONFIG_FILE: ["native", FILES.TERMINAL_CONFIG],
  // RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
  // `TERMINAL_MIRROR_WRITE_FILE` = `native/terminal-mirror-write.key`, MF-2a's
  // minted mirror-write capability. A durable secret on disk, readable by every
  // same-uid process, whose holder could write into any mirrored session until
  // a human deleted the file and bounced the pair. The write right is a claim in
  // a per-client, expiring, revocable attach grant now — nothing mints this file
  // and nothing reads it. A key left by a pre-TM-3 boot is inert; no code path
  // consults the path, so it is stale bytes a user may delete.
  MGMT_SOCKET: ["native", "run", SOCKETS.MGMT],
  MESHDATA_SOCKET: ["native", "run", SOCKETS.MESHDATA],
  TERMINAL_CONTROL_SOCKET: ["native", "run", SOCKETS.TERMINAL_CONTROL],
  TERMINAL_FRAME_SOCKET: ["native", "run", SOCKETS.TERMINAL_FRAME],
  CRASH_DIR: ["crash"],
  EXPORTS_STAGING_DIR: ["exports", ".staging"],
  /** AR-0 — the agent index (rosetta): the disposable SQLite projection
   * rosettad serves for this user (`serve --db`), with its ledger, assets and
   * search sidecars beside it. Per USER root (design: one rosettad per user). */
  INDEX_DIR: ["index"],
  INDEX_DB: ["index", "rosetta.db"],
  /** fieldd's PRIVATE rosetta announce directory (`--announce-dir`): the
   * daemon's `<pid>.json` lands here, never in rosetta's shared per-user
   * directory (EL7 — the origin is the secret), and the next fieldd reads it
   * to put down an orphan holding the projection lock. */
  INDEX_DAEMONS_DIR: ["index", "daemons"],
  /** AR-1 (AR-D17) — this user's consent record and persona ↔ runtime map:
   * which discovered kinds rosettad may read, which managed roots it is
   * handed, which runtimes are retired. VibeField's truth, written by fieldd
   * BEFORE every rosettad spawn — and the same file is the daemon's
   * `--enroll` input (rosetta ignores the keys only VibeField reads). */
  INDEX_ENROLLMENT_FILE: ["index", "enrollment.json"],
  /** AR-1 (AR-D18/D20) — this user's personas: puppeteer's profile registry
   * (`ProfileRegistrySnapshot`, through fieldd's injected store) and the
   * managed roots beneath it (0700 — the agent's own data folder, bound at
   * spawn through the provider's root variable). A root under here is
   * managed ⇒ enrolled by construction, never discovered.
   * AR-S2 (AR-D23/D24) — each Agent Profile (puppeteer's profile set) owns ONE
   * folder, `profiles/<set>/`, named once from the profile's first name, and
   * every agent signed in there has its root inside it,
   * `profiles/<set>/<provider>-<8 hex>/`, allocated exclusively and never
   * reused: a profile's whole data — each agent's config, history, plugins and
   * sign-in — is one folder under its user. `roots/` is where AR-1..S1 put
   * `<provider>/<uuid>/` roots; nothing is allocated there any more, and a
   * root found there is adopted in place (a root never moves). */
  AGENTS_DIR: ["agents"],
  AGENT_PROFILES_FILE: ["agents", "profiles.json"],
  AGENT_PROFILE_SETS_DIR: ["agents", "profiles"],
  AGENT_ROOTS_DIR: ["agents", "roots"],
  /** AR-S4d — what each Agent Profile keeps once for its agents (pass 24,
   * S1): one `<set>.json` (0600) per profile with each kept MCP server's
   * definition (what it runs or where it is, and the NAMES of the variables it
   * reads), the names it keeps a value for, and which names it gave each
   * agent. The values live in the OS keychain, one entry per profile — never
   * under this root. */
  AGENT_EXTENSIONS_DIR: ["agents", "extensions"],
  /** AR-S4d2 — each Agent Profile's skills folder, `skills/<set>/<name>/`:
   * the one copy of each skill the profile keeps (a folder with a SKILL.md,
   * or a link to it in `~/.agents/skills` once Codex took it there). Every
   * agent in the profile is given a link to it where it looks for skills;
   * deleted with the profile. */
  AGENT_SKILLS_DIR: ["agents", "skills"],
  /** AR-3 — this user's managed-session records: one `<runtimeRunId>.json`
   * (0600) per session fieldd spawned, holding puppeteer's opaque continuation
   * beside the launch facts (provider, persona, cwd, workspace) and the exit,
   * once there is one. What `agent.resume` reads and what AR-4's re-attach
   * will read; never a transcript (rosetta's) and never a credential. */
  AGENT_SESSIONS_DIR: ["agents", "sessions"],
  /** AR-4 — puppeteer's durable creation registry for this user's runs
   * (its own layout beneath: `claims/` + `installation.key`, all 0600/0700):
   * the claim a run is restored against when fieldd re-attaches after a
   * restart. Never written by VibeField; puppeteer owns every byte. */
  AGENT_RUNS_DIR: ["agents", "runs"],
  /** AR-4b — the key the session records are signed with (HMAC-SHA256, 32
   * random bytes, 0600, minted once per user root): fieldd's own acts on a
   * session (the re-attach at boot, a resume-when-idle) trust only records
   * it wrote itself — a same-uid file dropped into `agents/sessions/` is set
   * aside, never acted on (EL7). */
  AGENT_SESSIONS_KEY_FILE: ["agents", "sessions.key"],
  /** AR-7 — the spawn-through shim's home under this user (0700): the
   * rendezvous files, one launcher per offered agent's command, the bundled
   * shim and the shell integration. puppeteer's spawn-through kit writes every
   * file in it; fieldd chooses the path. A shell born in one of our panes
   * carries only this DIRECTORY — what changes across a fieldd restart (the
   * gateway's port, its bearer) lives in the files, never in the shell's
   * environment, because our shells outlive fieldd. */
  AGENT_SHIMS_DIR: ["agents", "shims"],
  /** UA-1 — the user directory ABOVE the per-user roots. `users/<fuid>/` holds
   * a full tree of the segments above; these four live at the VibeField root
   * itself and, with the `machine/` set below, are the only segments that
   * never re-root (LAYOUT_ROOT_LEVEL is that set, as data). */
  USERS_DIR: ["users"],
  USERS_FILE: ["users.json"],
  USERS_LOCK: ["users.json.lock"],
  LAYOUT_STAMP: ["layout.json"],
  /** AR-1 (AR-D15/D16) — the MACHINE scope: the one named exception to
   * UA-D1's "all product state under the user". Exactly agent distribution:
   * installs are OS-user-global by nature, and VibeField owns nothing there
   * but a choice (the active executable per provider) and a preference
   * (channel, network opt-in) — `distribution.json`, root-locked, published
   * atomically by the attached user's fieldd — plus puppeteer's opaque update
   * transcripts under `updates/`. Nothing else enters `machine/` without a
   * new decision. */
  MACHINE_DIR: ["machine"],
  MACHINE_AGENTS_DIR: ["machine", "agents"],
  MACHINE_DISTRIBUTION_FILE: ["machine", "agents", "distribution.json"],
  MACHINE_UPDATES_DIR: ["machine", "agents", "updates"],
} as const;

/** The segments that live at the VibeField ROOT and never re-root under
 * `users/<fuid>/` (UA-1's four + AR-D15's machine scope) — as data, so the
 * flat-v1 migration's manifest and every "is this root-level?" question read
 * one list instead of respelling it. */
export const LAYOUT_ROOT_LEVEL = [
  "USERS_DIR",
  "USERS_FILE",
  "USERS_LOCK",
  "LAYOUT_STAMP",
  "MACHINE_DIR",
  "MACHINE_AGENTS_DIR",
  "MACHINE_DISTRIBUTION_FILE",
  "MACHINE_UPDATES_DIR",
] as const satisfies readonly (keyof typeof LAYOUT)[];

/** The CLOSED Electron IPC surface (ESR spec §6.2 + LOG §12.4/§14): these channels, nothing
 * else. Payload schemas live in shell.ts; call sites import these names — a raw
 * `vibefield:` literal outside contracts is a boundary violation (wall R6). */
export const IPC_CHANNELS = {
  /** renderer → main invoke, once per webContents generation: WindowConnection */
  windowBootstrap: "vibefield:shell:window-bootstrap",
  /** main → renderer event, once per close attempt: CloseRequest */
  prepareClose: "vibefield:shell:prepare-close",
  /** renderer → main event, once per close attempt: CloseResult */
  closeResult: "vibefield:shell:close-result",
  /** main → preload, one transferred MessagePort per WebContents generation */
  rendererLogPort: "vibefield:logging:renderer-port",
  /** main ↔ preload, one host-only diagnostics MessagePort per generation */
  diagnosticsPort: "vibefield:diagnostics:host-port",
  /** main → preload, exactly four Live Surfaces ports per renderer generation */
  liveSurfacePorts: "vibefield:live-surfaces:host-ports",
  /** main → renderer: validated, presentation-only shell commands */
  shellCommand: "vibefield:shell:command",
  /** main → renderer: native tray/background capability truth */
  desktopState: "vibefield:shell:desktop-state",
  // GT-D3's bridge channels (`vibefield:terminal:connect` invoke,
  // `vibefield:terminal:status` event) RETIRED at TP-S3e: the renderer dials
  // the cells' T1 doors directly and main runs no terminal Backend.
  /** main → renderer event: GodviewState — this window's overlay truth, which
   * main owns (GT-D2: the accelerator intercepts before the renderer, so the
   * menu item and the renderer must read ONE state, and it has to be main's) */
  godviewState: "vibefield:godview:state",
  /** renderer → main invoke: GodviewSetRequest — the toolbar button asking for
   * the same transition ⇧⇧ asks for; answers with the resulting GodviewState */
  godviewSet: "vibefield:godview:set",
  /** renderer → main invoke: UsersUpdateParams → UserRecord — the Account
   * page's profile write. Main owns users.json (UA-D10); fieldd never writes
   * it, which is what keeps the boundary lint honest. */
  usersUpdate: "vibefield:users:update",
  /** renderer → main invoke: {} → UsersListSnapshot — the roster + attached
   * (UA-5; the Account switcher and the tray submenu read one truth) */
  usersList: "vibefield:users:list",
  /** renderer → main invoke: UsersCreateParams → UserRecord — mints user N
   * under the §3.3 lock, then attaches to it (UA-5; the reloaded window runs
   * the wizard's second-user variant) */
  usersCreate: "vibefield:users:create",
  /** renderer → main invoke: UsersSwitchParams → UserRecord — attach
   * re-target + window reload (UA-D15); same-user switch is a no-op */
  usersSwitch: "vibefield:users:switch",
  /** renderer → main invoke: ScreenshotCaptureRequest → ScreenshotCaptureResult
   * — the native screenshot helper, one capture at a time (SNAP-D3). The View
   * menu's Take Screenshot item asks main for the SAME capture, so neither
   * door holds an opinion the other cannot see. */
  screenshotCapture: "vibefield:screenshot:capture",
  /** main → renderer event: ScreenshotCaptureResult — the answer to a capture
   * MAIN ran on the page's behalf (the View menu's item, its accelerator). A
   * renderer that asked through `screenshotCapture` already holds its own
   * answer; this is how the other door stops being invisible to the page that
   * will hold the still (SNAP-3, the clipboard tray). */
  screenshotResult: "vibefield:screenshot:result",
  /** A registered product window asks main to preview one retained still. */
  screenshotPreview: "vibefield:screenshot:preview",
} as const;
