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
| `services/push-relay` | *(planned)* the one cloud hop — open-source APNs wake-hint relay |

## Getting started

Prereqs: node per `.nvmrc` (`corepack enable` for pnpm) · Rust stable · `cargo install cargo-typify` ·
one sibling checkout, `../p008/truffle` — consumed by path because cargo `[patch.crates-io]` has no
registry equivalent (see `CLAUDE.md` "Machine setup"). `@vibecook/ice` now comes from npm at an
exact pin, so it needs no checkout.

```sh
pnpm install
pnpm preflight      # verifies the machine-coupled bits above
pnpm dev            # desktop app dev loop
pnpm verify         # full gate: typecheck · biome · rustfmt/clippy · TS+Rust tests · gen freshness
```

Env toggles are documented in `.env.example` (nothing auto-loads it — export in your shell).

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
