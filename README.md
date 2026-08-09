# VibeField

A personal programmable field for agentic computing — infinite canvases hosting live widgets,
a two-plane daemon pair per device (`fieldd` Node product plane · `field-native` Rust native plane),
a private mesh across machines, and an iPhone companion.

> Build anything. See everything alive.

## Monorepo layout

| Path | What |
|---|---|
| `packages/contracts` | `@vibefield/contracts` — zod-first source of every VibeField-owned protocol; `gen/` JSON Schema → typify'd Rust |
| `packages/field-native` | Rust native-plane daemon: mgmt server, D8 pairing, MeshGateway (truffle node), and the embedded ghosttea TerminalService — the native floor that outlives fieldd (NF-0…7 + NF-remote) |
| `packages/fieldd` | Node product-plane daemon: NativeLink, TokenService, ProductAPI (dual-WS), MeshClient, DocumentService, ArtifactService |
| `packages/users` | the multi-persona layer: the users.json lock, per-user roots, mint/migrate (UA track) |
| `packages/logging` · `packages/audit` | the structured logging/diagnostics pipeline and the append-only audit log (LOG track) |
| `packages/plugin-sdk` | the door plugins come through — walls rule R10 keeps `plugins/*` SDK-only |
| `packages/fieldd-client` | renderer/worker client — loopback WS + React hooks |
| `packages/fieldd-supervisor` | Node-only fieldd discovery/adopt/spawn/shutdown library — executes inside Electron main, never a process of its own |
| `packages/electron-shell` | Electron main + preload + the tiny renderer host, and the renderer's vite build — a composition root with no product logic |
| `packages/field-app` | the browser-compatible renderer product: boot machine, DocManager, the FieldView units (session/canvas/persistence/chrome/previews), HUD |
| `packages/design-kit` | the design kit — CardShell, tokens, GL card chrome (DESIGN.md made code) |
| `packages/plugin-runtime` | plugin manifest / registry / renderer context (P0 core of the design-03 plugin system) |
| `plugins/*` | built-in plugins at the repo root (product actors beside the platform — plugin spec §5.1): `note` (sticky note), `field-tools` (folder/comment), `browser` (the Artifact Hub panel) |
| `examples/plugins/widgetlab` | the 18-widget parity pack — dev/reference plugin, staged as demo boot content |
| `apps/desktop` | packaging-only: delegating scripts + the electron dep; no application source lives here |
| `apps/ios` | the iPhone companion — thin xcodeproj over the `VibeFieldKit` SPM package (FieldHome · FieldAgents · FieldMesh · FieldTerminal · FieldDesign · SwarmPhysics). Deliberately outside `pnpm verify` (the gate must not require Xcode); its gate is the `xcodebuild` commands in `apps/ios/README.md` |
| `docs/` | the main-tracked corpus: `ROADMAP.md` (now/next) · `LANDED.md` (append-only history) · `DECISIONS.md` (decision index) · `UI_SYSTEM.md` (where `DESIGN.md` lives in code) |
| `tooling/dev-runner` | repo-owned desktop development supervisor: Vite HMR, watched process builds, safe Electron/daemon restarts, native/codegen refresh, and Nx affected typechecks |
| `services/push-relay` | *(planned)* the one cloud hop — open-source APNs wake-hint relay |

## Getting started

Prereqs: node per `.nvmrc` (`corepack enable` for pnpm) · Rust stable · `cargo install cargo-typify`.
The repo builds standalone: `truffle-core` is an exact crates-io pin (`=0.7.12`) and
`@vibecook/ice` an exact npm pin (`0.3.0`) — no sibling checkouts. Both numbers live in the
manifests (`Cargo.toml`, `pnpm-workspace.yaml`); cite them from there, not from prose — this
line said `=0.7.11`/`0.2.0` until 2026-08-07. (A truffle petition window
reopens the `../p008/truffle` `[patch.crates-io]` + `siblings.lock.json` dance; see
`CLAUDE.md` "Machine setup" and git history.)

```sh
pnpm install
pnpm preflight      # tool versions + import-boundary walls
pnpm dev            # desktop app dev loop
pnpm dev:design     # Electron UI Bench, no daemon or product data required
pnpm dev:design:web # optional browser-only UI Bench loop
pnpm verify         # full gate: typecheck · biome · rustfmt/clippy · TS+Rust tests · gen freshness
```

Env toggles are documented in `.env.example` (nothing auto-loads it — export in your shell).

## Development loop

`pnpm dev` starts one VibeField-owned lifecycle supervisor directly; that supervisor uses
Nx for workspace change detection and affected typechecks while it manages the
long-running stack:

- Vite hot-updates renderer code, including renderer-facing workspace packages and plugins.
- esbuild watches Electron main/preload and both fieldd runtime artifacts. A successful change
  publishes one immutable, content-addressed runtime snapshot and performs one debounced Electron
  restart; a failed or superseded build leaves the last valid snapshot running.
- Contract edits regenerate schema/Rust bindings before rebuilding `field-native`. Native edits
  rebuild the repo-owned sidecar. Plugin manifest edits regenerate installed metadata before
  restart, and a service's whole relative-import closure (resolved via esbuild metafile, bare
  imports external) is watched and hashed — not just its entry file. These critical watchers
  start before initial codegen/build, buffering startup edits until the serialized refresh queue
  is ready.
- Snapshots carry two identities: the combined runtime and the daemon plane
  (fieldd bundle/harness/wasm/native/plugin services). A shell-only edit restarts Electron alone
  and the new shell **adopts** the running fieldd/field-native pair through the buildId-gated
  probe (dev runs `leave-running`, the production shape); only a daemon-plane change reaps and
  respawns the pair. The runner owns final teardown at session end. Dev state, logs, snapshots,
  and Electron user data are isolated under `.vibefield/dev/`; an atomically published
  per-worktree lock refuses a second live stack.
- Nx watches the complete workspace graph and runs initial plus affected typechecks in the
  background. `pnpm build`, `pnpm test`, and `pnpm typecheck` use the same graph and local cache;
  `pnpm verify` remains the uncropped release-quality gate.

The development watcher is deliberately repository-bounded: it does not monitor
`../p008/truffle` or its manifests. After changing dependencies or package manifests, run
`pnpm install` and restart `pnpm dev`; installs are never performed implicitly by the watcher.

`pnpm dev:design` starts the single-page interface index in a dedicated Electron UI Bench. It
reuses the production BrowserWindow and security policy, but its empty preload and isolated
`.vibefield/ui-bench/` user-data root give it no user, daemon, plugin, tray, or diagnostic
capabilities. The renderer imports the shipping token sheet and production view compositions;
runtime-bound chrome receives deterministic fixture adapters for light/dark and state review.
It can run alongside `pnpm dev`. `pnpm dev:design:web` keeps the faster browser-only loop on port
5174 when native window behavior is irrelevant. Ownership and contribution rules live in
[`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md).

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
