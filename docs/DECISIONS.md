# VibeField — Decision Index

> **Status:** the corpus-wide index of numbered decisions and rulings. STATUS FLIPS HERE;
> definitions stay in their owning docs — this file never restates law, it tells you where a
> decision lives and whether it still stands. Full-corpus sweep: 2026-08-02. Update the
> relevant row when a decision is ratified, amended, superseded, or consumed. Siblings:
> `ROADMAP.md` (now/next) · `LANDED.md` (history) · `draft/petitions/README.md` (upstream
> petitions). AH status advanced 2026-08-03; **IOS (D-i7…D-i9) and the UI system added
> 2026-08-07** in the reconciliation pass that found both tracks missing from all three
> main-tracked docs. Lives in main-tracked `docs/` (moved from
> `draft/` 2026-08-02); owning-doc
> citations (`native-floor §3`, `thinking-c6`, …) resolve under `draft/`, dev-local-only.

## The core D-series (D1–D39 + D29′ — contiguous, no gaps)

| IDs | Defined in | Status notes |
|---|---|---|
| D1–D4 | predesign-05 §2 | pass-05 seeds (spaghetti worker · chopsticks-in-fieldd · doc-host measure-first · one contracts package); all carried into the design docs |
| D5–D10 | design-02 §6 (D5 designed §2.5) | in force; D5 implemented by C6, D6 by NF-3, D9/D10 by the shell/supervisor |
| D11–D16 | design-03-widget-sdk (appendix 03·A) §10 | in force within design-03's architecture; **D11 SUPERSEDED** (Track D landed the GL shelf — plugin spec §28) · **D13's grace-pool is a deferred-return** (GT spec: only if AR-era cycling needs it) |
| D17–D29 | design-03 §11 | in force; **D27 = v0.2 amendment** (dual loopback WS; the v0.1 MessagePort row is deleted) · D28 v0.2 · **D29 amended by D29′** |
| **D29′** | design-03 §7.2 (ratified 2026-07-24, James) · plugin spec §16.6 + §28 fold-backs | AMENDS D29: the settings doc is a doc in FULL (persisted · synced · undoable), app prefs join it, three undo laws (user-scope only · never re-escalates · horizon = compaction epochs). **IMPLEMENTED at P7** (`3e3c534`); the spec's pre-P7 "not yet implemented" sentence carries a dated correction |
| D30–D38 | design-04 §10 | in force; D31/D32 implemented (C4/C5), D35 implemented (C5/C6-5), D33/D34/D37/D38 await AR; **D30 AMENDED 2026-08-05** (UA-D4 — mesh identity is per *user-on-device*; §3.2's peer preset split self/guest by UA-D5; `specs/users-and-accounts.md`) |
| D39 | design-03 §3.1 + §11 (v0.4, 2026-07-24) | single primary window; implemented (tray track + WP6) |

## Laws and principles (flip only on a design event)

PP1–PP6 + EL1–EL10 — design-00 §2 (**EL3 AMENDED 2026-08-05**, UA-D4: one mesh identity per
*user-on-device*) · A1–A8 axioms + PF1–PF8 performance laws — design-03 · C-1…C-7 widget
constitution — 03·A (CI-gated) · NF-L1…L3 custody laws — native-floor §1 · M1–M5 contract
milestones — design-01 §11 (M1+M2 implemented, green cross-language) · **W1–W6 onboarding
laws — users-and-accounts §6**.

## Spec decision namespaces

| Namespace | Home | Status (current through 2026-08-17) |
|---|---|---|
| NF-D1…NF-D10 | native-floor §3 | track complete; NF-D1 resolved upstream (ghosttea 0.6.0) · NF-D3's gap filled at NF-7 · NF-D10's mechanism half retired when G7 landed. §3's heading undercount (…D9) fixed 2026-08-02 |
| PA-1…PA-36 | plugin-architecture §1.1 | all binding; the §21 ladder (P0–P7) implemented; distribution staged — only rung R3 stays fenced (PA-24). AH-3's additive `hud.side-panel` fixed slot landed at `8c07bf4` and supersedes the unimplemented `hud.sheet` proposal without reopening the prior ladder; packaged discovery still waits on WP8's bundled-plugin staging + signed index. AH-D10 gates PA-31's peer-CAS optimization (registry fetch landed, peer fetch did not). **P8 opened 2026-08-11** (spec §21.9; `thinking-p8-loadable-artifact.md` holds P8-D1′…D10 — **P8-D1 WITHDRAWN 2026-08-12**, falsified by ESP §8.4): P8a/P8b-1/P8b-2 LANDED `acc272d`/`08f19c5`/`ad8b804`; **P8b-3 LANDED 2026-08-13** (`0b8ad13`+`ded012b`+`39c165a`+`608e78e` — **P8b COMPLETE, the artifact loads**; probe verdicts: **P8-D9/P8-D10 REFUTED** — map targets are app-origin chunks, no derived-token class; P8-D2's dev-only `BUNDLED` + P8-D7's build wiring consumed; the P8b-2 secure-context clobber found/fixed en route — ONE `registerSchemesAsPrivileged` call is law, `scheme-registration.ts`); **P8b-3e seam e2e LANDED `089274c`** (every §8.4 clause tested on the real seam — P8b closed whole); **P8d KIT COMPLETE 2026-08-13** (`5cfd0b4` CLI + gen-freshness docs · `0478f08` playground verdicts · `a3c4897` create-plugin · `a7d434f` the rehearsal-caught docs fix, anchor-pinned; P8-D8's verdict contract as-built end to end; ONLY the measured bar remains, gated on `thinking-mindmap-pack.md` MM-D1…D6 awaiting James) (P8c = WP8 · P8e gates third-party); destination agents-author-widgets RATIFIED 2026-08-11; **mind map pack = the first prod dogfood product, 2026-08-13** (`thinking-prod-dogfood-packs.md`; Rung-3 visual-consistency read directive recorded there §3) |
| PRC-D1…PRC-D13 | plugin-architecture §1.2 · `thinking-plugin-runtime-composability.md` §12 | **RATIFIED 2026-08-15** (James: “go ahead”). **PRC-0 shared ownership/target core LANDED `7e0a0e8`**. **PRC-1 renderer ownership LANDED `4831b0a`**. **PRC-2 service ownership + common route drain LANDED `96fcd81`**. **PRC-3a exact target controller LANDED `4c4755c`**: semantic vs observation equality, canonical per-face authority projection, private synchronous candidate commit, credential refresh/fallback, and positive boundary-force proof are production-tested. **PRC-3b credential seam LANDED `2dbb359` + `22a4f71`** (with the strip-only worker boundary correction in `dbb5423`): stable clients rotate in place and replay subscriptions; renderer and service mint/install paths are observation- and backend-generation fenced. **PRC-3c service controller LANDED `2df838b`**: one exact plugin/device target owns privately staged providers, stale loading/refresh episodes cannot install, observation-only movement rotates the live worker credential, and service-authority movement replaces the worker behind the common drain. **PRC-3d renderer/window controller LANDED `e747af3`**: exact plugin/window targets own privately staged command/surface/style publication, mutable late acquisitions, stable ICE widget facades, observation refresh, and honest awaited window close from the pre-ready boot edge. **PRC-4a behavior design/proof COMPLETE 2026-08-16**: released ICE/React controls and an isolated upstream red/green revise the mechanism to a sealed renderer behavior-intent catalog plus one synchronous, sorted document-generation registration batch. Exact identity includes a runtime-generation nonce; chronic breaker identity does not. **PRC4-E10 consumer feasibility GREEN:** patched ICE 0.6 and its coupled strata 0.12 floor pass installed-package singleton checks, five consumer typechecks, SDK/shell/all non-socket field-app controls, production builds, and bundle gates; eager bytes do not move and total renderer output grows 0.534%. The direct-source-link negative control duplicated React, so physical peer resolution is now an acceptance gate. **PRC4-E11 manifest projection GREEN:** a complete inline ICE descriptor remains under the canonical manifest hash, catches 23 semantic mutation families, and lets fieldd validate widget attachments code-free. Real ICE controls refute `writes:[]` as read-only and separate inert declaration binding from `canvas.write`-gated engine execution. **PRC4-E12 dormant policy GREEN:** durable cells survive a genuinely code-absent writable round trip and migrate on return; runtime cells are World-scoped; ephemeral facets must tombstone when execution stops. Current ICE leaves stale facets on unregister, suspension, and singleton quarantine, so I17 assigns the inverse to the behavior node. **PRC4-E13 host mechanics GREEN 7/7:** canonical initial/close order, live deny/regrant, chronic ledger replacement, collision rollback, and invalid-snapshot isolation pass. Production create/open has no behavior-visible presence; standalone `attachPresence(world)` cannot inject it, while joined presence activates the same intent. Renderer catalog state is therefore `authorized`, with the document host deriving execution and reporting `presence-unavailable`. **PRC4-E15 contract thread GREEN 6/6 + typecheck:** current passthrough parsing lets fieldd drop top-level behavior declarations while nested riders survive; the candidate proves typed verbatim projection, strict descriptor/attachment validation under a tolerant outer reader, a stable `behavior-store-unsupported` verdict, effective-grant authorization on the staged path, and the exact SDK-subpath host mapping requirement. **PRC4-E16 dependency/control floor LANDED `0b8d009` + `5e6cb16`:** stock ICE 0.6 / strata 0.12 now use the real registry lockfile and preflight with physical Loro/ICE/strata/React/React DOM singleton guards. The installed behavior matrix is 10/10 green, but refutes the assumption that 0.6 contains I16: `describeBehavior` and behavior registration options are absent, and the order/ledger/diagnostic/thenable gaps reproduce. An I16 release + exact-pin follow-up and then contract/host work gate the durable/runtime base. I17 + I18 + document-room product presence independently gate ephemeral admission. Artifact byte replacement remains PRC-5's disruptive barrier; observability follows in PRC-6. Adapter integration must precede lifecycle-heavy W2 behavior work. |
| PRC-4 delivery state | plugin-architecture §8.8/§12.7 · `thinking-prc4-behavior-adapter.md` | **PRC-4 COMPLETE 2026-08-17. PRC-4b/4c consumed:** ICE 0.9.0 + strata 0.13.0 carry I16–I19; exact dependency consumption is `1fecb94`. **PRC-4d LANDED `95da1b8` / E19:** strict signed behavior descriptors/riders, verbatim projection, exact sealed renderer binding, effective-grant authorization, dormant widget construction, authoring/build surfaces, and activation-root withdrawal. **PRC-4e LANDED `6289795` / E20:** identity-bound window catalog, synchronous canonical document-generation host, bounded chronic ledger, rollback, presence coeffect, structured diagnostics, and reverse teardown across normal and quarantined-reset paths are production-tested. **PRC-4f LANDED `9fc2de6` / E21:** packaged durable/runtime migration, breaker carryover, exact churn cleanup, and 45 balanced registration inverses. **PRC-4g1 LANDED + PHYSICALLY CLOSED `43929e7` + `81c21fd` / E22:** the ticketed document socket, bounded latest-only room router, shared ids, MeshData barrier, ICE attach order, authenticated QUIC/UDP fragmentation, terminal replay, and receiver STOP/reopen are implemented; the real-tailnet witness passed 1/1 in 35.11 s across two ephemeral nodes, including vanished-peer repair. **PRC-4g2 LANDED `ce92023` / E23:** plugin ephemeral rows require an identity-bearing positive finite-integer `maxFacetBytes`; static and window admission charge the claim +256 bytes under a 48 KiB plugin window, allocate plugins atomically in canonical plugin-id order, and retain the independent 64 KiB transport guard. Exact ICE probes are 8/8; a fully charged maximal-id/core frame is 48,776 bytes; sealed byte-claim drift refuses; and the packaged production-composition witness observes both the remote facet and its I17 authority tombstone. The legacy `behavior-store-unsupported` code remains vocabulary-only for old hosts and is no longer emitted. |
| PRC-D14 / PRC-5 delivery state | plugin-architecture §1.2/§18.5 · `thinking-prc5-update-coordinator.md` | **PRC-D14 EVIDENCE AMENDMENT ADDED 2026-08-17:** freeze exact participant incarnations at synchronous ingress close; distinguish host-drained leave, positive boundary death with forward recovery, and mere disconnect; hold newcomers outside the vote. **PRC-E18 GREEN 7/7 + E13 6/6:** service + two-window snapshot, one commit epoch, ack/recovery barriers, close/crash/disconnect distinctions, stale identity/update refusal, retained external history, and no post-commit rollback edge. **PRC-5a LANDED `c5dcca9`:** Electron-main mints stable-window/exact-document identities, fieldd binds them into the renderer bearer and derives them into `CallerContext`, field-app uses the stable id for renderer targets, and strict update snapshot/command/ack contracts forbid caller-supplied participant identity. **NOW: PRC-5b** immutable artifact slots/current-pointer crash consistency; candidate authority, renderer replacement, coordination, death witness, and physical acceptance follow. |
| EDP-1…EDP-40 | electron-distribution-and-tray §1.1 | EDP-22 AMENDED 2026-07-29 (universal macOS; separate-arch retired) · EDP-6 supersedes the v0.1 platform-convention rule · EDP-15 amended Node 24→26 · EDP-33…40 = the update system (defined IN THE SPEC; `thinking-auto-update.md` is provenance and defines U1–U15) |
| ESP-1…ESP-17 | electron-security-packaging §1.1 | in force; §9.3 (operationalizing ESP-3) CLOSED 2026-07-25 (WP9) |
| ESR-1…ESR-15 | electron-shell-refactor §1.1 | ESR COMPLETE as specced (§17) |
| GT-D1…GT-D8 | godview-terminal §3 (v0.2) | LIVE track; GT-D9 refuted and deleted in v0.2 — retired, never reissued |
| AH-D1…AH-D12 | artifact-hub §3 (v0.4) | RATIFIED 2026-08-02; AH-D6 AMENDED 2026-08-03 by the AH-2 as-built retained-public-cache mechanism: last-known safe slices survive Truffle peer removal until a future device-retirement policy, while explicit empty origin slices remove immediately. The 2026-08-03 review hardening fixes the interpretation: a store key owns its DeviceSlice, tolerant device/catalog readers narrow before retention, raw URL spelling is validated before normalization, self does not consume the 256-remote-origin budget, and contracts-generated cross-plane frame/slice/queue limits bind native + fieldd. Cache writes are async/coalesced; preview cleanup retains absent intent as its retry record; ArtifactService disposal is a drain barrier. AH-D7 AMENDED 2026-08-03 by James's desktop direction: a spine-owned non-modal right-edge `hud.side-panel` with an outermost top-right round toggle supersedes the unimplemented bottom-island sheet; it overlays without canvas reflow/recede while `vibefield.browser` still owns content. AH-1a/1b serving landed at `9f80f0c`; AH-2 global validated catalog landed at `9c17c46`; AH-3's desktop runtime implementation landed at `8c07bf4`, consuming AH-D7/AH-D11 with the browser-plugin panel and authenticated Electron-main `shell.*` provider. AH-4's runtime is in implementation under the ratified AH-D8 boundary; its explicit refresh is state-advancing/non-idempotent and must never be replayed automatically. The live AH-1 second-client proof, AH-3 packaged-plugin/physical UI closeout, AH-4 physical witness, and AH-5 remain open. CAS/file transfer stays gated by AH-D10; AH-D12 records that per-port origins do not isolate browser cookies; AH-D6 amended again 2026-08-05 (UA-D8 — user unlink is retirement's second trigger; `allow` globs named the guest-admission exemplar) |
| LOG-1…LOG-44 | logging-and-diagnostics §1.1 (glosses in its own table) | all binding; LOG-41…44 folded in v0.2; slices LOG-L0…L6 all complete; **LOG-39 release-gated (open)**; verify-items LOG-V1 (Windows half) / V5 / V8 open, V7 optional-deferred; amended 2026-08-05 (UA-D16 — `userId` is a record field, never a path) |
| UA-D1…UA-D16 | users-and-accounts §2 (lock law §3.3 · wizard §6 + W1–W6 · door law §7) | **RATIFIED 2026-08-05** (James). v0.2 same-day wizard revision (UA-D11 reversed from silent-mint to the Setup Assistant at James's direction). All five verify-items (S1, V2–V5) RESOLVED by spikes 2026-08-05 and folded at §12 — UA-4 unblocked on pinned truffle 0.7.12 (self-whois works); V5's finding rewrote UA-D10/UA-D12 (the users.json lock replaces the accidental fixed-port mutex). Fold-backs executed 2026-08-05: design-00 (§1 · EL3 · §4.2 · §4.8 · §4.9 incl. the `native/mesh` path correction) · design-01 (hello/principals/registry) · design-02 (§3.6) · design-03 (§4.3 setup assistant realized) · design-04 (D30 · §3.2 · §6 · §7) · artifact-hub AH-D6 · logging UA-D16. **UA-0 LANDED 2026-08-05 `fcd0af9`** (layout registry) · **UA-1 LANDED `ca1ce49`** (user-shaped storage; live dev-root migration witness owed to the first `pnpm dev`) · **UA-2 LANDED `3750f20`** (identity threading) · **UA-3 LANDED `15832c0`+`30aece8`+`96e9e9d`** (link lifecycle: native self/retire, LinkService capture, Account page) · **UA-6 LANDED `a4bed08`+`1a2a846`** (sync intent: three DocSync gates, doc.setSyncIntent, posture key; §8 errata recorded at source — peer-declined mapping falsified by the one-directional lane protocol; side-find: pre-existing doc-registry write-back race fixed) · **UA-4 CODE LANDED `105e6bd`** (self/guest door: stored-login comparison, tailnet-guest principal, guestOk column lint-pinned to system.hello, serve-allow belt REMOVE-THEN-ADD around the traced no-upsert semantics; C3 serve-reconcile-skip debt RECORDED at spec §7.3 — stale gate + adopted state, pathSecret rotation rides the same skip; **exit open on the physical pair: S1 live probe + two-account witness — gates ANY shared-tailnet login**); **UA-3w LANDED `1e27c7b`** (Setup Assistant: onboarding boot phase held after the workspace resolve, five panes + migration variant on the splash's own ground, W6 resume from durable facts, mintOnboarded mint/migrate symmetry, setupVariant stamp + main-side backfill; two as-built notes folded at spec §6 — no link-start verb exists so the pane rides the authUrl anchor, and posture-resume is not derivable so a linked resume lands ON the posture question) · **UA-5 LANDED `cfe87b8`+`f3aa78a`+`e83033a`** (second user: createUser under the lock + UA-D9 create-time budget assert; per-user PairBundles, build-before-break attach, switch-by-reload; UA-D12 completed — ephemeral ports unconditional, two-pair audit on real daemons green incl. the UA-D10 mtime law; tray submenu + Account Users block + wizard second-user variant; §6.2 modal-frame clause amended at source — the variant rides the boot wizard). **THE TRACK IS CODE-COMPLETE — all nine slices**; remaining exits physical: S1 live probe · two-account witness · switch kill-matrix row. MeshSection dedup deferred. T3 optional-unfiled; C-series AR-era asks recorded in §13 |
| WIN-D1…WIN-D9 | `thinking-windows-port.md` §8 (spec graduates with the track) | track OPEN 2026-08-10 (James: "follow your plan"). **WIN-D1** pipes-via-`ghosttea::ipc` + FNV-scope · **WIN-D4** `cfg(unix)` mode bits + per-pipe DACL (dir-DACL = booked hardening) · **WIN-D5** stop-verb ADOPTED (a design-02 §2.8/§3.6 amendment) — all landed 2026-08-11 (`5ffd30b`/`85cce04`/`f982d27`); **WIN-D3 RESOLVED BY CONSTRUCTION** the same wave (binding upstream's own `Listener` made the terminal handoff direct — no petition, the plan's sketched fork unneeded); **WIN-D2** ADOPTED 2026-08-11 (James: "build WIN-6 now") — terminal hosting is in Windows GA, the ConPTY rung landed `03cc648` with the kill matrix on the box, and the one residual EL7 gap (a case-variant private-env key leaking past ghosttea's case-sensitive strip) is booked upstream as G13; WIN-D6/D7/D8/D9 OPEN (James's) |

## Work / finding namespaces (status lives in their own tables — pointers only)

- **WP1–WP13** (+WP12a–f), findings F-1…F-29, blockers B-1…B-7, probes P-A…P-D — packaging
  plan §2/§7/§5/§3. Open: **B-3** (Apple Team ID, enrolment under way) · **B-7** (Immutable
  Releases toggle, 2026-07-29). WP8/WP10–13 not started.
- **H0–H6** hardening + **F0–F2** file-protocol stages — ESP §14/§8.3. F2 reached 2026-07-25;
  F1 skipped.
- **C6-1…C6-6** (+3a…3i) and **F-C6-1…F-C6-22** — thinking-c6 §4/§7. Open: F-C6-1, F-C6-4,
  **F-C6-21 (the track's oldest debt)**; F-C6-22 mitigated-not-fixed (see its corrected row).
- **IOS-0…IOS-4** + **D-i1…D-i9** — thinking-ios-app. D-i5 superseded 2026-07-29 (upstream
  publish). **D-i7/D-i8/D-i9 added 2026-08-06 at the IOS-3 design (§10.6)** and all three are
  now implemented: **D-i7** one `FieldBubble` model, two pure projections (agent · remote), the
  desktop's GT-4b shape adopted rather than re-invented — remote status is the terminal
  classifier and can never wear the `waiting` tier, which is agent-permission language ·
  **D-i8** appearance is upstream *data* rendered in our design system, presentation config
  built directly, the config-document machinery deliberately not adopted (escape hatch named) ·
  **D-i9** the viewer owns appearance (`presentationAuthority: .device`) — a desktop's theme
  never reaches through the mesh to restyle the phone. **IOS-3a…3e LANDED 2026-08-05/06**
  (`f54cb06` · `15dfa4a` · `72929d8` · `feb6dc8`) with the **3r review** (`d36528a`) fixing six
  findings, three of them HIGH and all three in the one module with no test target. **Status
  correction, 2026-08-07:** `72929d8`'s subject claims IOS-3c, but that slice's
  capability/Keychain leg **did not land** (verified at three source sites) — the phone attaches
  view-only, so IOS-3c is PARTIAL, not complete. §10.4's font-size instruction was falsified
  during the build and carries a dated correction at source; §10.3's unqualified "readWrite"
  gained a clarification for the same reason. Open and unanswered: the mock-fleet-beside-real-
  bubbles taste call (§10.6).
- **AH-0…AH-5** (AH-1a/1b split) — artifact-hub §10. AH-0 design ratified 2026-08-02;
  AH-1a/1b implementation landed at `9f80f0c` (physical second-client proof open);
  AH-2 implementation landed at `9c17c46`; AH-3 desktop runtime landed at `8c07bf4`
  (WP8 packaging + physical UI closeout open); AH-4 runtime implementation in flight with its
  physical witness open; AH-5 open.
- **U1–U15** — thinking-auto-update §4 (+8 unprefixed closed decisions §8; all consumed by
  EDP v0.3).
- **UA-0…UA-6 (+UA-3w)** slices + verify-items S1/V2–V5 (ALL RESOLVED 2026-08-05) —
  users-and-accounts §10/§12. **UA-0 landed 2026-08-05 (`fcd0af9`)**; UA-1 is the next
  rung; UA-4's two-account witness and the S1 live probe are the named physical gates.
  Provenance: thinking-users-and-accounts (2026-08-04, James's OS-user framing).
- **P-1…P-8 / V-1…V-6 / P-D1…P-D4** — thinking-widgetlab-port (all executed 2026-07-21).
- **A0–A5** altitude ladder · **R0–R3** trust rungs · **L0 + P0–P7** slices — plugin spec
  §4.3/§20.5/§21.

## Petitions

Status lives in `draft/petitions/README.md` (kept current; scheme `<RepoLetter><Number>` — C
chopsticks · G ghosttea · I ICE · M mille · S strata · T truffle · SP spaghetti). Sweep notes
2026-08-02: **I5 had no status and no README row** (row added) · G5/G6 resolved WITHOUT
petitions at NF ratification · G1′ spells itself with a prime though the file is `G1-*.md` —
treat G1′ as canonical.

## Collision warnings (read before citing an ID)

- **`GT-5` names TWO different things (added 2026-08-07):** `ROADMAP.md` used it for *iOS
  attach, the last GT rung*, while `LANDED.md` §GT-5 records `127df5c`/`95cbd7e`/`69e8a99`/
  `17365fd` as *the code review's findings, fixed*. The attach work shipped as **IOS-3**
  instead. Cite the slice ids, not "GT-5".
- **`R` is THREE namespaces:** walls R1–R17 (`scripts/check-import-boundaries.mjs` — all 17
  enforce:true as of 2026-08-02) · predesign-01 standing rules R1–R12 · trust rungs R0–R3
  (plugin spec §20.5). Walls R11 ≠ predesign R11 — they conflict numerically.
- **G7's file-local `D1.`–`D8.` design sections are NOT core decisions** (nor are its review
  ids R2-1…R4-2) — the highest-risk confusion in the corpus. T1's D15/D30/D31 citations ARE
  core.
- **`M1` four ways:** mille petition · ICE design-007 milestone · design-01 contract
  milestone · DESIGN.md motion rule. `C2` / `C5` / `P0` / `L0` / `A*` / `V-*` / `F-*` are
  similarly overloaded — resolve against the home doc. D33/D37 vs EDP-33/37 is numeric
  coincidence.
- **Outside-draft ID sources:** walls R1–R17 live in code; motion rules M1/M3/M5/M6 live in
  repo-root `DESIGN.md`.
- **`T1` names TWO petitions:** the FILED `T1-truffle-identity-surfaces.md` (RESOLVED upstream at
  truffle 0.7.9) and the NEVER-FILED truffle Windows-coexistence ask (predesign-03 §6; the later-phase
  list in `petitions/README.md`). The Windows ask refiles under a fresh id when WIN-7 opens — do not
  cite "T1" for it.
- RFC 022/023/024 (truffle) and ADR-007 (chopsticks) are upstream external ids, not VibeField
  namespaces.

## Docs that define zero numbered ids

`foundations-and-architecture.md` (prose decisions; references petition ids only) ·
`agent-field-design.md` (§17 product principles are the prose origin of PP1–PP6) ·
**`docs/UI_SYSTEM.md`** (added 2026-08-06, main-tracked beside this trio — it states the
four-layer ownership boundary between `DESIGN.md`'s direction and the code, and the
catalog-mounts-shipping-views rule that `ui-system-boundaries.test.ts` enforces; binding as
architecture, but it numbers nothing).
