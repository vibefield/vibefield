# VibeField

A personal programmable field for agentic computing — infinite canvases hosting live widgets,
a two-plane daemon pair per device (`fieldd` Node product plane · `field-native` Rust native plane),
a private mesh across machines, and an iPhone companion.

> Build anything. See everything alive.

## Monorepo layout

| Path | What |
|---|---|
| `packages/contracts` | `@vibefield/contracts` — zod-first source of every VibeField-owned protocol; `gen/` JSON Schema → typify'd Rust |
| `packages/field-native` | Rust native-plane daemon: mgmt server, D8 pairing, MeshGateway (truffle node), and the TerminalUnit that supervises the `field-terminal-host` cells — the native floor that outlives fieldd (NF-0…7). *(Corrected 2026-09-14 by the TM review: this row said "the embedded ghosttea TerminalService … (NF-0…7 + NF-remote)". Ghosttea's `TerminalService` is constructed in the CELL binary — `packages/field-native/src/cell.rs:199`, since the cells landed at TC-S2 — and the floor's own remote half retired at TM-1 `afc35b15`; the remote posture is T, each cell's door reached over the sidecar's route.)* |
| `packages/fieldd` | Node product-plane daemon: NativeLink, TokenService, ProductAPI (dual-WS), MeshClient, DocumentService, ArtifactService |
| `packages/users` | the multi-persona layer: the users.json lock, per-user roots, mint/migrate (UA track) |
| `packages/logging` · `packages/audit` | the structured logging/diagnostics pipeline and the append-only audit log (LOG track) |
| `packages/plugin-sdk` | the door plugins come through — walls rule R10 keeps `plugins/*` SDK-only |
| `packages/fieldd-client` | renderer/worker client — loopback WS + React hooks |
| `packages/fieldd-supervisor` | Node-only fieldd discovery/adopt/spawn/shutdown library — executes inside Electron main, never a process of its own |
| `packages/screenshot` | `@vibefield/screenshot` — Node-only host of the native screenshot helper (SNAP track): spawns one `--once` helper, reads its one-line protocol (`contracts/src/screenshot.ts`), owns the timers and the still ring; Electron main composes it, wall R19 keeps Electron out |
| `packages/trust` | `@vibefield/trust` — Node-only: the ONE Ed25519 check and trust-root verifier (TD-2/TD-3) that fieldd, the authoring kit (re-exported), the stager and Electron main's update provider all call; walls R27/R28 keep it out of browser code and keep its own imports to contracts + `node:` (WP12 D2) |
| `packages/electron-shell` | Electron main + preload + the tiny renderer host, and the renderer's vite build — a composition root with no product logic |
| `packages/field-app` | the browser-compatible renderer product: boot machine, DocManager, the FieldView units (session/canvas/persistence/chrome/previews), HUD |
| `packages/design-kit` | the design kit — tokens, primitives, glyphs, the face and the logo (DESIGN.md made code; its DOM and GL card dressing left with the desk, DK-17) |
| `packages/plugin-runtime` | plugin manifest / registry / renderer context (P0 core of the design-03 plugin system) |
| `plugins/*` | built-in plugins at the repo root (product actors beside the platform — plugin spec §5.1): `comment-pad` (the comment pad — VibeField's own object kind, DK-8), `browser` (the Artifact Hub panel) |

| `apps/desktop` | packaging-only: delegating scripts + the electron dep; no application source lives here — the native helpers' sources do (`native/macos/live-surface-capture` the SCK helper · `native/macos/screenshot-helper` the Swift screenshot helper · `native/windows/screenshot-helper` its Rust twin, an own-workspace crate) with their build/test/verify scripts under `packaging/` |
| `apps/ios` | the iPhone companion — thin xcodeproj over the `VibeFieldKit` SPM package (FieldHome · FieldAgents · FieldMesh · FieldTerminal · FieldDesign · SwarmPhysics). Deliberately outside `pnpm verify` (the gate must not require Xcode); its gate is the `xcodebuild` commands in `apps/ios/README.md` |
| `docs/` | the main-tracked corpus: `ROADMAP.md` (now/next) · `LANDED.md` (append-only history) · `DECISIONS.md` (decision index) · `UI_SYSTEM.md` (where `DESIGN.md` lives in code) · `AGENT_PLANE.md` + `agent-plane/` (the three-repo agent plane) |
| `tooling/dev-runner` | repo-owned desktop development supervisor: Vite HMR, watched process builds, safe Electron/daemon restarts, native/codegen refresh, and Nx affected typechecks |
| `services/push-relay` | *(planned)* the one cloud hop — open-source APNs wake-hint relay |

## Getting started

Prereqs: node per `.nvmrc` (`corepack enable` for pnpm) · Rust per `rust-toolchain.toml` (rustup reads it; `rustup toolchain install`) · `cargo install cargo-typify` ·
two SIBLING CHECKOUTS beside this one: `../rosetta-pin` (rosettad is built from it; dedicated to its pin
since 2026-10-03) and `../mille-pin` (FS-1b, the files service window) — `node scripts/siblings.mjs fetch
NAME` creates each at its pin.
*(Corrected 2026-10-26, puppeteer 0.2.3: this said THREE, with `../puppeteer` first (AR-0; its packages were
`link:` rows). Its packages are exact `@vibefield/puppeteer-*` registry pins since, so no build reads that
checkout; it stays in `siblings.lock.json` as the dev overlay's coordinate: `pnpm siblings use puppeteer`.)*
*(Corrected 2026-10-23, the EL8 to ghosttea 0.13.1: this said FOUR — `../puppeteer`, `../rosetta-pin`,
`../truffle-rfc025` and `../ghosttea-0.11.2` — and left out `../mille-pin`, required since 2026-10-05.
ghosttea 0.13.1 is released on every plane and declares truffle exact 0.7.19, so no build reads
`../ghosttea-0.11.2` or `../truffle-rfc025` any more. Preflight on a fresh tree with no checkout
beside it names exactly the three above (measured on James's Mac mini). Both stay in
`siblings.lock.json` as the dev overlay's coordinates: `pnpm siblings use ghosttea` / `use truffle`.)*
**The RFC 025 petition window (2026-09-16) closed on two planes of three:** truffle 0.7.14
shipped, so `truffle-core` is an exact registry pin again, the `[patch.crates-io]` row is gone,
and the mesh sidecar comes from npm rather than being built from source (Go is no longer a
prereq). The iOS kit's path package STAYS: ghosttea pins truffle `exact: "0.7.12"` in every
published Swift tag, so the kit can move neither to 0.7.14 nor back to 0.7.12 (its own sources
need RFC 025's login API) — the unblock is a ghosttea Swift release, and `Cargo.toml`'s closure
note carries it. *(2026-10-17, the truffle bump: the cargo and npm planes moved to 0.7.19
together, and `../truffle-rfc025` is pinned at the tag `truffle-v0.7.19`; the vice is unchanged,
so the ghosttea release the kit now waits for is one at truffle 0.7.19. `Cargo.toml` is the
authority for the number.)* *(2026-10-22: that release came, v0.13.0. The kit lands at
0.13.1, which declares truffle exact 0.7.19 too, so the third plane closed on 2026-10-23: the
kit's truffle row is that exact version, and `Package.resolved` carries it.)* *(2026-10-26: the
two moved together again in one EL8 event, ghosttea 0.13.4 with truffle 0.7.22 on every plane;
`Cargo.toml` stays the authority for the numbers.)* *(2026-10-26, later: ghosttea 0.13.5 on every
plane, the harfrust shaper; truffle stays 0.7.22, which 0.13.5 declares too.)* *(Later still: ghosttea
0.13.6 on every plane, the render worker's and the claim's fixes; truffle stays 0.7.22, which 0.13.6
declares too.)* The repo still
does not build standalone: rosetta (rosettad) and mille are checkouts until their releases are
recorded (RD-5); puppeteer's was recorded on 2026-10-26. Every revision is pinned in
`siblings.lock.json`:
`pnpm siblings` prints the state, `pnpm preflight` fails on drift, `pnpm siblings:pin` is the
deliberate upgrade — it records the new SHAs, builds rosettad at them, proves the agent catalog
(wall R23) and, since 2026-10-04, typechecks the consumers (`pnpm typecheck`), so a sibling type
change only this repo's compiler can see fails the pin, not a later gate; any red keeps the new
SHAs recorded and exits 1 (`--skip-typecheck` for the deliberate case, said when used).
`@vibecook/ice` stays an exact npm pin and needs no checkout. Every number
lives in the manifests (`Cargo.toml`, `pnpm-workspace.yaml`); cite them from there, not from prose
— this line said `=0.7.11`/`0.2.0` until 2026-08-07, and its ice pin still read `0.4.0` on
2026-09-16 when the manifest had been at `0.11.0` for weeks, which is why it now names none.

```sh
node scripts/siblings.mjs fetch ghosttea # clone at its pin; preserves existing checkouts
node scripts/siblings.mjs install-js    # frozen install of Ghosttea's renderer dependencies
pnpm install
node scripts/electron-binary.mjs # Electron's binary: Electron 43 has no postinstall (fetched lazily otherwise)
pnpm siblings       # the sibling checkouts: path, pin, dirtiness, built binaries
pnpm siblings:build # rosettad + Ghosttea's React renderer and its dependencies
pnpm preflight      # tool versions + sibling pins + import-boundary walls
pnpm hooks:install  # one-time: wires scripts/git-hooks (the dev-local push guard)
pnpm dev            # desktop app dev loop
pnpm dev:studio     # desktop app + development Studio
pnpm dev:design     # open/focus Studio on the active dev host
pnpm dev:design:web # optional browser-only catalog loop (no live app authority)
pnpm verify         # full gate: typecheck · biome · rustfmt/clippy · TS+Rust tests · gen freshness
```

Ghosttea exports generated `dist` files, so rebuild after editing its TypeScript sources
with `node scripts/siblings.mjs build-js`. CI uses the same lock-driven fetch, install and
build commands; the native Cargo patches resolve directly to the pinned source checkout.

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
  per-worktree lock refuses a second live stack. Studio commands from a second CLI invocation
  attach through a boot-scoped local command endpoint; they never start another daemon, Vite, or
  Electron stack.
- Nx watches the complete workspace graph and runs initial plus affected typechecks in the
  background. `pnpm build`, `pnpm test`, and `pnpm typecheck` use the same graph and local cache;
  `pnpm verify` remains the uncropped release-quality gate.

The development watcher is deliberately repository-bounded: it does not monitor
`../p008/truffle` or its manifests. After changing dependencies or package manifests, run
`pnpm install` and restart `pnpm dev`; installs are never performed implicitly by the watcher.

`pnpm dev:studio` starts the real product and VibeField Studio under the same runner, Vite server,
and Electron host. `pnpm dev:design` is the compatibility entry focused on that same Studio; when
`pnpm dev` is already running it opens or focuses Studio through the local runner command endpoint.
Studio has its own sandboxed window, non-persistent session, and narrow appearance-preview preload;
it receives no product, daemon, plugin, user, tray, or diagnostic capabilities. The renderer
imports shipping tokens and production view compositions, and Live mode applies one complete,
ephemeral appearance snapshot without changing product settings. `pnpm dev:design:web` keeps the
faster catalog-only loop on port 5174 when native behavior and live app preview are unnecessary.
`pnpm smoke:studio` runs the physical Electron acceptance path: a real Studio UI edit reaches the
real product, survives a product reload, clears when Studio closes, and keeps fieldd operational.
Ownership and contribution rules live in
[`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md).

The agent plane — puppeteer (the agent runtime), rosetta (agent history) and this repository, as one
system — is indexed by [`docs/AGENT_PLANE.md`](docs/AGENT_PLANE.md), whose umbrella page
[`docs/agent-plane/architecture.html`](docs/agent-plane/architecture.html) carries the ownership law,
the seams and the walls.

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
