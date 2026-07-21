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
| `packages/plugin-runtime` | plugin manifest / registry / renderer context (P0 core of the design-03 plugin system) |
| `packages/plugins/note` | first built-in plugin — `note.card` sticky note on ICE `defineWidget` |
| `apps/desktop` | the Electron spine: windows, Field/System views, smoke harnesses |
| `services/push-relay` | *(planned)* the one cloud hop — open-source APNs wake-hint relay |

Further packages (shell-ui design kit, more built-in plugins) land per design-03 as the tracks progress.

## Getting started

Prereqs: node per `.nvmrc` (`corepack enable` for pnpm) · Rust stable · `cargo install cargo-typify` ·
sibling checkouts `../infinite-canvas-engine` and `../p008/truffle` — this repo consumes both by
path until `@vibecook/*` publishing is real (see `CLAUDE.md` "Machine setup").

```sh
pnpm install
pnpm preflight      # verifies the machine-coupled bits above
pnpm dev            # desktop app dev loop
pnpm verify         # full gate: typecheck · biome · rustfmt/clippy · TS+Rust tests · gen freshness
```

Env toggles are documented in `.env.example` (nothing auto-loads it — export in your shell).

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
