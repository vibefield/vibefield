# VibeField — Roadmap

> **Status:** the living now/next file, the corpus's single answer to "where are we, what's next." Four doc species,
> four mutation rules: this file is REWRITTEN in place at each milestone, never appended · `docs/LANDED.md` is the
> append-only ledger, one entry per landed slice · `docs/DECISIONS.md` is the decision index (status flips there;
> definitions stay in their owning docs) · `draft/petitions/README.md` holds petition status. Law stays in the design
> docs, the specs and `DESIGN.md`. A falsified claim gets a dated correction at its source, never only here.
> Last rewritten: 2026-10-28 — the housekeeping rewrite (James adopted it: James, 2026-10-28, the housekeeping page
> (R1)), at main `a7498883f`. It replaced 2,074 lines of recaps, landed narratives and stale Next cells with the live
> queue: what landed went to LANDED, dead directions to the retired table, every owed item kept once, every stale fact
> corrected, and James's forty housekeeping rulings folded in. What moved where, and why: `draft/archive/INDEX.md`. The
> rulings themselves: DECISIONS' HK row (the housekeeping page: R1, A1, Q1…Q29, ten lab rows) and
> `draft/thinking-housekeeping-2026-10-27.md`.

## 1 Where we are

- **Direction.** "A personal programmable field for agentic computing" (design-00 §1). The canvas is ICE's desk of GPU
  object kinds since DK-D11 (cut over 2026-10-09); live surfaces return as PORTALS. Since the Release Docket
  (2026-10-12, RL1–RL8) the goal is a real 1.0: signed desktop and iOS on nightly/beta/stable (RL4 (a)). Since 10-27
  the build front is the first run, so someone other than James can install it: **TS, AO, AL**. The engineering bar
  stays the P0 exit: real daily agent work, sessions surviving app restarts (board `rm-ar-p0`).
- **Release posture.** `nightly-20261026` (run 40398570391, `d9eea75e0`) and `nightly-20261027` (run 40426614625,
  `84509d642`) are published: Developer ID signed, notarized, immutable, the tag made at plan time. W10 and W11 passed
  (LANDED "WP12 — the first signed nightly is published", "W11 — the signed apply passes on the Mac mini"). Each
  nightly takes James's two `release-signing` clicks. The app is `0.1.0` (`apps/desktop/package.json`) and stays
  `0.1.0` until the commit that cuts `v0.9.0-beta.1` (WP12-D6 as amended; James, 2026-10-28, the housekeeping page
  (Q7)): tags `nightly-YYYYMMDD` (`scripts/release-plan.mjs`), version and title `0.1.0-nightly.YYYYMMDD`. 0.9.0 is
  tagged when RL6's four goals hold (the browser pane in a packaged build · History and Godview dogfooded daily ·
  prod-shape deps · the release rails; `draft/docket/release-docket.html`), as betas `v0.9.0-beta.N`, then stable
  after a soak; 1.0.0 at P0's exits (AR-6, the signed beta, the two-account witness).
- **Heads** (the lead, vibe-field-5c, read 2026-10-28 07:40Z). main = origin/main `a7498883f`, pushed 05:32Z. CI
  verify on `a7498883f` is GREEN (run 40638591985, 06:02:37Z). Before it: green on `9612ade48` (run 40624603346), and
  RED on `0ec11879e` (run 40605216364: item 84, AO-3's fixed-date History row expired at midnight UTC; `9612ade48`
  fixed it). `nightly-20261028` may dispatch on the green head (`scripts/release-plan.mjs:62`: never from a red trunk).
  Since the audit's base (`bb1a2c823`): AL-9, items 82–84, TS-8a/8b, the TS-3a erratum, AO-6b3 and QW1 stack A landed;
  then HK, the EL8 to puppeteer 0.3.0 (`1469639a6`) and QW1 stack B (10-28).
- **The live program.** §2: TS, AO, AL, QW1 (the Godview swarm's fix wave 1), the release rails, the EL8 watch, the
  fixer, upstream. The first-beta blockers are §3 item 7. Everything valid but unscheduled is §4.

## 2 Now — the active tracks

**TS — the Tailscale door** · vibe-field-d0 · law `draft/thinking-tailscale-onboarding.md` §10, DESIGN.md §6/§8/§9/§13
- Landed 10-27: TS-0, 1, 2, 3a (+ erratum `067d4895c`), 3b, 5, 8a (`d48e131fc`, the floor's facts on truffle 0.7.24),
  8b (`adf3d972f`, the faces and James's words). T9–T11 consumed with truffle 0.7.24.
- Next: **TS-4** (asking again) → TS-6 (the sync question, D13) → TS-7 (the phone) → TS-8c (T8, after its live probe)
  → TS-9. The slice names are the doc's: the board's "TS-6" was TS-8a.
- Owed on James's display word: §5 (TS-2's photographs and desk rows, renew's live half, TS-5's real notice, TS-8a's
  live tailnet rows). `specs/users-and-accounts.md` §6/§7 owes TS's fold (the housekeeping pass added its first dated
  notes there).

**AO — Bring Your Agents** · vibe-field-de · law `draft/thinking-agent-onboarding.md` §8 (page sources `draft/agent-onboarding/`)
- Landed: AO-0…AO-6b2, **AO-6b3** (`db8852169`, the limit moment reviewed, AO-D11), items 82 (`714ecbaae`,
  `8828601ed`) and 84 (`68296443f`).
- Next: **AO-7 (Get)** waits on James's puppeteer release with `installRecipe`. 0.3.0 (PUBLISHED 10-28 08:19Z, #48
  alone) does not carry it, read at its tag (`d0aa1224`), so AO-7 waits on a later release (0.3.x or 0.4.0; §3 item
  3). AO-8 FILED 10-27: rosetta #23–#27 (RO-24…RO-28), puppeteer
  #47 (PU-19).
- Owed: the desk rows (`pnpm smoke`, `smoke:studio`, `smoke:godview` on a display); the first-run spike (`thinking-agent-onboarding.md` §9).

**AL — what Quit means** · better-quit (lanes `al2`, `al/chords`) · law `draft/thinking-app-lifecycle.md` v0.2 §8, ESR §7.3 (amended), design-00 EL1
- Landed: AL-1…AL-3 (`7ebb1eeda` · `5eea4b2d5` · `697beb199`; AL-4 folded in), AL-5, AL-7, AL-8a, **AL-9** (`933d2fba3`,
  records `d9e5eb119`; AL-D14 "A", D15…D18). AL-8b RETIRED (AL-D10 "A": no LaunchAgent, not with AL-6 either).
- Next: **AL-6** background mode (AL-D2's "Keep running when VibeField quits", a Dock-hidden resident shell, a status
  item) · Settings → Diagnostics' "Last exit" · AL-5's relaunch cap persisted · Settings → Terminal → Behavior's "How
  long a terminal lives" (`BehaviorTab.tsx:154` promises a terminal outlives quitting, false since AL-3; DESIGN.md §9
  words first; GT-D11's "never promises more").
- Owed: AL-5's relaunch witness on a packaged build; Windows/Linux relaunch; a fieldd no shell ever claimed is
  unbounded; the clean `smoke:canvas` on this Mac (unattended); ghosttea's "last pane closed" hook (an upstream ask);
  James's hand rows (§5).

**QW1 — the Godview swarm QA, fix wave 1** · vibe-field-d4 · law `draft/testing/godview-swarm-qa-plan.md` v0.3 §12.1, `draft/thinking-ar-reattach.md` §6
- Ruled: the plan (A01–A27, X01–X26, Q01–Q21; page 3ZrkUWG4) and re-attach's RA-D1…RA-D9 (10-27, every pick at the
  lean; page JfoP9kXB). DECISIONS carries both rows since `3932cc190`.
- **Stack A LANDED 10-28** (`3932cc190` … `6b3d33af6`, records `a7498883f`; LANDED "QW1 stack A"), on the pinned
  puppeteer 0.2.3: Q17 (ACP offers no spawn), Q04 (hidden means unread), Q06 (1) (a failed body stays until its pane
  is seen; Q06 (2) withdrawn in review), Q12's departure in DESIGN.md §6, re-attach Step 0's VibeField half (the
  helpers' environment; RA-D7's resume guard), the dev overlay's `workspace:` closure (`cd585b1b4`), and Q16's goldens
  re-blessed on James's word (`9ea733f04`).
- **The EL8 to puppeteer 0.3.0 and stack B LANDED 10-28** (`1469639a6`, then B's eight to `9d7e99fbb`, + records; LANDED
  "EL8 — puppeteer 0.3.0" and "QW1 stack B"), one verify at B's tip: Q05 (the marks fieldd keeps), Q08 (the
  adapter-named stop), re-attach Step 1 and the write-word ruling (James, 10-28 04:22Z), with puppeteer's half of every
  lane from the registry (Q01/Q02, Q03, Q05's ledger, Q07, Q09, Q12's drawing, Q14, Q16, Q21, the Hermes bearer). Fix
  wave 1 is complete.
- Next: QA wave 1, the plan's run on main (VF-PM's grant and James's display). §2.6's fold is owed at Step 3's custody
  slice (design-02:13; its erratum stands since 10-27); RA-D6's own item is owed (§6).

**Release rails — WP12 · TD · BP · FW packaging · RD** · prod-builder (resting) · law `specs/build-wp12-updater.md`,
`specs/trust-and-distribution.md`, the three `specs/electron-*.md` + `electron-packaging-implementation-plan.md`,
`specs/build-wp8-bundled-plugins.md`, `draft/thinking-browser-profile.md` (BP), `draft/thinking-release-deps.md` (RD),
`draft/thinking-release-management.md` (RM: RL3 (a), RL4 (a), RL5, RL6 (a), RL7 (a), RL8 (a) ruled)
- Next: **nightly-20261028**, the first carrying `field-freeway-host` (FW packaging `f47987f18`…`a91fcf351`), and
  round 3, the host's live witness in a package. Then the first-beta list (§3 item 7).
- prod-builder's review of `4758b9837` (install.ts's census while the inventory is stale) is owed.

**EL8 — the pins** · vibe-field-5c (template lane `hl-el8-0724`) · law DECISIONS TB, the manifests
- Landed: ghosttea 0.13.7 + truffle 0.7.23 (`5ba36785b`); truffle 0.7.24, the split (`af3f3078f`, DECISIONS TB (a)).
- Watch: the kit's Swift plane rejoins truffle 0.7.24 at the first ghosttea that declares it. Next events: a later
  puppeteer release (§3 item 3; 0.3.0 pinned 10-28, `1469639a6`), mille's first release. The next event's kit pre-boots the
  simulator (`/Volumes/SamsungRed/lanes/hl-k1/kit-template.sh`, item 77's k1). CLAUDE.md names no pin since its dated pass (2026-10-28), so an EL8 event leaves it alone.

**Fixer** · fixer · law the LANDED item entries
- Landed since the audit: items 82 (`714ecbaae`, `8828601ed`), 83 (`f0b5342ac`) and 84 (`68296443f`).
- Queue: item 80 (DS-5c's wall-clock gap margin, `doc-sync-service.test.ts`, shaped with the DS owner) with its
  sibling TC-S3 (`terminal-service.test.ts`, 99 against ≥100, red at AO-6b3's verify) · item 71 (persona refresh
  window) · item 73 (`unregistered_webcontents` false positive on every factory window) · item 74 (the generation-1 port
  forward before the main world, live-surfaces) · the sibling 5 s waits (§6 Gates) · the shell lease's cleanup race
  (fieldd `shell-lease.test.ts:26`, AL-7: ENOTEMPTY on its own temp dir's `rmSync`, red in QW1 stack B's verify at load
  236 and green alone; the cleanup waits for the holders or tolerates it, fixed at the cause; VF-PM 10-28 09:39Z).
- **Item 77b**, FieldTerminalTests' 60 s block. The 5 s shape is fixed: (d) `b1e9bf53d` runs AttachDeadlineTests
  `.serialized`, because each row's 1 s deadline covers the dial too and rows started together stampeded the loopback
  dial under load. k1 is separate: `test-without-building` cold-boots a Shutdown simulator, and pre-booting it
  (`simctl bootstatus -b`) removed the 5 s dial shape (cold 14/20 red, pre-booted 0/20); that is ruled into the next
  EL8's kit script, not landed in the repo. Pre-booting does NOT remove the 60 s block (UIKit's first-touch synchronous
  XPC; stalled 2/20 booted, 0/20 cold): it stays the fixer's, and a quiet-window kit run is owed.

**Upstream** · focus-session · law `draft/petitions/README.md`
- truffle #242 (the pnpm-audit job) merged `5a8f88b5` on James's click, 10-27 21:14Z. Next: T8 (an app-chosen hostname
  prefix) after its live probe, as TS-8c; T12 (a typed start refusal) held as a candidate; T13, the one T row for T7's
  route-name pinning (Q22, §7; owed, not drafted).
- ghosttea: the ShapePlan cache `b834919be` is pushed with no PR; its mini row (replication-bench) was staged for after
  W11, which passed: give it a slot or park it.

**PM — main and pushes** · VF-PM
- Pushes go on James's click, never while CI's verify runs (the concurrency group cancels it). `pnpm commit-draft` only
  through VF-PM's queue; this rewrite's at-source corrections ride it (§6 Records). This records pass landed first
  through the docs slot; QW1 stack B rebased onto it and landed on the EL8 pin (10-28).

## 3 Next — queued, in order

1. `nightly-20261028` and round 3 (prod-builder), after a green verify on origin's head.
2. The housekeeping records pass through the docs slot (this ROADMAP, DECISIONS' HK row, the archive moves, the
   at-source corrections): LANDED 10-28 (`88e8289ea`), ahead of QW1 stack B.
3. James's puppeteer 0.3.0, PUBLISHED 10-28 08:19Z (`d0aa1224`; its notes list #48 alone, merged as `feat(views)!`
   at 07:34Z, `e79fc53d`) → its EL8 pin → QW1 stack B (both LANDED 10-28) → QA wave 1 (vibe-field-d4), next. 0.3.0 carries none of the
   following (read at its tag), so they wait on a later puppeteer release (0.3.x or 0.4.0): AO-7 (Get)'s
   `installRecipe`; item 50's env seam (puppeteer `9ffe59d1` + fieldd
   `c0581e952`, branch `focus/agent-probe-env`); item 39 (the swarm's physics at the display's rate, ruled (i) 10-19);
   the tuck row (`384e933f`). The puppeteer halves of the last three sit on `vf/item-39` / `vf/after-a` in James's local
   `../puppeteer` only (not on GitHub, not on puppeteer main, not in a release): push them first, then merge.
4. TS-4 → TS-6 → TS-7 → TS-8c → TS-9.
5. AL-6, "Last exit", the relaunch cap; the Behavior words.
6. **The ruled small slices** (James, 2026-10-28, the housekeeping page), each a lane when one is free:
   - Q4: the explorer thumbnail follows an edit by ≈22 s (ICE's ambient wind, design-015 D-D9): pass a shorter
     `deskLayer({ ambientIdleMs })` (ICE 0.16.0's option; VibeField passes none today).
   - Q5: a note held longer than 2.4 s shows its advice again.
   - Q13: fieldd projects `costRatePerMin` on the desk row (`costUsd`/`costCoverage` since DS-3); the phone reads
     `desk` (D-i18), and D-i20 is re-checked in the same slice.
   - Q19: retire Fieldmarks in code: design-kit's `icons` and `face-stickers` leaves
     (`packages/design-kit/src/icons`, `packages/design-kit/src/face-stickers`), their catalog sections and reports,
     `tooling/fieldmarks` and `tooling/face-stickers`. DESIGN.md first: §11/§11.1 retire, and §12's icon line names the
     plain mark (`b51154f91`). The sheets archive to `draft/archive/retired/design-fieldmarks/`.
   - Q20: "Settings on demand" (replaces ESR's follow-on): SettingsPanel (`packages/field-app/src/panels/SettingsPanel.tsx`)
     becomes a lazy chunk, measured before and after.
   - Q21: TP-S3f's stated limit (a deliberate own kill never gets an event-driven face), verified after item 59
     (`eebb518b0`), then kept or struck at its source.
7. **The first beta** (release rails; RL6 betas `v0.9.0-beta.N`):
   - BP-D9's ruling → its fix lane → R4 (row 31 `smoke:profile` on the signed package) · R3 (the mini) · BP-2,
     downloads (BP-D2: "at the first beta") · BP-D5's row with UA's user removal.
   - D11's signing-only measurement (two nightlies sharing an unchanged plane; W11's PTY-survival clause rides it).
   - The build job's image to `macos-26` (the Xcode 26.3 pin stands until then) · EDP-22's universal macOS build
     (`release.yml:171` builds mac-arm64 alone).
   - RD-6, CI in prod shape only: mille's first npm release (no tag past v0.3.4; release PR #44) and rosettad as a
     release asset (RD-D7; RO-4's remainder).
   - AR-7j, the launcher runtime in a packaged build (`agent-gateway.ts:310` still refuses a strict packaged fieldd).
   - LOG-39's packaged checks in `release.yml`'s verify · `allow-jit` on every shipped Rust daemon · shipped binaries
     embedding `~/.cargo/registry` paths · `package-census --assert --strict` red on MV's renderer chunks.
   - The surface lab (GodviewTuningPanel) is dev-only: gated out of production builds (Q3).
   - `cargo audit` hardened: `continue-on-error` dropped once the yanked chacha20 moves (Q28).
   - The next TestFlight build (build 4, carrying P0-H1 and everything since 09-13), then external TestFlight (Beta App
     Review; App Review 2.1's "access" question is James's).
8. Then stable `v0.9.0` after a soak. 1.0 adds Linux (RL3 (a); no Linux leg exists) and, on James's call, Windows
   (RM-4; the 10-26 production-readiness read put it out of scope; Azure signing unstarted).

## 4 Parked — valid, unscheduled

| Track / item | Parked state | Re-entry | Doc |
|---|---|---|---|
| DS / SP — sync planes | DS-7 (other desktops' sessions; unblocked: RO-1/RO-10 in the rosetta pin, egress default since TB-E) · DS-9 (E3 and artifacts in the app, files) · SP-4 probe → SP-4 → SP-7 → SP-5 → SP-8 (after AR-6) · wave 2's residue (§6) · the two built trades ACCEPTED (Q29: whole-value streams lose the 250 ms leading edge; self-served keyed calls are not journaled), reopened only if a witness shows a lost update | an owner + the two-desktop run (Tailscale app QUIT) | `thinking-desktop-sync-plane.md`, `thinking-sync-planes.md`, `design-06-sync-planes.md` |
| TD-4…TD-7 | the registry's listing gates, attestation/rebuild, the R2 posture (TD ladder §9) | third-party plugins | `specs/trust-and-distribution.md` |
| History finish (AR-8) | B-D4/B-D5 (the doors federate; no window asks for another desktop's past; the phone reads none) · PJ-8 acts across desktops (PlaceRef + the params idempotency key) after DS-7 · R8/R9 and P2's runs (§6) | the History lead's slot; PJ-8 after DS-7 | `build-hf.md`, `thinking-ar-history-room.md`, `thinking-project-places.md` |
| PJ-5 · PJ L5 | Godview's project chip, "Open in History", synced ink, where line: unbuilt; re-judged against One Frame and MV before any build (Q16) · the project key unkeyed (`normalize.ts:172`, version 1) | the re-judgement · a mesh-shared secret | `thinking-project-places.md` |
| FS | FS-3 the files consumer on the desk (a kind or panel; `pickFolder()` → `attach(root)` is built) · FS-4 with DS-7 only · FS-5 the phone viewer · GitService replaces the interim git port (R2; M5) | a desk lane · DS-7 · mille's release | `thinking-files-service.md`, `draft/files-service/build-fs.md` |
| FW — the freeway | F1's device round before leaving `-vf-freeway` · F1b, FD1/FD2 (truffle precondition met; need an owner), FD3/FD4, F4, FW-D10's slice, FW-R1…R10 · FW-DF-1/DF-2 (§6) | James's device round; an owner (History lead) | `draft/thinking-freeway.md` v0.3 §13/§14/§16 |
| AR-6 — approvals + prompts | Phase 0 paid (P0-H, 09-25); AG-1 shipped as AR-S1/AR-S2. Waits on AR6-D1…D9 (unindexed; re-verify §0's anchors at the pinned puppeteer). PU-15 rides it. A 1.0 exit | James rules AR6-D1…D9 | `thinking-ar-approvals-prompts.md` |
| AR-7 later slices · AR-S4e3 | AR-7f leak detector, AR-7h bash/fish, AR-7i prewarm (AR-7j is a beta blocker) · S4e3 options, Needs/Needed by, EX6/EX7, other profiles | an AR lane | `thinking-ar7-typed-agents.md` §5.6, `thinking-ar-agents-settings.md` |
| MV-8b ruling 8 | the transcript-provider migration: puppeteer 0.2.3 still ships adapter-claude's `observation/transcript/provider.ts` | its own track after MV | DECISIONS MV-8b, `docs/agent-plane/architecture.html` |
| MV · SB | third-party views (MV-D14) · SB-4, SB-6 (after DS); SB's M4/L7/M5/L8 RULED at the built leans (Q14); SB-5 was delivered by PJ-7 (PJ-7's own Q4) | the next MV slot | `design-mv.md`, `thinking-spawn-bloom.md` |
| CO | composing, characters, the Assistant view (DEFERRED 09-12, FV-D3/D8) · CO-D1…D16 unruled | AR's P0 exit witnessed | `thinking-four-views.md` §5–6, `draft/compose-plane/` |
| Desk Phase 6 | STRING (ports on objects, ICE's wires, the Wire tool DK-D29) · OBJECT KIT (panel, controls, screens, cables, `process`) · AGENT'S EYES (`canvas.read`/`canvas.render`, MCP canvas tools DK-D26; DT-5's control lane, the reserved `surface.control` scope) · UPLOAD PLANE + the mini-app bridge (SP-D9/SP-D7; UP v0.1 and MB v0.1 drafted 10-01; UP-D1…D8, MB-D1…D9 unruled; AH-D10's cross-device CAS rides it). It replaces the four dogfood packs (Q9); the microservice pack retires or becomes an OBJECT KIT `process` candidate | a thinking doc each; STRING first | `thinking-desk-migration.md`, `thinking-upload-plane.md`, `thinking-mini-app-bridge.md` |
| Mind map pack | waits for STRING; redesign from Paper & String (MD-1…MD-15); v3's MM-D1…D14 were cut for the pre-desk canvas, MM-D14 moot (DK-D30) | STRING's thinking doc | `draft/mindmap/`, `thinking-mindmap-pack.md`, `predesign-mindmap-evidence.md` |
| The bare mat's menu | "Paste here", "New note here": unbuilt | a desk lane | DESIGN.md §8, ICE design-015 §7 |
| PT — PORTALS | PT-S STOPPED by James 10-18 21:51Z (`portals/pt-s`: 4 PT-S1 commits, tip `85a21b86e`, plus uncommitted `plugins/simulator/` in the `pts` lane); the capture bake-off GO'd 10-19 20:13Z, unrun · then PT-C, PT-T (form ruled last, PT-D10) · James's 10-14 A2, B4, the 5 s wind tail, unbuilt | James on `draft/portals-maps/PT-S-vs-PHONE.md` §5's seven choices | `thinking-portals.md`, `draft/portals-maps/`, ICE design-019 |
| AH | AH-4's runtime on main since `cce684ce3` (08-03), unledgered by its own rule until review + witnesses · AH-1 two-client proof · AH-3 physical closeout · AH-5 the phone list · device-retirement GC | an owner; GC with TS's "forget a device" | `specs/artifact-hub.md` |
| PLUG | the KIT slice · third-party listing (P8e: TD registry + R2 process host; PA-24, §20.5, §21.8) · sideload · R2 `host:"process"` · PRC-6c2b and PRC-5's power loss (§6) · PRC residual policies (§14–§15) · per-section undo/⌘Z/timeline (D29′, P7) | first-party publishing; third-party plugins; a Settings history design | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md` |
| TP / TC | D6's cell half, C5, D5, the lineage break (§6) · TC RATIFIED as built (Q6: TC-D1/D2 as amended by WG-D1, D3, D15, L1c at TM-1); TC-S4…S8 (vault, broker, replay, drain-migrate, warm tiers) parked · TP-S4…S6 (S4's typeable mirror struck) | a TP lane · a ghosttea next-major or a P0 witness across a floor restart · measured demand | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md` |
| GT | G29 upstream (then GT-D22's file half) · GT-D22 (§5) · smoke row 13b: attach through DS-4e to a second staged desktop · no kill control in Godview (Q2): a session ends by the agent's quit, ⌘Q (AL-3) or reaping | G29's release · the two-desktop run | `specs/godview-terminal.md` |
| IOS | the rebuild and TestFlight (§5) · phone Settings ("Settings in a Pocket", 7 marks, page VCfkfxMp) · IOS-8f `user.me` · K-D5's ghosttea `customInputView` petition (unfiled) | James rebuilds; external TestFlight; TS-7 | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `apps/ios/TESTFLIGHT.md` |
| NF | COMPLETE; owed: item 52 (b)'s phone half (its routed ghosttea client) · headless floor-on-tailnet rows over TS-1's authKey path (`029af0e6f`) if wanted · native-floor §7 into the T posture | an NF lane | `specs/native-floor.md` |
| Native push (APNs) | SP-D8: the relay after AR-6; pairing is the account; README's `services/push-relay` row is deferred | AR-6 | `thinking-native-push.md`, design-06 L4 |
| LOG | LOG-39 (beta list) · LOG-V5 (rides Windows) · LOG-V8 retention (James's product call) · LOG-V7 optional | the beta checklist | `specs/logging-and-diagnostics.md` |
| SNAP | live checks (§5) · a still onto the desk as a `desk.photo` dragged from the tray → SNAP-2 under `surface.capture` → SNAP-4 (Windows round) · the perf review's leads | a SNAP lane | `thinking-screenshot-tool.md`, `draft/reviews/screenshot-performance-2026-09-24.md` |
| SD — sound | James's lab, a proposal only: round 2 "Deep Field" (10-02) over round 1; SD-D1…SD-D22 on its page. A Parked row by his ruling (Q27) | James picks it up | `draft/sound/design-sound.md` |
| WIN | WIN-5 visual · WIN-7 live mesh (`TRUFFLE_TEST_AUTHKEY` via TS-1's authKey) · WIN-8 = RM-4's Windows leg (Azure signing, EDP-39) · WIN-D6…D9 (James) · residue: the win32-gated concurrent-edit doc-sync rows (their skip text claims coverage behind `TRUFFLE_TEST_AUTHKEY`), group-kill → Job Objects, snapshot-prune EBUSY (`doc-service.ts`) · LSF §18's Windows rows (LSF-3/3C/6; the LSF-3C spike's re-run reads `draft/archive/executed/specs/live-surfaces-agent-browser-spike.md`), PRC-5's Windows filesystem, M11, predesign-03 §6's coexistence ask, SNAP-4 ride it · a pipe-name squatter makes field-native fail closed (deliberate) | a Windows leg on the release rails | `thinking-windows-port.md`, `docs/WINDOWS_PORT_STATUS.md` |

## 5 Owed by James — live surfaces only

**Rulings**
- BP-D9: a desk profile lives inside Electron's userData (lean a) — blocks R4 and the desk's sign-ins.
- AR6-D1…D9 (AR-6) · AR-D24…D35 (one batched ratification; Agent Profiles) · QL-D1…D10, QL-D12…D17 (built as
  QL-1/QL-2) · GT-D22 (adopted as built; the web-only narrowing above all).
- NF-D3/NF-D5's long-pending read, or record them as answered by the as-built code.
- MB-D1…D9 and UP-D1…D8 (proposal pages owed first, LANDED :7954) · SP-D4, D11, D12 · CO-D1…D16 at CO's re-entry.
- PT-S-vs-PHONE.md §5's seven choices, with the `pts` lane's uncommitted work kept or dropped · WIN-D6…D9 · LOG-V8.
- DK's parked build rulings ((17)/(53), (48), (83), (92), (95), (97); DECISIONS DK addenda). (86) is answered by Q18
  and D22's "packaged built-ins" by WP8 (`5e7507d6c`); both leave the list.

**Witnesses (his hands, his devices)**
- AL-9's ten chord rows (row 1 first: a physical ⌘Q over a focused pane brings up the census box and sends no
  `deck_changed`; a miss on ⌘H or ⌘M puts that chord on D15's list) · the quit gate's two rows the 10-27 acceptance run
  left (Dock → Quit; a logout with a session open; LANDED §AL-7 "The quit gate's acceptance run") · the notice after a
  `kill -9` of a packaged build's shell and of its fieldd.
- Mesh (board `rm-c-witnesses`, the one home): the two-desktop run with the Tailscale app QUIT, in one sitting with the
  DK fleet's eleven two-Mac steps (`docs/desk-gates.md` "The two-desktop check"; they decide (20)'s stamp wait and
  (95)'s drag strip) and AH-1's real HTTP/HTTPS Proxy and Folder URLs from another device · the signed-in phone reaching
  a published nightly by itself, and a terminal tap · the phone across a fieldd restart on hardware (TP-R21's re-mint).
- UA, a 1.0 gate (board `rm-ua-witness`): the second-account witness on the PHONE (the desktop plane PAID 09-21, LANDED
  §UA-P-4d witness; the S1 live probe PAID 10-20) · the switch kill-matrix row (a live session survives
  switch-away-and-back) · the user switcher and the new first-run wizard (TS/AO) in both themes.
- TS: TS-2's photographs and desk rows · renew's live half (a key expired in the admin console) · TS-5's real notice
  on the desk · TS-8a on a real tailnet (no connection to log.tailscale.com while uploads are off; a tailnet with flow
  logs; Disconnect leaving the admin console; Tailnet Lock signed) · a phone run on the new TailscaleKit (with TS-7).
- Item 78's two-pairs-both-logging row on the mini · item 79's promotion row (his device identity) · F1's device round.
- The phone: rebuild from main (truffle Swift 0.7.23, ghosttea 0.13.7; until then a restarted desktop needs a phone
  relaunch) → TestFlight build 4 → the device checks: shader compile at first launch, 7 pt type, VoiceOver per body,
  the tab bar as an obstacle, the reconnect banner across a fieldd bounce, the attached-but-unlisted card, an overload
  refusal said in the connecting face, C1's swipe after a reopen (and PJ-7 run 3's n/a cases, if 10-19's round missed
  them).
- AR-7: his daily dogfood · AR7-D2's 8 s kit wait, measured on a pair bounce.

**Eyeballs (both themes)**
- The update card on the current nightly (Settings › General, WP12d L3c-ii).
- History by project (PJ-4 phase B): the list's order and folds, a row's marks, "n live".
- Settings → Plugins (object rows since DK-8 `244263f8c`): enable, disable, update, a faulted plugin's state.
- Settings → Devices → Network details' sync rows and the head's name-pill sync dot (C6-4); could join TS's photographs.
- Artifacts: the list and the Proxy/Folder picker, add and open flows (AH-3), reduced motion included.
- The UI catalog (`pnpm dev:design`): light/dark, keyboard focus, reduced motion, narrow.
- The deck's effects over a live pane (GT-7's Settings → Terminal → Look; CRT, VHS, Sparks over glass v2, GT-D19's
  stack): Animate effects only where it means something; licences visible.
- Godview round 3 on a real window: the lights' move, a real fling, launch's first call, ⌘W on the last pane (re-read
  after AL-9), other heights. Fold into QA wave 1 if the plan covers it.

**Releases, edits and chores**
- Releases: puppeteer 0.3.0 PUBLISHED 10-28 08:19Z and pinned (`1469639a6`, with QW1 stack B) · a later puppeteer
  release (0.3.x or 0.4.0) for AO-7's `installRecipe`, item 50's env seam, item 39 and the tuck (push and merge
  `vf/item-39`, `vf/after-a` first) · mille's first
  npm release · rosettad as a release asset (RD-D7) · RD-4's pipelines (who runs them is open, §9).
- The Mac mini (Q24): full Xcode 26 there is DEFERRED (James, 2026-10-28 08:46Z: "not able to install xcode on mini
  right now, please run those test on this mac instead"), so row 30 (`smoke:update`), the one gate row that needs it,
  runs on James's Mac. Claude lists the mini's leftovers, read-only, for his hand (`/tmp/vf-smoke-*`, `~/vf-lanes`
  and its `pb`, `tp` and `el8gt*` trees). Agents delete nothing.
- The npm token that leaked 10-26 is NOT rotated yet (Q26): a board reminder through VF-PM until he rotates it.
- DESIGN.md §1.1 (his edit): Godview's visual source is puppeteer's Godview, not `p008/chopsticks/apps/godview`; drop
  "honest mock label" (the mock left at AR-3). Text in `thinking-ar-views-port.md` §9, refreshed for GV-D1 and the
  `@vibefield` scope.
- Apply the mille-git spec erratum v2 (N8 (a); `draft/files-service/mille-git-spec-erratum.patch`; `../mille`'s spec
  still hashes `7730f54a…`, no Erratum lines).
- N9 (a): `rm -rf plugins/note plugins/field-tools examples/plugins/widgetlab` (untracked `dist/`, `node_modules/` only).
- The trust-root v2 signing before 2027-04-19 (§6 release rails).

## 6 Open debts (one line each; source)

**Release rails**
- BP R3: the pane says a permission refusal; Clear browsing data empties the desk profile's cookies (smoke:canvas, the mini) — LANDED "BP-1".
- BP R4 = BP-D7: row 31 `smoke:profile` on the signed package, RED until BP-D9's fix (J4 done) — LANDED "BP-1b".
- Desk sign-ins are lost at restart in dev and every smoke (`session.fromPath` outside userData) — LANDED "BP-1b"; closes with BP-D9.
- D11's signing-only measurement; W11's PTY clause rides it — `build-wp12-updater.md` :365.
- The freeway host's live witness in a package (round 3) — LANDED "FW (packaging) — the freeway host ships in the package".
- Re-sign trust-root v1 before 2027-04-19T20:52:49Z: James signs v2 (`trust-keygen assemble … --previous <v1>`, `sign`); a lane embeds it as a ROTATION; the re-sign procedure folds into `specs/trust-and-distribution.md` (or the P9 runbook) before its hand-off archives — LANDED "TD-1"; `specs/trust-and-distribution.md` §2.
- Two electron-shell unit tests download Electron's binary through their imports — LANDED "CI — Electron's binary is fetched and proven before any test".
- A guard that every `link:` row resolves before `pnpm build`, unless preflight's refusal covers it; retires with mille's release — LANDED "The Rust toolchain is pinned".
- `smoke:update` raises a keychain dialog with a person present (use a run keychain; the fixer's item). Row 30 runs on James's Mac, since the mini's Xcode is deferred (Q24, §5); until the run keychain is built, he cancels each run's dialog (never Reset, never a password).
- `cargo audit` runs report-first (`audit.yml`, `continue-on-error`); chacha20 is YANKED in Cargo.lock (run 40590297837); harden it after chacha20 moves (Q28, §3 item 7).
- Shipped Rust daemons inherit `allow-jit`; shipped binaries embed `~/.cargo/registry` paths; `package-census --assert --strict` red on MV's chunks (run it once, then update the manifest or drop the row) — `build-hf.md` M3–M5.

**AL and the dev runner**
- The dev runner's SIGTERM teardown dies before `stopDaemons` under `pnpm dev` (three times 10-17); read why, fix at the cause — `draft/handover/2026-10-17-focus-audit.md`.
- After an unclean exit, a pair adopted across a shell-only change keeps its floor, loses its cells to the start-up reaper, and the floor starts its host again — LANDED "TC-S2 + GT-2d".

**Agent plane (AR · AO · MV · Godview)**
- Item 50: agent probes inherit fieldd's env (EL7); one puppeteer seam (`BuiltinProviderOptions.env`, abort on stop) also ends fieldd's agent-inventory probes outliving its stop (QW1 stack A's `4c54f20c7` covers an adapter's helper once the pinned puppeteer asks) — DK-18 follow-up (a).
- COLORFGBG: ghosttea writes it into every session, an agent's included; EL7 accepted ghosttea's value 10-23 — decide whether an agent's value is VibeField's own.
- Item 60's doors: James's veto on the phone's bounded reply; whether `project.figures` says a count beside `clipped`; the phone's "N more" for `omitted`; a revisioned delta past a page (measure first) — LANDED "AR/SP — item 60's three doors".
- AR-S4e2's probes: each install form's first real run on a throwaway profile; a >512-char Claude inventory id — LANDED "AR-S4e2".
- AR-7 §11's three puppeteer petitions, "none filed yet": file or drop with a dated note — `thinking-ar7-typed-agents.md` §11.
- `s3eInstrumentDebt` (`smoke.ts:7772`): does keystroke-echo move onto the routed path, and is the flip-witness still meaningful for panes born keep-until-exit? The perf lab no longer throws (`2cb776f27`) — Godview owner.
- Godview smoke reload rows still wait on `CANVAS_READY` for 60 s (`smoke.ts:7992`, `:10079`); wait on `DESK_READY` (`smoke.ts:999`); no red since August — low.
- The perf lab leaves its fieldd data root (`/tmp/vf-smoke-*`); `teardownLab` should call `removeSmokeRoot` — DK-18 follow-up (c).
- MV's owed: the squeeze gate's test fixes at their cause (items 45, 47, 48, the cd row's harness note) and `docs/desk-gates.md`'s arming rule; the after-MV list — LANDED §MV "Known, not fixed", §SWF.
- RA-D6's own item; AGENT_PLANE.md gains entries for `thinking-ar-reattach.md` and `thinking-agent-onboarding.md` — `thinking-ar-reattach.md` §6.

**History (AR-8)**
- R8/R9 are built upstream and not passed: `projectStatsBatch` and the repository address — build-hf §5.
- P2's measurements, on the mini: the paired `perf:godview --source-a model` (M40), a paired capture against pre-P2, the blur-18 scrim's CDP trace — LANDED §AR-8 P2.
- The live peek's ground uses the token default, not the viewer's terminal appearance (`LivePeekPane.tsx`) — LANDED §AR-8 P2.
- M21: run `smoke:godview` again with `FIELDD_ROSETTAD_BIN` unset at any landing that touches the past door; move the rule into `docs/desk-gates.md`.
- The debts lane's remnants, each re-checked first: which callers pass a timeout; field-native's flush behind its backoff; rosettad's signal handler armed after it announces (a rosetta petition) — LANDED "Debts, fourth/fifth part".
- History's word: `packages/field-app/src/history/session-port.ts:125` still says "This desktop has the direct plane switched off — …"; `thisDeviceWord` is on main (`packages/field-app/src/account/link.ts:200`, AO-6a), so this is one small History commit, its test `packages/field-app/test/history-doors.test.ts:1104` — VF-PM's 10-27 13:47Z docket.

**Terminal (TP · GT · TM)**
- D6's cell half: wire.rs `InputOp::PastePart`, per-activation reassembly/discard, audit lines, `CELL_CAPABILITIES += "paste-parts"`, a cell-wide bound, a wire.rs fixtures row — LANDED §TM (D6).
- D6's ghosttea-react seam: `encodeInput` returns an ordered list sent all-or-none, with the leg's accepted capabilities (a petition row) — focus audit §5.
- TPv3 §5.4's SendInput paste-part row; the capability spec gains `geometry-events` (item 42, `7954ddbe8`) and `paste-parts` (`18d91aac0`) — a commit-draft turn.
- C5 is VibeField's own: field-app adds `InputRefused` to `HOST_VERBS`, surfaces it, then advertises `input-refusals`; a runtime witness first — LANDED "TP — the terminal pump lane".
- D5 (ghosttea-react): ask for the renewal before the margin; close input locally only at it (a petition row) — same entry.
- The draft a refused send cleared (the kit, audit §2 C-input) · no way back from a lineage break (no reseed door; `requestReseed` is local) — LANDED §TP-S3d.
- STALE_ROUTE raised by custody (TC-S6) · the wall-100 rAF zero-frames reading · divider drag ≈52 Hz (re-measure on 0.13.7) — TP standing debts.
- Item 61: the theme browser pages its catalog; then the UI turn for ghosttea's own keys in Settings → Terminal — the EL8 to 0.13.7's owed.
- Shaders on the Canvas2D fallback: GT-7's Look chips show an honest UNAVAILABLE when the window's backend is Canvas2D — GT-3f.
- The desk readout's GPU memory says MB for a count in 1024s (`DeskReadout.tsx`; DESIGN.md §9's known deviation, 2026-10-18).
- F-C6-21, the audit-integration flake (`audit-integration.test.ts:112`, narrowed 08-10); F-C6-1/F-C6-22 if they bite (F-C6-4 probably closed by item 79's mechanism 1 (`5d0cc20d1`); confirm, then correct thinking-c6-meshdata :135 and DECISIONS) — `thinking-c6-meshdata.md` §7.
- `GodviewDeck.tsx:2327`'s "Browse sessions" comment: under the routed runtime the remote banner never renders, and "G13" is the env-strip petition — correct at source; the browse-handler candidate stays (§7).

**Mesh and DS**
- `DeviceSlice.restart` and `doorWords`' restarting arm — the C row's owed.
- C3's in-boot half: a placed serve's changed spec is adopted while the old gate runs (`mesh-client.ts` reconcile); live since UA-P-0; callers remove-then-add; the restart half fixed at P0-S `1a44b141`.
- Which tailnet grants a serve should accept — the mesh owner's question (or TS-6/TS-9's, if TS owns grants).
- DS wave 2's residue: the egress-route sweep after a superseded daemon; `FORWARDED_MINTS` vs the keyed-forward set; DS-6b's `page`/`pages` not in `rows.ts`, design-06 §5's `catalog.db` vs per-table JSON, project-family's case and port, a consumer throw inside live frame routing (the unjournaled self-served keyed call is accepted, Q29) — `draft/work/ds-wave2-2026-10-01.md`.
- FW-DF-2: PeerLink never pings; the fallback (a FielddClient `onTick` beat, retired at FD1) has triggered · FW-DF-1: one `devices.desktopPeers()` predicate, unbuilt — `thinking-freeway.md` §16.
- IL O2's consumers: stale words in DESIGN.md, the kit's `doorWords` stale case, field-app's re-ask on stale → fresh — `thinking-inventory-latency.md`.
- `STORES.AGENT_FIELD` and its shapes stay "never a new reader or writer" (`registries.ts:150-160`); their deletion rides DS.

**PORTALS (parked track's debts)** — `thinking-portals.md` §4
- `smoke:studio` reds when its window is covered: give Studio's acceptance window DK-11's frames.
- The SLEEP row's judge (M1, L1, L2, L3) · B5 the still sweep · R5 a refusal's load stamp · V7 a failed page re-asked · pressable shadow-hosted frames (V2–V5).
- IDLE counts ICE's HoldPass and mat submits outside `perf().frames`: settle on ICE's idle, or ICE reports its hold pass (harness + ICE owners).
- NO-DOCUMENT's ↻ missed its new window once (smoke:canvas, 10-26) · a typed address may not draw while typed (PLAUSIBLE) · M18: host clicks miss by ≤4 CSS px (measure).
- Two stated limits (James, 2026-10-12) move into §4 as law (§6 Records): a mouse press into a frame at a page scale past 1 rests on units alone; typing into a frame of another site is refused and counted.

**Desk, UI and design**
- With no desk, B and the line's ⊕ still flip the Objects surface — DK-18 follow-up (b).
- InlineNotice's attention/error tones to DESIGN.md §2.5's inks (a design-kit slice) — WP12 L3c-ii.
- `prefers-reduced-transparency`: a DESIGN.md stance first (`440b04e`'s proposal: glass falls back to the §5 tint), for the cover glass (FC-D13/D16) and the deck's glass v2 (GT-D19), then tokens.css.

**Files, phone, accounts**
- EACCES is not yet honest words (the files service) — `build-hf.md` M3–M5.
- AP-D7's protocol cause (low) — `thinking-ios-account.md`. (`costRatePerMin` on the desk row is §3 item 6, Q13.)
- UA-P-6: fold UA-P-D1…D8 into a governing spec (`specs/users-and-accounts.md` names none) — `thinking-ua-phone-account.md` §7 UA-P-6.

**Plugins**
- PRC-6c2b: run 1 (08-18/19, 1,535 samples (cycles 0–1534)) ended `verdict: fail`, `claimSatisfied: false` (`draft/plugin-runtime-spike/evidence-runs/plugin-runtime-soak-2026-08-18T07-11-50-175Z.jsonl`: an unexplained log drop from cycle 1109, a 61-minute gap at 1121). Root-caused first (Q8), then re-baselined on the desk (DK-9's kinds), then run 2 on the mini; it gates a release only if a release cites plugin-architecture §24.6.
- PRC-5's literal power-loss witness (the Windows filesystem half parks with WIN) — `thinking-prc5-update-coordinator.md` :789.
- ICE declarations are not strict-NodeNext portable (still 0.16.0); matters only if the KIT slice's out-of-tree typecheck admits NodeNext — petitions README I18.

**Gates (to the fixer's docket, each re-checked)**
- `pnpm siblings:pin` writes a lock layout biome refuses · a fresh-lane smoke exits 1 in 22 s with no reason line · the smoke shot directory is shared by every lane · `capture:godview` timed out once in four.
- The sibling 5 s waits need a read now that item 77 placed its own: AttachmentOverTheDoorTests :618 and :352, AttachLogTests :203, LanesOverTheDoorTests :262 (`apps/ios/VibeFieldKit/Tests/FieldTerminalTests/`) — item 77's review.

**Records — at-source corrections still owed after the 2026-10-28 housekeeping pass (commit-draft turns through VF-PM)**
- Done by this pass and not repeated here: the archive moves and their reference rewrites (`draft/archive/INDEX.md`); the rulings' folds, the DECISIONS flips, the design docs' Status blocks, the specs' and thinking docs' dated notes and Status headers, the root docs, DESIGN.md's Q18 signatures and desk sweep, and the petitions restructure (DECISIONS' HK row). Of these, petitions M4/M5 are corrected, Open until mille releases; D16 is retired (DECISIONS D11–D16); T7's route-name pinning is T13 (Q22).
- thinking-portals §4 gains PT's two stated limits as law (§6 PORTALS); the ROADMAP no longer carries them.
- The LIVE drafts take their lines only after their owners release them: `specs/godview-terminal.md` §1, the QA plan and its rulings, ar-reattach, release-deps, build-mv, thinking-ios-app and thinking-ios-keyboard, with `refs.held.tsv`'s four references to moved paths (`draft/archive/INDEX.md`).
- The design-00…04 D1–D4 body fold-back (chopsticks/spaghetti → puppeteer/rosetta); this pass added amendment blocks and stale notes only.
- design-03's body fold of TPv3 rollout §13's deltas (the cell-to-render-worker row, §4.7's PF6 erratum, §4.6's hop count, the CSP note); this pass added notes only.
- `specs/terminal-custody.md` §5: TP-D23's cell-side fairness (TPv3 rollout §13).
- F-C6-4 probably closed by item 79's mechanism 1 (`5d0cc20d1`); confirm, then correct thinking-c6-meshdata :135 and DECISIONS.
- SNAP's DECISIONS status (the audit's item 18), only after `codesign -dv` on a nightly's zip shows a Developer ID-signed `field-screenshot-helper.app`.
- DECISIONS rows not yet written (the audit's appendix B), each after its owner's status read: RL2…RL8, K-D1…K-D6, AR6-D1…D9, CO-D.
- G27's own file (`draft/petitions/G27-ghosttea-kit-routed-terminal-client.md`) still says "Filed 2026-09-14": a dated correction at its source.
- LANDED's dated corrections: the EL8 to ghosttea 0.13.7 entry's "FieldTerminalTests' 60 s red is a fixed set of 17", corrected or confirmed now that item 77b measured the 60 s block (§2 Fixer).
- `.github/workflows/verify.yml`'s step name still says "Build rosettad and the Ghosttea renderer from their pinned siblings".
- DESIGN.md's own owed lines: the catalog's replica specimens (the catalog slice: it mounts the shipping view) and §8's uninstall words, doc first.
- Code comments (code lanes): `GodviewDeck.tsx:2327` (re-locate the audit's second line, cited as :2360 at the audit's base) · `terminal-pool.ts:620` (0.13.7, no `prepare()`) · `smoke.ts:9213` (DS-4e's path) · `lab-switches.ts:22` · `plugin-sdk/src/canvas.ts:5-7` · `window-policy.ts:15` · `build-widget.ts:7` · `HomeScreen.swift:20-22` · `TESTFLIGHT.md:212`.

## 7 Upstream and pins

| Plane | Pin (the manifests) | Note |
|---|---|---|
| truffle | `truffle-core = "=0.7.24"` (Cargo.toml) + the five npm sidecars 0.7.24 (protocol 11) · Swift exact 0.7.23 (Package.swift's `truffleRelease`; lock `release.swift`) | the split, DECISIONS TB (a), `af3f3078f`; Swift rejoins at the first ghosttea declaring 0.7.24 |
| ghosttea | 0.13.7 on cargo (`=0.13.7`), npm and Swift | `5ba36785b`; no checkout needed; `../ghosttea-0.11.2` is only the overlay's coordinate |
| ICE | `@vibecook/ice` 0.16.0 exact (overrides row) · strata 0.13.0 via ICE · `loro-crdt` ^1.13.8, one resolution | EL8 |
| puppeteer | `@vibefield/puppeteer-*` 0.3.0 exact (tag v0.3.0 = `d0aa1224`) | the EL8 `1469639a6` (10-28; RD-5a-2 `a04850e29` took it exact at 0.2.3); `../puppeteer` is the overlay's coordinate |
| rosetta | `@vibefield/rosetta-protocol` / `-room` 0.1.1 exact · rosettad built from `../rosetta-pin` at `4348545` | RD-5a `fe01ac797`; RD-D7 (no release asset) |
| mille | `link:../mille-pin` at `c8160d5` (`@vibecook/mille`, `mille-ui`) | FS-1b; no release past v0.3.4; exit RD-6 |
| rustc | 1.99.1 (`rust-toolchain.toml`) | EL8 |

Petition status lives in `draft/petitions/README.md`. Still open or owed there:
- **ghosttea:** G29 (the link hook names its session; drafted; gates GT-D22's file half) · candidates to file: D6's
  `encodeInput` seam, D5's renewal, browse-handler injection (absent at 0.13.7), a real `prepare()` (the first-frame
  half MET by `session-drawn`, 09-29), whether `paste()`/`sendKey()`/`sendText()` say they sent, the "last pane
  closed" hook (AL), K-D5's `customInputView` · G27 parked (a second Swift consumer).
- **truffle:** T8 (the app-chosen hostname prefix; TS-8c, probe first) · T12 (a typed start refusal; held; a PR when
  James says) · T13, the one T row for T7's route-name pinning (Q22; owed, not drafted); T7's other follow-ups (the per-direction idle reap, a held
  route id's refusal, loopback pages) are recorded as accepted.
- **rosetta:** RO-8 (retire/forget a runtime; RO-27 depends on it) · RO-11 (with DS-7) · RO-17…RO-23 · RO-24…RO-28
  filed as #23–#27 (AO-8) · RO-10's follow-ups need a row · RO-4's remainder is RD-D7.
- **puppeteer:** 0.3.0 PUBLISHED and pinned 10-28 (`1469639a6`) · a later release for AO-7's `installRecipe`,
  item 50's env seam, item 39 and the tuck · PU-12 (verify first) · PU-19 filed as #47 (AO-8) · PU-15
  (with AR-6).
- **mille:** M11 (with WIN). **ICE:** I47, I48 (named, parked) · the remount edge (a pointer `leave` with no point; a
  candidate if presence UX needs it) · NodeNext portability. **strata:** S3/S4's residue (parked: a measured join or
  reload wall on a real desk document).

## 8 Tracks

| Track | State | Law lives in | Next |
|---|---|---|---|
| TS — the Tailscale door | ACTIVE; TS-0…3b, 5, 8a, 8b landed | `thinking-tailscale-onboarding.md`; DESIGN.md §6/§8/§9/§13 | TS-4 |
| AO — Bring Your Agents | ACTIVE; AO-0…6b3 landed | `thinking-agent-onboarding.md` | AO-7 on a puppeteer release after 0.3.0 (`installRecipe`) |
| AL — app lifecycle | ACTIVE; AL-1…3, 5, 7, 8a, 9 landed | `thinking-app-lifecycle.md`; ESR §7.3 | AL-6, Last exit, relaunch cap |
| QW1 — Godview swarm QA, fix wave 1 | ACTIVE; stacks A and B landed 10-28, B on puppeteer 0.3.0's EL8 pin | `godview-swarm-qa-plan.md`; `thinking-ar-reattach.md` | QA wave 1 |
| Release rails (EDP/ESP, WP12, TD, BP, RD, RM) | ACTIVE; nightlies live, W10/W11 passed | the release specs; `thinking-browser-profile.md`, `thinking-release-deps.md`, `thinking-release-management.md` | round 3; the first-beta list |
| EL8 — pins | ACTIVE (watch) | DECISIONS TB; the manifests | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); Swift rejoin; mille's release |
| AR — agent runtime | PARKED; AR-3…AR-5b, AR-7, AR-S1…S4e2, AR-S5 landed | `thinking-ar-agent-plane.md`, `thinking-ar-data-topology.md`, `thinking-ar7-typed-agents.md`, `thinking-ar-agents-settings.md` | AR-6 on AR6-D; AR-7j for the beta |
| MV — monitor views | PARKED; landed 10-08 | `draft/monitor-view-sdk/design-mv.md`; DESIGN.md §8 | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); item 39 and the tuck wait on a later release; QL ratifications |
| History (AR-8) / PJ | PARKED; PJ-1…4, 6, 7 landed | `build-hf.md`, `thinking-ar-history-room.md`, `thinking-project-places.md` | R8/R9; B-D4/B-D5; PJ-5 re-judged; PJ-8 after DS-7 |
| DS / SP — sync planes (was C — mesh) | PARKED; waves 1–3 landed | design-04, `design-06-sync-planes.md`, `thinking-desktop-sync-plane.md`, `thinking-sync-planes.md`, `thinking-c6-meshdata.md` | DS-7 with an owner + the two-desktop run |
| FW — the freeway | PARKED; F1 landed 10-20, packaging 10-27 | `thinking-freeway.md` | James's device round; FD1/FD2's owner |
| FS — files service | PARKED; FS-1a/1b/2 landed | `thinking-files-service.md`, `build-fs.md` | FS-3 on the desk; mille's release |
| PT — PORTALS | PARKED; browser landed 10-14; PT-S stopped | `thinking-portals.md`, `draft/portals-maps/`, ICE design-019, LSF spec | James on PT-S's choices |
| Desk Phase 6 | PARKED; replaces the four dogfood packs (Q9) | `thinking-desk-migration.md` | STRING's thinking doc |
| DK — the desk migration | COMPLETE; landed 10-09 | `thinking-desk-migration.md`, `thinking-the-desk.md`, ICE design-015…018, `docs/desk-gates.md` | James's parked build rulings |
| GT — Godview terminal | PARKED; the deck's ladder done (GT-0…GT-8) | `specs/godview-terminal.md` | G29; GT-D22; row 13b |
| TP / TC — terminal pipeline and custody | PARKED; TC RATIFIED 10-28 (Q6) | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md`, `thinking-terminal-mesh-cells.md`, `thinking-floor-wedge.md`, `thinking-inventory-latency.md` | D6's cell half |
| AH — Artifact Hub | PARKED; AH-1…3 landed, AH-4 unledgered | `specs/artifact-hub.md` | an owner: AH-4's review + witnesses |
| PLUG — plugins (P0–P8, PRC) | PARKED; PRC-4/5 complete | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md`, `thinking-prc6*.md` | PRC-6c2b root cause; first-party publishing |
| IOS — companion | PARKED | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `thinking-ios-account.md`, `thinking-ios-history.md`, `apps/ios/TESTFLIGHT.md` | the rebuild; TestFlight build 4 |
| UA — users and accounts | COMPLETE except witnesses | `specs/users-and-accounts.md`, `thinking-ua-phone-account.md` | the phone's second-account witness |
| NF — native floor | COMPLETE; one owed line | `specs/native-floor.md` | item 52 (b)'s phone half |
| LOG — logging and audit | PARKED; item 78 landed | `specs/logging-and-diagnostics.md` | LOG-39 for the beta |
| UI — design system | COMPLETE; owed slices | `DESIGN.md`, `docs/UI_SYSTEM.md` | the Fieldmarks retirement (Q19); InlineNotice tones; the desk sweep |
| SNAP — screenshot tool | PARKED; SNAP-0/1/1a/3/3a/3b landed | `thinking-screenshot-tool.md`, `draft/composer/build-edge-trays.md` | live checks; the still as `desk.photo` |
| SD — sound | PARKED (James's lab, Q27) | `draft/sound/design-sound.md` | James's call |
| WIN — Windows port | PARKED since 08-24 (`c16e618f4`) | `thinking-windows-port.md`, `docs/WINDOWS_PORT_STATUS.md` | a Windows leg on the rails |
| LSF — live surfaces foundation | COMPLETE; LSF-4 landed 10-26 | `specs/live-surfaces-foundation.md` | consumed by PT; §18 Windows rows with WIN |
| CO — composing | PARKED (deferred 09-12) | `thinking-four-views.md` §5–6, `draft/compose-plane/` | AR's P0 exit |
| A — shell and spine | COMPLETE | design-03, `specs/electron-shell-refactor.md` | Settings on demand (Q20, §3 item 6) |

**Retired and superseded tracks**

| Track | Ruling | Replaced by | Archive pointer |
|---|---|---|---|
| B — canvas and docs | DK-D11 (2026-10-02/03) | the desk; LANDED §B1–B4 | design-03 / 03·A carry the desk's Status amendment (2026-10-28); their body folds are §6 Records' |
| D — widgetlab port | DK-8 `91bda4f6`, DK-17 | desk object kinds | `draft/archive/retired/thinking-widgetlab-port.md`; board `rm-d` |
| DT — dev tool pack | DK-D19/D20 | PORTALS (PT-D1), PT-S/PT-C, AGENT'S EYES | `thinking-devtools-pack.md` stays law for DT-D2/D3/D4/D6/D7 |
| The terminal mirror widget (TP-S2b) | DK-D19 (DK-5/DK-17) | PT-T | LANDED §TP-S2b-widget |
| The browser page widget (BW) | DK-D20 | `vibefield.browser-pane` (PT-D1) | `draft/archive/superseded/thinking-browser-widget.md` |
| chopsticks / spaghetti | the 09-04 pivot (D1–D4) | puppeteer / rosetta | `draft/archive/superseded/predesign-04-agent-data-runtime.md`; petitions C1/C5/C7 in `draft/archive/retired/petitions/` |
| The ECS door (W2a–W2d) | James 08-14, "go with defineBehavior" | ICE design-009, BF-D1…D20, PRC-4d/e | `draft/archive/superseded/thinking-plugin-ecs-door.md` |
| The mock agent fleet, GT-3m swarm, GT-3p DOM bubble, the shadow pass | AR-5 `fe6b3d0a`; IOS-4b `5a46c163e` | `@vibefield/puppeteer-views`; the phone's mock DEBUG-only | LANDED §AR-5 |
| AG-1 — the Agents settings section | delivered as AR-S1/AR-S2 | AR-S*, AO-7 (installs) | LANDED §AR-S1, §AR-S2 |
| AL-8b — the LaunchAgent | AL-D10 "A" (10-27) | AL-8a, AL-6 (no LaunchAgent) | `thinking-app-lifecycle.md` §8.3 keeps its shape |
| NF-8 | UA-P-D1 (09-15) | the posture derives from the link | DECISIONS UA-P |
| Four rooms / the composer bar | FV-D7; One Frame FC-D1…D18 | the views, One Frame | `draft/archive/superseded/four-views/`, `draft/archive/superseded/composer/design-composer.md` |
| Widget card chrome | DK-D23; MC-D1…D11 | the mat's chrome | `draft/archive/superseded/card-redesign/` |
| Unified Live Surfaces design | LSF v0.9 | the LSF spec + `thinking-portals.md` | `thinking-vibefield-live-surfaces-technical-design.md` stays while it is a live PT-S input |
| The magnet grid; the Wormhole lab | DK-17's retire table; James 10-25, and his archive ruling (Q27) | the desk; `vf-splash` | `draft/archive/retired/magnet-grid/`, `draft/archive/superseded/wormhole/` |
| The four dogfood packs | Q9 (James, 2026-10-28) | Desk Phase 6 | `draft/archive/superseded/thinking-prod-dogfood-packs.md` |
| The device facet in puppeteer (PU-17's puppeteer half) | Q17 B (dropped; `feat/device-dimension` kept locally, not deleted) | VibeField's DS-3 filter (`6e62011e9`) | DECISIONS' HK row |
| Fieldmarks and Face Club (DESIGN.md §11/§11.1) | Q19 C (retired) | the plain mark (`b51154f91`); DESIGN.md §13's glyphs | `draft/archive/retired/design-fieldmarks/`; the code slice is §3 item 6 |
| James's labs: AV avatars, identity, logo studio, mark, research, system atlas | Q27 (archive each) | CO (avatars); the plain mark and `vf-splash` (identity, logo studio, mark); the desk (system atlas) | `draft/archive/retired/agent-avatars/`, `draft/archive/superseded/identity/`, `draft/archive/retired/logo-studio/`, `draft/archive/superseded/mark/`, `draft/archive/evidence/research/`, `draft/archive/superseded/system-atlas/` |
| The LSF-3C agent-browser spike | Q12 (executed) | LSF §17 and DECISIONS hold its law | `draft/archive/executed/specs/live-surfaces-agent-browser-spike.md` |

## 9 Open questions for James (one line each; the lean)

James ruled the housekeeping page's forty questions on 2026-10-28 (R1, A1, Q1…Q29, the labs). They are recorded in
DECISIONS' HK row and `draft/thinking-housekeeping-2026-10-27.md`, and folded above. Q23's two follow-ups, compact.md's
D-1 and D-10, he ruled A the same morning (DECISIONS' compact row). What stays open:

1. **`draft/work/`** (the plans of record for DS waves 1–3, all landed): never asked. Lean (the archive ledger's):
   keep it in place; archive only with its 14 living pointers rewritten and its two Status headers flipped first.
2. **Who runs RD-4's pipelines** (`draft/handover/2026-10-15-rd4-james-pipelines.md`). No lean.
