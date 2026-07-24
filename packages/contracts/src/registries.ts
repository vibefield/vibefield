// Registries-as-code (design-01 §7, P8): ports, stores, namespaces, env prefixes,
// scopes, app id, socket names exist HERE and nowhere else.

export const APP_ID = "vibefield" as const;

/** One place for every port VibeField binds or reserves. */
export const PORTS = {
  /** fieldd product API — renderer control plane (loopback WS, JSON-RPC text). D27 */
  FIELDD_WS_CONTROL: 9410,
  /** fieldd product API — renderer data lanes (loopback WS, binary, D5 framing). D27 */
  FIELDD_WS_DATA: 9411,
  /** reserved by truffle's own WS bus — never bind. */
  TRUFFLE_WS_RESERVED: 9417,
  /** Ghosttea TSP1 terminal mirror (QUIC). */
  GHOSTTEA_TSP1_QUIC: 9420,
  /** Ghosttea TSP1 terminal mirror (TCP compact). */
  GHOSTTEA_TSP1_TCP: 9421,
  /** doc-sync lanes over the mesh (QUIC, snapshot-per-stream). */
  DOC_SYNC_QUIC: 9440,
  /** presence + device heartbeats (UDP, lossy). */
  PRESENCE_UDP: 9441,
  /** push relay (Cloudflare Worker). */
  RELAY_HTTPS: 443,
} as const;

/** SyncedStore ids (device-owned slices unless noted). */
export const STORES = {
  TERMINAL_HOSTS: "terminal.v1.hosts",
  DOCS: "field.docs.v1",
  ARTIFACTS: "field.artifacts.v1",
  PUSH: "field.push.v1",
  DEVICES: "field.devices.v1",
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
  "diagnostics.read", // LOG §14 — trusted shell only; excluded from every federated preset
  "diagnostics.manage", // diagnostic leases/support mutations; trusted shell only
  "audit.append", // shell-originated audit actions; local-only
  "tokens.mint", // shell-main only: mint per-window renderer tokens (Track A bootstrap)
] as const;
export type Scope = (typeof SCOPES)[number];

/** The D32 tailnet-caller preset (C3): the scopes a WhoIs-authenticated tailnet
 * principal is granted on a served product surface. Broad product access MINUS
 * D32's local-only-forever set (doc.*, tokens.mint, native.admin, push.manage,
 * plugins.*) and MINUS plugin-runtime/shell powers — those are capability
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
  "artifact.publish",
  "index.read",
  "approval.respond",
  "workspace.read",
  "mcp.consume",
] as const;

/** Socket file names under the daemon run dirs; paths are stable across restarts (external-mode law). */
export const SOCKETS = {
  FIELDD: "fieldd.sock",
  MGMT: "mgmt.sock",
  MESHDATA: "meshdata.sock",
} as const;

/** The CLOSED Electron IPC surface (ESR spec §6.2 + LOG §12.4): four channels, nothing
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
} as const;
