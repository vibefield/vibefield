# CLAUDE.md

VibeField — a personal programmable field for agentic computing. Electron shell over a
two-plane daemon pair per device: `fieldd` (Node, product truth) and `field-native`
(Rust, native execution — outlives fieldd), joined by a JSON-RPC management channel and
a private tailnet mesh (truffle). Build proceeds in tracks (A shell/spine · B canvas/plugins ·
C mesh) toward the P0 exit criterion: real daily agent work, sessions surviving app restarts.

## Design docs (read before structural work)

- `draft/` holds the whole design corpus. It is gitignored on main and tracked on the
  local-only `dev-local` branch (`pnpm commit-draft` snapshots it). NEVER push dev-local —
  the pre-push hook enforces this.
- Authority order: `draft/design-00-architecture.md` (top-level; the PP/EL laws) →
  `design-01-contracts` → `design-02-daemons` → `design-03-electron-app` (supersedes
  `design-03-widget-sdk`, kept as appendix 03·A) → `design-04-aggregation`.
  `foundations-and-architecture.md` is the decision record; `predesign-*` are evidence.
- The roadmap discipline (2026-08-02 — four doc species, four mutation rules; the trio is
  main-tracked under `docs/`, unlike the rest of the corpus):
  `docs/ROADMAP.md` = now/next, REWRITTEN in place at each milestone (never appended) ·
  `docs/LANDED.md` = the append-only ledger, one entry per landed slice ·
  `docs/DECISIONS.md` = the decision index (status flips there; definitions stay in their
  owning docs) · `draft/petitions/README.md` = petition status. The milestone ritual:
  rewrite ROADMAP · append LANDED · flip the finished thinking-doc's Status header · fold
  recorded deltas into the governing spec (or mark its section stale). Errata rule: a
  falsified claim gets a dated correction AT ITS SOURCE, never only downstream in the ledger.
- **`DESIGN.md` (repo root) governs art direction** — read it before writing ANY UI
  (tokens, motion easings, card chrome, materials, voice). Mechanics defer to design-03;
  look and feel defer to DESIGN.md. UI reviews cite its sections; token/easing deviations
  change the doc first.
- **`docs/UI_SYSTEM.md` governs where that direction lives in code** (main-tracked, added
  2026-08-06): tokens → primitives → colocated product compositions → catalog harnesses.
  Two rules bite immediately — add visual constants to `DESIGN.md` first and project them
  into `tokens.css`, and **the catalog mounts the shipping view with a fixture adapter,
  never a copy of its markup or CSS**. `packages/field-app/test/ui-system-boundaries.test.ts`
  enforces both, so a replica fails the gate rather than a review.

## Workspace taxonomy (the per-package map is README.md §Monorepo layout)

Four kinds of `packages/*`; the flat listing is deliberate. Assessed 2026-08-09 (James
ratified): do NOT merge the small packages into a `core` — the browser/Node boundary, the
EL7 review surface (`audit` is a one-sitting read), and Nx affected-granularity are encoded
in the split.

- **Wire truth:** `contracts` — the zero-dep root of the graph, imported from every
  environment (renderer, workers, Node daemons; Rust side generated). Keep it dependency-free.
- **Node-only spine libraries**, consumed by the Node hosts (fieldd, Electron main), never by
  browser-compatible code: `logging` + `audit` (LOG track), `users` (UA track).
- **Daemon plane:** `fieldd` · `field-native` (the sole Cargo workspace member) ·
  `fieldd-supervisor` (a library inside Electron main, never its own process) ·
  `fieldd-client` (the renderer/worker client).
- **Renderer plane:** `field-app` — the browser-compatible product (`@vibefield/fieldd` is a
  test-only devDependency; runtime deps stay browser-safe) · `design-kit` — the DESIGN KIT
  (tokens + primitives, shared with plugin-sdk), not electron-shell's UI · `electron-shell` —
  composition root (main/preload/renderer-host + the renderer vite build; no product logic).
  The UI Bench splits the same way: `electron-shell/src/design-bench` is the window bootstrap,
  `field-app/src/design-system` is the catalog page it mounts.
- **Plugin system:** `plugin-sdk` (the R10 door; its `ui.ts` is the only design-kit re-export
  plugins may touch) · `plugin-runtime` · `tooling/plugin-build`; product plugins live at the
  repo root. `tooling/dev-runner` is the `pnpm dev` supervisor; `apps/*` are packaging roots.

## Machine setup

The repo builds standalone since 2026-07-28. `truffle-core` is an **exact crates-io pin**
(`=0.7.12` in the root Cargo.toml) — the `../p008/truffle` sibling `[patch.crates-io]` and its
`siblings.lock.json` SHA pin retired when the T1 petition window closed. To co-develop truffle
again (a new petition window), re-add the `[patch]` and restore the sibling-pin machinery from
git history; never leave a path patch unpinned.

`@vibecook/ice` is an **exact registry pin** (`0.4.0`, declared once in the pnpm-workspace.yaml
overrides — packages ask for `"*"`). It stopped being a `file:` sibling on 2026-07-25: npm ships
its dist, so the B2 stale-dist class is gone and upgrading is a version edit, not a SHA chase.
To co-develop ice against this repo, link it locally and never commit that:

```sh
pnpm link ../infinite-canvas-engine/packages/ice   # undo: pnpm unlink
```

> **Errata (2026-08-07):** both version numbers above were stale — this file said truffle
> `=0.7.11` and ice `0.2.0` while the manifests had moved to `=0.7.12` (AH-1b) and `0.3.0`.
> `README.md` and `ROADMAP.md` repeated them. **The manifests are the authority, never this
> paragraph:** `Cargo.toml` for the cargo pins, `pnpm-workspace.yaml` overrides for the npm
> ones, `apps/ios/VibeFieldKit/Package.resolved` for the Swift side. Read the number there
> before citing one; an EL8 pin stated from memory is how lockstep quietly breaks.

Tools: node per `.nvmrc` (corepack for pnpm) · Rust stable · `cargo install cargo-typify`
(contracts codegen; preflight checks the version).

## Commands

- `pnpm dev` — directly enters the repo-owned desktop supervisor (which uses Nx for workspace
  change detection): renderer HMR, watched
  main/preload/fieldd builds, generated/native refresh, lifecycle-safe restarts, and background
  affected typechecks. Restarts are plane-aware: shell-only edits restart Electron and re-adopt
  the running daemons (dev is `leave-running`; the runner owns teardown); daemon-plane edits
  bounce the pair. Its isolated state is `.vibefield/dev/`; it never watches sibling trees.
- `pnpm dev:design` — the UI Bench: the single-page catalog in an isolated Electron window on
  the production window/security factory, with no preload, daemons, users, plugins, tray, or
  diagnostics. State lives in `.vibefield/ui-bench/`, so it runs beside `pnpm dev`. Use it for
  any UI work; `pnpm dev:design:web` is the browser-only loop. Rules in `docs/UI_SYSTEM.md`.
- `pnpm smoke` / `pnpm smoke:canvas` / `pnpm smoke:godview` — headless desktop smoke checks
- `pnpm build` / `pnpm typecheck` / `pnpm test` — Nx task graph with conservative local caching;
  use `pnpm exec nx graph` or `pnpm exec nx affected -t <target>` to inspect/select work
- `pnpm verify` — THE gate; run before every commit: preflight → typecheck → biome →
  rustfmt/clippy → TS + Rust tests → gen freshness
- `pnpm format` — biome `--write` + cargo fmt
- `pnpm gen` — regenerate contracts JSON Schema + typify'd `contracts.rs`; commit the output
- `pnpm test` (TS) · `pnpm test:rust` (cargo)

## Laws that bind code here (condensed from design-00; full text in draft/)

- **Contracts first.** Every VibeField-owned wire shape is a zod schema in
  `packages/contracts`; ports/scopes/stores/env-prefixes come from its `registries.ts` —
  never hardcode. The Rust side is generated (`pnpm gen`) and pinned by golden fixtures.
- **EL2 — bytes never ride JSON-RPC or Node.** Control via contract surfaces; data planes
  via ticketed direct sockets.
- **EL7 — same-uid agents are the adversary.** Scoped bearer tokens on every surface;
  `FIELD_*`/`FIELDD_*` env vars are stripped from agent PTYs; daemon secrets never enter
  agent environments.
- **EL8 — version lockstep.** `loro-crdt` (workspace override) and `truffle-core`
  (exact `=` registry pin) bump only as deliberate upgrade events, never casually.
- **Tolerant reader.** Inbound parsing is `.passthrough()` + unknown-field logging; degraded
  states surface as `UNAVAILABLE {service, state, progress}` — honest states, never blanks.
- **Two planes.** field-native outlives fieldd outlives the shell. The session-persistence
  ceiling is daemon-lifetime — UX says so honestly, never promises more.

## Style & tests

- TS: biome (`biome.jsonc` — double quotes, 2-space, width 100). Rust: rustfmt defaults,
  clippy clean at `-D warnings`. UI code additionally follows `DESIGN.md` (no hex literals
  outside tokens; the named easings; the shadow recipes).
- Every daemon seam ships contract fixtures parsed on both sides (EL9); kill-matrix
  integration tests live in `packages/fieldd/test`. New plugins get at least a
  manifest/registry test (`plugins/note/test` is the template). Plugins live at the
  repo root (`plugins/*`, dev/reference packs in `examples/plugins/*`) — walls rule
  R10 (ENFORCED since PLUG-P3 — the SDK is the door) keeps them SDK-only.
- Env vars: see `.env.example`. Nothing auto-loads `.env` — export in the launching shell.

## Commits

Track-prefixed subjects in the repo voice (`B2: the canvas is alive — …`) with detailed
bullet bodies: what's real vs stubbed, tests run, findings discovered along the way.
Draft-doc snapshots go through `pnpm commit-draft`, never by committing `draft/` to main.
