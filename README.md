# VibeField

A personal programmable field for agentic computing — infinite canvases hosting live widgets,
a two-plane daemon pair per device (`fieldd` Node product plane · `field-native` Rust native plane),
a private mesh across machines, and an iPhone companion.

> Build anything. See everything alive.

## Monorepo layout

| Path | What |
|---|---|
| `packages/contracts` | `@vibefield/contracts` — zod-first source of every VibeField-owned protocol; `gen/` JSON Schema → typify'd Rust |
| `packages/field-native` | Rust native-plane daemon: mgmt server, D8 pairing, MeshGateway (truffle node); embedded ghosttea TerminalService to come |
| `packages/fieldd` | Node product-plane daemon: NativeLink, TokenService, ProductAPI (dual-WS), MeshClient |
| `packages/fieldd-client` | renderer/worker client — loopback WS + React hooks |
| `packages/fieldd-supervisor` | Node-only fieldd discovery/adopt/spawn/shutdown library — executes inside Electron main, never a process of its own |
| `packages/electron-shell` | Electron main + preload + the tiny renderer host, and the renderer's vite build — a composition root with no product logic |
| `packages/field-app` | the browser-compatible renderer product: boot machine, DocManager, the FieldView units (session/canvas/persistence/chrome/previews), HUD |
| `packages/shell-ui` | the design kit — CardShell, tokens, GL card chrome (DESIGN.md made code) |
| `packages/plugin-runtime` | plugin manifest / registry / renderer context (P0 core of the design-03 plugin system) |
| `plugins/*` | built-in plugins at the repo root (product actors beside the platform — plugin spec §5.1): `note` (sticky note), `field-tools` (folder/comment) |
| `examples/plugins/widgetlab` | the 18-widget parity pack — dev/reference plugin, staged as demo boot content |
| `apps/desktop` | packaging-only: delegating scripts + the electron dep; no application source lives here |
| `tooling/dev-runner` | repo-owned desktop development supervisor: Vite HMR, watched process builds, safe Electron/daemon restarts, native/codegen refresh, and Nx affected typechecks |
| `services/push-relay` | *(planned)* the one cloud hop — open-source APNs wake-hint relay |

## Getting started

Prereqs: node per `.nvmrc` (`corepack enable` for pnpm) · Rust stable · `cargo install cargo-typify`.
The repo builds standalone: `truffle-core` is an exact crates-io pin (`=0.7.9`) and
`@vibecook/ice` an exact npm pin — no sibling checkouts. (A truffle petition window
reopens the `../p008/truffle` `[patch.crates-io]` + `siblings.lock.json` dance; see
`CLAUDE.md` "Machine setup" and git history.)

```sh
pnpm install
pnpm preflight      # tool versions + import-boundary walls
pnpm dev            # desktop app dev loop
pnpm verify         # full gate: typecheck · biome · rustfmt/clippy · TS+Rust tests · gen freshness
```

Env toggles are documented in `.env.example` (nothing auto-loads it — export in your shell).

## Development loop

`pnpm dev` starts one VibeField-owned lifecycle supervisor directly; that supervisor uses
Nx for workspace change detection and affected typechecks while it manages the
long-running stack:

- Vite hot-updates renderer code, including renderer-facing workspace packages and plugins.
- esbuild watches Electron main/preload and both fieldd runtime artifacts. A successful change
  performs one debounced Electron restart; a failed build leaves the last valid app running.
- Contract edits regenerate schema/Rust bindings before rebuilding `field-native`. Native edits
  rebuild the repo-owned sidecar. Plugin manifest/service edits regenerate or reload their
  installed metadata before restart.
- Restart uses Electron's normal `will-quit` path, waits for owned fieldd/native cleanup, and
  validates a per-build identity before daemon adoption. Dev state, logs, and Electron user data
  are isolated under `.vibefield/dev/`; a per-worktree lock refuses a second live stack.
- Nx watches the complete workspace graph and runs initial plus affected typechecks in the
  background. `pnpm build`, `pnpm test`, and `pnpm typecheck` use the same graph and local cache;
  `pnpm verify` remains the uncropped release-quality gate.

The development watcher is deliberately repository-bounded: it does not monitor
`../p008/truffle` or its manifests. After changing dependencies or package manifests, run
`pnpm install` and restart `pnpm dev`; installs are never performed implicitly by the watcher.

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
