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
- **`docs/AGENT_PLANE.md` indexes the agent plane** (main-tracked, added 2026-09-22): the three-repo
  system — puppeteer (the agent runtime, in fieldd) · rosetta (agent history, `rosettad` per user
  root) · this repo (custody, policy, presentation). Its umbrella page
  `docs/agent-plane/architecture.html` carries the ownership law (AR-L1: VibeField knows no vendor),
  the seams, the walls R20–R23, the data domains and the status legend; `system.html` the
  aggregation and `api.html` the doors. Read it before touching a seam: a seam change updates the
  page that OWNS the seam first, then the umbrella's table.

## Workspace taxonomy (the per-package map is README.md §Monorepo layout)

Four kinds of `packages/*`; the flat listing is deliberate. Assessed 2026-08-09 (James
ratified): do NOT merge the small packages into a `core` — the browser/Node boundary, the
EL7 review surface (`audit` is a one-sitting read), and Nx affected-granularity are encoded
in the split.

- **Wire truth:** `contracts` — the zero-dep root of the graph, imported from every
  environment (renderer, workers, Node daemons; Rust side generated). Keep it dependency-free.
- **Node-only spine libraries**, consumed by the Node hosts (fieldd, Electron main), never by
  browser-compatible code: `logging` + `audit` (LOG track), `users` (UA track), `screenshot`
  (SNAP track — the host side of the native screenshot helper; wall R19 keeps Electron out).
- **Daemon plane:** `fieldd` · `field-native` (the sole Cargo workspace member — the Windows
  screenshot helper crate under `apps/desktop/native` is its OWN workspace root, SNAP-D7) ·
  `fieldd-supervisor` (a library inside Electron main, never its own process) ·
  `fieldd-client` (the renderer/worker client).
- **Renderer plane:** `field-app` — the browser-compatible product (`@vibefield/fieldd` is a
  test-only devDependency; runtime deps stay browser-safe) · `design-kit` — the DESIGN KIT
  (tokens + primitives, shared with plugin-sdk), not electron-shell's UI · `electron-shell` —
  composition root (main/preload/renderer-host + the renderer vite build; no product logic).
  Studio preserves that split: `electron-shell/src/studio` owns the development-only host,
  protocol, and narrow preloads; `field-app/src/design-system` remains the Electron-free catalog
  and appearance workbench it mounts. The browser-only catalog is a separate authority-free entry.
- **Plugin system:** `plugin-sdk` (the R10 door; its `ui.ts` is the only design-kit re-export
  plugins may touch) · `plugin-runtime` · `tooling/plugin-build`; product plugins live at the
  repo root. `tooling/dev-runner` is the `pnpm dev` supervisor; `apps/*` are packaging roots.

## Machine setup

**RFC 025 petition window — OPENED 2026-09-16 (B0), PARTLY CLOSED the same day (UA-P-X).**
truffle **0.7.14** shipped RFC 025's login-scoped nodes (tag `v0.7.14` = `9f0d6287`, on
crates.io and npm together), and the CARGO and NPM planes took it: `truffle-core` is an exact
registry pin again with the `[patch.crates-io]` row deleted, and `apps/desktop` installs the
protocol-5 sidecar — the half the window could not buy, so a PACKAGED build can now run a
login-gated node. `siblings.lock.json` keeps a `truffle` entry, reduced to its `swift` key.

**The SwiftPM plane is still open, and closing it is not ours.** The kit is in a vice with both
jaws measured: forward to `exact: "0.7.14"` is UNSATISFIABLE, because `ghosttea` declares
`exact: "0.7.12"` of its own in every published Swift tag through v0.11.1 and two exact
requirements cannot both hold; back to `0.7.12` resolves and then does not COMPILE, because
UA-P-5a taught the kit RFC 025's login API (`MeshConfiguration.loginAllow`,
`MeshNode.loginName`, `Peer.loginName`) which no 0.7.12 has. So the path package under
`apps/ios/VibeFieldKit/.window/truffle` STAYS — a path package's identity is its DIRECTORY
NAME, which is what lets it override ghosttea's remote edge, and it records no revision, so
`Package.resolved` carries no truffle row (that absence is the shape, not a missing pin).
**`../truffle-rfc025` is therefore still required to build the iOS plane.** The exit is one
upstream event: a ghosttea Swift release whose `truffleVersion` is 0.7.14, and that is the whole
remaining exit list. The phone is NOT on different code meanwhile: `../truffle-rfc025` was
advanced to `9f0d6287`, the commit tagged `truffle-v0.7.14`, and the lock pins it there, so every
plane reads 0.7.14 and the path package is only how this one reaches it. `Cargo.toml`'s closure
note and `Package.swift` carry the resolver's and the compiler's own words; no prose here is
the authority for a number.

> **Errata (2026-09-16):** the paragraph that stood here — "The repo builds standalone since
> 2026-07-28 … the `../p008/truffle` sibling `[patch.crates-io]` and its `siblings.lock.json`
> SHA pin retired when the T1 petition window closed" — stopped being true when the RFC 025
> window opened, and the exit did NOT make it true again. The cargo patch is gone, but
> `../truffle-rfc025` is still required for the iOS plane, so **this repo does not build
> standalone**; `pnpm preflight` says which checkout is missing rather than letting a build fail
> later. `../p008/truffle` is James's own checkout and is still nothing this repo reads.

`@vibecook/ice` is an **exact registry pin** (`0.11.0`, declared once in the pnpm-workspace.yaml
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

**AR-0 sibling mode (2026-09-12):** the agent runtime is **puppeteer** and agent history is
**rosetta** (chopsticks and spaghetti retired 2026-09-04). Neither is published, so this repo
consumes two SIBLING CHECKOUTS, `../puppeteer` and `../rosetta` (three since 2026-09-16 —
`../truffle-rfc025` still serves the RFC 025 window's SwiftPM half above), pinned by revision in
`siblings.lock.json`: puppeteer's packages and rosetta's TypeScript client enter as `link:` rows in
the fenced block of `pnpm-workspace.yaml` (packages ask for `"*"`; only directly imported packages
are rows; adapters never — walls R20–R22), and `rosettad` is built from the rosetta checkout by
`pnpm siblings:build` (cargo's own target dir, the SSD) and reaches fieldd as `FIELDD_ROSETTAD_BIN`.
`pnpm preflight` fails on a missing checkout or a revision ≠ the pin and warns on a dirty tree;
`pnpm siblings` prints the state; `pnpm siblings:pin` is the deliberate upgrade event (EL8).
`scripts/siblings.mjs` is the ONE reader of the lock (preflight, `check:deps`, the Nx cache stamp
and the dev runner all go through it). Sibling *sources* reach the fieldd and renderer builds
through esbuild's and Vite's own input tracking, never through the runner's watchers, so the
"never watches sibling trees" law below stands. Exit (W-D8) is a version edit: replace each
`link:` row with an exact version and delete the lock entry.

Tools: node per `.nvmrc` (corepack for pnpm) · Rust stable · `cargo install cargo-typify`
(contracts codegen; preflight checks the version). Go is NO LONGER a prereq — truffle's mesh
sidecar was built from source while the window's Go half was open, and comes from npm again.

## Commands

- `pnpm dev` — directly enters the repo-owned desktop supervisor (which uses Nx for workspace
  change detection): renderer HMR, watched
  main/preload/fieldd builds, generated/native refresh, lifecycle-safe restarts, and background
  affected typechecks. Restarts are plane-aware: shell-only edits restart Electron and re-adopt
  the running daemons (dev is `leave-running`; the runner owns teardown); daemon-plane edits
  bounce the pair. Its isolated state is `.vibefield/dev/`; it never watches sibling trees.
- `pnpm dev:studio` — the real product plus VibeField Studio under the same runner, Vite server,
  Electron host, and daemon pair. `pnpm dev:design` opens or focuses Studio's Design System
  section and attaches to an active `pnpm dev` when one exists; it never starts a parallel stack.
  Studio has its own sandboxed window, ephemeral session, and narrow preload. Use
  `pnpm dev:design:web` for the catalog-only browser loop. Rules in `docs/UI_SYSTEM.md`.
- `pnpm smoke:studio` — opt-in physical Electron gate for Studio/product session and preload
  isolation, real UI edit/apply, product reload replay, Studio-close restoration, and fieldd.
- `pnpm smoke` / `pnpm smoke:canvas` / `pnpm smoke:godview` — headless desktop smoke checks
- `pnpm --filter @vibefield/desktop build:screenshot-helper` / `test:screenshot-helper` /
  `verify:screenshot-helper` — the native screenshot helper (Swift on macOS, Rust on Windows;
  `apps/desktop/native/*/screenshot-helper`). Outside `pnpm verify` like the SCK helper and the
  iOS app: `verify:screenshot-helper` is the live witness (a real `--capture-test`, no overlay),
  the Windows crate's gates are in its README (SNAP-D7). Never run the helper's `--once` on a
  developer's live display from an agent — it is a full-screen overlay.
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
- **The agent catalog decides support (AC, 2026-09-22).** `packages/contracts/src/agent-catalog.ts`
  (`AGENT_CATALOG`) is the ONE hand-maintained list of the agents VibeField offers — the id
  (puppeteer's), our label, `status`, the two seam ids, the layout root, `offers`, `surfaces`, the
  decision trail. Wall R23 (`scripts/check-agent-catalog.mjs`, in `pnpm preflight`; required by
  `pnpm siblings:pin`) holds every row to both pinned siblings; a sibling offering with no row is red
  (`declined` is a row). fieldd's doors answer from it; no product code compares an agent id to a
  literal (R23b — the gate's allow-list names the few presentation tables that may, each with an exact
  count). After editing the table: `pnpm --filter @vibefield/contracts gen:schema`, then copy
  `fixtures/agent-catalog.valid.json` to the kit's three mirrors (`pnpm check:ios-fixtures` names them).
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
