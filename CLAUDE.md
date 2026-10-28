# CLAUDE.md

VibeField — a personal programmable field for agentic computing. Electron shell over a
two-plane daemon pair per device: `fieldd` (Node, product truth) and `field-native`
(Rust, native execution — outlives fieldd), joined by a JSON-RPC management channel and
a private tailnet mesh (truffle). Work proceeds in tracks (now and next: `docs/ROADMAP.md`);
the engineering bar is the P0 exit criterion: real daily agent work, sessions surviving app restarts.

## Design docs (read before structural work)

- `draft/` holds the whole design corpus. It is gitignored on main and tracked on the
  local-only `dev-local` branch (`pnpm commit-draft` snapshots it). NEVER push dev-local —
  the pre-push hook enforces this.
- Authority order: `draft/design-00-architecture.md` (top-level; the PP/EL laws) →
  `design-01-contracts` → `design-02-daemons` → `design-03-electron-app` (supersedes
  `design-03-widget-sdk`, kept as appendix 03·A) → `design-04-aggregation` →
  `design-06-sync-planes`. `foundations-and-architecture.md` is the decision record; `predesign-*` are evidence.
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
  the seams, the walls R20–R23 (and R24, 2026-10-05: mille is imported only by fieldd's files worker and through field-app's allowed entries — FS-1a), the data domains and the status legend; `system.html` the
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
  (SNAP track — the host side of the native screenshot helper; wall R19 keeps Electron out), `trust` (WP12 D2 — the
  ONE Ed25519 + trust-root verifier fieldd, the kit, the stager and main's update provider share; walls R27/R28).
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
  `live-surfaces` — the live-surface foundation's browser-compatible library (demand, the frame
  queue, the lifecycle; its `./renderer` entry), consumed by field-app and electron-shell; its
  wall keeps it independent of Electron, Node, ICE, plugins and field-app.
- **Plugin system:** `plugin-sdk` (the R10 door; its `ui.ts` is the only design-kit re-export
  plugins may touch) · `plugin-runtime` · the authoring kit `tooling/plugin-build`,
  `tooling/plugin-cli` (`pnpm plugin`) and `tooling/create-plugin`; product plugins live at the
  repo root. `tooling/dev-runner` is the `pnpm dev` supervisor; `apps/*` are packaging roots.

## Machine setup

**The manifests are the authority; this file names no pin.** Read a number at its source before citing one. An EL8
pin stated from memory is how lockstep quietly breaks.
- Cargo: `Cargo.toml` `[workspace.dependencies]` (exact `=` registry pins, e.g. `truffle-core`, `ghosttea`) and
  `Cargo.lock`.
- npm: the `pnpm-workspace.yaml` overrides (ICE, loro, ghosttea, the `@vibefield/rosetta-*` and
  `@vibefield/puppeteer-*` rows, mille's `link:` rows; packages ask for `"*"`), and `apps/desktop/package.json` for
  the five `@vibecook/truffle-sidecar-*` packages.
- Swift: `apps/ios/VibeFieldKit/Package.swift`'s `let <name>Release` lines and `apps/ios/VibeFieldKit/Package.resolved`.
- Siblings: `siblings.lock.json` (each checkout's revision, and a `release` per plane). The compiler:
  `rust-toolchain.toml`.
- `pnpm preflight` holds them to each other (`PIN_EXPECTATIONS` in `scripts/preflight.mjs`); DECISIONS (TB for
  truffle, RD for the release shapes) holds why each moved.

> **Errata, folded (2026-10-28, the housekeeping pass; James, 2026-10-28, the housekeeping page (Q1)):** pins stated
> in this section went stale three times, so it now states none.
> - **2026-08-07:** it said truffle `=0.7.11` and ice `0.2.0` while the manifests had moved to `=0.7.12` (AH-1b) and
>   `0.3.0`; `README.md` and `ROADMAP.md` repeated them.
> - **2026-09-16:** it said "the repo builds standalone since 2026-07-28" (the `../p008/truffle` patch retired with
>   the T1 window). That stopped being true when the RFC 025 window opened: `../truffle-rfc025` was required for the
>   iOS plane until 2026-10-24. `../p008/truffle` is James's own checkout and is nothing this repo reads.
> - **2026-10-24:** it said "the SwiftPM plane is still open, and closing it is not ours", that a forward to
>   `exact: "0.7.19"` was unsatisfiable (ghosttea declared `exact: "0.7.12"` in every published Swift tag through
>   v0.12.0), and that `../truffle-rfc025` was still required to build the iOS plane. All three were true until
>   ghosttea v0.13.0 declared truffle 0.7.19. The same day's erratum on the ghosttea window: the lock had pinned
>   `../ghosttea-0.11.2` for six Cargo patches and the React renderer, built by `install-js`, `siblings:build` and CI,
>   from 2026-09-27 until the EL8 to ghosttea 0.13.1.
>
> The superseded paragraphs are in git (`git log -p -- CLAUDE.md`); the events are in `docs/LANDED.md`.

**Which checkouts a fresh tree needs.** The repo does not build standalone. `needsCheckout` in `scripts/siblings.mjs`
decides it: a sibling needs its checkout while any of its planes is committed in dev shape (`link:` rows, path
patches, a path package), while something is built from it (rosettad), or while the local overlay links it. Today
that is two checkouts beside this one: `../rosetta-pin` (rosettad is built from it) and `../mille-pin` (mille's
`link:` rows). `node scripts/siblings.mjs fetch NAME` creates each at its pin, and `pnpm preflight` names a missing
one rather than letting a build fail later.
*The last measurement (James's Mac mini, 2026-10-22 on the EL8's ghosttea 0.13.0 build and 2026-10-23 at its 0.13.1
tip; the lane's logs/mini/standalone-*.log and gate-r2's bare-preflight.log) named three: `../puppeteer`,
`../rosetta-pin` and `../mille-pin`. With those three it installs, builds field-native and passes preflight.
puppeteer's npm plane went exact on 2026-10-26 (RD-5a-2, `a04850e29`), which
drops it from the list by `needsCheckout`'s rule (true for rosetta and mille alone, read 2026-10-28); CI's verify
has run without `../puppeteer` since that day (`verify.yml`). The two is read from the code, not re-measured on a
bare host.*

**truffle is released on every plane.** RFC 025's petition window opened on 2026-09-16 (B0). Its cargo and npm
planes closed the same day (UA-P-X). Its SwiftPM plane closed on 2026-10-24, at the EL8 to ghosttea 0.13.1 (G28's
exit). See DECISIONS TB for every bump since.
- `truffle-core` is an exact registry pin in `Cargo.toml`, with no `[patch.crates-io]` row.
- `apps/desktop` installs the mesh sidecar from npm. The core and its sidecar move together in one EL8 event, never
  one plane alone (TB's revert note). The sidecar's protocol, and what each protocol adds, are in TB.
- The kit's truffle row is the exact URL package that `Package.swift`'s `truffleRelease` names, rendered from the
  lock's `release.swift`. It may trail the cargo plane. SwiftPM must agree with the truffle version that the pinned
  ghosttea's own manifest declares exact, so the Swift plane moves in the EL8 of the first ghosttea that declares the
  new truffle (TB, the split of 2026-10-27).
- T6 retired the `.vibefield/sidecar/` override and `.env`'s `FIELD_NATIVE_SIDECAR_PATH`. `pnpm dev` hands the floor
  the pinned sidecar itself (`devSidecar`).
- field-native builds the egress arm by default (TB-E). It publishes its terminal doors for a linked desktop by
  default (TB-T).
- `siblings.lock.json` keeps a `truffle` entry with only its `swift` key, its public `repository` and
  `release.swift`. It is the dev overlay's coordinate: `node scripts/siblings.mjs fetch truffle` creates
  `../truffle-rfc025` at the pin, and `pnpm siblings use truffle` links it. `apps/ios/VibeFieldKit/.window/truffle`
  stays as the overlay's link; with `../truffle-rfc025` absent it dangles, and preflight reads it only while
  `use truffle` stands. **No truffle checkout is needed to build any plane.**

`@vibecook/ice` is an **exact registry pin of a RELEASE** (the overrides row in `pnpm-workspace.yaml`; packages ask
for `"*"`). It stopped being a `file:` sibling on 2026-07-25: npm ships its dist, so the B2 stale-dist class is gone
and upgrading is a version edit, not a SHA chase. **A pin bump is an EL8 event, one commit:** the pin moves in its
THREE places together — preflight's `PIN_EXPECTATIONS` (anchored to the line's end, so a `-desk.N` prerelease never
passes for a release), the overrides row with its dated note, and `minimumReleaseAgeExclude` for a version published
this week (keep the OLD row for the one install that rewrites the lock, then drop it — the lock is regenerated by
`pnpm install`, never hand-edited) — and the same commit regenerates fieldd's ICE1 probe fixtures
(`packages/fieldd/test/probes/ice1-envelope/`, its `generate.mjs`). Then `pnpm check:deps` holds one copy each (ICE,
strata, loro), `pnpm still` stays byte for byte or its re-bless is said, and the desk smokes run on it
(`pnpm gate:landing`). The `0.15.0-desk.N` prereleases on `next` were the desk lane's alone (DK-D12); main pins
releases.
To co-develop ice against this repo, link it locally and never commit that:

```sh
pnpm link ../infinite-canvas-engine/packages/ice   # undo: pnpm unlink
```

**The sibling model (AR-0, 2026-09-12; RD since 2026-10-15).** The agent runtime is **puppeteer** and agent history
is **rosetta** (chopsticks and spaghetti retired 2026-09-04). `siblings.lock.json` pins every sibling by revision.
Each plane is committed in one of two shapes, by `thinking-release-deps.md` (RD-1):
- A **released** plane is committed EXACT: puppeteer's `@vibefield/puppeteer-*` rows (RD-5a-2, 2026-10-26), rosetta's
  `@vibefield/rosetta-protocol` and `-room` (RD-5a, 2026-10-14, published from the revision the lock pins), ghosttea
  and truffle on every plane. Its lock entry stays as the dev overlay's coordinate.
- An **unreleased** plane is committed as `link:`/path rows: mille's npm plane (FS-1b, below). rosettad is still
  built from `../rosetta-pin` until it ships as a release asset (RD-D7).
- Only directly imported packages are rows; adapters never are (walls R20–R22).

The tools:
- `scripts/siblings.mjs` is the ONE reader of the lock (preflight, `check:deps`, the Nx cache stamp and the dev
  runner all go through it).
- `pnpm preflight` fails on a missing checkout or a revision ≠ the pin and warns on a dirty tree. `pnpm siblings`
  prints the state.
- `pnpm siblings:build` builds rosettad from the pinned rosetta checkout (cargo's own target dir, the SSD); it reaches
  fieldd as `FIELDD_ROSETTAD_BIN`.
- `pnpm siblings:pin` is the deliberate upgrade event (EL8). Since 2026-10-04 it also typechecks the consumers: a
  sibling type change the consumer's compiler alone can see fails the pin loudly (the new SHAs stay recorded;
  `--skip-typecheck` for the deliberate case).
- `pnpm siblings render --prod` writes the committed rows from the lock (`--check` compares), and the pre-commit hook
  refuses a commit whose staged rows its own lock does not render.

Sibling *sources* reach the fieldd and renderer builds through esbuild's and Vite's own input tracking, never through
the runner's watchers, so the "never watches sibling trees" law below stands.

**The dev overlay (RD-2, RD-3).** `pnpm siblings use NAME` links a released sibling's checkout back, locally only.
- npm: a gitignored root `.pnpmfile.cjs` that pnpm loads for every command, with the dev lockfile under
  `.vibefield/dev/`. The committed `pnpm-lock.yaml` is never the overlay's. `use --none` removes it and reinstalls
  the committed shape.
- cargo: a released cargo plane is committed in one of two shapes. As an exact registry version (`release.cargo` =
  "X", 2026-10-22, `thinking-release-deps.md` §13) it has NO `[patch.crates-io]` row, and its
  `[workspace.dependencies]` row is rendered `=X`. As a fork line (`release.cargo` = git + rev) it has git rows.
  Either way the overlay links it through a generated, gitignored root `.cargo/config.toml`, with Cargo.lock
  skip-worktree while it stands. Preflight refuses the overlay while a linked crate's version does not satisfy the
  requirement, because cargo would leave the patch unused (measured 2026-10-22).
- Swift: a released Swift plane is the manifest's own `let <name>Release` line, which the overlay renders nil in the
  working tree (the manifest shows modified). It is the line itself because SwiftPM caches a manifest by its contents
  plus its environment, never a file it reads. `.window/truffle` and `.window/ghosttea` are the overlay's links.
- While a lock is hidden, every commit is refused.

A sibling whose every plane is released needs no checkout (`needsCheckout`). Exit (RD-5, superseding W-D8's "delete
the entry") is a `release` recorded in the lock and the rows re-rendered; the entry stays as the overlay's
coordinate.

**rosetta's checkout is dedicated to its pin (W-D10, 2026-10-03):** `../rosetta-pin` is a DETACHED checkout at the
lock's revision, with its `repository` in the lock so `node scripts/siblings.mjs fetch rosetta` creates it on a
machine that lacks it (once the pin is on the remote). James's working checkout `../rosetta` is nothing this repo
reads, so his commits there do not redden preflight. A pin move is
`git -C ../rosetta-pin fetch && git -C ../rosetta-pin checkout --detach <sha>`, then `pnpm siblings:pin rosetta`
(which builds rosettad from that checkout; its machine-local `.cargo/config.toml` keeps the target on the SSD). Since
RD-5a the same EL8 commit moves the two `@vibefield/rosetta-*` rows to the version published from that revision (and
preflight's `PIN_EXPECTATIONS`), so rosettad and the client never name two revisions.

**ghosttea is released on every plane (the terminal performance source window, opened 2026-09-27, CLOSED 2026-10-24
at the EL8 to ghosttea 0.13.1):** npm and Swift exact, and cargo as a registry pin with no `[patch.crates-io]` row.
The lock's `ghosttea` entry (its checkout `../ghosttea-0.11.2`, at the lock's revision) is only the dev overlay's coordinate:
`node scripts/siblings.mjs fetch ghosttea` creates it, and `pnpm siblings use ghosttea` links its renderer, its six
crates and its Swift package back. Name it to build its JavaScript (`install-js ghosttea`, `build-js ghosttea`): the
sweep skips a released, unlinked plane. CI needs no ghosttea checkout, and the `prepare-ghosttea` composite retired.

**Files service sibling window (FS-1b, 2026-10-05):** `../mille-pin` is a dedicated checkout at
`siblings.lock.json`'s revision, supplying mille and mille-ui together for the unreleased WebSocket channel.
`node scripts/siblings.mjs fetch mille`, then named `install-js mille` / `build-js mille`, prepares it (CI: the
`prepare-mille` composite). Host React peers are linked only inside that dedicated checkout's generated
node_modules; its source and lock stay unchanged. Renderer and test aliases share the lock's built exports,
including rosetta's nested consumer. R24 permits mille's engine (the root entry, `/node`) only in the files worker;
field-app may import `/port`, `/remote` and mille-ui, and fieldd's and field-app's tests the same two clients. Exit
is an exact npm version after the release (RD-5).

> **Errata (2026-10-07):** this paragraph said R24 admits "browser client/port/remote
> entries". It never admitted a `/browser` entry: the wall (`scripts/check-import-boundaries.mjs`)
> names `/port`, `/remote` and mille-ui, nothing imports `@vibecook/mille/browser`, and mille at
> the pin (`baa0de8`) exports no `./browser`.

Tools: node per `.nvmrc` (corepack for pnpm) · Rust per `rust-toolchain.toml` (rustup reads it;
`rustup toolchain install`; DECISIONS RT) · `cargo install cargo-typify` (contracts codegen; preflight checks the
version). Go is NO LONGER a prereq — truffle's mesh sidecar was built from source while the window's Go half was
open, and comes from npm again.

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
  isolation, real UI edit/apply, product reload replay, Studio-close restoration, and fieldd — on a
  fresh dev root under /tmp (`apps/desktop/packaging/run-studio-smoke.mjs`; `VIBEFIELD_DEV_ROOT`
  moves the dev runner's whole state), never the checkout's `.vibefield/dev`.
- `pnpm smoke` / `pnpm smoke:canvas` / `pnpm smoke:godview` / `pnpm smoke:plugin-restart` /
  `pnpm smoke:kind-faults` — desktop smoke checks. Each runs Electron on its OWN profile, fresh
  under the OS temp and removed after (`apps/desktop/packaging/run-smoke.mjs`; `smoke:godview` and
  `smoke:terminal-direct` through MV's `scripts/smoke-godview.mjs`, its isolated lab profile proven, with
  the same run mark and daemon row; main mints one for a hand-started smoke), never the app's shared one. `smoke:canvas`, `smoke:plugin-restart` and
  `smoke:kind-faults` keep the GPU and draw the desk (`--disable-gpu` asserts its unavailable card
  instead). `smoke:plugin-restart` and `smoke:kind-faults` run on plugin fixtures staged for that
  ONE run (`apps/desktop/packaging/stage-kind-fixtures.mjs`: a temporary `FIELDD_PLUGIN_DEV_ROOTS`,
  never `examples/plugins`) — the restart smoke enables, disables, updates and regresses the clock
  before its restarts; the faults smoke boots the desk beside DK-7's broken clocks.
  `smoke:canvas:no-gpu` / `smoke:canvas:no-webgpu` run the GPU-less modes on smoke:canvas's build.
  `smoke:plugin` is run as an author runs it, through the kit — `pnpm plugin try
  examples/plugins/desk-clock` stages the plugin alone in a dev root of its own (a bare
  `pnpm smoke:plugin` stages nothing and says so). `smoke:terminal-door` and
  `smoke:terminal-direct` are Godview's terminal proofs. `pnpm still` is the playground's Dawn stills
  against their goldens — host-bound (this Mac's Metal, `webgpu`, `@napi-rs/canvas`), out of CI.
  Every smoke stops its own daemons and waits for them; its launcher then fails the run if any
  process of it lives (`VF_SMOKE_RUN`, `SMOKE_DAEMONS`). `smoke:browser-widget` RETIRED at DK-5.
  The packaged rows: `smoke:bundled` (WP8d, the staged bundled plugins under a verified index),
  `smoke:update` (WP12f, a dev-keyed packaged app against the fixture update origin; landing-only)
  and `pnpm --filter @vibefield/desktop smoke:profile --app <app or zip>` (BP-D7, no root script; the
  browser profile's cookie encryption on a signed package) — rows 29–31 of `docs/desk-gates.md`.
- `pnpm gate:landing` — the landing-only gates (`pnpm still` and every smoke, this Mac's GPU),
  each alone, one verdict line each; `--with-stages` runs `verify`'s stages first, each alone; a
  gate past `--timeout-min` (30) is stopped whole and red. REQUIRED at every landing, out of CI.
  The list, what each proves and its doors: `docs/desk-gates.md`. **The cargo target is SHARED**
  (`~/.cargo/config.toml` sets one `target-dir` for every checkout, and a checkout's own `target`
  link does not override it): the smokes run whichever checkout's `field-native` was built last, and
  cargo does not rebuild across checkouts — before gating after another checkout built, touch the
  Rust sources that differ and `cargo build -p field-native`; give a control worktree its own
  `CARGO_TARGET_DIR` (its fieldd test setup builds `field-native`).
- `pnpm --filter @vibefield/desktop build:screenshot-helper` / `test:screenshot-helper` /
  `verify:screenshot-helper` — the native screenshot helper (Swift on macOS, Rust on Windows;
  `apps/desktop/native/*/screenshot-helper`). Outside `pnpm verify` like the SCK helper and the
  iOS app: `verify:screenshot-helper` is the live witness (a real `--capture-test`, no overlay),
  the Windows crate's gates are in its README (SNAP-D7). Never run the helper's `--once` on a
  developer's live display from an agent — it is a full-screen overlay.
- `pnpm build` / `pnpm typecheck` / `pnpm test` — Nx task graph with conservative local caching;
  use `pnpm exec nx graph` or `pnpm exec nx affected -t <target>` to inspect/select work
- `pnpm verify` — THE gate; run before every commit: preflight → the import walls
  (`check:walls`) → deps/retired/fixtures/icons → typecheck → biome → rustfmt/clippy →
  bundle → TS + Rust tests → gen freshness
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
  `fixtures/agent-catalog.valid.json` to the kit's five mirrors (`pnpm check:ios-fixtures` names them).
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
  A person's Quit (⌘Q, Dock, tray, menu) stops them through the census gate (ESR §7.3 as amended); a crash, a Force Quit or a signal leaves them.

## Style & tests

- TS: biome (`biome.jsonc` — double quotes, 2-space, width 100). Rust: rustfmt defaults,
  clippy clean at `-D warnings`. UI code additionally follows `DESIGN.md` (no hex literals
  outside tokens; the named easings; the shadow recipes).
- Every daemon seam ships contract fixtures parsed on both sides (EL9); kill-matrix
  integration tests live in `packages/fieldd/test`. New plugins get at least a
  manifest/registry test (`plugins/comment-pad/test` is the template). Plugins live at the
  repo root (`plugins/*`, dev/reference packs in `examples/plugins/*`) — walls rule
  R10 (ENFORCED since PLUG-P3 — the SDK is the door) keeps them SDK-only.
- Env vars: see `.env.example`. Nothing auto-loads `.env` — export in the launching shell.

## Commits

Track-prefixed subjects in the repo voice (`B2: the canvas is alive — …`) with detailed
bullet bodies: what's real vs stubbed, tests run, findings discovered along the way.
Draft-doc snapshots go through `pnpm commit-draft`, never by committing `draft/` to main.
