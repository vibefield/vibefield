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
  the build front is the first run, so someone other than James can install it: **TS, AO, AL**, and since 10-29
  **FG**, the first run on the website's field. The engineering bar
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
- **The live program.** §2: TS, AO, FG, AL, **AU (updates that wait)**, **PG (the phone's Godview)**, **HN (Cards in
  Hand: the line, the hand, Artifacts in the head)**, QW1 (the Godview swarm's fix wave 1), PT-S (PORTALS' phone,
  resumed 10-29), **CO (the compose plane: sparks and the tool plane, re-entered 10-28)**, the release rails, the EL8
  watch, the fixer, upstream. The first-beta blockers are §3 item 7. Everything valid but unscheduled is §4.

## 2 Now — the active tracks

**TS — the Tailscale door** · vibe-field-d0 · law `draft/thinking-tailscale-onboarding.md` §10, DESIGN.md §5/§6/§8/§9/§13
- Landed 10-27: TS-0, 1, 2, 3a (+ erratum `067d4895c`), 3b, 5, 8a (`d48e131fc`, the floor's facts on truffle 0.7.24),
  8b (`adf3d972f`, the faces and James's words). T9–T11 consumed with truffle 0.7.24.
- Landed 10-29: TS-4a (`776eae4d3`, asking again: the status item's Connect Your Devices…, the filters' ghost rows,
  the away notice and the one switch), TS-4b (`257af5f6f`, the approval line on the claims strip, behind the limit
  moment) and TS-6 (`26b331dbc`, landed as the merge `14c74f980`: the sync question at the first new field; setup's
  posture pane retired).
- Landed 10-30: TS-7 (`59d0ada65`, landed as the merge `648719bb2`, the mini's run 4: the phone's door, the code from
  the Mac, and the door's scrim, TS-D22 A).
- Next: TS-8c (T8, after its live probe) → TS-9. The slice names are the doc's: the board's "TS-6" was TS-8a.
- James ruled TS-D19, TS-D20b and TS-D21 A (10-29 03:57:49Z). Owed: the approval line while Godview is closed (TS-4c
  or a later rung); Publish's nudge, until a Publish offers where to open; the switch's words (drafts); a field made
  while the sync question is owed by a path other than New field follows the posture (TS-6's finding).
- James ruled TS-7's Q1 (all six A) and Q2 A (10-29 05:29Z) and TS-D22 A (10:51:56Z). Owed from TS-7: Q2's later half
  (the store link, once a public install link exists); the five truffle Swift petitions (ids after T13, at the next
  draft queue); item 103's witness (`dc0f1dce0`, the kit's `:262` race).
- Owed on James's display word: §5 (TS-2's photographs and desk rows, renew's live half, TS-5's real notice, TS-8a's
  live tailnet rows, TS-4a's rows and away notice, TS-4b's approval line, TS-7's phone rows at the build-4 sitting).
  `specs/users-and-accounts.md` §6/§7 owes TS's fold (the housekeeping pass added its first dated notes there).

**AO — Bring Your Agents** · vibe-field-de · law `draft/thinking-agent-onboarding.md` §8 (page sources `draft/agent-onboarding/`)
- Landed: AO-0…AO-6b2, **AO-6b3** (`db8852169`, the limit moment reviewed, AO-D11), items 82 (`714ecbaae`,
  `8828601ed`) and 84 (`68296443f`).
- Next: **AO-7 (Get)** waits on James's puppeteer release with `installRecipe`. 0.3.0 (PUBLISHED 10-28 08:19Z, #48
  alone) does not carry it, read at its tag (`d0aa1224`), so AO-7 waits on a later release (0.3.x or 0.4.0; §3 item
  3). AO-8: rosetta #23–#26 (RO-24…RO-27) shipped in 0.1.2 and are pinned at `3948bcf` (10-29);
  their VibeField RPC/UI wiring remains follow-on work. Rosetta #27 (RO-28) and puppeteer #47 (PU-19) remain filed.
- Owed: the desk rows (`pnpm smoke`, `smoke:studio`, `smoke:godview` on a display); the first-run spike (`thinking-agent-onboarding.md` §9).

**FG — the first run on the field** · vibe-field-a5 (lane `fg/build`) · law `draft/thinking-first-run-glass.md` §7, DESIGN.md §2.1/§5/§6/§8/§13 (page sources `draft/first-run-glass/`)
- Ruled 10-29 09:29–09:35Z (James on *First run on the field*: the lean on eight, D15 C, D10 B, D14 B), and FG-D24 in
  his words on version 6 (the field draws the glass).
- Landed 10-30: **FG-0** (records only: DESIGN.md first), **FG-1** (`88457494e`, the field: the website's splash
  vendored with its door, the boot's ground) and **FG-2** (`07618ca61`, the returning tear; every boot handed over
  before it is interactive), as the merge `ffe9d9b40`, run 7 on the Mac mini: verify green, smoke:canvas:no-webgpu
  green, and smoke:canvas red only on item 117's class; **FG-3a** (`e012d1f50`, the glass's DOM: 880 × 640 with the
  fit, its layers, the steps' band, the frame), as the mint `5cc2d1108`, run 13 on the Mac mini: verify green, and
  `smoke:canvas` (on run 12's mint) red only on items 117 and 119 and a hand at the mini (LANDED "FG-1", "FG-2",
  "FG-3a").
- Next: **FG-3b** (the field drawing the glass, FG-D24) → FG-4 (the panes in the frame, and the logo) → FG-5 (the
  hand-over) → FG-6 (the gates: the catalog, a `smoke:first-run` row, contrast). Each verifies on the Mac mini.
- Owed: FG-O7 (§9) at FG-4.

**AL — what Quit means** · better-quit (lanes `al2`, `al/chords`, `al/chords-2`) · law `draft/thinking-app-lifecycle.md` v0.2 §8, ESR §7.3 (amended), design-00 EL1
- Landed: AL-1…AL-3 (`7ebb1eeda` · `5eea4b2d5` · `697beb199`; AL-4 folded in), AL-5, AL-7, AL-8a, **AL-9** (`933d2fba3`,
  records `d9e5eb119`; AL-D14 "A", D15…D18), **AL-9b** (`cc37d2d8e`, 10-29; LANDED §AL-9b: one chord table in main for
  ⌃⌘A, ⌘Q and ⌃⌘F, a held chord acting once, a non-Latin layout's chord read from the physical key). AL-8b RETIRED
  (AL-D10 "A": no LaunchAgent, not with AL-6 either).
- AL-9c candidates, on James's word (VF-PM's board): a person's own Ghostty `quit` chord quitting the app, and the
  deck's no-op `toggleFullscreen`, through one page→main door · Settings' chord words off the Mac · the deck's
  last-pane count (with ghosttea's "last pane closed" hook).
- Next: **AL-6** background mode (AL-D2's "Keep running when VibeField quits", a Dock-hidden resident shell, a status
  item) · Settings → Diagnostics' "Last exit" · AL-5's relaunch cap persisted · Settings → Terminal → Behavior's "How
  long a terminal lives" (`BehaviorTab.tsx:154` promises a terminal outlives quitting, false since AL-3; DESIGN.md §9
  words first; GT-D11's "never promises more").
- Owed: AL-5's relaunch witness on a packaged build; Windows/Linux relaunch; a fieldd no shell ever claimed is
  unbounded; the clean `smoke:canvas` on this Mac (unattended); ghosttea's "last pane closed" hook (an upstream ask);
  James's hand rows (§5).

**AU — Updates That Wait** · vibe-field-1b (lane `lanes/au`) · law `draft/thinking-update-ux.md` §7 (page sources `draft/update-ux/`), DESIGN.md §2.5/§2.8/§6/§8/§9/§13, EDP §5.2/§6.4/§11, ESR §7.3
- Ruled 10-29 02:01–02:16Z (James, on the page KY3q9U2e): A on thirteen, **B on AU-D4**, so the Me menu always
  carries an update row ("Check for updates" at rest, checking in place). The lead's calls LC-1…LC-57 (seven rounds)
  settle the blueprints' questions and what the builds found (the record's §10); James ruled LC-53 at the leans.
- Landed 10-30: **B1** — AU-0 (`db22ddb2e`: DESIGN.md first; its EDP/ESR/WP12 notes at source in dev-local
  `a0a7f7bdb`) and AU-1 (`380fb4d81`: the view grows, and a person's two doors, the check's answer and
  `download(version)`), as the merge `aa2be72c9`, run 3. **B2** — AU-3a (`571d81079`: `appVersion` in the device
  slice), AU-3 (`0706b1b76`: Settings → Updates and Your devices) and AU-2 (`066e20473`: the corner, the dot, the
  always-row, the question), as the merge `6a41ba1d8`, run 8. **B3** — AU-4 (`7b2cd0db6`: the app menu's Settings… ⌘,
  and update item, the status item's update image), AU-7 (`2cfaa1f96`: Move to Applications), AU-5a (`cbd6e15e5`: a
  signal skips the quit gate in every build, a fault older than AU, corrected at AL's LANDED entry) and AU-5
  (`a4688b7c9`: install on quit), as the merge `20783c656`, run 11. Each green on the Mac mini (LANDED "AU B1", "AU
  B2", "AU B3").
- Landed 10-31: **B4** — AU-6a (`4c25147bf`: a release's signed plain-text notes on Settings → Updates and the Me row's
  What's new, and the build's day on the page's head) and AU-6b (`2b1cfff6f`: the notes written in the sign job,
  inside the manifest's one signature, and each stage's `builtAt`), merged over main twice in the lane (`4dad7e228`,
  `f21680dd3`) and a third time by a9 over item 102, as `cf4335ab9`, run 24 (LANDED "AU B4"). AU-0…AU-7 are all built.
- Next: the records at their sources at the next draft queue: the record's §7 B4 note gains its landing, and its Status
  gets the dated "rebases … shas move" correction and flips to built; EDP §11.1's note and `build-wp12-updater.md`'s
  step 6c. Then the owed rows below. Nothing of AU is left to build but LC-49's one-line words after the W row.
- Owed: Settings → Updates, the row, the dot, the question, and B4's notes card, build day and What's new on a desk in
  both themes (James's display word); the first signed nightly with notes (release-notes.mjs and the sign job's notes
  step run only in the release workflow); ⌘,
  through the app menu (AU-4's eyeball, LC-28); AU-5's install-on-quit and AU-7's Move rows on the mini between two
  signed nightlies, then LC-49's "or quit" words in one line; the quit run's TCC probe; the logout probe; LC-52
  ("Check for Updates…" keeps its ellipsis, though the item does not open a box) is James's.

**PG — the phone's Godview** · vibe-field-fd (lane `lanes/ios`) · law `draft/thinking-phone-godview.md` §7/§8 (the page *The Phone's Godview*, AAYgPk8o), `design-mv.md`, `design-06-sync-planes.md`
- Ruled 10-29 08:17–08:30Z (James, on the page): all ten (a), nine at their leans; PG-D3 (a), native transcriptions,
  against the lean. PG-D11 A at 16:22:36Z (the PM board): the phone's queue cap is 256 KiB.
- Landed 10-31: **PG-1a…1c**, the desktop's efficiencies first (PG-D9): the model's attach promise withdrawn with the
  join (`e9a57b4b6`), the key-only relay and the window's per-desktop screen (`f2d76f7bf`, `8a3b64ced`), and tailnet
  backpressure at 256 KiB (`2392b0ef8`, `83e08f1e1`), as the merge `1790be95f`, run 18 (LANDED "PG-1a…1c").
- Next: PG-0, the records at their sources (`860a2449f`), in the queue after item 102, HN B2/B3
  and AU B4; PG-1d → PG-1e0, with PG-1f in parallel. Then PG-2 (the remote cut) → PG-3 (the phone's replica under the
  swarm) → PG-5…PG-8 (list, timeline, spend, rain, native) → PG-9 (resume, `agent.get`, the measured rates).
- Owed: items 109 (the History tail's reset hole) and 110 (`project.subscribe`'s no-op snapshot on the phone), both on
  the shed; the agent-plane pages' clauses, after PG-0; the cap read on the phone under the link conditioner (PG-9).

**HN — Cards in Hand** · vibe-field-a1 (lane `lanes/hn`) · law `draft/thinking-cards-in-hand.md` §6 (page sources `draft/cards-in-hand/`), DESIGN.md §1/§5/§6/§8/§9/§10/§13
- Ruled 10-29 10:40Z (James): all sixteen at their leans (LN-D1…D3, HN-D1…D10, PL-D1…D3); HN-D1 was his own pick on
  the page.
- Landed 10-31: **B1** — HN-0 (`0e2ad08bc`: DESIGN.md first) and HN-1…HN-4 (`6835b5398`: the hand at the window's
  foot, the line `[views] snapshot create`, the desk's Copy ⌘C, a card played into a pane or onto the desk), as the
  mint `23e9c2538`, run 22, verify only (LANDED "HN B1"). **B2** — HN-5…HN-7 and LC-17's follow-ups (the doc
  `a7de38b5f`: every copy deals a card and reaches the system clipboard, the picture's write half; another app's
  paste and drag; History's New terminal ⌘T), as the mint `e71f2d332`, run 26, verify only (LANDED "HN B2").
- Next: **B3** — HN-8, Artifacts in the head (PL-D1…D3: the pill's package, the covered views' circle, the Hub's
  tiles on the sheet's Artifacts shelf; the right edge's tray retires): light-green at `0874e0ac4`, re-merged over
  main from git's own base, run 28.
- Owed: B1's and B2's desk smoke rows on James's console window (§5); a card dropped on the desk is not smoke-covered
  in Electron; G30 (⌘C in a pane) and RO-31 (Copy in History) upstream (§7).

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

**PT-S — the phone on the desk (PORTALS)** · the PORTALS orchestrator (lane `pts`, branch `portals/pt-s`) · law `draft/portals-maps/PT-S-the-simulator.md` (re-ruled 2026-10-29), `draft/ground/PHONE.md`, DESIGN.md §5.1 and §9, ICE design-019
- Resumed 10-29 00:25Z on James's "Go with your leans" (`draft/portals-maps/PT-S-vs-PHONE.md` §6, every choice at its
  lean): PHONE.md folded as a VibeField plugin; the eye and hand losses accepted for v1; the pixels from LSF-5's
  ScreenCaptureKit producer behind one frame-source seam; the redrawn fixture; the metals mean the device's likeness;
  the stopped work kept.
- **PT-S1, the phone as a kind**: built 10-18 and 10-29, gated and looked at 10-29, LANDED 10-30 (`1de84540b`,
  the mini's run 10; LANDED "PT-S1"). `vibefield.simulator` (`plugins/simulator`)
  carries PHONE.md's law with its 28 units, the catalog's 42 iPhones from Xcode 26.6 (17F113), the morph, the
  materials in DESIGN.md §5.1 and the nine honest faces in §9's words. Its one frame source at PT-S1 was the plugin's
  fixture (the playground's stills through `playground/live.ts`, the tests' through `fixtureSources`, which nothing in
  the app lends); since PT-S2 the product's source answers under the same key, `LIVE`: a simulator lane in
  `desk-live.ts`, beside the browser's. The contracts bind a phone to `{ deviceType, runtime }`, never a UDID.
- Its gates: review round 1's six lenses confirmed 16 findings, all addressed; round 2's read-only re-review found 2,
  fixed. The second gated run (10-29 09:35:45Z, this Mac at nice 19) was green on every step, `pnpm still` 17/18 with
  the expected unblessed row; the 24 stills were looked at and blessed once, then 18/18. That run is the stills'
  witness for the landing: the golden is this Mac's, and `pnpm still` is `gate:landing`'s row 15, outside `pnpm verify`
  (`docs/desk-gates.md`). The full verify ran on the mini as run 10 (verify exit 0 at 21:05:29Z on
  `1de84540b`: typecheck 28 projects, vitest 10,151 / 0 / 18, rust 499 / 0 / 14). Before it,
  run 6 went red on one row: `build:all` had no edge to the plugin, fixed at the cause in `b72c46dfd`. The mint
  queue merged main into the lane as main moved, and DESIGN.md kept both sides. James's look: the dev app from
  the lane on his "launch it and show me" (09:48Z); at 10:02Z he typed "works, close and continue", no notes.
- **Item 119, PT-S1's fix**: LANDED 10-31 (`88bf4605d` in the mint `265325d09`, the mini's run 15; LANDED "PT-S1 fix
  — item 119"). The pegboard's rows are the lay's lines, so a shelf beside a hook no longer splits a line, and → and
  the listbox agree. smoke:canvas's KEYS clause cleared on the mini. HAND (item 117) and IDLE (the 10-26 class) stay
  their own.
- **PT-S2, the phone's producer**: built code-only on James's word (10-30 18:25Z), light-green on this Mac 10-30,
  LANDED 10-31 (`762f24978` in the mint `e4aa3d367`, the mini's run 16; LANDED "PT-S2"); its brief's R1–R16 are the
  orchestrator's leans. A bound phone's screen is wired through LSF-5's ScreenCaptureKit capture on `LIVE`, its nine
  faces and their acts mapped from the shell's facts, "Attach" and "Finish" on its menu (no free Model act, PT-S2's
  R11). No smoke row: its desk evidence is PT-S3's live run, and no real Simulator pixels have been seen on the desk.
- Next: **PT-S3** (the gates and the live witness: a booted simulator streams its real pixels to the desk, a still at
  rest, each honest face witnessed, the Screen Recording and Accessibility flows, "Show it" on a running Simulator.app
  (its launch arguments reach only a fresh launch), the fps buckets (PT-S2's R9: the law's 12 at rest arrives as 10),
  the letter of PT-S2's R7 (a split's second inner runtime, only with no face attached), the cost at the cap beside a
  pane) → PT-S4 (touch through serve-sim, supervised, after its `killPortHolder` is fixed: an EL8 pin event, loopback
  only, never `--allow-exec`). The capture bake-off (PT-S-B1, prepared in `/Volumes/SamsungRed/lanes/pts/bakeoff/`)
  stays queued on the mini; its result decides whether serve-sim's stream later replaces SCK's.
- Owed: whether the phone ships among `BUNDLED_PLUGINS` (James's, §5; PT-S2's R13 left it and the dev bundled set
  (`field-engine.ts`) untouched); PT-S1's host-bound files and its two ICE candidates (§6 PORTALS); a stale comment in
  `plugins/simulator/src/live.ts:17-20`, "(the cap shared with panes is PT-S2's)": the cap is built, a one-line fix.

**CO — the compose plane (sparks and their doors)** · cp-landing (lanes `co` and `mt/mt0`; the MT lead, vibe-field-dc, reviews the tool plane's rooms) · law `draft/compose-plane/thinking-roled-agents.md` §15–§17 and `draft/compose-plane/v2/` (version 2, ruled 2026-10-29), `draft/thinking-tool-plane.md` (MT, ruled 2026-10-30), DESIGN.md §2.10
- Re-entered 10-28 on James's word, with its rulings since:
  - the plane, ruled 10-29: fifteen CP marks, each on its lean, on the v2 page;
  - Sparks round 2, ruled 10-30: 22 of 22 on its page;
  - the tool plane, ruled 10-30: MT-D1…D12, each on its lean.
  - The foundation was James's ask, 10-29 ~10:24Z: "now shall we start planning and land the foundation of composer
    plane and spark".
- **CP-0, the record**: LANDED 10-30 (`b9ca35824`, the mini's run 5; LANDED "CP-0").
  - compose.ts: a spark, the 20-verb catalog and CP-1's six read verbs.
  - A run's origin, the `compose.sparks` doors, and DESIGN.md §2.10's spark faces.
- **SP-1a, the spark face in the kit**: LANDED 10-30 (in the mini's run 14, `0b40e56da`; LANDED "SP-1a").
- **CP-1a…1c and their docs, one candidate**: LANDED 10-31 (`67cf9f1cd`, the mini's run 20; LANDED "CP-1a…1c").
  - The floor's `door.sock` names each caller by the kernel's pid and start time, and walks it to its pane.
  - fieldd's hand-written `vibefield` MCP server speaks 2026-07-28 and the handshake before it. It serves a spark the six
    read verbs, each held to its Agent Profiles and audited before it acts.
  - Each spark is a signed record with a folder of its own and the window's three doors.
- **CP-1d, the briefing at every birth**: James's PR #4, re-cut onto main through the train on his "A" (10-31
  02:11:50Z), LANDED 10-31 (`ef5fb6161`, the mini's run 25; LANDED "CP-1d").
  - puppeteer 0.3.2's per-run `mcpServers`, `allowTools` and `instructions` carry the `vibefield` server and the
    spark's brief at hatch, at both resumes and at a pending run's replacement, so a spark's own session holds the door.
  - Claude only, until CP-5: in 0.3.2 only the Claude adapter declares a terminal MCP process.
- Next, in order:
  - **MT-0**, the tool plane: `contracts/src/tools.ts`, one catalog with audience and scope columns, and
    `fieldd/src/tool-plane/` serving each caller its rows; a plain run gets History and the projects list. It is drafted
    on PR #4's tip; it rebases onto CP-1d and is lit.
  - **SP-1b** (Chat's list) and **SP-1c** (the New spark sheet): renderer only, on James's go.
  - **SP-1d**: the thread and Chat's composer (HN B1 and B2 landed 10-31).
  - **CP-2**: start and talk (`rooms/talk/`).
  - **CP-3**: the person (`ask_user`, `notify`).
  - **CP-4**: flows and the desk applier.
  - **CP-5**, which is MT-7: Codex and Grok, once their MCP processes can be named.

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
- Landed since the audit: items 82 (`714ecbaae`, `8828601ed`), 83 (`f0b5342ac`), 84 (`68296443f`), 85 (`7eda2ee38`,
  `b60e80398`), 89 (`238a960bc`), 87 (`8d56b2bd8`) and 113 (`218dc3d9e`); the stack's eight, landed as the merge
  `0b4cb2ff0`: 94, 86, 90, 96's first half, 93, 97, 92 and 101; and the shell lease's cleanup race (`2422bdf5c`).
- Queue: item 80 (DS-5c's wall-clock gap margin, `doc-sync-service.test.ts`, shaped with the DS owner) with its sibling
  TC-S3 (`terminal-service.test.ts`, 99 against ≥100, red at AO-6b3's verify) · item 71 (persona refresh window) · item
  73 (`unregistered_webcontents` false positive on every factory window) · item 74 (the generation-1 port forward before
  the main world, live-surfaces) · the sibling 5 s waits (§6 Gates) · item 91 (MF-1's field-projection row judges a
  board settled from one pair of 750 ms readings, `agent-session.test.ts:2835`; red in item 87's first verify at load
  257; its red-first inverted on 10-29, so a read comes first) · item 116 (item 93's twin: electron-shell's
  `stopRunDaemons`, `src/testing/smoke-daemons.ts`, reads the whole process table twice per 100 ms poll, in macOS's `ps`
  spelling alone, so a Linux smoke reads nothing; one census, after PR #8) · item 117 (the smoke:canvas HAND bar-return
  class on the mini, 250 ms vs 200 ± 40; filed from FG's run 7, `lanes/records/item117`; after 116) · item 96's own half
  (the parts alone ×N and on CI; which of the 13 bare `30_000` rows keep a named constant; the one row still past a
  second) · item 111 (the Artifact panel's Copy does nothing in the app: a plugin's web clipboard write under the empty
  grant set, item 102's class; an SDK clipboard-write door over HN B2's host copy door (landed) unless HN B3 claims
  it) · item 112 (main decodes a clipboard PNG of up to 64 MiB with no pixel bound; an IHDR read before decoding against
  one new contracts constant, its literal ruled alone; HN B2 is in) · item 115 (`pnpm dev`'s nx watcher outlives a
  runner that ends without `shutdown()`: a watcher host on a stdin pipe, and a SIGHUP handler; after 111 and 112).
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
4. TS-8c → TS-9.
5. AL-6, "Last exit", the relaunch cap; the Behavior words.
6. **The ruled small slices** (James, 2026-10-28, the housekeeping page), each a lane when one is free:
   - Q4: the explorer thumbnail follows an edit by ≈22 s (ICE's ambient wind, design-015 D-D9): pass a shorter
     `deskLayer({ ambientIdleMs })` (ICE 0.16.0's option; VibeField passes none today).
   - Q5: a note held longer than 2.4 s shows its advice again.
   - Q13 (`costRatePerMin` on the desk row, the phone reading `desk`, D-i18) is superseded by PG-D1 (a), 2026-10-29:
     the phone reads the model's remote cut (PG-2, PG-3), and `desk` retires into it. D-i18's status flips in PG-0.
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
   - RD-6, CI in prod shape only: mille's first npm release (no tag past v0.3.4; release PR #44) and adopting the published
     rosettad archives (RD-D7; RO-4's remainder).
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
| Desk Phase 6 | STRING (ports on objects, ICE's wires, the Wire tool DK-D29) · OBJECT KIT (panel, controls, screens, cables, `process`) · AGENT'S EYES (`canvas.read`/`canvas.render`, MCP canvas tools DK-D26; DT-5's control lane, the reserved `surface.control` scope) · UPLOAD PLANE + the mini-app bridge (SP-D9/SP-D7; UP v0.1 and MB v0.1 drafted 10-01; UP-D1…D8, MB-D1…D9 unruled; AH-D10's cross-device CAS rides it). It replaces the four dogfood packs (Q9); the microservice pack retires or becomes an OBJECT KIT `process` candidate | a thinking doc each; STRING first | `thinking-desk-migration.md`, `thinking-upload-plane.md`, `thinking-mini-app-bridge.md` |
| Mind map pack | waits for STRING; redesign from Paper & String (MD-1…MD-15); v3's MM-D1…D14 were cut for the pre-desk canvas, MM-D14 moot (DK-D30) | STRING's thinking doc | `draft/mindmap/`, `thinking-mindmap-pack.md`, `predesign-mindmap-evidence.md` |
| The bare mat's menu | "Paste here", "New note here": unbuilt | a desk lane | DESIGN.md §8, ICE design-015 §7 |
| PT — PORTALS | PT-S is §2's (resumed 10-29; PT-S1 built 10-18 and 10-29, gated and looked at 10-29, LANDED 10-30 `1de84540b`; item 119's fix LANDED 10-31 `265325d09`; PT-S2 built code-only and light-green 10-30, LANDED 10-31 `e4aa3d367`) · then PT-C, PT-T (form ruled last, PT-D10) · James's 10-14 A2, B4, the 5 s wind tail, unbuilt | PT-C, PT-T: after PT-S (PT-D11's order: the simulator, window capture, the terminal) · A2, B4, the tail: a PT lane | `thinking-portals.md`, `draft/portals-maps/`, ICE design-019 |
| AH | AH-4's runtime on main since `cce684ce3` (08-03), unledgered by its own rule until review + witnesses · AH-1 two-client proof · AH-3 physical closeout · AH-5 the phone list · device-retirement GC | an owner; GC with TS's "forget a device" | `specs/artifact-hub.md` |
| PLUG follow-ups | the KIT slice · third-party listing (P8e: TD registry + R2 process host; PA-24, §20.5, §21.8) · sideload · R2 `host:"process"` · PRC-5's power loss (§6) · PRC residual policies (§14–§15) · per-section undo/⌘Z/timeline (D29′, P7) | first-party publishing; third-party plugins; a Settings history design; runtime validation is tracked separately in §6 | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md` |
| TP / TC | D6's cell half, C5, D5, the lineage break (§6) · TC RATIFIED as built (Q6: TC-D1/D2 as amended by WG-D1, D3, D15, L1c at TM-1); TC-S4…S8 (vault, broker, replay, drain-migrate, warm tiers) parked · TP-S4…S6 (S4's typeable mirror struck) | a TP lane · a ghosttea next-major or a P0 witness across a floor restart · measured demand | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md` |
| GT | G29 upstream (then GT-D22's file half) · GT-D22 (§5) · smoke row 13b: attach through DS-4e to a second staged desktop · no kill control in Godview (Q2): a session ends by the agent's quit, ⌘Q (AL-3) or reaping | G29's release · the two-desktop run | `specs/godview-terminal.md` |
| IOS | the rebuild and TestFlight (§5) · phone Settings ("Settings in a Pocket", 7 marks, page VCfkfxMp) · K-D5's ghosttea `customInputView` petition (unfiled) | James rebuilds; external TestFlight | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `apps/ios/TESTFLIGHT.md` |
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
- MB-D1…D9 and UP-D1…D8 (proposal pages owed first, LANDED :7954) · SP-D4, D11, D12.
- Whether the phone (`vibefield.simulator`) ships among `BUNDLED_PLUGINS` (`apps/desktop/packaging/bundled-list.mjs`;
  PT-S1 and PT-S2 left it untouched) · WIN-D6…D9 · LOG-V8. `PT-S-vs-PHONE.md` §5's seven choices are ruled (James,
  2026-10-29 00:25Z, "Go with your leans"; its §6, the work kept) and leave the list.
- DK's parked build rulings ((17)/(53), (48), (83), (92), (95), (97); DECISIONS DK addenda). (86) is answered by Q18
  and D22's "packaged built-ins" by WP8 (`5e7507d6c`); both leave the list.

**Witnesses (his hands, his devices)**
- AL-9's ten chord rows (row 1 first: a physical ⌘Q over a focused pane brings up the census box and sends no
  `deck_changed`; a miss on ⌘H or ⌘M puts that chord on D15's list) and AL-9b's two (⌘Q held over a focused pane: one
  box, and Cancel leaves both panes on their sessions; ⌘Q with a Russian input source selected brings up the same box)
  · the quit gate's two rows the 10-27 acceptance run
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
  on the desk · TS-4a's status-item row, a ghost row and the away notice on the desk · TS-4b's approval line on the
  claims strip · TS-8a on a real tailnet (no connection to log.tailscale.com while uploads are off; a tailnet with flow
  logs; Disconnect leaving the admin console; Tailnet Lock signed) · a phone run on the new TailscaleKit with TS-7's
  rows: a live sign-in (the consent alert, an approval tailnet), sign-out → Continue, and a scan and a link of the
  add-phone code.
- Item 78's two-pairs-both-logging row on the mini · item 79's promotion row (his device identity) · F1's device round.
- The phone: rebuild from main (truffle Swift 0.7.23, ghosttea 0.13.7; until then a restarted desktop needs a phone
  relaunch) → TestFlight build 4 → the device checks: shader compile at first launch, 7 pt type, VoiceOver per body,
  the tab bar as an obstacle, the reconnect banner across a fieldd bounce, the attached-but-unlisted card, an overload
  refusal said in the connecting face, C1's swipe after a reopen, the corner wearing its home desktop's face and name
  (IOS-8f) (and PJ-7 run 3's n/a cases, if 10-19's round missed them).
- HN B1's and B2's desk smoke rows on his console window (runs 22 and 26 were verify only, the console locked):
  smoke:godview's re-aimed 11h rung (a card played into a real pane) and 11j (a program's OSC 52 reaching main's
  copy door, no card), and smoke:canvas's Copy rows, its picture Copy rows (CLOCK, TWO, HAND, MISSING) and DROP
  (LANDED "HN B1", "HN B2").
- AR-7: his daily dogfood · AR7-D2's 8 s kit wait, measured on a pair bounce.

**Eyeballs (both themes)**
- Settings → Updates (AU-3; the update card left General with B2) with the Me menu's update row, the dot and the
  question (AU-2), since B3 the status item's update image and the app menu's update item (AU-4), and since B4 the
  notes card, the build's day and What's new (AU-6); ⌘, through the app menu has no smoke (LC-28).
- History by project (PJ-4 phase B): the list's order and folds, a row's marks, "n live".
- Settings → Plugins (object rows since DK-8 `244263f8c`): enable, disable, update, a faulted plugin's state.
- Settings → Devices → Network details' sync rows and the head's name-pill sync dot (C6-4); could join TS's photographs.
- Artifacts: the list and the Proxy/Folder picker, add and open flows (AH-3), reduced motion included.
- The UI catalog (`pnpm dev:design`): light/dark, keyboard focus, reduced motion, narrow.
- The deck's effects over a live pane (GT-7's Settings → Terminal → Look; CRT, VHS, Sparks over glass v2, GT-D19's
  stack): Animate effects only where it means something; licences visible.
- Godview round 3 on a real window: the lights' move, a real fling, launch's first call, ⌘W on the last pane (re-read
  after AL-9), other heights. Fold into QA wave 1 if the plan covers it.
- The Setup Assistant's glass on the field (FG-3a): the forming, the fit in a small window, the steps' band; the
  sheet's scrim close by hand (FG-D27).
- Cards in Hand's B1: the hand at the window's foot (a capture dealt, a card held and reached, ⇧⌘V's list), the line
  `[views] snapshot create`, the desk's Copy ⌘C, a card played into a pane and onto the desk.
- Cards in Hand's B2: Settings', History's and the Setup Assistant's copies dealt into the hand from their buttons; a
  picture copied with its words; ⌘V with no caret and a drag from another app; History's New terminal ⌘T in the
  project it shows.

**Releases, edits and chores**
- Releases: puppeteer 0.3.0 PUBLISHED 10-28 08:19Z and pinned (`1469639a6`, with QW1 stack B) · a later puppeteer
  release (0.3.x or 0.4.0) for AO-7's `installRecipe`, item 50's env seam, item 39 and the tuck (push and merge
  `vf/item-39`, `vf/after-a` first) · mille's first
  npm release · adopt rosettad's published archives (RD-D7) · RD-4's pipelines (who runs them is open, §9).
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

**PORTALS (the pane's carried debts, then PT-S1's)** — `thinking-portals.md` §4; LANDED "PT-S1"
- `smoke:studio` reds when its window is covered: give Studio's acceptance window DK-11's frames.
- The SLEEP row's judge (M1, L1, L2, L3) · B5 the still sweep · R5 a refusal's load stamp · V7 a failed page re-asked · pressable shadow-hosted frames (V2–V5).
- IDLE counts ICE's HoldPass and mat submits outside `perf().frames`: settle on ICE's idle, or ICE reports its hold pass (harness + ICE owners).
- NO-DOCUMENT's ↻ missed its new window once (smoke:canvas, 10-26) · a typed address may not draw while typed (PLAUSIBLE) · M18: host clicks miss by ≤4 CSS px (measure).
- Two stated limits (James, 2026-10-12) move into §4 as law (§6 Records): a mouse press into a frame at a page scale past 1 rests on units alone; typing into a frame of another site is refused and counted.
- PT-S1's host-bound files: the stills' golden (`plugins/simulator/test/still.golden.json`, blessed on this Mac: Metal on macOS 26.5.2, `webgpu` 0.4.0) and the committed face words (`plugins/simulator/src/face-words.gen.ts`, 339,375 bytes drawn in this Mac's fonts; accepted for v1 by PT-S1's brief, R5, revisited only if a plugin size budget appears). On another host a still whose bytes differ is refused, naming the host that blessed it, and a regen's diff of the words means another host, never a fault to commit over. The law's "is every iPhone device type installed on this Mac" row compares only on the catalog's Xcode build (17F113) and skips elsewhere, naming both builds (the mini's Xcode 27.1 knows 45: the 42, iPhone 18 Pro, 18 Pro Max and Duo) — LANDED "PT-S1"; `docs/desk-gates.md` row 15.
- PT-S1's two ICE candidates, named and not filed, no petition numbered: a per-frame "drawn" fact for every record a kind prepared (a model change that lands while the phone is culled morphs at the reveal, accepted for v1, the brief's R2 Q2); a desk-eye record and a body driver for every kind (choice 3's losses: the band's parallax toward the view's centre, the tip to the fingers, the eye-pinned grab) — `PT-S-the-simulator.md` §1; LANDED "PT-S1".

**Desk, UI and design**
- With no desk, B and the line's ⊕ still flip the Objects surface — DK-18 follow-up (b).
- InlineNotice's attention/error tones to DESIGN.md §2.5's inks (a design-kit slice) — WP12 L3c-ii.
- `prefers-reduced-transparency`: a DESIGN.md stance first (`440b04e`'s proposal: glass falls back to the §5 tint), for the cover glass (FC-D13/D16) and the deck's glass v2 (GT-D19), then tokens.css.

**Files, phone, accounts**
- EACCES is not yet honest words (the files service) — `build-hf.md` M3–M5.
- AP-D7's protocol cause (low) — `thinking-ios-account.md`. (Q13's `costRatePerMin` on the desk row is superseded by
  PG-D1 (a).)
- UA-P-6: fold UA-P-D1…D8 into a governing spec (`specs/users-and-accounts.md` names none) — `thinking-ua-phone-account.md` §7 UA-P-6.

**Plugins**
- PRC-6c2b: evidence triage and diagnostics are in draft [PR #7](https://github.com/vibefield/vibefield/pull/7) (implementation `8bcdab786`, CI fixes `60b49ce25`); **verification and landing remain open** as of 2026-10-30. Run 1 (08-18/19, 1,535 samples) remains `fail`, `claimSatisfied: false`: one persistent aggregate drop increment from cycle 1109 and seven observation gaps above five minutes (maximum 61 minutes). Per-stream counters, phase/power events, 15-second resource-probe deadlines, durable diagnostic records and all-gap reporting are implemented with targeted regressions. Linux affected CI passes build, tests and typecheck; full macOS verify is running. Next: finish verification, then the guarded 32-cycle DK-9 desk calibration and listener negative control. Historical root causes remain open. A literal 24-hour witness is required only for a release claiming plugin-architecture §24.6's endurance guarantee; ordinary plugin work is not gated by it. Scope and evidence: `draft/thinking-prc6c2-physical-soak.md` §9–10.
- PRC-5's literal power-loss witness (the Windows filesystem half parks with WIN) — `thinking-prc5-update-coordinator.md` :789.
- ICE declarations are not strict-NodeNext portable (still 0.16.0); matters only if the KIT slice's out-of-tree typecheck admits NodeNext — petitions README I18.

**Gates (to the fixer's docket, each re-checked)**
- `pnpm siblings:pin` writes a lock layout biome refuses · a fresh-lane smoke exits 1 in 22 s with no reason line · the smoke shot directory is shared by every lane · `capture:godview` timed out once in four.
- The sibling 5 s waits need a read now that item 77 placed its own: AttachmentOverTheDoorTests :618 and :352, AttachLogTests :203, LanesOverTheDoorTests :262 (`apps/ios/VibeFieldKit/Tests/FieldTerminalTests/`) — item 77's review.

**Records — at-source corrections still owed after the 2026-10-28 housekeeping pass (commit-draft turns through VF-PM)**
- Done by this pass and not repeated here: the archive moves and their reference rewrites (`draft/archive/INDEX.md`); the rulings' folds, the DECISIONS flips, the design docs' Status blocks, the specs' and thinking docs' dated notes and Status headers, the root docs, DESIGN.md's Q18 signatures and desk sweep, and the petitions restructure (DECISIONS' HK row). Of these, petitions M4/M5 are corrected, Open until mille releases; D16 is retired (DECISIONS D11–D16); T7's route-name pinning is T13 (Q22).
- thinking-portals §4 gains PT's two stated limits as law (§6 PORTALS); the ROADMAP no longer carries them. Its Status and §4 carry PT-S's resumption as dated corrections (2026-10-29: resumed 00:25Z, `PT-S-vs-PHONE.md` §6; choice 4 taken, touch is PT-S4; PT-S1, LANDED "PT-S1").
- The LIVE drafts take their lines only after their owners release them: `specs/godview-terminal.md` §1, the QA plan and its rulings, ar-reattach, release-deps, build-mv, thinking-ios-app and thinking-ios-keyboard, with `refs.held.tsv`'s four references to moved paths (`draft/archive/INDEX.md`).
- The design-00…04 D1–D4 body fold-back (chopsticks/spaghetti → puppeteer/rosetta); this pass added amendment blocks and stale notes only.
- design-03's body fold of TPv3 rollout §13's deltas (the cell-to-render-worker row, §4.7's PF6 erratum, §4.6's hop count, the CSP note); this pass added notes only.
- `specs/terminal-custody.md` §5: TP-D23's cell-side fairness (TPv3 rollout §13).
- F-C6-4 probably closed by item 79's mechanism 1 (`5d0cc20d1`); confirm, then correct thinking-c6-meshdata :135 and DECISIONS.
- SNAP's DECISIONS status (the audit's item 18), only after `codesign -dv` on a nightly's zip shows a Developer ID-signed `field-screenshot-helper.app`.
- DECISIONS rows not yet written (the audit's appendix B), each after its owner's status read: RL2…RL8, K-D1…K-D6, AR6-D1…D9.
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
| rosetta | `@vibefield/rosetta-protocol` / `-room` 0.1.2 exact · rosettad built from `../rosetta-pin` at `3948bcf` | EL8 10-29; matching npm and daemon releases; adopting daemon archives remains RD-D7 |
| mille | `link:../mille-pin` at `c8160d5` (`@vibecook/mille`, `mille-ui`) | FS-1b; no release past v0.3.4; exit RD-6 |
| rustc | 1.99.1 (`rust-toolchain.toml`) | EL8 |

Petition status lives in `draft/petitions/README.md`. Still open or owed there:
- **ghosttea:** G29 (the link hook names its session; drafted; gates GT-D22's file half) · G30 (the routed
  `copySelection` answers nothing, so ⌘C in a pane copies nothing; HN-5's pane copy waits on it) · candidates to file:
  D6's `encodeInput` seam, D5's renewal, browse-handler injection (absent at 0.13.7), a real `prepare()` (the
  first-frame half MET by `session-drawn`, 09-29), whether `paste()`/`sendKey()`/`sendText()` say they sent, the "last
  pane closed" hook (AL), K-D5's `customInputView` · G27 parked (a second Swift consumer).
- **truffle:** T8 (the app-chosen hostname prefix; TS-8c, probe first) · T12 (a typed start refusal; held; a PR when
  James says) · T13, the one T row for T7's route-name pinning (Q22; owed, not drafted); T7's other follow-ups (the per-direction idle reap, a held
  route id's refusal, loopback pages) are recorded as accepted.
- **rosetta:** RO-24…RO-27 (#23–#26) shipped in 0.1.2; VibeField RPC/UI adoption remains follow-on work.
  RO-28 (#27, AO-8) remains filed, with RO-8 (retire/forget a runtime), RO-11 (with DS-7), RO-17…RO-23,
  and RO-10's follow-ups. RO-4's remainder is adopting the released daemon archives (RD-D7). RO-31 (a copy port in
  rosetta's room; History's Copy waits on it, HN-5).
- **puppeteer:** 0.3.0 PUBLISHED and pinned 10-28 (`1469639a6`) · a later release for AO-7's `installRecipe`,
  item 50's env seam, item 39 and the tuck · PU-12 (verify first) · PU-19 filed as #47 (AO-8) · PU-15
  (with AR-6).
- **mille:** M11 (with WIN). **ICE:** I47, I48 (named, parked) · the remount edge (a pointer `leave` with no point; a
  candidate if presence UX needs it) · NodeNext portability. **strata:** S3/S4's residue (parked: a measured join or
  reload wall on a real desk document).

## 8 Tracks

| Track | State | Law lives in | Next |
|---|---|---|---|
| TS — the Tailscale door | ACTIVE; TS-0…3b, 4a, 4b, 5, 6, 7, 8a, 8b landed | `thinking-tailscale-onboarding.md`; DESIGN.md §5/§6/§8/§9/§13 | TS-8c (T8, after its live probe) |
| AO — Bring Your Agents | ACTIVE; AO-0…6b3 landed | `thinking-agent-onboarding.md` | AO-7 on a puppeteer release after 0.3.0 (`installRecipe`) |
| FG — the first run on the field | ACTIVE; FG-0…3a landed 10-30 | `thinking-first-run-glass.md`; DESIGN.md §2.1/§5/§6/§8/§13 | FG-3b |
| AL — app lifecycle | ACTIVE; AL-1…3, 5, 7, 8a, 9 landed | `thinking-app-lifecycle.md`; ESR §7.3 | AL-6, Last exit, relaunch cap |
| AU — Updates That Wait | ACTIVE; B1–B4 (AU-0…AU-7) landed 10-30/31 | `thinking-update-ux.md` §7 (page sources `draft/update-ux/`); DESIGN.md §2.5/§2.8/§6/§8/§9/§13; EDP §5.2/§6.4/§11; ESR §7.3 | the owed eyeballs, the first signed nightly with notes, the physical rows |
| PG — the phone's Godview | ACTIVE; PG-1a…1c landed 10-31 | `thinking-phone-godview.md` §7/§8; `design-mv.md`; `design-06-sync-planes.md` | PG-0 (queued); PG-1d → PG-1e0 |
| HN — Cards in Hand | ACTIVE; B1 (HN-0…HN-4) and B2 (HN-5…HN-7) landed 10-31 | `thinking-cards-in-hand.md` §6 (page sources `draft/cards-in-hand/`); DESIGN.md §1/§5/§6/§8/§9/§10/§13 | B3 (HN-8), run 28 |
| QW1 — Godview swarm QA, fix wave 1 | ACTIVE; stacks A and B landed 10-28, B on puppeteer 0.3.0's EL8 pin | `godview-swarm-qa-plan.md`; `thinking-ar-reattach.md` | QA wave 1 |
| Release rails (EDP/ESP, WP12, TD, BP, RD, RM) | ACTIVE; nightlies live, W10/W11 passed | the release specs; `thinking-browser-profile.md`, `thinking-release-deps.md`, `thinking-release-management.md` | round 3; the first-beta list |
| EL8 — pins | ACTIVE (watch) | DECISIONS TB; the manifests | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); Swift rejoin; mille's release |
| AR — agent runtime | PARKED; AR-3…AR-5b, AR-7, AR-S1…S4e2, AR-S5 landed | `thinking-ar-agent-plane.md`, `thinking-ar-data-topology.md`, `thinking-ar7-typed-agents.md`, `thinking-ar-agents-settings.md` | AR-6 on AR6-D; AR-7j for the beta |
| MV — monitor views | PARKED; landed 10-08 | `draft/monitor-view-sdk/design-mv.md`; DESIGN.md §8 | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); item 39 and the tuck wait on a later release; QL ratifications |
| History (AR-8) / PJ | PARKED; PJ-1…4, 6, 7 landed | `build-hf.md`, `thinking-ar-history-room.md`, `thinking-project-places.md` | R8/R9; B-D4/B-D5; PJ-5 re-judged; PJ-8 after DS-7 |
| DS / SP — sync planes (was C — mesh) | PARKED; waves 1–3 landed | design-04, `design-06-sync-planes.md`, `thinking-desktop-sync-plane.md`, `thinking-sync-planes.md`, `thinking-c6-meshdata.md` | DS-7 with an owner + the two-desktop run |
| FW — the freeway | PARKED; F1 landed 10-20, packaging 10-27 | `thinking-freeway.md` | James's device round; FD1/FD2's owner |
| FS — files service | PARKED; FS-1a/1b/2 landed | `thinking-files-service.md`, `build-fs.md` | FS-3 on the desk; mille's release |
| PT — PORTALS | ACTIVE (PT-S, resumed 10-29); browser landed 10-14; PT-S1 (the phone as a kind) built 10-18 and 10-29, gated and looked at 10-29, LANDED 10-30 (`1de84540b`); PT-S2 (the phone's producer) built code-only and light-green 10-30, LANDED 10-31 (`e4aa3d367`) | `thinking-portals.md`, `draft/portals-maps/` (PT-S: `PT-S-the-simulator.md`), `draft/ground/PHONE.md`, ICE design-019, LSF spec | PT-S3 (the gates and the live witness) → PT-S4 (touch); then PT-C, PT-T |
| Desk Phase 6 | PARKED; replaces the four dogfood packs (Q9) | `thinking-desk-migration.md` | STRING's thinking doc |
| DK — the desk migration | COMPLETE; landed 10-09 | `thinking-desk-migration.md`, `thinking-the-desk.md`, ICE design-015…018, `docs/desk-gates.md` | James's parked build rulings |
| GT — Godview terminal | PARKED; the deck's ladder done (GT-0…GT-8) | `specs/godview-terminal.md` | G29; GT-D22; row 13b |
| TP / TC — terminal pipeline and custody | PARKED; TC RATIFIED 10-28 (Q6) | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md`, `thinking-terminal-mesh-cells.md`, `thinking-floor-wedge.md`, `thinking-inventory-latency.md` | D6's cell half |
| AH — Artifact Hub | PARKED; AH-1…3 landed, AH-4 unledgered | `specs/artifact-hub.md` | an owner: AH-4's review + witnesses |
| PLUG — shipped core | COMPLETE: P0–P7, P8b–d (P8c via WP8), PRC-4/5; later publishing/validation work is separate | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md` | existing product gates; no blanket 24-hour prerequisite |
| PRC-6 — plugin runtime validation | OPEN; diagnostics in draft [PR #7](https://github.com/vibefield/vibefield/pull/7); Linux CI passed, full verification and calibration pending | `thinking-prc6c2-physical-soak.md` §9–10 | full verify → guarded 32-cycle current-desk calibration + listener control; historical failures stay open; literal 24h only for that claim |
| PLUG — publishing | PARKED: KIT/P8e | `thinking-p8-loadable-artifact.md`, `specs/trust-and-distribution.md` | publishing scope; TD registry + R2 process host |
| IOS — companion | PARKED; IOS-8f landed 10-30 (`user.me`: the corner wears its home desktop's face and name) | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `thinking-ios-account.md`, `thinking-ios-history.md`, `apps/ios/TESTFLIGHT.md` | the rebuild; TestFlight build 4 |
| UA — users and accounts | COMPLETE except witnesses | `specs/users-and-accounts.md`, `thinking-ua-phone-account.md` | the phone's second-account witness |
| NF — native floor | COMPLETE; one owed line | `specs/native-floor.md` | item 52 (b)'s phone half |
| LOG — logging and audit | PARKED; item 78 landed | `specs/logging-and-diagnostics.md` | LOG-39 for the beta |
| UI — design system | COMPLETE; owed slices | `DESIGN.md`, `docs/UI_SYSTEM.md` | InlineNotice tones; the desk sweep |
| SNAP — screenshot tool | PARKED; SNAP-0/1/1a/3/3a/3b landed | `thinking-screenshot-tool.md`, `draft/composer/build-edge-trays.md` | live checks; the still as `desk.photo` |
| SD — sound | PARKED (James's lab, Q27) | `draft/sound/design-sound.md` | James's call |
| WIN — Windows port | PARKED since 08-24 (`c16e618f4`) | `thinking-windows-port.md`, `docs/WINDOWS_PORT_STATUS.md` | a Windows leg on the rails |
| LSF — live surfaces foundation | COMPLETE; LSF-4 landed 10-26 | `specs/live-surfaces-foundation.md` | consumed by PT; §18 Windows rows with WIN |
| CO — the compose plane | ACTIVE; CP-0, SP-1a, CP-1a…1c and CP-1d landed | `compose-plane/thinking-roled-agents.md` §15–§17, `compose-plane/v2/`, `thinking-tool-plane.md`; DESIGN.md §2.10 | MT-0 → SP-1b/1c → CP-2 |
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
| Fieldmarks and Face Club (DESIGN.md §11/§11.1) | Q19 C (retired); code removed 2026-10-29 | the plain mark (`b51154f91`); DESIGN.md §13's glyphs | `draft/archive/retired/design-fieldmarks/`; kit leaves, assets, catalog sections/reports and generators removed |
| James's labs: AV avatars, identity, logo studio, mark, research, system atlas | Q27 (archive each) | CO (avatars); the plain mark and `vf-splash` (identity, logo studio, mark); the desk (system atlas) | `draft/archive/retired/agent-avatars/`, `draft/archive/superseded/identity/`, `draft/archive/retired/logo-studio/`, `draft/archive/superseded/mark/`, `draft/archive/evidence/research/`, `draft/archive/superseded/system-atlas/` |
| The LSF-3C agent-browser spike | Q12 (executed) | LSF §17 and DECISIONS hold its law | `draft/archive/executed/specs/live-surfaces-agent-browser-spike.md` |

## 9 Open questions for James (one line each; the lean)

James ruled the housekeeping page's forty questions on 2026-10-28 (R1, A1, Q1…Q29, the labs). They are recorded in
DECISIONS' HK row and `draft/thinking-housekeeping-2026-10-27.md`, and folded above. Q23's two follow-ups, compact.md's
D-1 and D-10, he ruled A the same morning (DECISIONS' compact row). What stays open:

1. **`draft/work/`** (the plans of record for DS waves 1–3, all landed): never asked. Lean (the archive ledger's):
   keep it in place; archive only with its 14 living pointers rewritten and its two Status headers flipped first.
2. **Who runs RD-4's pipelines** (`draft/handover/2026-10-15-rd4-james-pipelines.md`). No lean.
3. **FG-O7, the way out of a long load** (`draft/thinking-first-run-glass.md` §8): Opening Tailscale's Cancel shows
   only after 6 s, where TS shows it beside its pill from the start. Lean (the page's): after 6 s, by James's round-3
   words on loads ("nothing more"). Asked at FG-4.
