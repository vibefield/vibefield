# VibeField — Roadmap

> **Status:** the living now/next file — the corpus's single answer to "where are we, what's
> next." REWRITTEN in place at each milestone (never appended); history goes to `LANDED.md`,
> decision status to `DECISIONS.md`, petition status to `draft/petitions/README.md`, law
> stays in the design docs + specs. Last rewritten: **2026-08-11** — the WIN milestone: the Windows
> port's first wave (WIN-0…4, `5ffd30b`/`85cce04`/`f982d27`) landed on `f98f58a`; this pass adds the WIN
> track row and its Next-up bullet, the wave's residue named there — and the WIN-6 terminal rung
> (`03cc648`, WIN-D2 adopted) folded into the same row and ledger. Previously **2026-08-07** — a
> RECONCILIATION pass, not a milestone. An onboarding read found this file had gone stale against its own tree: two
> whole bodies of work (IOS-3 and the UI system) had landed with **zero** entries in `LANDED.md`
> and zero mentions here or in `DECISIONS.md`, one debt below was already closed, and three
> docs disagreed with the manifests about the EL8 pins. All four are fixed in this pass; the
> ledger gained the two missing entries, and the pin claims are corrected at their sources
> (`CLAUDE.md`, `README.md`). Nothing in the tree changed — `pnpm verify` was run verbatim at
> `d36528a` and exits 0. Main is **22 commits ahead of `origin/main`** (last push `4f2b21d`);
> `fcd4c36` (the canvas-ground workbench, an eleventh UI-track commit) landed while this pass
> was being written and is folded into the ledger entry rather than left for the next sweep —
> which is the habit whose absence caused this pass.
> Previously rewritten 2026-08-06 (GT-4 `3aa5ba1`/`39c1b1d`/
> `0a2ac28` — the mesh in two halves: the monitor is the door, the floor joined the tailnet,
> the kill matrix proved on three real nodes, NF-remote complete, and ghosttea 0.9.2 released
> upstream to meet our truffle pin. Earlier: UA-0 `fcd0af9` — the
> users track opens: layout registry landed hours after `specs/users-and-accounts.md` was
> drafted from James's OS-user framing, spike-verified (S1/V2–V5 all resolved — self-whois
> works on the pinned truffle, so the guest door needs no upstream), RATIFIED, and folded
> into five design docs; GT-3p perf + GT-3c physics-in-worker landed alongside from
> James's side; earlier: GT-3f `7a76f4d` —
> shaders live viewer-local, G11 drafted→landed upstream 0.9.1→consumed the same day;
> GT-3m `7dea861` mocked monitor; GT-3v `440b04e` glass deck; James's own `6646f1b`
> chopsticks-UI match between them; earlier: GT-2e `a3babb7` + GT-3
> `af316db` — the one-authority correction, then restore/kill/config;
> AH-0 ratified; T2 consumed in exact-pinned Truffle v0.7.12; AH-1a/1b serving
> implementation landed at `9f80f0c` with its physical two-client tailnet proof still owed;
> AH-2 global validated catalog landed at `9c17c46`; AH-3 desktop runtime landed at
> `8c07bf4`, with WP8 packaged-plugin discovery and the physical UI/native-picker closeout
> still explicit; AH-4's preview runtime is in implementation, with physical tailnet proof
> deliberately still open).
>
> Lives in main-tracked `docs/` (moved from `draft/` 2026-08-02). Corpus citations here
> (`specs/…`, `thinking-…`, `predesign-…`, `research/…`, `petitions/…`) resolve under
> `draft/`, which stays dev-local-only.

## Where the project stands

The P0 exit criterion — *real daily agent work, sessions surviving app restarts* — is half
held: the board survives daemon restarts (B3), PTYs survive everything up to field-native (the
NF kill matrix), docs sync across the mesh (C6), and the plugin/settings/logging/distribution
rails are in. **The missing half is the agents themselves** — the AR track, running over the
landed native floor, watched from the GT deck.

AR's zero was re-verified against the tree on 2026-08-07, not taken from this file: there is no
`agents.ts` in `packages/contracts/src`; `@vibecook/chopsticks-*` is pinned in
`pnpm-workspace.yaml` but is a dependency of **no package**; and the only agent surface that
exists is `MockAgentField` behind the Godview monitor's explicit MOCK label. Every dependency
AR named is landed and waiting — the NF floor, the GT deck, C7 spawn-through upstream — and the
seam it plugs into is one module wide. Everything else in this file is scaffolding built to
receive it.

The artifact serving foundation, global catalog, and desktop runtime are now real but are not
yet the whole product: AH-1 owns durable Proxy/Folder serving; AH-2 owns the bounded validated
global view; AH-3 adds the browser-plugin catalog/add flows, spine-owned right-side panel, and
authenticated Electron-main shell-provider bridge. Its packaged-plugin staging and physical
UI/native-picker closeout remain visible. AH-4 preview capture is now in implementation;
its two-device/Tailscale acceptance witness remains open. AH-5 still owns the phone.

## Tracks

| Track | State | Law lives in | Next / gate |
|---|---|---|---|
| A — shell & spine | walking skeleton + ESR COMPLETE | design-03 · `specs/electron-shell-refactor.md` | follow-on slice: lazy widget factories + on-demand settings/diagnostics (§5.4.4-sanctioned) |
| B — canvas & docs | B1–B4 landed; persistence half of P0 holds since B3 | design-03 · 03·A | — |
| PLUG — plugins | P0–P7 COMPLETE for the prior surface set; AH-3 added `hud.side-panel` at `8c07bf4` | `specs/plugin-architecture.md` | WP8 stages/signs bundled manifests for packaged discovery; other dogfood through AR/GT; public index repo = James's op |
| C — mesh | C1–C6 + T1 COMPLETE; the P2 mesh chapter closed | design-04 · `thinking-c6-meshdata.md` | doc-existence replication (named follow-up); artifact product work moved to AH |
| AH — Artifact Hub | **IN FLIGHT** — AH-1 serving `9f80f0c`; AH-2 catalog `9c17c46`; AH-3 desktop runtime `8c07bf4`; AH-4 preview runtime in implementation; live AH-1 proof + AH-3/AH-4 physical closeout owed | `specs/artifact-hub.md` | land/review AH-4 + physical two-device witness → AH-5 phone |
| D — widgetlab port | COMPLETE (code) | `thinking-widgetlab-port.md` | visual fidelity pass = James's eyeball (§5 checklist) |
| LOG — logging/diagnostics/audit | L0–L6 + post-L6 hardening COMPLETE (§23: 31/32 accepted) | `specs/logging-and-diagnostics.md` | LOG-39 packaged multi-platform CI · LOG-V5/V7/V8 decisions |
| NF — native floor | NF-0…7 + **NF-remote (§7) COMPLETE** — the floor serves TSP1, hosts published, writes gated; proved on a real tailnet at GT-4, with peers authenticated by tailnet WhoIs | `specs/native-floor.md` | per-device tokens (GT-D6) whenever the token work is wanted — NOT gated upstream (the v3 claim was retracted) |
| IOS — companion | **IN FLIGHT** — IOS-0/2/2f + IOS-EL8, and **IOS-3a…3e + the 3r review landed** 2026-08-05/06 (peer terminals are bubbles; the card attaches; appearance + upstream's reconnect banner) | `thinking-ios-app.md` §10 · `research/ios-app-design.md` | **IOS-3c's capability/Keychain leg never landed — the phone attaches VIEW-ONLY.** That, plus the live-device run, is what remains of the attach story; artifact catalog/open = AH-5 |
| GT — Godview terminal | **IN FLIGHT** — GT-0…3 + 3v/3m/3f/3p/3c + **GT-4 the mesh, both halves** + **GT-5a…d the code review's fixes** landed (spec v0.3, GT-D10…D17); the kill matrix ran over a real tailnet | `specs/godview-terminal.md` | the deck's own ladder is done. James's SDF/WebGPU swarm renderer plugs into the worker's `adoptCanvas` socket in his own session; AR replaces the monitor's one mock module; smoke row 13b unskips when a peer can be staged in the harness |
| UI — design system | **LANDED** 2026-08-05/06, James's hands — tokens → primitives → production compositions → a catalog that mounts shipping views → `pnpm dev:design` UI Bench, with ownership enforced by test | `DESIGN.md` (authority) · **`docs/UI_SYSTEM.md`** (where it lives in code) | the catalog's own acceptance is an eyeball (light/dark · keyboard focus · reduced motion · narrow); `codex/settings-review-fixes` is unmerged and undecided |
| UA — users & accounts | **IN FLIGHT** — spec v0.2 RATIFIED 2026-08-05; UA-0 `fcd0af9` · UA-1 `ca1ce49` · UA-2 `3750f20` · UA-3 `15832c0`+`30aece8`+`96e9e9d` · UA-6 `a4bed08`+`1a2a846` · **UA-4 door `105e6bd`** · **UA-3w wizard `1e27c7b`** · **UA-5 second user `cfe87b8`+`f3aa78a`+`e83033a`** — **CODE COMPLETE: all nine slices across two days**, three by worktree agents, zero integration-fix commits on the last two; the sun_path regression James's first real boot found is fixed (`d6f8489`); UA-D12 landed in full (ephemeral ports everywhere — the two-pair audit on real daemons is the V5 mutex's tombstone) | `specs/users-and-accounts.md` | **Physical witnesses only:** S1 live probe (`cargo test --ignored` + TRUFFLE_TEST_AUTHKEY) · two-account guest refusal (gates ANY shared-tailnet login) · the switch kill-matrix row (a live session in user 1 survives switch-away-and-back) · the switcher/wizard eyeball in both themes |
| EDP/ESP — distribution & packaging | specs ready (EDP v0.3 · ESP v0.2 · plan v0.2); WP3 icons + WP6 tray/single-window landed | the three `specs/electron-*.md` | WP ladder toward WP10 = first signed macOS beta (EDP §16.1); ops first: Immutable Releases toggle + Azure signing eligibility (`thinking-auto-update.md` §next-actions) |
| WIN — Windows port | **IN FLIGHT** — WIN-0…4 landed `5ffd30b`/`85cce04`/`f982d27` (2026-08-11; ratified 2026-08-10, James: "follow your plan"): gate + dev loop portable, the endpoint law in two languages (WIN-D1), the native plane on named pipes with a real stderr floor, the pair's probe/env/spawn doors, the stop VERB (WIN-D5; WIN-D3 resolved by construction) — all proven on the box (WORKSTATION4090) · **WIN-6 terminal hosting landed `03cc648`** (WIN-D2 adopted 2026-08-11: hosting in GA — the ConPTY kill matrix, two-plane adoption, and frame-plane I/O all on the box; the case-variant env-strip gap booked upstream as G13) | `draft/thinking-windows-port.md` (plan; spec graduates with the track) | box gates green (Rust workspace incl. terminal_unit 14/14 · terminal_mesh 7/7; fieldd terminal-seam 3/3 · terminal-kill-matrix 6/6 · the full fieldd suite 454/2-skip (the 2 = the tracked concurrent-edit doc-sync pair) · fieldd-client 12/12 · field-app 417); next: WIN-5 shell (WIN-D9 chrome), WIN-7 mesh coexistence + sidecar resolver, WIN-8 packaging + the EL8 pin delta (electron-builder vs EDP-39) |
| AR — agent runtime | **NOT STARTED** — the other half of the P0 exit | design-04 (D33/D37/D38) · predesign-04 | chopsticks-in-fieldd over the NF seam; consumes petition C7 (implemented upstream); correlator = fieldd-side ancestor walk (NF resolution) |

## In flight now

**GT.** The control room is open and corrected. v0.3 (GT-2e) dissolved the second session
authority James smelled behind an `sh-3.2$` pane: the workspace now owns pane births through
its own doors, main hands it the real login shell, and the FLOOR flips ownerless births to
keep-until-exit — the persistence law survives fieldd death. GT-3 landed restore (consent
before anything relaunches; `paneMeta` carries `{cwd, title}`; dead panes come back as shells
in their folders), the audited two-step kill chip, the `config.ghostty` surface (Settings →
Terminal raw editor; atomic write + live reload through the floor's own document API; the
user's real Ghostty config imported underneath), and paid both named test debts (deck-mount
fixture; `keystrokeEchoMs` report-only). GT-3v put the deck on ghosttea **0.9.0** and made it
glass: renderer-true semi-transparent panes over the blurred canvas (James's screen-composite
interim retired), appearance viewer-local per GT-D12 — 602 themes + shader catalog built from
upstream's exported data in our design system, persisted beside the layout, never in the
floor's config; the surface lab stays as the stage-tuning instrument. GT-3m ported the
reference app's agent monitor (swarm/list/rain, matter-js) into the overlay behind an
explicitly labeled MOCK source — the smoke fails if the label goes missing — with agent
colors in the §2.6 accent slots (`--vf-accent-1..8` now real tokens); AR replaces exactly
one module (`MockAgentField`) and deletes the label. GT-3f closed the G11 loop inside one
day — drafted morning, landed upstream in 0.9.1, consumed by evening: shaders are LIVE and
viewer-local (four ports as §8 chips; the withheld-upstream list renders honestly for the
first time; the floor's config document provably untouched by a viewer's choice). James's
own `6646f1b` (chopsticks-UI match, per-mode themes) landed between slices and everything
stacked cleanly. **GT-4 landed the mesh in two halves**: the monitor became the door (remote
sessions are monitor citizens — bubbles, columns, rows — and clicking one attaches the active
pane; no palette), and the floor joined the tailnet, borrowing the gateway's single truffle
node rather than standing up a second. The kill matrix ran for real — three ephemeral nodes,
one seeing the host's session and refused write, the other holding the capability and
accepted, with no fieldd anywhere. NF-remote is complete with it. GT-3p made the deck fast the honest way: James's own groundwork
(the ICE frame gate, the rAF×LoAF frame counter, the ⇧⇧ one-door) plus the warm transport —
bridge, worker, and WebGPU device ready at app-idle, sessions still born only on ⌘G — took a
cold open from ~443ms to a ~36ms warm one, with the phase breakdown riding the smoke verdict
and the surface lab wearing a perf readout. The one-runtime law (exactly one ports-wait
armed, ever) closed the slice's own hardest bug. **GT-5a…d then closed the deck's own code
review** — four builders on disjoint planes, every HIGH fixed, and an acceptance stated as
*prove the row can fail* rather than *the row passes*; the demonstration was performed and is
recorded in `LANDED.md` §GT-5. The deck's ladder is done; what it is still waiting for is AR.

**AH.** The serving seam and global catalog are landed. `9f80f0c` replaces C6's
`{name,target}` writer behind its one-window adapter, persists v2 source-local intent, assigns
stable nonzero ports, fingerprints the full two-route config, retries durable remove-before-add
work, separates source/listener health, enables public TLS, and consumes exact Truffle v0.7.12
in both Rust and the packaged platform sidecar. Folder + optional SPA fallback now ride the
same listener as an empty, T2-confined preview route. `9c17c46` makes the catalog one validated
global view: safe self-slices, transport-derived MagicDNS binding, boot/liveness folding,
narrow hostile-input projection, tick-coalesced subscription snapshots, and a bounded retained
public cache. The post-landing review debt is paid in-tree: DeviceSlice owner binding and narrow
trust projection, raw URL grammar, generated end-to-end transport budgets, bounded ProductAPI
backpressure, async/coalesced cache checkpoints, durable preview cleanup retries, isolated
legacy migration, and drainable ArtifactService shutdown underpin AH-3. `8c07bf4` now adds the
earned `hud.side-panel` slot, the visually canonical right-edge panel and top-right toggle, the
bundled browser-plugin catalog/Proxy/Folder flows, and the validated static `shell.*` broker on
Electron main's existing authenticated loopback client. No ProductAPI UDS, renderer relay,
artifact IPC, or renderer path textbox was added. Packaged discovery remains behind WP8's
signed bundled-plugin index; the final both-theme/reduced-motion/native-picker witness is owed.
AH-4's current implementation adds the internal-only bounded capture provider, a separately
serialized ArtifactService preview lane, one-shot permissionless same-origin Electron
WebContents, atomic 640×400 bounded JPEG replacement, monotonic revisions, explicit refresh,
placeholder fallback with a bounded thumbnail-read retry, and the image-only MagicDNS CSP
aperture. Refresh is non-idempotent and never replay-safe. Automated contracts/service/Electron/UI
coverage and production builds are green; the physical desktop-B fetch/refresh, Truffle
symlink/allow, and cross-origin witnesses
remain gates, so this work is not recorded in LANDED yet.

**UA.** The multi-persona chapter opened and closed its design loop in one day: James's
OS-user framing (thinking doc) → implementation-ready spec grounded in a three-sweep
as-built census → four Opus spikes resolving every verify-item (self-whois WORKS on pinned
truffle, so UA-4's guest door needs zero upstream; V5 exposed that ephemeral ports delete
the accidental fixed-port mutex single-writer was leaning on, and the users.json lock law
replaced it; a resident pair costs ~85 MB, so resident-by-default; vendor relocation is
Claude-first) → ratification + fold-backs into five design docs → **UA-0 landed
(`fcd0af9`)**: 21 LAYOUT segments in registries.ts, generated to Rust, pinned by a
cross-language vector, twelve consumers boundary-tested, the macOS-only bin.ts default
fixed. **UA-1 landed the same day (`ca1ce49`)**: the tree now lives at `users/<fuid>/`
behind the §3.3 lock — eight real processes raced a mint and exactly one ULID survived;
the migration's move list derives from LAYOUT itself; field-native changed zero lines. The
one owed witness: the first `pnpm dev` stops the running pair and migrates the dev root
live. The ladder then ran on: UA-2 threaded identity, UA-3 gave the link a face, UA-6
taught a doc to stay home, and **UA-4 landed the door (`105e6bd`)** — stored-login
comparison, tailnet-guest behind a lint-pinned guestOk choke, and the serve-allow belt
proven enforced sidecar-side by a dispatched trace, then rebuilt remove-then-add around
the trace's no-upsert find (the serve reconcile-skip is recorded C3 debt: stale gate,
adopted state; latent only while mesh is env-gated off). UA-4's exit stays open on the
two physical witnesses (second-account guest refusal; the S1 live probe) — those still
gate advertising any shared-tailnet login. **UA-3w landed the same afternoon
(`1e27c7b`)**: a worktree agent built the whole Setup Assistant — five panes on the
splash's own ground, W6 resume from durable facts alone, mint/migrate symmetry on the
onboarded flag — and its two honest findings (no link-start verb exists; posture-resume
is not derivable) are folded into spec §6 as dated as-built notes. The next `pnpm dev`
greets James with the one-time migration-variant wizard. **And then the last rung landed
the same evening: UA-5** — createUser under the lock, per-user pair bundles with
build-before-break attach, switch-by-reload, the tray switcher, the Account Users block,
the wizard's second-user variant, and UA-D12 finished for real (ephemeral ports
unconditional; the recon trace caught that the doc lane's fixed 9411 collided FIRST and
that dev was ephemeral only by env inheritance). The two-pair audit runs on real daemons:
four distinct ports, own-root sockets, concurrent health, users.json mtime untouched —
UA-D10 held physically. The track is code-complete; what remains is physical.

**IOS.** The phone joined the mesh as a peer's *audience*. IOS-3 landed in five slices over two
evenings: every terminal a peer serves arrives as its own bubble beside the agents (James's
correction — there is no session list in the card), the card's ATTACH builds a live Ghostty
surface over Truffle, a settings sheet renders upstream's 602 themes and four licensed shader
ports in our monochrome, and the reconnect face is upstream's own banner presenter rather than a
second answer to "is this connection healthy". Then `d36528a` reviewed the four commits and
found the concurrency work sound but **three HIGH defects in the seams**, all in `FieldHome` —
the one module with no test target — including one where a single backgrounding disabled the
entire reconnect leg for the life of the process. Fixed as pure functions with tests; 135 green.
**The honest bound, and it is bigger than the slice titles suggest: `72929d8`'s subject claims
IOS-3c, but the capability/Keychain leg never landed** — verified at three source sites, one of
which says *"nothing assigns this yet"*. `claimControl` is plumbed; no capability is ever
supplied; the phone attaches **view-only** and the card says so honestly. The old GT-5 acceptance
row was *live view · type with mirror-write · reconnect banner* — the middle third is not
reachable until that leg lands.

**UI.** A track the roadmap never had a row for, built entirely by James: `DESIGN.md` said what
the product should look like and nothing said where that direction lived in code.
`docs/UI_SYSTEM.md` now names four layers — tokens → primitives → colocated product
compositions → catalog harnesses that may stage a production component but never redefine its
selectors — and `c188195` did the migration the rule implies at a net **585 lines deleted**
across 52 files. The load-bearing claim is that **the catalog mounts shipping views, not
replicas**, and it is a maintained boundary rather than a cleanup: `ui-system-boundaries.test.ts`
rejects catalog-only replicas and production selectors in catalog CSS. `3ca1f8a` gave it
`pnpm dev:design`, an isolated Electron UI Bench on the production window/security factory with
no preload, daemons, users, tray, or diagnostics, plus two leakage gates keeping bench artifacts
out of `dist/renderer`. The episode worth remembering: `11765bc`'s import was *correct* by R5's
own description and the wall failed anyway, leaving `pnpm verify` red at preflight on main for
about 22 hours across four GT-5 builders and the whole IOS-3 ladder.

## Next up — the options on the table (James's call)

- **AH-4 closeout** — review and land the preview runtime, stage/sign the bundled browser
  plugin through WP8, then run the both-theme/native-picker plus desktop-B preview/refresh,
  Truffle symlink/allow, and cross-origin physical witnesses. AH-5 adds the phone list; the
  AH-1 physical two-client proof can run alongside this work.
- **UA physical witnesses** — the track is code-complete; an evening with a second
  device closes it: the S1 live probe, the two-account guest refusal (gates ANY
  shared-tailnet login), the switch kill-matrix row (live session survives
  switch-away-and-back), and the switcher/wizard eyeball in both themes.
- **WIN ladder continues** — WIN-6 terminal hosting landed (`03cc648`); next: WIN-5 shell (needs the
  WIN-D9 chrome decision), WIN-7 mesh (the tsnet-coexistence spike is cheap — the box runs host
  Tailscale today), WIN-8 packaging. Named residue, none blocking: the WIN-6 env-case gap is booked
  upstream as G13 (a case-variant private-env key leaks past ghosttea's case-sensitive strip on
  Windows; row 6b is an `it.fails` witness that flips green when the pin consuming G13 lands); the two
  concurrent-edit doc-sync tests are win32-gated (a slow-box stall past the raised 15s timeout under
  sustained load — the router is in-process, transport is proven in `quic_lane_transport.rs`);
  MockMgmtServer + mesh-lane `fakeBridge` still bind filesystem paths (~20 suites); `process-service`
  group-kill → Job Objects; snapshot-prune EBUSY policy.
- **AR** — the agent tracks; the reason everything else exists, and the only thing between here
  and the P0 exit. Its seam is one module wide and every dependency it named is landed.
- **IOS-3c's capability leg** — the Keychain store, the write capability supplied at attach, and
  the settings that manage it. Until it lands the phone can watch and cannot type, which is most
  of what "the field in a pocket" was for.
- **Packaging WPs** — the ladder toward the signed macOS beta (WP10).
- **LOG-39 packaged CI** — also carries NF's 24h-soak gate.
- **ESR follow-on** bundle slice.

## Open debts (dated, sourced)

- ~~**`smoke:canvas` is RED on committed main**~~ — **FIXED 2026-08-10, and the tripwire now
  lives inside `pnpm verify`.** The eager-graph half was REAL and product-visible: the boot
  path reached `@vibefield/design-kit`'s BARREL (`mount` → `BootRoot` → `OnboardingWizard` →
  `wizard-ui` → `ThemeToggleButton` → `field/theme-constants.ts`, which imported one class-name
  string from it), the barrel re-exports `GlLiftGroup`, and its `@vibecook/ice/r3f` import
  dragged three + loro into the splash bundle. The edge arrived with **UA-3w's Setup Assistant
  (2026-08-06)**, which dates the regression and matches the observed reds. **Cold opens paid
  5798.4 KB raw / 1902.6 KB gz for four days; now 455.4 KB / 118.2 KB with the world lazy**
  (not the ESR-cited 269.8 KB — the Setup Assistant legitimately joined the boot path since,
  and that is the honest new baseline). `smoke:canvas` then ran its Electron leg for the first
  time in days: `SMOKE_CANVAS {"widgetTypes":21,"plugins":4}`.
  **The load-bearing fix is `"sideEffects": ["*.css"]` on design-kit** (every JS module there
  is pure; the CSS imports are the only side effects — without it a bundler must keep every
  module the barrel re-exports). Three-way control, run rather than reasoned: barrel import +
  no `sideEffects` REPRODUCES the exact failure (same chunk, same three messages) · barrel +
  `sideEffects` passes · leaf import + `sideEffects` passes. The leaf import
  (`@vibefield/design-kit/primitives`, a new deep export) is hardening, not the cure — it keeps
  the boot path off the barrel instead of relying on tree-shaking.
  **CORRECTION AT SOURCE to this row's own earlier text (2026-08-09):** it claimed both CSS
  canaries were missing, and I repeated to James that the utilities were "actually absent from
  the built renderer." **That was false.** `.tabular-nums` and `.leading-none` were both in
  `main-*.css` the whole time; `bundle-report.mjs` graded canaries against
  `[...chunks.keys()].find(n => n.endsWith(".css"))` — the FIRST stylesheet by name — and the
  renderer emits one per chunk, so it read the wrong file. The script now checks the union of
  every built stylesheet. A false alarm standing beside a real one is how a tripwire loses its
  authority; the check was wrong, the CSS never was.
  **The standing hazard is closed:** `pnpm bundle:assert` (renderer build + assert) is wired
  into `pnpm verify` between clippy and the test suites, so this class can no longer regress
  behind a green gate — the reason it survived four days and two ledger entries (2026-08-10).
- **Install-a-widget-plugin does not exist — the renderer half of plugin distribution is dead
  code (2026-08-09, onboarding review).** No plugin builds: no `dist/` exists anywhere, no
  plugin has a build script (`gen:manifest`/`test`/`typecheck` only), and every widget-bearing
  manifest's `entries.renderer: "./dist/renderer.js"` names a file nothing produces and nothing
  loads — the renderer imports plugins from source through the static `BUNDLED` list
  (`field-engine.ts:70-76`, whose own comment names the §19.2 staged import-map loader as the
  replacement), and async `activate` is refused (renderer-harness). `entries.service` is real
  by contrast: the worker host imports kv-service's checked-in `service.js` off disk. So the P7
  chain can deliver a signed `.vfplugin` end-to-end whose *services* run but whose *widgets*
  cannot load. Seam set: real plugin builds + the staged loader; WP8 covers only the packaged
  staging half and was already recorded (2026-08-09).
- **The §5.4 authoring kit was never scheduled** — `plugin-cli`, `create-plugin`, and
  `apps/plugin-playground` are spec-named (the ten-minute bar) and absent from the tree; only
  `plugin-build` exists. The §21 ladder completed without an authoring rung, so this appeared
  on no list until now. It becomes critical path the moment anyone but this repo authors a
  widget — including the four-views Widget Builder character (2026-08-09).
- **`PluginWidgetProps` (03·A / plugin spec §12.1) is unimplemented — widgets ship on ICE's raw
  contract** through the curated door, which says so itself (`plugin-sdk/src/canvas.ts:6-8`:
  "The deep target (PluginWidgetProps — 03·A) replaces most of this"); §12.1's register-time
  invariants (contiguous migration chains) are unenforced, and plugin code stays coupled to ICE
  vocabulary — the widgetlab-port V-4 `ValueOf<>` papercut reaches plugins through exactly this
  coupling. PA-27 retires it together with the already-recorded `ctx.canvas` engine stopgap
  (P6 delta) (2026-08-09).
- **`ctx.pool`** — spec'd (plugin spec §12.6 / altitude A3), absent from the SDK by design
  ("pool arrives with its runtime", `plugin-sdk/src/index.ts:11-12`); with terminals
  spine-owned (GT), the first real attachment kind now rides AR (2026-08-09).
- **THE LEDGER LOST TWO WHOLE TRACKS (2026-08-07) — the discipline's own worst failure to
  date, now repaired.** IOS-3 (six commits) and the UI system (ten commits) both landed and
  **neither had a single entry in `LANDED.md`, a mention in this file, or a row in
  `DECISIONS.md`.** The discipline is five days old (2026-08-02) and it skipped two tracks
  inside its first week.
  The common factor is visible in hindsight: both ran *concurrently with* the tracks that were
  getting the ceremony (UA, then GT-5), and the UI commits carry **empty bodies**, so nothing in
  the git history would have prompted an entry either. Both entries now exist, but the UI one had
  to be reconstructed from diffs rather than written from the author's own account, and it says
  so. Named fix, not taken here: the milestone ritual has no step that asks *"what else landed in
  this window?"* — it walks the track being closed, so a parallel track is invisible to it by
  construction (2026-08-07).
- **IOS-3c's capability/Keychain leg never landed — the phone attaches VIEW-ONLY**, and the
  commit subject `IOS-3c/3d` (`72929d8`) says otherwise. Verified at three source sites
  (`TerminalAppearance.swift:73` · `SessionCardView.swift:45` · `HomeScreen.swift:51-53`, the
  last reading *"Nothing assigns this yet"*). `claimControl` is plumbed and the token rides the
  lifecycle; no capability is ever supplied. The card's face is honest ("this device has no write
  key for this host") — this is a missing feature, not a lie — but the attach story's middle
  third does not exist yet, and IOS-3r's third HIGH was a direct consequence of the gap being
  papered over by the listing's `readWrite` (2026-08-07).
- **`GT-5` names two different things** — this file used it for *iOS attach, the last GT rung*,
  while `LANDED.md` §GT-5 records it as *the code review's findings, fixed* (`127df5c`…`17365fd`).
  The attach work shipped as IOS-3 instead. Both usages are now in the corpus and citing "GT-5"
  alone is ambiguous; the collision belongs in `DECISIONS.md` §Collision warnings, where it has
  been added (2026-08-07).
- **The mock agent fleet now stands beside real facts** — with peer terminals arriving as real
  bubbles, the mock agents are decoration next to data. The desktop's answer was to narrow the
  label so a real row never sits under one calling it invented; the phone has the same problem.
  `thinking-ios-app.md` §10.6 recommends a settings toggle defaulted on, with mock bubbles
  carrying no claim the real ones don't — but it is explicitly James's taste call about his own
  home screen, and it is unanswered (IOS-3, 2026-08-07).
- **GT CODE REVIEW — ALL FIXED (2026-08-07, `127df5c` · `95cbd7e` · `69e8a99` · `17365fd`,
  four builders on disjoint planes; `pnpm verify` exit 0 and `smoke:godview` green across the
  combined result, both re-run by the orchestrator).** The evidence slice's acceptance was
  *prove the row can fail*, and it did: with the recovery ladder commented out the smoke
  exited 2 at exactly the right place, carrying the deck's own "the terminal bridge died —
  rebuilding"; restored, exit 0. `recoveredBackend` now reports `"starting"` instead of
  echoing the pre-kill backend. Remaining follow-ups from the same work: ~~**⌘W never worked**~~
  **— FIXED 2026-08-10.** The handover now DROPS `role: "close"` while the overlay is open
  instead of merely omitting the accelerator, which released nothing (Electron resolves
  `explicit ?? roleDefault`). The fix took the smoke's own measurement as its design input:
  `accelerator: null` and `registerAccelerator: false` both still resolve to the role default,
  so a role-less item is the only spelling that reports null. The role's close behaviour
  arrives as `actions.closeWindow`; cost is an English label in that one state. The model test
  that passed through the whole defect (it asserted `role: "close"` while the overlay was open)
  now asserts the role is GONE — control-run, it fails with *expected 'close' to be undefined*
  — and the smoke's two verdict fields stop being a record: it throws if they ever read alike
  again, or if the open state reports any chord. **Still owed: the OS-level witness.** No
  harness can prove macOS routes a real ⌘W to the pane rather than the menu
  (`sendInputEvent` injects below AppKit's key-equivalent dispatch), so this is a chord
  without a delivery probe until James presses it with a deck open · **G13 petition**: no
  browse-handler seam exists at 0.9.2, verified against the workspace's own `.d.ts`, so the
  dead "Browse sessions" button cannot be fixed from our side · ~~**the tailnet probes run on a
  STALE sidecar**~~ **— FIXED 2026-08-10** in `tests/common/mod.rs` as predicted: the harness
  now resolves the binary this workspace PINS (through `apps/desktop`'s own
  `@vibecook/truffle-sidecar-*` dependency) BEFORE the machine-wide installs, with
  `FIELD_NATIVE_SIDECAR_PATH` still authoritative above both and the installs kept as a last
  resort for a checkout without `pnpm install`. Confirmed on this machine, where the old order
  found a **Jul 16** `~/.config/truffle/bin/sidecar-slim` while the pinned **Aug 2** 0.7.12
  copy sat unused. Because every other probe here is `#[ignore]`d behind a live tailnet, the
  order now has the family's one OFFLINE test guarding it — it asserts rather than skips on an
  installed workspace, so `pnpm verify` notices if it ever inverts again · **R5 keeps a second
  source of truth**
  for package entry points, which is what made main red on a correct import (`1e4f9ac`);
  deriving it from `package.json` exports is the real fix. **Correction to `1e4f9ac`'s own
  body (2026-08-07):** it dates the breakage "since `3ca1f8a`", but `3ca1f8a` only *modified*
  the offending file — `--diff-filter=A` puts both the import and its `exports` declaration at
  `11765bc`, sixteen commits and eighteen hours earlier. Main was red at preflight for about
  **22 hours**, not four, spanning four GT-5 builders and the whole IOS-3 ladder (2026-08-07).
- ~~**GT CODE REVIEW (2026-08-06) — 7 HIGH defects open, none fixed.**~~ Six read-only reviewers
  across four planes; every HIGH re-verified by the orchestrator against the code. Full
  record with file:line and failure scenarios in `specs/godview-terminal.md` §9. In fix
  order: **(1) the bridge-SIGKILL recovery smoke row is VACUOUS** — it derives its predicates
  from the pre-kill marker and `until()` short-circuits on the marker it already holds, so
  the row cited as recovery proof by eight slices returns instantly; delete the ladder and
  the smoke still exits 0 (the harness owns the fix it doesn't use — `MarkerWatch.reset()`).
  **(2) a dead floor still mints working-looking tickets**, audited as successful grants,
  because `terminalEndpoints` is set once at hello and never cleared — it poisons
  `system.health` too. **(3) restore can delete a layout whose sessions are alive**:
  `terminal.list` cannot distinguish unarmed from empty, and the deck's honest branch fires
  only on a FAILED list, so the fix must be fieldd's. **(4) a restored REMOTE pane spawns a
  LOCAL shell at the peer's path** (`paneCwd` discards the URL host) while the consent face
  promises "its folder". **(5) a peer's session is painted as a local terminal in the rain
  view.** **(6) a superseded recovery ladder blocks the next one**, hanging the deck at
  `bridge-down` forever. **(7) with the mesh flag on, another device's sessions enter our
  observed inventory carrying the remote's pid**, with no device field to tell them apart.
  Plus: three more vacuous/weak smoke rows (the shader-leak check cannot detect its leak; the
  glass two-homes proof has no negative control; ⌘W arbitration is untested because the menu
  is not installed in smoke mode), a monitor that re-renders every 2s on a stock machine, a
  worker that reports "worker" after failing to load, and `connectedClient()` leaking a
  connection under concurrent calls (2026-08-06).
- **The corpus claimed two safeguards that were never built** — both now dated-corrected at
  source. GT-3's finding said `paneCwd` catches a foreign host; the CODE said only that it is
  where one *"would be"* caught (a TODO), and the spec upgraded that into a fact. GT-3m's
  residual said ⌘1/2/3 were not ported; they are, capture-phase. Standing lesson, and the
  second instance in one day: when recording a finding, a hedge in the code stays a hedge in
  the corpus (2026-08-06).
- **GT-D11's second half is unmet** — no user-visible string states the daemon-lifetime
  ceiling or that closing a pane detaches rather than kills. The product never over-promises,
  so "never promises more" holds; "UX says so honestly" does not (GT review, 2026-08-06).
- **`terminal.connectTicket` is reachable from another device** — `terminal.attach` federates
  via `TAILNET_SCOPES` and `locality:"local"` is declared but never enforced, so a
  WhoIs-verified peer can mint this device's floor ticket. Bounded (the token authenticates
  only on local unix sockets) but it is a daemon credential crossing a device boundary for no
  reason, and it falsifies GT-D6's "only spine code receives it" (GT review, 2026-08-06).
- **Our mirror-write secret leaves the device** — upstream reuses the one configured string as
  the VIEWER's outbound token, so attaching to a peer hands it the string that grants write on
  our own sessions. Inherent to mirror-write v1, not a coding bug: it is the concrete argument
  for the per-device-token upgrade (GT review, verified at the pinned source, 2026-08-06).
- **F-C6-21 audit-integration flake** — struck 3× under full-suite load, green in isolation;
  "the track's oldest debt" (C6-6, 2026-07-28). The mcp EPIPE flake is separate and PAID
  (`37cce3b`). **NOT FIXED 2026-08-10, but narrowed by a source read — recorded so the next
  attempt starts ahead of where this one did.** The failing assertion is
  `audit-integration.test.ts:112` (`daemon.health().audit.state` reads `"healthy"` where the
  row wants `"degraded"`, while the test's `failWrites` hook is still on).
  (1) **The timer hypothesis is dead.** `health()` returns `this.state` directly with no
  re-probe, and `markHealthy()` has exactly three callers — `start()`, a SUCCESSFUL append, and
  the completed recovery drain. None is timer- or interval-driven, so nothing can flip the
  verdict on a clock; the flake needs one of those three to land AFTER `markFailure()`. Since
  `auditTestHooks.beforeWrite` throws for every write while the flag is on, the drain path
  (`audit-service.ts` ~:500, the one `markHealthy()` not guarded by a fresh visible append) is
  where the next look should start.
  (2) **The refusal assertion above it is not evidence about health, and must not be treated as
  a second witness:** `AuditUnavailableError` hardcodes `state: "degraded"` as a LITERAL in its
  details (`audit-service.ts:90`), so lines 100–110 would read `degraded` even with the service
  perfectly healthy. Line 112 is the row's only real health check — any future "deflake" that
  softens it leaves this test proving nothing.
  (3) **Not reproduced here:** 5 consecutive runs of the file passed with a full `pnpm verify`
  loading the machine concurrently, which is not the reported trigger (full-suite parallel
  interleaving inside the fieldd project). No production change was made on a mechanism that
  had not been reproduced — the alternative was rewriting live health semantics on a guess.
- **fleet-v3 gate** — delete the C5 hello-claim fallback once every sidecar speaks v3+
  (C6-T1, 2026-07-28).
- **Doc existence does not replicate** — the doc registry is a local JSON file, not a
  SyncedStore slice; a peer's unknown doc shows honest "not held here" (C6-4 corpus
  correction, 2026-07-28).
- **AH-1 live-tailnet field proof** — automated contracts/daemon/Rust/upstream-static and
  packaged-sidecar gates are green, but this workspace had no authenticated second tailnet
  client. Run real HTTP + HTTPS Proxy and Folder URLs from another desktop/phone before
  declaring the physical AH-1 exit fully witnessed (AH §10, 2026-08-02).
- **AH-3 packaged-plugin discovery** — the renderer statically bundles `vibefield.browser`,
  but production fieldd deliberately receives an empty `plugins/bundled` root until WP8 builds
  the signed bundled-plugin index/stager. The panel reports provider absence honestly; do not
  call the packaged artifact path shipped before that distribution gate closes (2026-08-03).
- **Artifact device-retirement GC** — AH-2 retains last-known validated public slices across
  Truffle peer removal (bounded to 256 origins) so transport departure cannot silently erase
  user objects. A future explicit device-retirement policy owns deletion; valid empty origin
  slices already remove immediately (AH-D6, 2026-08-03).
- **CAS blob store / deny-by-default pull root** — not an Artifact Hub v1 dependency. Its own
  contracts+Rust slice begins only when canvas blob refs, peer-CAS fetching, or an explicit
  offline/immutable artifact mode exists (AH-D10; C6-6).
- **ESR follow-on** — lazy widget factories, settings/diagnostics on-demand, open-doc-only
  preview reveal gating (ESR close, review finding 4).
- **Per-section undo, ⌘Z, timeline** — D29′ residue (P7, 2026-07-24).
- **Sideload** — post first-party publishing (P7).
- **R2 `host:"process"`** — the plugin process-isolation rung (P4/P6 deferral).
- **I1/I4/I5 CONSUMED — ice 0.4.0 in-tree the night of the release (2026-08-09; `pnpm verify`
  VERBATIM exit 0, one process, on the combined working tree).** The bump and the whole
  retirement sweep in one slice: the ChromeLayer C-key capture trap → two `keymapOverrides`
  entries with exact parity (selection decides; Settings suppresses the comment, never the
  tool; ⇧C comment-only), still invoking field-tools' declared command through the SPINE
  registry (R10); note's two `onWheel` stops deleted — the editor rides the editable cede,
  and the read-only body's wheel now belongs to the canvas, a RECORDED behavior delta for
  James's eyeball (revert = one `data-canvas-interactive`, at the cost of body-drag);
  `migrate-type-renames.ts` DELETED — build-widget projects TYPE_RENAMES into `renamedFrom`
  and the engine folds pre-rename boards in-band, writable through the version gate
  (test-pinned on the probe-era fixture; the C2 old-board eyeball retires with the surgery).
  Found while consuming, fixed and pinned: ghost stubs would have registered a pre-rename
  envelope's OLD ids as live types, colliding with their successors' `renamedFrom` claims —
  a renamed id whose successor is registered is now covered, never stubbed (2026-08-09).
- **`terminal.list` lags for readers** — GT-1 fixed create, not list; assertions poll past
  the window (GT-2 finding 6).
- **Terminal unit health self-report** — the unit publishes `starting / "binding terminal
  service"` while its service is serving and answering; `system.health` (and Settings →
  System) may show it perpetually starting. Pre-existing, reproduced on unmodified code
  (GT-3 finding 6, 2026-08-02); NF-owned.
- **G10 ghosttea petition candidate, unfiled** — two workspace props: `defaultPersistence`
  (deletes the sub-second persistence-flip window) + a login/default-args knob (panes are
  non-login interactive shells today; packaged-run PATH poverty is the risk) (GT-2e/GT-3,
  2026-08-02).
- ~~**SECURITY: device identity on the terminal mesh is assertable until the sidecar reaches
  protocol v3**~~ — **RETRACTED the same day it was written (2026-08-06). The claim was
  false.** The sidecar is not at v2: truffle's sidecar source is at `protocolVersion: 4`, the
  installed binary ships `whoisResult`, `truffle-core 0.7.12`'s `TailscaleProvider` implements
  `whois`, and the terminal mesh calls that same node. The diagnostic the GT-4 builder quoted
  fires only for a provider with NO WhoIs — upstream's own test calls that "the in-process
  transports these tests run on" — and it appears NOWHERE in the probe log it was attributed
  to. Live proof both ways: the UA S1 probe answers self-whois on a real tailnet, and because
  the mesh REFUSES a connection whose WhoIs is anonymous or unavailable, the kill-matrix
  probe's peers attaching at all proves their identities were authenticated. Per-device
  tokens are **not** gated on a sidecar release (GT-4 close-out, 2026-08-06).
- **`ghosttea-truffle` writes unstructured `[terminal-mesh]` lines to STDERR** — latent
  violation of native_logging's absolute no-stderr law (which today only meets the
  flag-off floor); the `field_native.sidecar.stderr` capture is the fixing pattern
  (GT-4, 2026-08-06).
- ~~**`apps/ios/**` is stale against 0.9.2**~~ — **CLOSED, and it was already closed when this
  row was written.** IOS-EL8 (`4f2b21d`) landed the bump hours after GT-4 recorded the debt, and
  the row was simply never retired. Verified 2026-08-07 in `apps/ios/VibeFieldKit/Package.resolved`:
  ghosttea `0.9.2` (rev `b55b803`) and truffle `0.7.12` (rev `2cf5732`) — both planes name one
  wire. Standing lesson for this file: a debt row is a claim with a shelf life, and a rewrite that
  only *adds* is not a rewrite (GT-4 2026-08-06, retired 2026-08-07).
- **Smoke row 13b (remote bubble → attach) is still skipped** — the floor is ready and the
  check is honest (`remotePeer:"unavailable"`), but unskipping needs a PEER staged in the
  smoke harness, i.e. a second floor. Harness work GT-4 did not take (2026-08-06).
- **G13 + G14 ghosttea petition candidates, unfiled** — G13: let a host inject the remote
  banner's browse handler (today, with the palette disabled, a mounted remote pane that ENDS
  renders a "Browse sessions" button that does nothing) so the monitor can be the door
  there too. G14: an injectable `MeshRuntime` seam, so the terminal mesh adapter need not
  hold the truffle node at construction — today a node arriving after the 20s budget does
  not attach until the pair bounces (GT-4, 2026-08-06).
- **The attach path with the mesh gateway genuinely UP is unexercised** — that combination
  has never booted outside the probe's hand-built services (GT-4, 2026-08-06).
- **Shaders are WebGPU-only** — on the Canvas2D fallback the chips select something that
  will not draw; the section's copy says so, but a deck that KNEW its backend could show a
  live honest-UNAVAILABLE — the panel can't know it today, the deck mounts on first ⇧⇧
  (GT-3f, 2026-08-04).
- **`configEditor` bridge** — the 0.9.0 two-track editor seam needs `terminal.config.validate`
  (new product method) + three main-side file dialogs; GT-3's raw editor is the raw track
  meanwhile (GT-3v, 2026-08-04).
- **Surface lab is not dev-gated** — renders in production builds; field-app has no dev-gate
  idiom to borrow. James's call: gate it, keep it, or retire it after the visual pass
  (GT-3v, 2026-08-04).
- **`prefers-reduced-transparency` has no policy** — DESIGN.md has M6 for motion and no
  transparency stance; proposal in `440b04e`'s body (glass falls back to §5 tint at full
  opacity); the doc changes first (GT-3v, 2026-08-04).
- **Godview smoke reload rows are load-flaky — now with a CONTROL and a named fix** — GT-3f's
  builder went green on attempt 8 (fails at three different points, loads 4–30) and ran an
  identical no-shader harness that failed the same rows, exonerating the new code by
  experiment; the orchestrator saw 2 fails then green at load ~14. The class is the
  `CANVAS_READY` wait (canvas/plugin-registry mount — the overlay is closed there). Real
  fix named: the reload rows should wait on something stronger than a 60s console deadline
  (GT-3v residual, measured at GT-3f, 2026-08-04).
- **Profile the cold-open legs** — the ~443ms cold total is stable but its attribution moves
  with load (ticket-mint 301ms dominant in one run; the connect leg 241ms in another); no
  single culprit claimed. The warm path sidesteps it entirely, so this is curiosity-priority
  (GT-3p, 2026-08-05).
- **G12 ghosttea petition candidate, unfiled** — a host-observable FIRST-FRAME signal
  (`renderer-status` reports a backend, not a presented frame; GT-3p's `frame` phase is a
  double-rAF proxy that read 36s under load 59 on a healthy open) + a real `prepare()`
  (the device warm currently rides `startPerformanceMeasurement()` → `ensureRenderer()`
  as a side door) (GT-3p, 2026-08-05).
- **RESOLVED then superseded — the shadow σ-proposal landed measured** (`4019e9b`): the
  original A/B had tested the wrong construction (box-shadow); the pre-blurred-layer rebuild
  measured worst-peak 15/255 / mean ≤3.4 with a self-comparison control, audit test now
  carve-out-free, orchestrator re-verified. Final authority = James's eyeball (revert is two
  files) (2026-08-05).
- **Reduced motion never applied to the monitor's status animations** — the
  `prefers-reduced-motion` block's selector (0,1,0) always lost to the state rules (0,2,0);
  media queries add no specificity. Verified in Chromium; behavior deliberately preserved at
  `4019e9b` because the fix is a VISIBLE motion change — DESIGN.md §M6 moves first
  (2026-08-05).
- **`native_logging::fieldd_link_death` flakes under load** — "field-native did not bind
  mgmt" at load 51, passes alone; unrelated to GT-3p (zero non-TS changes in that commit);
  NF-owned (2026-08-05).

## Eyeballs owed (James's standing visual passes)

- Widgetlab visual fidelity vs the original (thinking-widgetlab-port §5) — the D-track
  acceptance.
- Open an old board once; watch the C2 id-migration log line.
- Settings Plugins section (P2) · toggle widgetlab → placeholders swap LIVE + tray thins (P3).
- Mesh sync rows + the file pill's standing-state dot, both themes (C6-4).
- Artifact Hub list + Proxy/Folder native-picker/add/open flows, both themes and reduced motion
  (AH-3 closeout; runtime implementation `8c07bf4`).
- The Godview deck end-to-end (⇧⇧): the zsh first pane, the consent face after a session
  dies, the kill chip's two steps, Settings → Terminal editor with a live reload (GT-2e/3).
- **The glass pass (GT-3v)**: canvas ghosting through semi-transparent panes at the §5 SHEET
  tier · the surface lab's stage knobs · Settings → Terminal appearance section (theme
  catalog, shader cards incl. the honest UNAVAILABLE ports, opacity slider) · a theme +
  opacity change applying to an open deck live — then decide the lab's fate and the
  reduced-transparency stance.
- **The swarm pass (GT-3m)**: nine mock agents swimming over the stage (swarm default;
  list and rain via the switcher) · accent-slot colors + working/waiting state reads in
  both themes · the "preview — mock agents" label · the monitor section in the surface
  lab · select/create acknowledging without mounting (GT-3m).
- **The shader pass (GT-3f)**: whether CRT, VHS and Sparks actually look right over the
  glass · the four chips + No effect, animate only where it means something · licenses
  visible · the withheld-upstream list rendering with its reason (GT-3f).
- **The perf pass (GT-3p)**: zero visual delta across glass/swarm/glow/breathe · the warm
  ⌘G (should feel instant) · the DRAGGED bubble at the default `physicsHz: 30` — interpolation
  adds up to one physics step (~33ms) atop the spring; `physicsHz: 120` in the lab restores
  the old cadence for an A/B — your feel decides the default (GT-3p, unresolved by design).
- **The UI catalog (`pnpm dev:design`)** — its own stated acceptance, never yet run as a pass:
  light/dark, keyboard focus, reduced motion, and narrow layout across every cataloged view.
  The bench exists precisely so this is one command and no daemons (UI track, 2026-08-07).
- **IOS-3 on a real device** — the whole point of the slice and the only thing no fixture can
  stand in for: a peer's terminal as a bubble, ATTACH, the live TUI over the tailnet, the
  settings sheet's themes applying to a running attachment, and the reconnect banner on a daemon
  bounce. Note what this run can NOT show until IOS-3c's capability leg lands: typing. Also
  device-gated with it — the attached-but-unlisted card, which is tested as a decision but whose
  pixels need an attachment held open while discovery drops the row (IOS-3, 2026-08-07).
- **The shadow-parity check (`4019e9b`)**: the breathe/waiting pulses, both themes, at rest
  and at peak — measured worst case is 15/255 on one channel inside a blurred penumbra; if
  your eye catches it, the revert is exactly two files (2026-08-05).

## Upstream / sibling pins (the EL8 watch)

truffle `=0.7.12` (exact crates-io + exact platform sidecar packages; T2 consumed at AH-1) ·
ghosttea `=0.9.2` + **`ghosttea-truffle =0.9.2`** on all planes (GT-4, 2026-08-06; preflight
pins the cargo rows and all four npm rows) · chopsticks 0.1.4 · strata **0.11.0** (via ICE — corrected
2026-08-09; this line said 0.10.0 while `pnpm-workspace.yaml:95` and the lockfile resolve
0.11.0) ·
`@vibecook/ice` **0.4.0** (registry pin; **bumped 2026-08-09 — the I1/I4/I5 consumption**, the
same night upstream released; pin-drift history 2026-08-07: this line and `CLAUDE.md` had
trailed the manifests at 0.2.0) · **`apps/ios` is in
lockstep too** (`Package.resolved`: ghosttea 0.9.2 / truffle 0.7.12), which is what retires the
staleness debt above. **The 0.9.2 release exists because of GT-4**: our
`=0.7.12` and upstream's `=0.7.11` could not resolve together, and James moved ghosttea to
meet us rather than the reverse — the exact-pin law producing a loud manifest error instead
of a silent `Arc<Node>` split. G7/G8/G9 consumed at NF-7; G11 filed→landed→consumed at GT-3f
in one day; G10 (spawn props), G12 (first-frame signal + `prepare()`), G13 (browse-handler
injection), G14 (injectable mesh runtime) all named and unfiled; C7 implemented upstream,
consumption rides AR. Full petition status: `petitions/README.md`.
