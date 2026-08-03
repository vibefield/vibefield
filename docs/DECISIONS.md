# VibeField — Decision Index

> **Status:** the corpus-wide index of numbered decisions and rulings. STATUS FLIPS HERE;
> definitions stay in their owning docs — this file never restates law, it tells you where a
> decision lives and whether it still stands. Full-corpus sweep: 2026-08-02. Update the
> relevant row when a decision is ratified, amended, superseded, or consumed. Siblings:
> `ROADMAP.md` (now/next) · `LANDED.md` (history) · `draft/petitions/README.md` (upstream
> petitions). AH status advanced 2026-08-03. Lives in main-tracked `docs/` (moved from
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
| D30–D38 | design-04 §10 | in force; D31/D32 implemented (C4/C5), D35 implemented (C5/C6-5), D33/D34/D37/D38 await AR |
| D39 | design-03 §3.1 + §11 (v0.4, 2026-07-24) | single primary window; implemented (tray track + WP6) |

## Laws and principles (flip only on a design event)

PP1–PP6 + EL1–EL10 — design-00 §2 · A1–A8 axioms + PF1–PF8 performance laws — design-03 ·
C-1…C-7 widget constitution — 03·A (CI-gated) · NF-L1…L3 custody laws — native-floor §1 ·
M1–M5 contract milestones — design-01 §11 (M1+M2 implemented, green cross-language).

## Spec decision namespaces

| Namespace | Home | Status (2026-08-03) |
|---|---|---|
| NF-D1…NF-D10 | native-floor §3 | track complete; NF-D1 resolved upstream (ghosttea 0.6.0) · NF-D3's gap filled at NF-7 · NF-D10's mechanism half retired when G7 landed. §3's heading undercount (…D9) fixed 2026-08-02 |
| PA-1…PA-36 | plugin-architecture §1.1 | all binding; the §21 ladder (P0–P7) implemented; distribution staged — only rung R3 stays fenced (PA-24). AH-3's additive `hud.side-panel` fixed slot is ratified/open and supersedes the unimplemented `hud.sheet` proposal without reopening the prior ladder; AH-D10 gates PA-31's peer-CAS optimization (registry fetch landed, peer fetch did not) |
| EDP-1…EDP-40 | electron-distribution-and-tray §1.1 | EDP-22 AMENDED 2026-07-29 (universal macOS; separate-arch retired) · EDP-6 supersedes the v0.1 platform-convention rule · EDP-15 amended Node 24→26 · EDP-33…40 = the update system (defined IN THE SPEC; `thinking-auto-update.md` is provenance and defines U1–U15) |
| ESP-1…ESP-17 | electron-security-packaging §1.1 | in force; §9.3 (operationalizing ESP-3) CLOSED 2026-07-25 (WP9) |
| ESR-1…ESR-15 | electron-shell-refactor §1.1 | ESR COMPLETE as specced (§17) |
| GT-D1…GT-D8 | godview-terminal §3 (v0.2) | LIVE track; GT-D9 refuted and deleted in v0.2 — retired, never reissued |
| AH-D1…AH-D12 | artifact-hub §3 (v0.4) | RATIFIED 2026-08-02; AH-D6 AMENDED 2026-08-03 by the AH-2 as-built retained-public-cache mechanism: last-known safe slices survive Truffle peer removal until a future device-retirement policy, while explicit empty origin slices remove immediately. The 2026-08-03 review hardening fixes the interpretation: a store key owns its DeviceSlice, tolerant device/catalog readers narrow before retention, raw URL spelling is validated before normalization, self does not consume the 256-remote-origin budget, and contracts-generated cross-plane frame/slice/queue limits bind native + fieldd. Cache writes are async/coalesced; preview cleanup retains absent intent as its retry record; ArtifactService disposal is a drain barrier. AH-D7 AMENDED 2026-08-03 by James's desktop direction: a spine-owned non-modal right-edge `hud.side-panel` with an outermost top-right round toggle supersedes the unimplemented bottom-island sheet; it overlays without canvas reflow/recede while `vibefield.browser` still owns content. AH-1a/1b serving landed at `9f80f0c`; AH-2 global validated catalog landed at `9c17c46` and consumes AH-D5/D6 plus T1's lawful identity join. The live AH-1 second-client field proof remains open; AH-3…AH-5 remain open. CAS/file transfer stays gated by AH-D10; AH-D11 reuses Electron main's authenticated loopback ProductAPI connection for the static `shell.*` provider — no ProductAPI UDS or renderer relay; AH-D12 records that per-port origins do not isolate browser cookies |
| LOG-1…LOG-44 | logging-and-diagnostics §1.1 (glosses in its own table) | all binding; LOG-41…44 folded in v0.2; slices LOG-L0…L6 all complete; **LOG-39 release-gated (open)**; verify-items LOG-V1 (Windows half) / V5 / V8 open, V7 optional-deferred |

## Work / finding namespaces (status lives in their own tables — pointers only)

- **WP1–WP13** (+WP12a–f), findings F-1…F-29, blockers B-1…B-7, probes P-A…P-D — packaging
  plan §2/§7/§5/§3. Open: **B-3** (Apple Team ID, enrolment under way) · **B-7** (Immutable
  Releases toggle, 2026-07-29). WP8/WP10–13 not started.
- **H0–H6** hardening + **F0–F2** file-protocol stages — ESP §14/§8.3. F2 reached 2026-07-25;
  F1 skipped.
- **C6-1…C6-6** (+3a…3i) and **F-C6-1…F-C6-22** — thinking-c6 §4/§7. Open: F-C6-1, F-C6-4,
  **F-C6-21 (the track's oldest debt)**; F-C6-22 mitigated-not-fixed (see its corrected row).
- **IOS-0…IOS-4** + **D-i1…D-i6** — thinking-ios-app. D-i5 superseded 2026-07-29 (upstream
  publish).
- **AH-0…AH-5** (AH-1a/1b split) — artifact-hub §10. AH-0 design ratified 2026-08-02;
  AH-1a/1b implementation landed at `9f80f0c` (physical second-client proof open);
  AH-2 implementation landed at `9c17c46`; AH-3…AH-5 open.
- **U1–U15** — thinking-auto-update §4 (+8 unprefixed closed decisions §8; all consumed by
  EDP v0.3).
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
- RFC 022/023/024 (truffle) and ADR-007 (chopsticks) are upstream external ids, not VibeField
  namespaces.

## Docs that define zero numbered ids

`foundations-and-architecture.md` (prose decisions; references petition ids only) and
`agent-field-design.md` (§17 product principles are the prose origin of PP1–PP6).
