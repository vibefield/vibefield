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

/** Cross-plane bounds for the opaque SyncedStore → native mgmt → fieldd path
 * and its ProductAPI projection. Generated into Rust with the store names so
 * neither side can silently accept a larger trust envelope than the other. */
export const MESH_CONTROL_LIMITS = {
  REMOTE_ORIGINS: 256,
  OWNER_CHARS: 256,
  ARTIFACT_SLICE_BYTES: 256 * 1024,
  DEVICE_SLICE_BYTES: 64 * 1024,
  MGMT_FRAME_BYTES: 80 * 1024 * 1024,
  MGMT_QUEUED_BYTES: 96 * 1024 * 1024,
  MGMT_OUTBOX_MESSAGES: 64,
  PRODUCT_FRAME_BYTES: 128 * 1024 * 1024,
  PRODUCT_QUEUED_BYTES: 128 * 1024 * 1024,
} as const;

/** TC-D6(c) — per-class scrollback byte caps, enforced at the NATIVE create
 * seam (so they live in the genned registry, one authority both planes read).
 * THE fleet-memory lever — and a BYTE cap, not a row cap: styled 80-col
 * content costs ≈721B/row vs ≈62B plain (spike BASE-1), an order of magnitude
 * of retained history for the same bytes. Agents < interactive. */
export const TERMINAL_SCROLLBACK_CLASS_BYTES = {
  AGENT: 2 * 1024 * 1024,
  INTERACTIVE: 10 * 1024 * 1024,
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
  TERMINAL_CONFIG_FILE: ["native", FILES.TERMINAL_CONFIG],
  MGMT_SOCKET: ["native", "run", SOCKETS.MGMT],
  MESHDATA_SOCKET: ["native", "run", SOCKETS.MESHDATA],
  TERMINAL_CONTROL_SOCKET: ["native", "run", SOCKETS.TERMINAL_CONTROL],
  TERMINAL_FRAME_SOCKET: ["native", "run", SOCKETS.TERMINAL_FRAME],
  CRASH_DIR: ["crash"],
  EXPORTS_STAGING_DIR: ["exports", ".staging"],
  /** UA-1 — the user directory ABOVE the per-user roots. `users/<fuid>/` holds
   * a full tree of the segments above; these four live at the VibeField root
   * itself and are the only segments that never re-root. */
  USERS_DIR: ["users"],
  USERS_FILE: ["users.json"],
  USERS_LOCK: ["users.json.lock"],
  LAYOUT_STAMP: ["layout.json"],
} as const;

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
  /** renderer → main invoke: a redeemed TerminalTicket; main builds/replaces
   * this window's external-mode Backend and posts its ports (GT-D3) */
  terminalConnect: "vibefield:terminal:connect",
  /** main → renderer event: TerminalBridgeStatus for this window's bridge */
  terminalStatus: "vibefield:terminal:status",
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
} as const;
