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
  (Q7)): tags `nightly-YYYYMMDD[.N]` (`scripts/release-plan.mjs`), version and title `0.1.0-nightly.YYYYMMDD[.N]`. Manual dispatch can publish a numbered revision on the same UTC day (James, 2026-11-03); scheduled releases remain daily, and existing tags are never reused. 0.9.0 is
  tagged when RL6's goals hold (History and Godview dogfooded daily · prod-shape deps · the release rails;
  `draft/docket/release-docket.html`; *corrected 2026-11-09: RL6 named a fourth, the browser pane in a packaged build,
  which fell with the pane at James's first launch's lineup, DECISIONS "FL"*), as betas `v0.9.0-beta.N`, then stable
  after a soak; 1.0.0 at P0's exits (AR-6, the signed beta, the two-account witness).
- **Heads** (the lead, vibe-field-5c, read 2026-10-28 07:40Z). main = origin/main `a7498883f`, pushed 05:32Z. CI
  verify on `a7498883f` is GREEN (run 40638591985, 06:02:37Z). Before it: green on `9612ade48` (run 40624603346), and
  RED on `0ec11879e` (run 40605216364: item 84, AO-3's fixed-date History row expired at midnight UTC; `9612ade48`
  fixed it). `nightly-20261028` may dispatch on the green head (`scripts/release-plan.mjs:62`: never from a red trunk).
  Since the audit's base (`bb1a2c823`): AL-9, items 82–84, TS-8a/8b, the TS-3a erratum, AO-6b3 and QW1 stack A landed;
  then HK, the EL8 to puppeteer 0.3.0 (`1469639a6`) and QW1 stack B (10-28).
- **The live program.** §2: TS, AO, FG, AL, **AU (updates that wait)**, **PG (the phone's Godview)**, **WI (the
  phone's way in)**, **IOS-12 (the phone's Chat, since 11-04)**, **SD (the sound identity, since 11-05)**, **UM + SE
  (the profile meters and one search, since 11-06)**, **HN (Cards in Hand: the line, the hand, Artifacts in the head)**,
  QW1 (the Godview swarm's fix wave 1), PT-S (PORTALS' phone, resumed 10-29), **CO (the compose plane: sparks and the
  tool plane, re-entered 10-28)**, the release rails, the EL8 watch, the fixer, upstream. The first-beta blockers are §3
  item 7. Everything valid but unscheduled is §4.

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
- Next: TS-8c (T8 taken at truffle 0.7.27, M249; the prefix stays OFF until every shipped plane reads the tag) → TS-9.
  The slice names are the doc's: the board's "TS-6" was TS-8a.
- James ruled TS-D19, TS-D20b and TS-D21 A (10-29 03:57:49Z). The UM lead's ruling 5 (11-06, ‹for James›; DESIGN.md
  §8 "Asking again", amended) makes the approval line and the limit moment independent: the moment left the strip
  for the profiles column's add at UM-3 (M-desk, `48e54f49b`), the strip holds the line alone, and TS-4b's two "one
  moment at a time" rows retired with it. Owed: the approval line while Godview is closed (TS-4c or a later rung);
  Publish's nudge, until a Publish offers where to open; the switch's words (drafts); a field made while the sync
  question is owed by a path other than New field follows the posture (TS-6's finding).
- James ruled TS-7's Q1 (all six A) and Q2 A (10-29 05:29Z) and TS-D22 A (10:51:56Z). Owed from TS-7: Q2's later half
  (the store link, once a public install link exists); the five truffle Swift petitions (ids after T13, at the next
  draft queue); item 103's witness (`dc0f1dce0`, the kit's `:262` race).
- Owed on James's display word: §5 (TS-2's photographs and desk rows, renew's live half, TS-5's real notice, TS-8a's
  live tailnet rows, TS-4a's rows and away notice, TS-4b's approval line, TS-7's phone rows at the build-4 sitting).
  `specs/users-and-accounts.md` §6/§7 owes TS's fold (the housekeeping pass added its first dated notes there).

**AO — Bring Your Agents** · vibe-field-de · law `draft/thinking-agent-onboarding.md` §8 (page sources `draft/agent-onboarding/`)
- Landed: AO-0…AO-6b2, **AO-6b3** (`db8852169`, the limit moment reviewed, AO-D11; re-anchored beside Godview's
  profiles column's add by UM-D23, DESIGN.md first at UM-0, the code LANDED at UM-3, `48e54f49b`), items 82
  (`714ecbaae`, `8828601ed`) and 84 (`68296443f`).
- Next: **AO-7 (Get)** waits on James's puppeteer release with `installRecipe`. 0.3.0 (PUBLISHED 10-28 08:19Z, #48
  alone) does not carry it, read at its tag (`d0aa1224`), so AO-7 waits on a later release (0.3.x or 0.4.0; §3 item
  3). AO-8: rosetta #23–#26 (RO-24…RO-27) shipped in 0.1.2 (`3948bcf`, 10-29); their VibeField RPC/UI wiring
  remains follow-on work. Rosetta #27 (RO-28) shipped in 0.1.3 (`8e8f496`, EL8 11-04) and History titles its
  disconnected face with it; the line under the title is still fieldd's sentence. Puppeteer #47 (PU-19) remains filed.
- Owed: the desk rows (`pnpm smoke`, `smoke:studio`, `smoke:godview` on a display); the first-run spike (`thinking-agent-onboarding.md` §9).

**FG — the first run on the field** · vibe-field-a5 (lane `fg/build`) · law `draft/thinking-first-run-glass.md` §7, DESIGN.md §2.1/§5/§6/§8/§13 (page sources `draft/first-run-glass/`)
- Desktop QA refinement (2026-11-01, prepared for push 2026-11-03): clearer onboarding copy, Back separated
  from forward actions, full-width device details above the footer, a balanced face-frame switch, and profile
  cards whose pinned headings clip cleanly while the Add a profile offer stays reachable. DESIGN.md records
  the composition; the existing authentication and profile flows remain the owners of their state.
- Ruled 10-29 09:29–09:35Z (James on *First run on the field*: the lean on eight, D15 C, D10 B, D14 B), and FG-D24 in
  his words on version 6 (the field draws the glass).
- Landed 10-30: **FG-0** (records only: DESIGN.md first), **FG-1** (`88457494e`, the field: the website's splash
  vendored with its door, the boot's ground) and **FG-2** (`07618ca61`, the returning tear; every boot handed over
  before it is interactive), as the merge `ffe9d9b40`, run 7 on the Mac mini: verify green, smoke:canvas:no-webgpu
  green, and smoke:canvas red only on item 117's class; **FG-3a** (`e012d1f50`, the glass's DOM: 880 × 640 with the
  fit, its layers, the steps' band, the frame), as the mint `5cc2d1108`, run 13 on the Mac mini: verify green, and
  `smoke:canvas` (on run 12's mint) red only on items 117 and 119 and a hand at the mini.
- Landed 10-31: **FG-3b** (`be1dd92ad`, the field drawing the glass in its own frame, FG-D24: its shadow, frost, tint
  and grain read off the glass's own layers), as the mint `c8e4c55eb`, run 30 on the Mac mini: verify green; **FG-4a**
  (`fc1fc0f75`, the panes in the frame: head at 96, actions on the foot, no eyebrow on the glass, the old pane out
  first, and only a list scrolls, within itself), as the mint `733f24ed5`, run 35 on the Mac mini: verify green;
  **FG-4b** (`07b1dad5e`, the holds and the logo: a load as the logo and one line, standing at least 800ms once it
  shows, the welcome's title card, Setting up's one line with Start now, the band's fill, the logo drawn by the field
  over the live field and the still's own mark over the still, and a way out after 6 s), as the mint `a5106c727`, run
  40 on the Mac mini: verify green; **FG-6** (`4c5c2b233`, built ahead of FG-5: `pnpm smoke:first-run`, desk-gates row
  32, walks the Setup Assistant by its own controls to the desk by day, by night and over the field's still, its user
  the one harness minted not onboarded, UA-3w as amended), as the mint `7310560ea`, run 48 on the Mac mini: verify
  green; the row's first console run RED at run52b in two classes (A: the mark's ink +10 px, and no scroll to witness
  on the mini's 1180 × 748; B: the sign-in pane's Cancel under the pane's foot in warm walks, a timing race per the
  day-alone probe at 13:48Z); **FG-6's follow-up slice** (`7d25cdc80`, B: the add brought back into view when a
  card is set in above it; `618b35429`, A: the mark centred by its ink's extent, and a list that fits its body a
  declared, printed skip), as the mint `618b35429`, run 53 on the Mac mini: verify green; row 32 alone on M53 RED
  at run53b in one class, C (the login's Cancel 1.3 under the cards' fade: the add at the 190 terminal taller than
  the 278.2 they keep above it), its 39 stills seen by James at 15:02Z; **FG-6's follow-up 2 and class C**
  (`c92a48a13`: a walk that stops says what it had found; `09631d7d0`: the glass terminal 170, DESIGN.md §4 first,
  ruled by James at 15:07Z, and a Cancel red that says its numbers), as the mint `2ebc24fd3`, run 54 on the Mac
  mini: verify green; row 32 alone on M54 GREEN at run54b (15:24:54Z), its first: every walk green in 16 s, Cancel
  9.7 clear above the fade; **FG-5** (`14524e7b2`: the hand-over, the glass stepping out and the field opening onto
  the desk, its order and two stills in row 32), as the mint `5fb101980`, run 55 on the Mac mini: verify green; row 32
  alone on M55 GREEN at run55b (16:31:04Z), FG-5's witness: the hand-over in its order on every walk; **FG-6c**
  (`f3de33803`: the tear judged in the walk, `data-tear` on the field's root, FG-O3's read printed), as the mint
  `f3de33803`, run 56 on the Mac mini: verify green; row 32 alone on M56 GREEN at run56b (16:46:06Z), FG-6c's witness:
  the tear opened on both live walks; **FG-O2** (`f198e5ec5`: the glass's small words' contrast measured in the walk and
  printed, not judged yet), as the mint `f198e5ec5`, run 57 on the Mac mini: verify green; row 32 alone on M57 GREEN at
  run57b (17:22:02Z), FG-O2's first printed numbers: the stage line 6.4–6.5:1, the glass's small words 1.7–2.4:1 by day
  and over the still and 2.5–3.8:1 by night, the band's now 6.6–13:1; **FG-O2's judge** (`6adf58dd3`: every word on the
  glass at 4.5:1, the day's milk at 75% by James's "b", the ramp stopped at t2 on the glass, and row 32 judging every
  word), in the stacked mint M59 (`2d2f41046`), run 59 on the Mac mini: verify green; row 32 alone on M59 RED at run59b
  (20:43:06Z), its first live findings: two inks short on the day's 75% milk, the agents' "Ready" at 3.4–3.7:1 and t2 at
  4.1–4.4:1, the night green; **FG-O2's judge's fix** (`06cf3fe3d`: one rule for the glass, 5:1 at the thinnest stroke
  row 32 measured, the glass's own t2 at 80% by day, its healthy and attention inks, and the wizard's error line onto
  the attention ink), as the mint `06cf3fe3d`, run 60 on the Mac mini: verify green; row 32 alone on M60 GREEN at run60b
  (21:33:51Z), the fix's witness, every word on the glass at 4.5:1 or more on all three walks; **FG-6's catalog**
  (`aa4d41a3e`: the design catalog's 13 Setup Assistant frames on the shipping glass over the shipping field at its
  still, told the page a window that can't run the field is, never a copy), in the mint M62 (`48c67b39a`), run 62 on the
  Mac mini: verify green; **FG-6's frozen frame** (`9c8b4e280`: the live field held on one frame through
  `window.__vfField`, the field's glass held to the browser's at DESIGN.md §8's 2, 1 and 6), in the mint M65
  (`a09aae636`), run 65 on the Mac mini: verify green; row 32 on M65 RED at run65b (23:23:18Z), its day and night walks
  red, the frozen frame's judge on the logo their only problem; the frozen frame's first live numbers: held at 0, the
  field's glass 1.08–1.18 inside, 0.37 in the shadow and 7.59–8.02 on the logo, against §8's 2, 1 and 6; **FG-6's
  follow-up 3** (`0cf63cfed`: the browser's glass held off the field wears the field's held mark, so the frozen frame
  compares one mark), in the mint M68 (`064e7a5f9`), run 68 on the Mac mini: verify green; row 32 on M68 GREEN at run68b
  (01:53:12Z), the frozen frame with the browser's logo in the field's held mark: held at 0, the field's glass 1.08–1.18
  inside, 0.37 in the shadow and 0.85–1.03 on the logo, against §8's 2, 1 and 6; **FG, the catalog judged** (`e2c86e7fb`
  and `86b788e2f`: row 32's fourth walk judges the design catalog's Setup Assistant frames, every face by day and by
  night, by row 32's own measure, and DESIGN.md §2.4's ramp holds its floors, item 127, James's GO at 02:26:44Z), as the
  mint M69 (`86b788e2f`, the tip itself), run 69 on the Mac mini: verify green; row 32 on M69 RED at run69b (02:56:43Z),
  its catalog walk red, its only problem 4 words short on one face, 02 field (saving): "Face" and "Or any emoji" at
  2.1:1 by day and 2.5–2.6:1 by night; the catalog's 120 faces with 960 words judged, the error line standing on 8
  faces, and the Text ramp's 32 chips 0 under their floors, t3 at 4.6–5.1 and t4 at 3.1–3.3 by day, 4.9–5.5 and 3.2–3.4
  by night; the frozen frame held at 0 by the field's worker door, the logo at 0.85–1.04; **FG, the catalog judged's
  follow-up 1** (`1c6cb8aac`: an off control says so, the face deck off while its host writes a group that is off to
  assistive tech, its faces dimmed and its words at t4, DESIGN.md §7's Off row first, and row 32 printing every
  passed-over word's ratio), in the mint M72 (`96e99edff`, main `27d61f7a5` merged in), run 72 on the Mac mini: verify
  green at its re-run, run72r (run 72's red is item 139's); row 32 on M72 GREEN at run72b (03:43:45Z), 02 field
  (saving), run69b's red: 0 short by day and by night, the deck's head words passed over as off at 6.5–6.6:1 by day and
  6.6–7.1:1 by night; the catalog's 120 faces with 956 words at 4.5:1 or more (the lowest 4.8:1), the error line
  standing on 8 faces; the 24 words of controls that are off printed at 2.3–7.1:1, 2 under §2.4's 3:1; the frozen frame
  held at 0 by the field's worker door, the logo at 0.85–1.04 (LANDED "FG-1", "FG-2", "FG-3a", "FG-3b", "FG-4a",
  "FG-4b", "FG-5", "FG-6", "FG-6's follow-up slice", "FG-6's follow-up 2 and class C", "FG-6c", "FG-O2",
  "FG-O2's judge", "FG-O2's judge, its fix", "FG-6's catalog", "FG-6's frozen frame", "FG-6's follow-up 3",
  "FG, the catalog judged", "FG, the catalog judged's follow-up 1").
- Next: none built; on VF-PM's word: James's product question (the living logo off the held frame) and his eye list
  (Owed). The glass's literals, item 136, landed 2026-11-04 (`cc8894c46`, M117, run 117; LANDED "Item 136").
- Owed: James's eye list from row 32: Agents with nine installed (PU-L, drafted, would bring nine into the walk),
  History with six rows, Profiles' five cards, and a login opened from This Mac's row (not walked: its Cancel comes
  into view on the fade's top at zero margin; a margin of 10 like the add's, or the slot's `nearest` on the add's
  rule, VF-PM 15:14Z). FG-4b's rulings at VF-PM's leans (05:42Z: the hold's floor, the link read's Continue, the
  swap on `data-face`) and FG-O7 (a) (§9) are James's to overturn. FG-6's lane (07:39Z) was ruled by James at
  13:37:07Z (accept all three). The follow-up's declared skip for a list that fits its body is VF-PM's ruling
  (14:20Z), James's to overturn. The glass terminal's 170 is James's ruling (15:07Z, on VF-PM's 14:57Z lean). FG-O2's
  judge's scope is VF-PM's ruling at its leans (18:05Z, 18:11Z, 18:40Z), James's to overturn: every word on the glass,
  its panes' with its own; the wizard's class inks onto the ramp; the name field's placeholder to item 127, now item
  136's (VF-PM 02:51Z); and a word in a control that is off passed over and said so. The fix's one rule and its scope
  are VF-PM's rulings at its leans (20:46Z, 20:56Z, 21:07Z), James's to overturn: t2 and the two state inks held at 5:1
  at the thinnest stroke row 32 measured, attention in the slice, and no danger or info glass ink until one is worn; the
  error pane stands under the judge since the catalog judged. The frozen frame's seam (FG-D29) is VF-PM's ruling at a5's
  leans (22:28Z), the still's door's answers with it (23:00Z), James's to overturn. FG-6's follow-up 3's two calls are
  VF-PM's rulings at a5's leans (01:16Z: the picture inside the hold, `window.__vfField` unchanged; 01:41Z: the logo
  moved onto the mark's corner), James's to overturn; its product question is James's, named and not built: whether the
  browser's glass wears the field's living mark anywhere but the held frame (a failed pass's glass, its first look),
  where its logo is the brand's still. PR #9 drew the living mark as SVG for such loads
  (`@vibefield/design-kit/living-mark`, LANDED 11-02 in M104 `f2854bf2f`, LANDED "PR #9 and PR #10"); no surface
  wears it until that is ruled.
  The catalog judged's two seams are VF-PM's rulings at a5's leans (02:17Z: row
  32's fourth walk on an in-memory partition, the frame at FG-L2's 736), James's to overturn; its ramp is James's word
  (02:26:44Z). Owed with it: the iOS kit's ChromePalette ramp and the walk window's one
  `desktop.security.unregistered_webcontents` log; item 136 landed 11-04 (LANDED "Item 136"). Row 32's red at run69b
  was the class of the catalog judged's follow-up 1 (VF-PM 03:00Z), answered at run72b: 02 field (saving) with no word
  short by day or by night, the deck's two head words passed over as off at 6.5–6.6:1 by day and 6.6–7.1:1 by night. Its
  two calls are VF-PM's rulings at a5's lean (03:00Z: the off group says so, §7's Off row; 03:01Z: the off deck's words
  at t4, measured), James's to overturn. Owed with it: each off control's own dim onto §7's Off row, their words printed
  and none judged (at run72b, 24 words at 2.3–7.1:1, 2 under §2.4's 3:1 on A6 users (opening)); and a segmented
  control's off state (FacePicker's frame switch, latent). Item 136 landed 11-04 (LANDED "Item 136"); owed with it:
  row 32's judge on its inks (the stills move by its deltas; an off field's 3:1), and James's veto on the deltas.

**AL — what Quit means** · better-quit (lanes `al2`, `al/chords`, `al/chords-2`) · law `draft/thinking-app-lifecycle.md` v0.2 §8, ESR §7.3 (amended), design-00 EL1
- Landed: AL-1…AL-3 (`7ebb1eeda` · `5eea4b2d5` · `697beb199`; AL-4 folded in), AL-5, AL-7, AL-8a, **AL-9** (`933d2fba3`,
  records `d9e5eb119`; AL-D14 "A", D15…D18), **AL-9b** (`cc37d2d8e`, 10-29; LANDED §AL-9b: one chord table in main for
  ⌃⌘A, ⌘Q and ⌃⌘F, a held chord acting once, a non-Latin layout's chord read from the physical key), **AL-10**
  (`27d61f7a5`, 11-01; LANDED §AL-10: the Behavior tab's lifetime row says a quit ends a terminal, DESIGN.md §9's "The
  quit's words"; AL-D19 "no"), **AL-11** (`3ead0fd36`, 11-01; LANDED §AL-11: the relaunch cap read from a log on
  disk, written before each relaunch), **AL-12** (`b14117151`, 11-01; LANDED §AL-12:
  Settings → Diagnostics' "Last exit", kept after the notice), **AL-6** (`79458ac4a`, 11-01; LANDED §AL-6: Keep
  running when VibeField quits). AL-8b RETIRED (AL-D10 "A": no LaunchAgent, not with
  AL-6 either).
- AL-9c candidates, on James's word (VF-PM's board): the deck's no-op `toggleFullscreen`, through a page→main door of
  its own (AL-D19: a person's Ghostty `quit` chord never quits VibeField) · Settings' chord words off the Mac · the
  deck's last-pane count (with ghosttea's "last pane closed" hook).
- Next: nothing queued; the AL-9c candidates wait on James's word.
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
  against the lean. PG-D11 A at 16:22:36Z (the PM board): the phone's queue cap is 256 KiB. James put the phone's
  Godview ahead of the Settings track on 10-31 21:09Z. The Stories row's marks, 11-04 01:12–01:14Z (James, on the
  PG-4s page): J-S1 A, J-S2 (ii), J-S3 drop, J-S4 accept.
- Landed 10-31: **PG-1a…1c**, the desktop's efficiencies first (PG-D9): the model's attach promise withdrawn with the
  join (`e9a57b4b6`), the key-only relay and the window's per-desktop screen (`f2d76f7bf`, `8a3b64ced`), and tailnet
  backpressure at 256 KiB (`2392b0ef8`, `83e08f1e1`), as the merge `1790be95f`, run 18 (LANDED "PG-1a…1c"). **PG-0**,
  the rulings at their sources (`2509d573a`), with PG-1's agent-plane clauses (`ec04b7c41`). **PG-1d**, a gate flip
  re-presents every live field and desk board (`098ae53d1`, as the merge `38f722c3b`, run 37; LANDED "PG-1d").
  **PG-1e0**, the projection bench (`e18cde11e`, as the merge `36574b549`, run 46; LANDED "PG-1e0"): measured, and
  NEITHER 1e1 nor 1e2 (VF-PM 10:08Z). The three cuts cost ~2% of one core at n20 and ~5% at n60 in a busy swarm, the
  model cut ≥85% of it. The bench stays as the instrument; it reopens on a fourth cut projecting the same rows, swarms
  well past 60 busy agents, or the model cut's cost growing (the frames' wire serialization not measured).
  **PG-1f**, PU-I's pin test (`627bda158`, as the merge `5aa41562f`, run 50; LANDED "PG-1f"): an idle priced row's
  silence across the 30 s cost step, `.fails` at puppeteer 0.3.2 beside two controls; the petition drafted, not filed.
  **PG-2**, the remote cut (`2a8c3398a` the contract, `5e70a6c44` fieldd, the relay and the window; as the merge
  `ed212d21b`, run 64; LANDED "PG-2"): the model's one cut for every other screen, `AgentRemoteRow`, cut by its owner
  and paced by its caller's kind (a peer window 100 ms; the phone 1 s, its urgent edge 250 ms). Bare terminals ride it
  (PG-D5), their directory as its folder; each window's mesh asks its peers for `remote`, the phone's `{remote, mesh}`
  door is open at its home, and `desk` retired.
  **PG-3a** (11-01), the witness goldens (`b13390352` → `c5dfba715`, M80 `d14e97880`; LANDED "PG-3a"): the remote cut's
  states a phone reads row for row, hand-written and held to fieldd's own cut, and the home's window computed over
  them as `phone-fold.golden.json` and `phone-body.golden.json`, which the kit transcribes (J1 (a)); item 144 found.
  **PG-3b** (11-01), `reportShown` through the home (`9e3a67729` → `3072786bb`, M84 `fe84493c4`; LANDED "PG-3b"): the
  phone is a screen of the desktop that owns the row, its report routed by `device` through its home and kept on
  the owner as that reader's own screen, keyed by `onBehalfOf` (J2 (a)); screens by kind (`SCREEN_BOARDS`), at most
  64 carried per peer connection, and the report replayed at every re-dial and upstream re-attach.
  **PG-9a** (11-02), the lingering hub, pulled ahead of 3e (`5a7165338` → `4daf4326a`, M98 `29c20cef0`; LANDED "PG-9a"):
  a mesh hub stands `MESH_HUB_LINGER_MS` (60 s) after its last reader, so a phone's app switch and its gap repair
  rejoin it with every peer live on its epoch (item 135's grey flash); at most `MESH_LINGERING_HUBS_MAX` (4) linger
  on one daemon, the oldest closing at once. L4.4's per-device cursor half stays PG-9's.
  **PG-3c** (11-02), the kit reads the remote cut (`8a01d41f6` → `4e2f9ee86`, M99 `666ee281b`; LANDED "PG-3c"): a row is
  refused exactly where the window's `AgentModelMeshRow` refuses it (closed words, null, UTF-16 bounds), a refused
  row costs only its own place (`RemoteBoardScreen`, the window's screen transcribed), and the cut's 13 copies are
  the required mirror set "remote"; the phone's `{remote, mesh}` ask is pinned and unused until 3e.
  **PG-3d** (11-02), the phone's copy of its home's board (`6750ae899` → `8c91dd166`, M101 `fc6146dfe`; LANDED "PG-3d"):
  the window's screen, fold, replica and rows transcribed into FieldProduct (`RemoteMeshCopy`) and held to
  `phone-fold.golden.json` step by step, the whole golden compared; the replica keeps `cost.series` (costOf
  corrected at its source); no caller until 3e.
  **PG-3e** (11-02), the switch, with **PG-3f** stacked (`570683be8` → `2afc9c512`, M106 `c4d142181`; LANDED
  "PG-3e"): the phone asks its home for `{remote, mesh}` and draws the home's window body for body through 3d's copy,
  held to `phone-body.golden.json` step by step; the owner's cost, words and ids on every body; an old home on its
  own ladder; "Watch its agents" says a desktop the phone cannot read; the field cut's read path retired. 3f: the
  phone is a screen, its open card's model id routed by its desktop through the home (PG-3b's rules). PG-3 is done.
  **PG-4s** (11-02), the scaffold (`88be342ae` → `7902bdb13`, M109 `7902bdb13`; LANDED "PG-4s"): the Godview toolkit
  held to `phone-toolkit.golden.json`, the view choice and its stage inputs, and the per-view golden registry, empty
  and live; the Field page stands on the swarm until PG-5…8 add theirs. The door gate the design drew is not built:
  WI-1 retired the page it gated, found at the merge.
  **PG-4t** (11-04), the Stories row (`49b8c1339` → `690cb4e31`, the MERGE M118 `f8deba6b7` into `4d8c28869`, run
  118; LANDED "PG-4t"): one glass circle per view the phone has, under the island at `min(safe top, 48) + 8`, its
  ring the circle's own edge and its name said on a tap (J-S1…J-S4 as ruled); the stage full-bleed under it,
  dissolving in one place; the monitor skin, the views' marks held to `phone-marks.golden.json`, and the shared head
  `3ddde3eac` the view lanes stack on. The kit green on the merged tree, with its stills and a frame meter. N12
  (PG-4s's owed swarm still) is met by 4t's four swarm stills on the merged tree, photographed under 4t's stage (the
  row, the dissolve mask, the physics centre risen), not 4s's bare stage; the swarm's own draw is 4s's unchanged.
  **PG-7, PG-5 and PG-8** (11-04), the spend, list and rain views, as ONE stacked mint over James's `62916410a`
  (VF-PM, 06:56Z): `fe45ac739` (PG-7, `b7bb4bc95` → `3974cf25a`), `e48c48430` (PG-5, `c5569bc95` → `a06690c28`) and
  `c556d1428` (PG-8, `07bf70bc1` → `c928fb22b`), then two fixes, F `655080328` (wall R8: the goldens reach the SDK's
  `/testing` entry by dynamic import) and F2 `125578165` (the rain golden's still stops counting React's
  once-per-process draw, a re-bless); the mint `125578165`, run 123; LANDED "PG-7", "PG-5", "PG-8". Each view is a
  native transcription (PG-D3) on 4t's stage, held to its golden (`phone-spend`, `phone-list`, `phone-rain`). Each
  lane was red first and lit with its stills on its M120 proof; the kit ran green but item 167 on the stack's tree and
  again on F2's (1,738 tests, three apps, 07:27:23Z). The lanes' one-line additions met in three files when stacked
  and were resolved keep-both in the registry's order (LANDED "PG-5"); that resolution dropped PG-8's doc line above
  `case rain` (LANDED "PG-8"; PG-6 restored it). PG-5 keeps its lines whole at 402 pt (its deviation 6); PG-8's
  dissolve costs +1.1 to +1.4 ms of encode at p50, not frame time.
  **PG-6** (11-04), the timeline view (`9c7a4f57e` → `91ced30cb`, 18 commits on `125578165`, the MERGE M124
  `7e2369bd3` into `8817e5563`, run 124; LANDED "PG-6"): puppeteer-views' timeline transcribed natively, held to
  `phone-timeline.golden.json`, its slot green (the probe live) and its stills 4/4 on the proof over the landed head.
  Its two held fixes are in: H6b on the main actor (the kit's four Swift 6 warnings) and TERMINALS' label above the
  names' fade (timeline.css's stacking). PG-8's dropped doc line is restored byte for byte. The registry's order is a
  hand check: git auto-merged `case timeline` under the swarm with no conflict (LANDED "PG-6"). The Stories row now
  draws all five views, and PG-D3 is built (DECISIONS PG).
- Landed 11-05: **PG-9**, the phone resumes from its cursors (`866f7201e` → `77e3add01`, 8 commits on `67831d02f`,
  stacked as M137 `77e3add01`, run 137; LANDED "PG-9"): the mesh subscribe names one cursor per desktop, the hub
  answers each `resumed`, a delta or a snapshot from rows it stamps and removals it keeps to a bound, and the phone
  expands each answer into the whole open it stands for, so no view and no golden moved. Its instruments count a
  mid-stream reset, say how each open was answered, and signpost opens and frames. P2 (James, 11-05): PG-L4.6's
  `agent.get` HELD, (B); the open card shows the 280 cut until a screen needs whole text.
  **PG-9 S4a**, the bench (`6085d4eb2` → `10b98665a`, 2 commits on `fc70097e3`,
  M141 `10b98665a`, run 141; LANDED "PG-9 S4a"): the phone's mesh measured on the desk over a synthetic swarm.
  At n5 and n20, busy is 5.1 and 18.1 KB/s and idle 218 and 855 B/s at the phone's floor, and a 5 s app
  switch by cursor saves 53% and 91% against a whole open. Every idle byte is PU-I's 30 s cost step
  (`monitorRow.cost.series.lastStepAt`), bar four stale flips at n20.
  **PG-9 S4c**, the replay seam (`5b0780458` → `fbfc51c96`, 4 commits on `3e767108d`,
  M150 `fbfc51c96`, run 150; LANDED "PG-9 S4c"): a dev desktop's fieldd plays a recorded synthetic swarm through
  the real door (`FIELDD_DEBUG_SWARM_CORPUS`), one pass of a corpus and then a hold, and a package refuses it
  by name.
  **PG-9 S5a**, the corpora's fold tick (`7fb2cd6b5` → `fdfd2fa3c`, 4 commits on `be195e5b4`,
  M153 `fdfd2fa3c`, run 153; LANDED "PG-9 S5a"): a corpus recipe spells its fold tick and its name says it, and a
  fidelity row on n20 kept fold 250 ms within 5% of the product's tick on the phone's wire (busy 0.92%,
  idle 0.39%). The 120 s corpora could not exist (about 580 MB of JSON at n20). The bench's idle now
  holds one ledger step wherever a corpus ends, and it tallies each desktop's share.
- Next: S5, James's device run on `n5-300s-s1-f250` (and, optionally, `n20-300s-s1-f250`), by his recipe page
  (published 11-05 12:10Z). M1 the n5/n20 rates with the Energy Log, M2 the cap under the link conditioner. PU-I
  is filed by James; on the phone's cut, idle is its cost step alone (PG-9 S4a).
- Owed: item 110 (`project.subscribe`'s no-op snapshot on the phone; item 109 landed as M164, 2026-11-06), kept
  on the shed; the cap read on the phone under the link conditioner (PG-9, S5); from PG-1d, the F-H2 rider (the board's
  gate and the ticket mint read different things) and an old owner's run-id fallback (a design question); from PG-2,
  the draft queue's amendments (design-06's SP-L4, DS-D4 and limits "not built" clauses, design-mv §1, build-mv L8
  and M29, the design record's §8 as built), and `field`'s retirement one release of skew after the kit ships
  (PG-L1); from PG-3a, at a draft slot PG-L2's dated clarification (J1) and PG-1e0's erratum (item 144: the bench's
  remote-cut self-check); from PG-9a, a failed release's empty carried again (not built), and at a draft slot the
  dated note at thinking-desktop-sync-plane :201 (PF6's close; §8's PG-9 line is written, 11-05); from
  PG-3e, James's live look (J-E4, §5); from PG-4t, J-R3 (James's: the dissolve over Rain, (a) built, (b) not built),
  the island question (James's, 4t's packet §5.6: the row at 56 as built, or 8 under each phone's own island, the
  iPhone 17 Pro's ending at 50.7), the tap at y 56–62 (James's hand row), a device's 120 Hz frame meter, and the
  comment-only pair after the land (the island's words in the Swift comments and S1, the stills reader); from
  PG-5…PG-8, James's eye on the name pill, which reaches about 131 pt against the 108 pt reserve and so covers
  each view's first line for its 1.4 s (beside J-S2; not a lane red), and on each view's open words (their LANDED
  entries' Owed).

**WI — the phone's way in** · the IOS session (lanes `lanes/wi`, `lanes/item163`, `lanes/wi3`) · law: the page *The Way In* (5cvau5EQ, v5; sources `draft/ios-pocket/way-in/`), DESIGN.md §8 "The phone's way in" and §9 "The way in"; DECISIONS WI
- Ruled 11-02 11:13–11:15Z (James, on the page): WI-D1…D8 all A, the leans; "way in all ruled, now implement it"
  (11:17Z). The laws WI-L1…L7.
- Landed 11-02: **WI-4 and WI-1 with WI-2** (`40e447bfb` → `08d457f58`, as the merge M108 `8cfe4a59d`, run 108;
  LANDED "WI-1 (with WI-2) and WI-4"): two states, the way in on the splash's field, every word DESIGN.md's. **Item
  163** (LANDED "Item 163"): Settings' unreachable signed-out head and empty list retired; its last "Mac" says
  computer.
- Landed 11-04: **WI-3, the lock** (`80a9e2092` → `ae2d44c00`, stacked as M116, run 116; LANDED "WI-3 — the
  lock"): FieldLock on LocalAuthentication (WI-D3…D7, WI-L5…L7); a curtain window above the sheets holding the
  splash's surface; the way in's last step; Settings › Lock; the corner's Lock now. Item 161 (a dropped leg's
  re-mint had no backoff) landed 11-02 (LANDED "Item 161").
- Landed 11-04: **WI-1's owed witness** (`21aa0b3ec` → `576172d99`, stacked as M120, run 120; LANDED "WI-1 — the
  owed witness"): the stamp `-vf-demo-field-slice-signed-out` stands the welcome over the slice, then signs in by
  itself. The field's bodies draw through `12363ac27`'s refold: 11, and 0 with the refold reverted.
- Next: the Desktop slice (item 160's privacy line, Remove for a phone), held for James.
- Owed: L5's two words and the `inkTertiary` note (James); the mark's fade (James's word on pushing
  vibefield-splash `9219e97`, then `markFades` opened); the lock's four hand rows and its draft words (James; LANDED
  "WI-3 — the lock", Owed). The curtain's glass keeps WI-L4's one height: fitting each glass to what it holds
  would be James's WI-L4 change.

**IOS-12 — the phone's Chat** · the IOS session (lanes `lanes/ios12`, `lanes/ios12b`) · law: the page *Chat in a
Pocket* (M6kri6s5; sources `draft/ios-pocket/chat/`), DESIGN.md §8 "The phone's Chat", §2.10 and §9 "Chat on the
phone"; DECISIONS PC
- Ruled 11-04 02:59–03:02Z (James, on the page): PC-D1 and PC-D3…D8 all A, the leans; PC-D2 the carried A. The
  CP/spark hold lifted 11-04 23:16Z.
- Landed 11-05:
  - **IOS-12a, the cross-plane changes** (`362d1b8be` → `4fcb471af`, stacked as M125, run 125; LANDED "IOS-12a"):
    the scope `sparks.use`; the spark and needs-you doors answer the person's every screen through the phone's home;
    `compose.sparks.say` with its receipts; the remote row's `spark` and `origin`; the face's DNA golden.
  - **IOS-12b, the tab and the list** (`d2971415f` → `8255a10b3`, stacked as M127, run 127; LANDED "IOS-12b"):
    the bar's third tab and its marks (one need, one count); Chat's list from the home, each spark as the Mac reads
    it; the flat star held to its golden; Wake; the note; each desktop's last word, or "never heard" (§9, 02:06Z).
- Landed 11-06:
  - **IOS-12c's M-c1, the fold** (`94ac3d1db` → `2b9b66c14`, M179, run 179; LANDED "IOS-12c's M-c1"): the phone folds a
    spark's conversation as the Mac does, held to the Mac fold's own goldens; a spark's words; the say's wire.
  - **IOS-12e, the star in Metal** (`5bc16c497` → `09378c9ec`, M186, run 186; LANDED "IOS-12e"): a spark's live
    face on the phone is the engine's own, its Buddy and shader transcribed and held to the engine's rows and
    stills; one stage per screen; Chat's list draws it, live while a spark works.
  - **IOS-12c's M-c2, the thread** (`e197648da` → `eda440d58`, M191, run 191; LANDED "IOS-12c's M-c2"): a spark's
    thread on the phone, drawn as the Mac's at touch pitch, read through the home and answered by your words; its
    draft held while its desktop is away; the head's one live face.
- Landed 11-07:
  - **IOS-12d's M-d, what waits on you** (`96cba98cc` → `ef9457363`, M209, run 209; LANDED "IOS-12d's M-d"):
    Needs you heading Chat, the Mac's card at a thread's foot, an answer through the home, an away desktop's
    card withholding its acts; kit-rc on the merged tree.
  - **IOS-12f's M-f1, New spark** (`74599daac` → `01bdd52d7`, M218, run 218, landed as `27c75681f`; LANDED
    "IOS-12f's M-f1"): New spark on the phone, the Mac's sheet at touch pitch on Chat's door, its reads and
    hatch through the home; the sky the star engine's hatch in Metal, held to the engine's rows and its 19
    frames; the face flown to its row, then its thread; the stills' seed.
  - **Item 241's 241a, the Off pill** (`092026d0b` → `13d7f058c`, M219, run 219, landed as `fba72f50d`; LANDED
    "Item 241 (241a)"): a pill that is off draws §7's Off itself, the quiet fill and hairline with its words
    in t4 (`ChromePalette.inkT4`); Start's call-site fade retires; the Needs card's acts wear the same Off.
- Landed 11-08:
  - **Item 241's 241b, the Mac's Off pill** (`75dcbf8d3` → `493ad96b0`, M225, run 225, an ff of `f65af29a9`;
    LANDED "Item 241 (241b)"): design-kit's `.vf-ui-button:disabled` draws §7's Off from the button's own
    `disabled`, the quiet fill with its words in t4; `UiButton`'s `running` keeps a running pill's look.
    Its gate:landing (LANDED, the entry's Owed): the Mac stills green, 19 of 19; row 32 red on the Mac, by the lane's
    target link and then by the gate's environment (item 253, LANDED M232 `ef22fb3b7`; the Mac's witness paid
    GREEN-BUT-263/264 at main `351bea4ce` (recorded `4db42a816`), the BUT settled by items 263 + 264, M239 `9d2b8d03d`)
    and the "ChatGPT Pro" pair (item 254), the rest that run's own.
  - **Item 244 CLOSED** (VF-PM 08:03Z): the stills' one-base rule names the tab bar's glass, at most T = 2
    levels (measured on the old mini over 12 launches), and the Field badge, never judged until item 251;
    LANDED "Item 241 (241b)", Found.
- Landed 11-09:
  - **IOS-12f's M-f2, @ on the phone** (`33b8015f2` → `d9fe8e6c2`, M266, run 266; LANDED "IOS-12f's M-f2"): @ in a
    spark's thread on the home opens the Mac's list at touch pitch; a chip stands in the sentence and a send
    carries it; a session is named by its handle in the list and in the card.
- Next: 12f is whole (M-f1 and M-f2). The session's IOS-13a (Settings
  for App Review) landed 11-06 (Phase 3, below). SP-7's reader, SP-7a's M-b (`432784612`), the home's carry, M-a
  (`d6fe77980`), and M-b2 (`3b8611ec4`) landed 2026-11-06 (LANDED "SP-7a's M-b", "SP-7a's M-a"); 12c builds nothing
  of them.
- Owed:
  - item 169 (a say delivered before a fieldd restart is forgotten; 152's class);
  - cp3 §5's line at the draft queue;
  - the two-desktop run of the merge and a forwarded say (James);
  - item 199 (the Mac fold keys a row by its conversation's opening run; TH-1's fold and M-c1's port);
  - for James's eye: §9's away lines and the held draft's (M-c2), and an ask that does not move a spark's row
    (CH-D1, both platforms).
  - the flight's device read on James's phone: whether a row's `.global` box follows the presenting view's
    scale while a large sheet folds (M-f1);
  - M-f2's device reads on James's phone: a tap on a row of @'s risen box, and the field with the keyboard up;
  - M-f2's unstilled: Effort's row (until a model-chosen fixture exists) and a chip wider than the field;
  - 241b's row 32 on the old mini (the ts6 form, with rosettad), the witness of record: owed on the console
    unlock, a9's row placed 11:21Z;
  - item 242 (the phone kit's `inkFaint` retires, its 40 uses sorted by §2.4's test: 29 words to t3, 10
    marks and an off control's words to t4; VF-PM 11-08 06:10Z), cut on 241b's tip, its kit row R owed;
  - item 248 (the phone's t3, black at 50% by day, reads 3.98:1, under §2.4's floor): a kit-wide ink
    slice with its own stills, James's eye on the number;
  - item 251 (the mock fleet's seed door for the stills, so the Field badge is judged at max 0 like
    every other pixel): a harness slice, when the old mini has room.

**SD — the sound identity** · the sound lead (vibe-field-4a until the 11-05 account switch, ex vibe-field-61;
lane `lanes/sd1`) · law: DESIGN.md §14 "Sound — the field, heard", §8 "Settings → Sound" and §9's queue line;
the pages *Hear What Needs You* (Lq2MXZkT; sources `draft/sound/`) and *Heard While Away* (Rfw94D2y, SD-3's
Q1–Q3), and `draft/sound/design-sound.md` §14–§15; DECISIONS SD
- Ruled 11-05 00:40:17–00:42:43Z (James, on the page): SD-D1…D22, all at the leans, with no tuning and no trials
  saved; his word at 00:43Z, "all ruled with your lean, now land this nicely". SND-0's listening week is skipped by
  that ruling. It left §4, where Q27 had parked it until James picked it up.
- Ruled 11-06 07:22–07:28Z (James, on *Heard While Away*): sound and notice are two separate things (Q1), so
  away VibeField plays the sound itself and a silent notice says what happened; the notice's words (Q2) and a
  click to Godview (Q3) at the leans. SD-D15 is amended.
- Landed 11-05: **SD-1, the law and its code** (`8b22e7b01` → `1ebe7b461`, stacked as M126, run 126; LANDED
  "SD-1"): DESIGN.md §14; `@vibefield/sound`, a second zero-dependency root beside contracts (the field, Starlight,
  the spaces, the masters, the family, the touch and the voice), sample for sample the lab engine; wall R31.
- Landed 11-05: **SD-2, the desktop hears it** (`46535b83f` → `9e5b6eec8`, stacked as M138, run 138; LANDED
  "SD-2"): an agent's sound in VibeField while one of its windows is in front, from main's voice over the mesh board
  (this desktop's agents placed by the panes, every other desktop's from across the field), through the system-sound
  path (a Node-API player at the alert volume); the renders in a worker; Settings → Sound; Quiet in the status item.
  CLAUDE.md's taxonomy names `sound` (James's typed word).
- Landed 11-06: **SD-3, away** (`863a67aa1` → `67034fe61`, stacked as M181, run 181; LANDED
  "SD-3"): with no VibeField window in front, the voice plays every agent's sound, centred in the theme's
  space, and posts a silent notice for each sound it says (the agent, then what happened; a click opens
  Godview); Settings → Sound's foot says so.
- Next: SD-4, the phone (its own kit slot); SD-5, the mark, a terminal's bell and the bloom.
- Owed: James's audible check and his away row (LANDED "SD-2" and "SD-3", Owed); his eye on the foot's words
  (`sd3-foot-words`); the next signed nightly's reads of the player (its release signature, its load under the
  hardened runtime, `desktop.sound.rendered`); the mark's clearance check before it ships.

**MA — Apps (what your agents make, open on every device)** · vibe-field-19 (lanes `lanes/ma/1`, `lanes/ma-3`,
`lanes/ma-4`) · law: `draft/thinking-mini-apps.md` §3–§5 and §9 (the page *Apps in a Pocket*, YJ28uyY3, where it
moved 11-05 22:09Z from MfeTjw5K; sources `draft/ios-pocket/apps/`), `specs/artifact-hub.md`, design-06 §5,
DESIGN.md §2.9, §8 "The phone's Apps" and §9 "Apps"; DECISIONS MA
- Ruled 11-05 07:53:09–07:55:14Z (James, on the page): MA-D7…D9 and D11…D13 A; MA-D10 B, against the lean (an
  app's icon is a crop of its preview, and its project's ink and title's initial until it has one); MA-D1…D6 carried
  A under his typed "good, all ruled, now implement and land this properly" (08:02Z). It takes AH's rows from §4.
- Landed 11-05: **MA-0a + MA-1a, DESIGN.md first and the contracts** (`91c280bbf` → `f657f6dfe`, stacked as M152,
  run 152; LANDED "MA-0a + MA-1a"): the phone's and the desk's Apps in DESIGN.md; six doors declared with no handler
  yet, the scope `apps.use`, `MADE_APP_LIMITS`, three LAYOUT rows (the gen) and the seam's pages.
- Landed 11-05: **MA-3a, 3b, 3d and 3c, M-A** (`82b5c18fe` → `32192ed1f`, stacked as M157, run 157; LANDED "MA-3a,
  3b, 3d and 3c (M-A)"): the library reader and the `apps` table, the made-app service, the replica and the fold, and
  Electron's capture of a made app. They are tested modules with nothing wired, so the six doors still answer
  method-not-found.
- Landed 11-05: **MA-3e, M-B** (`d8afd7a6e` → `ac2fc574f`, stacked as M162, run 162; LANDED "MA-3e (M-B)"): the
  six doors answer. `artifact.open` is `export-unbuilt` until MA-3f calls rosetta 0.1.4's export, and `artifact.mark`
  is `intent-unbuilt` until 3h.
- Landed 11-06: **MA-4, the desk** (`a16205d5c` → `2cccfb168`, stacked as M166, run 166; LANDED "MA-4"), in 0.9 by
  James's "MA-4 in" (00:30Z): From your agents under Live on the Apps shelf, History's `artifacts` port (dormant
  until RO-37), and the screen's word Apps. Every open was still `export-unbuilt`, until MA-3f (11-09).
- Landed 11-09: **MA-3f, serving** (`9ce93fa71` → `0d82b611b`, M268, run 270; LANDED "MA-3f"), in 0.9 by James's word
  (04:36:57Z): an open on the app's own desktop, or forwarded to it, exports the page by digest, builds its view and
  serves it under the app's policy. The two-device witness is owed, on the nightly carrying this native move.
- Landed 11-09: **MA-6's 6a–6d and the gate** (`3148f426b` → `c88ad0908`, M269, runs 271 and 272; LANDED "MA-6
  (6a–6d + the gate)"): the phone reads `index.apps.*` and stands its shelf as a model (6a absorbed MA-1b, which never
  landed), the ink and measures, the feed, the strip and Everything's Apps group, and the door's values. Nothing draws
  yet: `AppsShelfGate.drawn` is false, so the sheet's two slots stand empty until 6e.
- Landed 11-09: **MA-6e, the phone's Apps drawn** (`76e4423dc` → `9873b1ef8`, M272, runs 276, 278; LANDED "MA-6e"): the
  door (the pull from every tab, the peek, the drop, the dot), the shelf, the folders and the zoom to the honest screen.
  No app runs on the phone before MA-5.
- Next: MA-3h, Keep and Hide, now intents in the
  drive's document (DR-2), and with them the phone's Keep, Hide and Versions ·
  item 273, the shelf 62 pt low (LANDED "MA-6e", Found), with James's notes on the ten stills ·
  **MA-5, the phone's host** after SP-4 and its probes P1/P2 (cp-landing's queue).
- Owed: the 10 words marked ‹for James› in DESIGN.md §8 and §9, and §9's interim words for Live (MA-4);
  MA-6's nine interim words and James's device rows: a real pull, a real preview fetch, the zoom, the night that does
  not follow the finger, the unshot dot on it, and his look at the ten stills (LANDED "MA-6e", Owed);
  MA-4's witness by eye; smoke:godview on vf-m1 (items 185, 186); carried from AH: AH-4's
  review, its LANDED entry and its physical witnesses (`cce684ce3`, on main since 08-03), AH-1's two-client
  witness, AH-3's physical closeout, and device-retirement GC with TS's "forget a device".

**DR — the Drive (your apps and pages, held by every desktop, served by any)** · vibe-field-19 (lanes `lanes/ma-4`,
`lanes/ma/1`, `lanes/ma/rosetta`, `lanes/dr/{truffle,truffle-t3,mille}`) · law: `draft/thinking-drive.md` v0.3 (the
page *The Drive*, KB33dCAP, where it moved 11-06 05:45Z from LB8rzJYV; sources `draft/drive/page/`); DECISIONS DR
- Ruled 11-06 (James, on the page): DR-D1 (b), against the lean (rosetta's export door writes the copy); DR-D2, D4,
  D5, D6 and D8 (a) at 01:43–01:56Z; DR-D3, D7, D9, D10, D11 and D12 (a) at 04:41–04:42Z. Then, typed: "Good, all
  ruled with lean, now start the implementation, plan and work in parallel" (04:43Z).
  - It is designed across the sibling repos (his 03:23Z rule): rosetta exports, mille holds, truffle moves and serves,
    and VibeField decides.
- Landed 11-06, each real and called by nothing yet:
  - **DR-1a, the serve policy as contracts** (`a1e722a82` → `86d274f10`, M183, run 183; LANDED "DR-1a").
  - **DR-2a, the drive's contracts** (`2decf299d` → `1fcbf0963`, M188, run 188; LANDED "DR-2a"):
    - the drive's folders and holders' store, and a `drive` lane;
    - `native.mesh.fileTransfer.{roots,pull,subscribe}` over T-3's named roots, a root served only from a node built
      gated (ROOT_UNGATED, ratified 11:01Z);
    - the drive's honest states, generated into Rust.
    - The three mgmt rows were declared ahead of VF-FLOOR (the D36 exception, which DR-3a closed: below).
  - **DR-1b, a made app's view in the files worker** (`e1283cb59` → `dd74abc85`, M190, run 190;
    LANDED "DR-1b"): written by rename into the served folder, never through the export's link.
- Landed 11-07: **DR-3a, W3's VF-FLOOR, stacks A and B** (`207a6f778` → `cb4ec2a4f`, 15 commits, M203,
  run203; LANDED "DR-3a"):
  - in production, the three `native.mesh.fileTransfer.*` verbs answer `file-transfer-unsupported` ahead of the
    node gate, so D36's exception is closed, and a `field.drive.v1` slice over 64 KiB is refused;
  - the named-root arm over a VibeField `PullSubstrate`, held to its rows over `ScriptedPulls` and unreachable
    until the substrate slice after EL8-TRUFFLE; W3-14, W3-15, W3-16, W3-17 and W3-20 ruled (VF-PM 11-06), W3-21's
    floor half in it.
- Landed 11-07: **the EL8 to rosetta 0.1.4** (`8c03c4c5a`, one commit, M205, run205; LANDED
  "EL8 — Rosetta 0.1.4"): protocol and store schema 30, and a publication's `description` and `dropped_files`
  carried to the History door. The export door is at the pin with no caller: every open that reaches it is
  `export-unbuilt`.
- Landed 11-07: **DR-3b, W3's VF-RELAY** (`9edaaaa4e` → `0e61d7f0a`, 19 commits, M217, run217;
  LANDED "DR-3b"): fieldd's pulls over the floor's file transfer, this desktop's holders slice and opaque drive
  records on one lane per peer, held to 150 rows over a mock floor; nothing constructs a `DriveService` until the
  integration lane. A floor restart no longer freezes the holders list (F1, found by review and fixed before the land).
- Wave 1's sibling lanes, filed, merged and released by James on 11-06 (truffle 0.7.27, rosetta 0.1.4 with its
  daemon-archive release still a draft, mille 0.3.5):
  - R-1, rosetta: RO-32 by digest, after DR-D13;
  - T-1 and T-3, truffle;
  - M-D1 and M-D2, mille;
  - RDST, rosetta's transcript day key across daylight saving.
- Landed 11-09: **the EL8 to truffle 0.7.27** (`4f4c9038d`, one commit, M249, run 249; LANDED "EL8 — truffle
  0.7.27"), before the v0.9.0 tag on James's word: cargo and the five sidecars move together, and the Swift plane
  stays 0.7.26. The new sidecar has run on no automated row: its live witness (R1's or row 28's) is owed, and is the
  precondition of the v0.9.0 tag and beta.1.
- Next:
  - The EL8 to mille 0.3.5 in its dev shape, one commit with its own filler (`siblings:pin` to the
    tag; VF-PM's M1: the npm exit waits on a mille 0.3.6 that remaps its release builds and ships its notices).
  - The substrate slice after EL8-TRUFFLE: `impl PullSubstrate for MeshNode`, the install hook in bring-up, the
    `truffle-named-pull` default feature and the `#[ignore]` probe, the first live named pull.
  - The integration lane after EL8-TRUFFLE: the daemon constructs `DriveService` and wires NativeLink's
    "reconnecting" and "connected" and MeshClient's "node-up" to it (`w3-plan.md` §5.8).
  - DR-2 (the drive in the files worker, at mille's release), DR-3 (the sync, over T-3), DR-4 (one address,
    T-2) and DR-5 (a folder or a build published as a version).
- Owed:
  - James's marks DR-D14 and D15. T-2 waits on D15, which reopens D12.
  - Decided before DR-1 (B) wired a caller, on the board: DR-L3's re-check at the view, `dr-l3-blake3-recheck` [b],
    `@noble/hashes` in fieldd now (James, 2026-11-06 23:29:30Z), and `dr-serve-csp-unsafe-eval` [1], rosetta's shell CSP
    kept (23:28:39Z). Both are in M268.
  - Rosetta's EL8's `gate:landing`. DR-3a's and DR-3b's ran on 2026-11-08 at `e60d8add6`, 12 of 14 green (LANDED
    "DR-3a", its Owed): row 10's red is items 253 and 254 (253 LANDED M232 `ef22fb3b7`, LANDED "Item 253"; the Mac's
    witness paid GREEN-BUT-263/264 at main `351bea4ce` (recorded `4db42a816`), the BUT settled by items 263 + 264, M239
    `9d2b8d03d`); row 13's is item 255, host state, so `smoke:studio` is owed again, alone, on an awake display.
  - From DR-3b: items 237 and 238, their root landed by NR S0–S2 (M240 `33162a078`, LANDED "NR S0 + S1 + S2"): a
    refused native subscription tells its owner, and the five gated consumers ask again. NR's S3 brings
    DriveHolders and DriveLaneRelay onto MeshStream, with the integration lane after EL8-TRUFFLE.
  - The two-device witness of MA-3f, R1's class (LANDED "MA-3f", Owed).
  - Item 268's removal of the four orphan `lane-*.json` schema files, after MA-3f (LANDED "MA-3f", Found).
  - The drive's disk budget (the record's §10, risk 5).
  - Findings for James: rosetta-main's seven stripped ts-rs outputs, and the heatmap's daylight saving (a protocol
    change).
  - The draft slot: the record's v0.3 errata and the four loro pins; design-01 §5.2's opened verbs and DR-L1's note on
    pulls, each with DR-2a's sha; RO-32…RO-35 in the petitions' README, shipped in 0.1.4.

**UM + SE — the profile meters and one search** · vibe-field-e0, the UM lead (vibe-field-88 until the 11-06
account switch, then vibe-field-b7 until the second; lanes `lanes/um1` (M-U1), `lanes/um1-ud8` (M-desk's stack),
`lanes/ts4` (S1), `lanes/um1-model` (U3 and M-phone's stack) and `lanes/fix179` (S2)) · law
`draft/thinking-profile-meters.md` §2–§4 (the page *The Bands Meter*, RyPEkD4h; round 3 PUPkEJBC; sources
`draft/profile-meters/`), the plan `lanes/um/PLAN.md` §4, DESIGN.md §2.7, §5, §8 ("The Bands circle", "Godview's
profiles column", "Search — the Peek", the phone's corner, search sheet and token), §9 and §13; DECISIONS UM
- Ruled 11-06 00:06:51–00:07:56Z (James, on the page): UM-D21…D28 and SE-D1…D5 A. UM-D16 E (Bands) and UM-D19 A were
  his chat words of 11-05 21:36Z. UM-D3, D4, D8 and D12…D15 carried A at the leans under his "good, now start
  implement and land this properly, work in parallel" (03:11Z). UM-D6 and D7 are puppeteer's (PU-S, PU-R).
- Landed 11-06: **UM-0…UM-2, M-U1** (`f40ec6621` → `c9493b957`, a fast-forward of `2b9b66c14`, run180, M180; LANDED
  "UM-0…UM-2"): DESIGN.md first for every surface of UM and SE, with tokens.css's 22 chrome tokens; the meter model
  and the Bands geometry, pure, in field-app's `src/usage/`, held to the usage bands golden; UM-D8, the phone may read
  its home's usage batch (`agent.usage` in the tailnet preset, its subscription a passive watcher, its refresh served
  from the cache).
- Landed 11-06: **UM-3 and SE-1, M-desk** (`aeb8177ec` → `ed8099c1e`, 51 commits, a fast-forward of `09378c9ec`,
  run187, M187; LANDED "UM-3 and SE-1"): Godview's profiles column in the chrome slot, one Bands circle per profile,
  each the lens, with its popover and add, and the limit moment beside the add as round 4's card; puppeteer-views'
  usage column and its flat 80% left the stage; Settings says the same meter through the leaf; the Peek is Tokens
  with + Filter and the small switch at the field's end, one filter everywhere.
- Landed 11-06: **UM-4 and SE-2, M-phone** (`a43224dbc` → `d6d76d079`, 70 commits, a fast-forward of `d6fa5e31a`,
  run198, M198; LANDED "UM-4 and SE-2"): the phone reads its home's cached usage through the desktop's own model,
  held to the golden; the Me menu's Agent Profiles row and its page; the held face; search a glass sheet over the
  field, Live now first; the profile token above search, its lens receding the rest of Field's list, rain, timeline
  and swarm. MA-6 is unblocked: the sheet names the two slots MA-D7's strip fills.
- Landed 11-09: **M-phone's owed generator** (`f4bb97e8d` → `72952b2c0`, M264, run 264; LANDED "UM-4's owed
  generator"): the phone's glyph and plan-title tables are held to the pinned packages by one generated golden,
  mirrored into the kit; the tables themselves stay hand copies. And in M260, M-desk's Settings catalog plate
  (LANDED "UM-3's plate, Q20, Q5 and ES-6").
- Landed 11-09: **UM-R, the column's cards** (`1506cb785` → `a2a1b68db`, M271, run 277; LANDED "UM-R"), James's two
  defects: the cards stand above the terminals and a pointer can reach them. V is green; the window rows and his eye
  are owed, and only they prove the defects gone.
- Landed 11-09: **UM-5, the plan filter** (`f3a7cb587` → `2082837d3`, 25 commits, M273, runs 280 and 281; LANDED
  "UM-5"): choose a plan and the field shows only its sessions, on the desk and the phone. V is green and the kit
  is green but for item 167 (K GREEN-BUT-167); the stills are James's and the device witness over real rows is owed.
- Landed 11-10: **the EL8 to puppeteer 0.4.0** (`fe6a04a7f` → `996c51939`, 12 commits, M274, runs 283 and 284; LANDED
  "EL8 — puppeteer 0.4.0"): item 171's fix, PU-S's body that wears its profile with nothing new passed, and the phone's
  Timeline and Spend ported to 0.4.0's rules. A desk with two profiles is James's eye.
- Landed 11-10: **UM-R-F, the column's open calls** (`a5f16b79b` → `d597a7b95`, 13 commits, M276, run 288; LANDED
  "UM-R-F"): James's c3, c4 and c6, a pinned circle's tell, focus as pointing and a pill that scrolls. V is green;
  the Mac witness and his eye on its two ‹for James› marks are owed.
- Next: **PU-R's bands** in puppeteer (James's b1 "bands"; built on `pu/bloom-bands`, unrun, his to push), its
  release and EL8, then **PU-R's consumer**, the bloom's buds wear their fuel, its DESIGN.md text first.
- Owed:
  - UM-R's window rows: `smoke:godview` with UM-R6's rung (written, never run), `smoke:godview:no-record`,
    `smoke:first-run` and `pnpm gate:landing`, on James's typed word and the Mac's swap draining (or his word on
    that), one invocation per row, display awake; then his eye on a card over live terminals;
  - UM-5's: `pnpm gate:landing` with `smoke:godview` on James's typed word; the R rows at its Swift red shas, until
    James names kit dirs to reap; the two-plan desk witness; the device witness of the plan filter over real rows;
  - UM-R-F's: the Mac witness (a click on a circle, ⌘Tab away and back, the deck's lip, six or more profiles with
    the terminals away) and `pnpm gate:landing` with `smoke:godview` on James's typed word; his eye on c3's 8% and
    c4's reading (DESIGN.md §8's two ‹for James› marks);
  - to James: the ‹for James› marks in DESIGN.md §8, §9 and §13 (the lead's rulings 1, 2, 5, 19, 22 and 24; UM-D14's
    wave-1 interim; the self-only lens; the desk token clearing on close; the model's words; §9's marks; the page's
    age width, the honest words and the spoken hints; Every profile's `person`; LANDED "UM-0…UM-2", "UM-3 and SE-1"
    and "UM-4 and SE-2", Owed), the board ask `um-stack-words` (W1–W8; the words stand as built in the interim) and
    UM/SE's place in 0.9 (lean: in);
  - M-desk's: the catalog stills (the popover's 12-tall line, the limit card's hover, Settings' rows);
  - M-phone's: the stills no row took (the token's menu, search over History, the page three hours on, a stale body
    receded, PJ-7's bloom bud);
  - the petitions PU-R and PU-S: shipped in puppeteer 0.4.0 (#76, #77) and pinned at M274; their records in
    `draft/petitions/` are unwritten (his to file);
  - SLOT 18's riders: the record, seven at-source corrections, the petitions and the page's hold words.

**RV — the review fixes (Godview's agent monitor, the terminal stack and puppeteer, for Claude Code, Codex and Grok)**
· vibe-field-62 (was vibe-field-06; lanes `lanes/au`, `lanes/fg2/vibe-field`, `lanes/fg2/records-fu1`, and the sibling
clones `lanes/rv/puppeteer`, `lanes/rv/ghosttea-clone`) · law: the plan `draft/rv/plan.md` (27 lanes in 8 waves) and
its rulings (`draft/rv/james-asks.md`, `draft/rv/lead-rulings.md`); the review `lanes/rv/review/`; DECISIONS RV
- Opened 11-06 06:24Z by VF-PM on James's word (06:21Z): "now i want you to plan and fix them all properly in waves
  and in parallel". The review behind it ranks 118 findings: 1 critical, 6 high, 34 medium, 74 low, 3 disputed.
- Ruled: the lead's three, at the lean (rv-monitor-dedup A, rv-selection-fence A, rv-transcript-turn-rule B, whose
  18:47Z follow-up has the window walk replay the unbounded walk), and four in build (rv-claude-a-w1p2-fixes,
  rv-ghosttea-option-minor, rv-pup-monitor-fold, rv-ghosttea-relay-gap; `draft/rv/lead-rulings.md`). James's 15 asks
  were on the board as `rv-*`: all fifteen RULED at their leans on 11-06 (rv-service-recovery and
  rv-godview-honesty at 22:56Z, the other thirteen at 23:11Z; James's "all leans"), rv-pr58-codex-observer at (a).
  Every mark that said "open until James rules" says the ruled lean (`dc05d6ce7`, the words commit after item 212).
- Landed 11-06: **item 191, RV #2's half A** (M192 `0d1d66f05`; LANDED "Item 191"): fieldd ends a typed run by its
  proved process, never the person's shell. Its deck half is next (rv-typed-stop Q2 ruled at its lean). smoke:godview
  row 14 green.
- Landed 11-06: **item 192, RV #6** (M193 `09940c201`; LANDED "Item 192"): a release that keeps the floor counts the
  agent runs fieldd's stop ends, asks, and fieldd re-checks them at the stop. Built at rv-update-census's lean C.
  smoke:update row 30 green.
- Landed 11-06: **item 201, RV #17, #43, #49, #48, #50** (M194 `db181a008`; LANDED "Item 201"): a held run's end is
  told, a replacement waits for the old process's exit, the boot's grace sweeps per record, an unread re-attach
  settles nothing and asks again (rv-s9-records' lean B), and a dead pane is no live terminal. smoke:godview green
  (gv4, at `db181a008`).
- Landed 11-06: **item 203's VF-W1, RV #1's pin-free half** (M196 `02aed7ec2`; LANDED "Item 203, VF-W1"): fieldd's
  executable is the daemon only with no argument; a script handed to it as if it were Node is refused in one line
  with 127, never a second daemon. Words at rv-forwarder-role's lean A.
- Landed 11-06: **item 211, RV #97, #96, #93, #116, #95, #47** (M199 `c39e45518`; LANDED "Item 211"): field-native's
  terminal plane holds its own: an upgrade has a deadline, a closed credit account closes, each pump wakes for its
  own session's frames, seeds keep to their negotiated slots, and a cell whose serve plane fails exits.
  smoke:godview and smoke:terminal-direct green (gv5, at `5d58c8731`).
- Landed 11-06: **item 212, RV #30, #29, #67** (M201 `86d14e31b`; LANDED "Item 212"): the shell keeps its fieldd
  honestly: a busy incumbent is waited for, recovery is three tries in ten minutes then Stopped with Try again, and
  a silent fieldd is said Not responding, an owned one ended alone at the wedge bound (rv-service-recovery's leans).
- Landed 11-07: **item 216, item 192's census row** (`system-shutdown-census.test.ts:519`; M204 `339d0a26e`; LANDED
  "Item 216"): the row awaits the replaced PTY's leaving fieldd's inventory, which comes over a socket the successor's
  birth does not; test-only, the probe P1 its proof (run 200's red at the parent, every time).
- Landed 11-09: **item 213 (2)**, design-system.test.tsx's restructure (audited `a6c189ed6`, landed `f31871864`, M243,
  run 243, an ff of `0b98488bf`; LANDED "Item 213 (2)"): two rows keep the whole catalog, four mount their one preview
  and the Studio's two run over the page with its sections stubbed; test-only. The theme row's split waits on the
  20-verify watch and a new ruling after beta.1.
- Landed 11-10: **item 203's VF-W3a**, the closed agent-forwarder role, and **#73's gateway split**, in the EL8 to
  puppeteer 0.4.0's stack (M274; LANDED "EL8 — puppeteer 0.4.0"): a packaged fieldd lends puppeteer its own forwarder.
  Probe G and desk-gates row 34 (packaged, the release runner) are owed.
- Landed 11-10: **item 277's S0** (`f85d0b023`, docs; LANDED "Item 277's S0"): the usage page says where 0.4.0 puts
  a Claude push, and the three cases that still get no sink. S1 ships in 278's puppeteer release; D2 is James's.
- Landed 11-10: **item 287** (`36d8a3aa0`, `c0032d626`, M275, run 287; LANDED "Item 287"): fieldd starts only through
  the coordinator, and a guard row holds teardown's order. Nothing a person sees changes. Its residual is item 290.
- Landed 11-10: **item 290** (`105280023` to `57096484d`, M278, run 290; LANDED "Item 290"): a pair that comes up
  during a person's quit is stopped with the rest, and a switch or a new user is refused while VibeField quits. Its
  refusal reached the window with the class's name, by reading; item 314 fixed it.
- Landed 11-10: **item 314** (`07f41fc86` to `8bbc3d504`, M281, run 294; LANDED "Item 314"): the quit's refusal reaches
  the window in James's words alone, with no class name, and DESIGN.md §9 names the Settings head and the chooser.
- Landed 11-11: **item 315** (`4636f1f0e` to `e464eb5cc`, M282, run 296; LANDED "Item 315"): once VibeField's quit
  goes ahead, a switch or a new user pressed at any of the window's five doors does nothing and says nothing, as
  James ruled; the press goes to the log alone.
- In flight:
  - the sibling lanes, filed by James on 11-06: puppeteer #64 rv/pup-monitor (#84, #81, #9) and #65
    rv/pup-claude-a (#1, #61, #4, #3, #5a, #64, #62, #63) MERGED, #66 rv/pup-views-a (#38, #39, #106, #107, #40,
    #105) open; ghosttea #102 rv/ghosttea (#115, #37 G-A, #92, #113, #94) MERGED. Their releases and the EL8 pins
    follow. At James's hand, their PR scripts ready (`lanes/rv/pr/`): rv/pup-claude-b (#14, #111, #66, #110, #13)
    and rv/pup-views-b (#103, #104, #41, #101, #108). Building: rv/pup-claude-usage (#70, #32, #34, #102, #109,
    #35, #33). Parked: rv/pup-codex (on rv-pr58-codex-observer).
- Next: ghosttea 0.15.0 → EL8-g → rv/vf-ghosttea-tail; waves 3–8 by the plan.
- Owed: James's hand on every sibling PR and release;
  smoke:plugin-restart and the plugin-runtime soak for item 212; item 215 (freeway's link door), item 217 (item 198's
  door did not take a fresh connection for 30 s after fd pressure; load not shown to be the cause, corrected
  2026-11-07; measured beside item 204) and petition G36 (ghosttea's accept loops).

**HN — Cards in Hand** · vibe-field-a1 (lane `lanes/hn`) · law `draft/thinking-cards-in-hand.md` §6 (page sources `draft/cards-in-hand/`), DESIGN.md §1/§5/§6/§8/§9/§10/§13
- Ruled 10-29 10:40Z (James): all sixteen at their leans (LN-D1…D3, HN-D1…D10, PL-D1…D3); HN-D1 was his own pick on
  the page.
- Landed 10-31: **B1** — HN-0 (`0e2ad08bc`: DESIGN.md first) and HN-1…HN-4 (`6835b5398`: the hand at the window's
  foot, the line `[views] snapshot create`, the desk's Copy ⌘C, a card played into a pane or onto the desk), as the
  mint `23e9c2538`, run 22, verify only (LANDED "HN B1"). **B2** — HN-5…HN-7 and LC-17's follow-ups (the doc
  `a7de38b5f`: every copy deals a card and reaches the system clipboard, the picture's write half; another app's
  paste and drag; History's New terminal ⌘T), as the mint `e71f2d332`, run 26, verify only (LANDED "HN B2").
  **B3** — HN-8, Artifacts in the head (the pill's package and its two-shelf sheet, the covered views' package circle,
  the Hub in tiles; the edges leave the frame), as the mint `e31e55ecd`, run 28, verify only (LANDED "HN B3"). The
  track is built: all sixteen marks.
- Next: nothing built is left. The Hub in the head's smoke:godview rung is built: 11k, on main since M44
  (`bcedadd4e`; LANDED "HN — smoke:godview's rungs").
- Owed: D10, one caption style for both of the sheet's shelves as the page drew (§9); a card dropped on the desk is
  not smoke-covered in Electron; G30 (⌘C in a pane) and RO-31 (Copy in History) upstream (§7). HN's console-window
  rows are all paid: smoke:canvas's at runs 30b, 35b and 38b; smoke:godview's 11h and 11j at run 38b, and 11k and
  11l (its Esc from the body too) at run52b (M52 `c564de0e4`).

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
- **Godview lifecycle QA (2026-11-02):** stable pane identity through launch/exit, terminal-owner
  release with durable retry, and full-size swarm geometry with an eased terminal wall. James's
  new ruling makes Stop end the agent and adds Pause for one current-turn cancellation. The
  consumer adopts published Ghosttea 0.13.8 and Puppeteer 0.3.3; LANDED records the release
  coordinates, unchanged phone parity values and verification.
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
- **PT-S3, the gates**: built code-only on James's board word (10-31 01:16Z: "write the checks now, run on my
  unlock"), light-green on this Mac 10-31, LANDED 10-31 (`d3f974f84` in the mint `c564de0e4`, the mini's run 52;
  LANDED "PT-S3"); its brief's P1–P16 are the orchestrator's leans. `pnpm smoke:phone` (L2), `:none` (L1) and `:cost`
  (L3) run the phone's rows under a stage that arms on the console's idle, makes and deletes only its own devices and
  restores the host (desk-gates row 33: landing-only, never inside `gate:landing`); P1 finds Xcode beside the Command
  Line Tools. **The first console run, 11-01** (James's unlock): L0 ENUM GREEN (Ghostty holds Screen Recording, no
  prompt), L1 GREEN (after field-native was built: items 133/134); L2 ran 14 of 20 rows: real Simulator pixels
  reached the desk (SIM-CAP's band), and its four reds and two VOIDs were the harness's, not the product's: a fresh
  device's door verbs before iOS was ready, rows judging pages never opened (item 140, LANDED 11-01 in the mint
  `aa5bf3669`; P7, P8 and H1 ruled at the leans).
- Next: **PT-S3's L2 again, under a new run id, at James's launch** (L0 and L1 stand; SIM-STOPPED-CLOSED and P7's
  hand witness after it, if he offers; L3 on the mini on his word, or skipped): a booted simulator streams its real
  pixels to the desk, each
  honest face, the Screen Recording and Accessibility flows, "Show it" on a running Simulator.app (P7: recorded, its
  fix ruled after), the stopped word (P8), the fps buckets (PT-S2's R9: the law's 12 at rest arrives as 10), the
  letter of PT-S2's R7, the cost at the cap beside a pane
  → PT-S4 (touch through serve-sim, supervised, after its `killPortHolder` is fixed: an EL8 pin event, loopback
  only, never `--allow-exec`). The capture bake-off (PT-S-B1, prepared in `/Volumes/SamsungRed/lanes/pts/bakeoff/`)
  stays queued on the mini; its result decides whether serve-sim's stream later replaces SCK's.
- Whether the phone ships among `BUNDLED_PLUGINS`: no, for 0.9 (James, 2026-11-09, DECISIONS "FL"; PT-S2's R13 and
  PT-S3's P14 left it and the dev bundled set (`field-engine.ts`) untouched).
  Owed: PT-S1's host-bound files and its two ICE candidates (§6 PORTALS).

**CO — the compose plane (sparks and their doors)** · cp-landing (lanes `co` and `mt/mt0`; the tool plane's build too, since the MT lead's session, vibe-field-dc, ended 10-31) · law `draft/compose-plane/thinking-roled-agents.md` §15–§17 and `draft/compose-plane/v2/` (version 2, ruled 2026-10-29), `draft/thinking-tool-plane.md` (MT, ruled 2026-10-30), DESIGN.md §2.10
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
  - Claude only, until CP-5c: at puppeteer 0.3.3, as at 0.3.2, only the Claude adapter declares a terminal MCP
    process. Since CP-5a the catalog's `spark` claim is read first, and Claude Code's row alone makes it.
- **MT-0, the tool plane's first slice**: LANDED 10-31 (`b3a0cc95a`, the mini's run 29; LANDED "MT-0").
  - `contracts/src/tools.ts` is the one catalog, with audience and scope columns, and `fieldd/src/tool-plane/` serves
    each caller its rows: a spark every served row, a plain run History and the projects list, by its own briefing.
- **CP-2, start and talk**: LANDED 10-31 (`b4357a345`, the mini's run 33; LANDED "CP-2").
  - A spark starts agents one level deep, watches them and talks to them through each session's one input queue; its
    words land at the session's idle, marked as its own and sent on the person's behalf (CP2-D1).
  - CP2-D7's quiet wait waits on a floor fact (the person's last keystroke); the ordering guard stands meanwhile.
- **SP-1b, Chat's list**: LANDED 10-31 (`30d610136`, the mini's run 39; LANDED "SP-1b").
  - The fourth view is Chat. Its list is the sparks fieldd keeps, newest activity first, live from the field board,
    whose rows now say whose session a run is (`spark`) and who started it (`origin`).
  - The needs-you three take the attention ink and the orange dot, on the row and on Chat's cell, with a 2.4 s note
    from another view.
- **SP-1c, the New spark sheet**: LANDED 10-31 (`ec2d296ef`, the mini's run 42; LANDED "SP-1c").
  - Chat's create is New spark (⌘N). It asks a name, the agent that can take VibeField's tools and its model, and
    the profiles once there is more than This Mac; Create's refusals are said where the sheet asked.
  - Hatched, a star falls and bursts in the sheet's sky, and the face is born there and flies to its row in Chat.
- **SP-1d, Chat's thread and composer**: LANDED 11-01 (`7871ce1f1`, the mini's run 83; LANDED "SP-1d").
  - An awake spark's thread is its own conversation in Chat, with Chat's composer under it: @'s agents and sessions,
    and Send, which goes through `compose.sparks.say` and the input queue: its bubble says Delivered when puppeteer
    confirms the agent has it (LANDED "TH-1 and TH-2" and "Item 185").
  - A new spark says hello with three starters. A thread's unread dot lasts until you open it. A thread takes one act
    at a time, and fieldd wakes a spark once.
  - Its smoke:godview rung 11m is on main since M97 `f0e7bb465` (2026-11-02), row 23 green as run97b, with items 149
    and 151 (LANDED "SP-1d — smoke:godview's rung 11m").
- **CP-3, the person**: LANDED 11-01 (`ce6577783`, the mini's run 88; LANDED "CP-3"), on CP3-D1…D8, all A (James,
  10-31 06:31:34Z; `draft/compose-plane/cp3-the-person.md`). CP3-D3 is built as its fallback, B, until a session's
  permission mode is a fact VibeField reads.
  - A spark asks you (`ask_user`) and tells you (`notify`). What waits on you is one queue in fieldd: a spark's
    questions, which wait on your answer, and its first send into a session you started and a spawn past 8 live
    agents, each held for your OK.
  - Chat's row says it, with the orange dot and the note, and the thread shows its card, answered once for every
    window. A notify is one line on the status line, and an OS notice while no VibeField window is in front.
- **TU-1, the turn fact and the one placement rule**: LANDED 11-02 (`57569bca3`, the mini's mint M96; LANDED "TU-1"),
  on the read's seven marks (Q1 and Q2 A by James, 11-01 08:31:35Z, on the decision page; Q3–Q7 by VF-PM, 07:17Z) and
  the plan's §12 (VF-PM, 14:01Z: (a′), O1 out, the pending tail named).
  - fieldd keeps whether a spark, and each run's conversation, has worked (`turnedAt`), and Chat's hello reads it: a
    spark that has worked never says hello again, across a restart or a wake. An ask alone is no turn.
  - One rule places a run in an Agent Profile (`profileSetOfRun`) for @, the talk room, the needs-you Allow, the
    compose room, the door and the New spark sheet's count. The board's row carries the profile its run is filed
    under.
  - A turn no fieldd saw (while it was down, or in a run a restart could not re-attach) is not kept. It is named
    (Q4), not closed.
- **The handle, the card names a session as @ does**: LANDED 11-02 (`045f10ec7`, the mini's mint M100; LANDED "The
  handle"), on VF-PM's ruling (11-02 01:41Z) and the plan's Q0–Q7 (VF-PM, 02:12Z, all at the leans).
  James's frame: https://claude.ai/artifact/K4DcyuvBebfNqguLKjzxQc.
  - The needs-you card names a session as @ does, one rule read twice: two untitled sessions in vibe-field read
    "vibe-field" and "vibe-field·2", never two "Claude Code"s. fieldd's name stands only where @ offers none.
  - Chat reads its Agent Profiles once, in its controller, for every thread's @ and the card.
  - Owed: whether a title should win in @ (Q1, James's; §9 below). Q3 closed with CO-1b (fieldd's reason says "it"),
    and Q7 in part (notify's teller reads fieldd's CO-1b name).
- **Items 158 and 159, and CO-1b, one stack**: LANDED 11-05 (`9b3164ccf`, the mini's mint M129, run 129; LANDED
  "Items 158 and 159, and CO-1b"), on the CO round (James's page Druyc3Ua, 68/68 picked, read 11-04 23:14Z; the
  CP/spark hold lifted 23:16Z) and the step-0 plan (RULED 23:16Z): TH-Q32 (a), CO-Q9 (b), TH0-Q11 (b), CO-Q4 (b).
  - **158**: the input queue stamps its head before it sends it; a send a restart broke into is said uncertain once and
    never sent again, a say's retry included. An answer stays owed until its session takes the line (CO-Q9 (b)).
  - **159**: each spark keeps one signed record, `spark-files/<spark>/kept.json`, its sections whole across writers.
    Nothing writes it yet: 1′, SP-1e2 and TH-1 each add theirs. Later slices join the settle with one `joinSettle`.
  - **CO-1b**: fieldd names an untitled session by its agent in its folder ("Claude Code in vibe-field"), and a reason
    after a colon says "it" for a session its sentence names.
  - Owed: item 169 (a say delivered before a fieldd restart is forgotten) · 1′'s held wakes (item 152) · CO-Q9's
    second half (fieldd's own wakes, unaudited) · the screens that draw item 172's refusal (a store fieldd cannot
    read): the phone's Chat (sparks, needs, needs.subscribe) and field-app's needs board.
  - For James's eye (draft words; not a hold): a dropped answer's "Vela's session ended before it took this", and
    CO-1b's names ("Claude Code in vibe-field"; "…: it ended"; "work is not one of Vela's Agent Profiles").
- **CP-5a, the spark claim**: LANDED 11-05 (`fc70097e3`, the mini's mint M140, run 140, stacked; LANDED "CP-5a"), on
  the CO round's CP5-Q1 (b) and CP5-Q9 (a) and the step-0 plan (`step0-cp5.md`, RULED 23:16Z; §12 at its leans, 23:22Z).
  - The catalog's `offers.spark` says which agents VibeField lets be a spark. Claude Code's row alone claims it.
  - R23 holds the claim to the pin's briefing (all three fields, a terminal MCP process) and to the row's status: it is
    claimed on `supported`, and a `deprecated` row keeps it, so its sparks still wake.
  - fieldd's hatch reads the claim before the facts (`spark-not-offered`), and `agent.providers` sends it as the
    hatch's verdict.
  - The New spark sheet lists the agents that can be sparks first, then the installed ones that cannot yet, disabled.
  - Owed:
    - the claim's live witness, the proposed hand row, owed to James's hand (its desk-gates number is taken when CP-5c's
      line lands);
    - the Studio plate, by eye;
    - the phone's New spark sheet reading `offers.spark` (IOS-12).
  - For James's eye (draft words; not a hold): the sheet's two kinds, and fieldd's new refusal "VibeField does not
    offer this agent as a spark".
- **CP-4a1, flows' first part**: LANDED 11-05 (`1a3ca5f24`, the mini's mint M143, run 143, stacked; LANDED "CP-4a1"),
  on the CO round's CP-4 marks (all at the leans) and the step-0 plan (`step0-cp4.md`, RULED 23:16Z; CP4-S at the
  leans, 23:22Z).
  - fieldd reads the person's flow library (`flows/`) as approved, changed, new or too big, and keeps a flow's bytes
    by their hash, its approval and a spark's proposal, signed: item 172's fifth store.
  - The static read says what a flow's bytes will call (its meta, its `agent()` calls, its gates) without running
    them. `acorn` and `ses` are pinned in fieldd behind wall R32.
  - Nothing calls it yet: the five `flows.*` doors are declared with no handler.
  - For James's eye (draft words; not a hold): "VibeField can't read the flows it keeps; nothing was changed".
- **CP-4a2a, the flow host**: LANDED 11-05 (`c07039551`, the mini's mint M159, run 159; LANDED "CP-4a2a"), on
  the CO round's CP-4 marks and the step-0 plan (`step0-cp4a2.md`; 4A2-Q1…Q10 ruled by VF-PM 08:51Z, Q7 re-ruled (b)
  11:46Z).
  - fieldd starts one child per run, as its own executable in the `flows-host` role. The script runs locked down in a
    worker inside it, under V8's own cap, on a bounded pipe; a spinning script, a heap past its cap, a broken bound
    or a flood ends the host, said in fieldd's words.
  - fieldd journals each call and answer, every line MAC'd, and a host started again replays what the journal holds.
  - Nothing calls it yet: the runs, a step's lines and the doors' handlers are CP-4a2b's.
  - For James's eye (draft words; not a hold): DESIGN.md §9's five sentences for a run's host.
- **CP-4a2b's first mint, M-h (the host's tail)**: LANDED 11-05 (`aebd6a80b`, vf-m1's mint M163, run 163, its
  first mint there; LANDED "CP-4a2b's M-h"), on CP-4a2b's step-0 plan (`step0-cp4a2b.md`, RULED by VF-PM 16:24Z;
  Q-A0 (a): four mints, M-h, M-r1, M-r2 and M-d).
  - A leaving flow host kills itself past its deadline, a memory count it cannot read ends its run, SIGUSR1 opens no
    inspector, and a row holds the resident read alone (CP-4a2a's Owed O1, O2, P6 and O3).
  - The static read refuses the three shapes the run's sandbox refuses, by SES's own tests; the compartment pins
    WebAssembly, SharedArrayBuffer and Atomics undefined; a flow host carries a smoke's run mark; and wall R32 keeps
    every file outside the host's folder from importing one under it.
  - Nothing calls the host yet: the rest of CP-4a2b (the runs, a step's lines, the doors' handlers and the verbs) is
    M-r1's, M-r2's and M-d's.
  - For James's eye (draft words; not a hold): DESIGN.md §9's three refusals, such as "it calls import(), which a
    flow may not".
- **CP-4a2b's second mint, M-r1 (the seams)**: LANDED 11-06 (`c92b33692`, the mint M168, run 168; LANDED
  "CP-4a2b's M-r1"), on the same plan, with VF-PM's 22:48Z and 03:33Z rulings.
  - Every run that enters is told, with its origin and its own spark; a flow step's turn end is heard from
    puppeteer's own events, its result by CP4-S2's road.
  - A run's own signed record is written first and anchors its journal, so a fieldd started again reads a cut tail
    `lost` (D18); the needs queue takes a flow run's items, the runs' acts then Stop the run.
  - 13b's contracts under them: a run's record, `stopping`, the six bounds, the seven acts, a flow's two senders, a
    cut step, the bounded list and the verbs' shapes.
  - Nothing calls the runs yet: the flow's own engine is M-r2's, and the doors and the verbs M-d's.
- **SP-1e2, the crew and its card**: LANDED 11-05 in two halves, fieldd's (`068cab410`, the mini's mint M146, run 146;
  LANDED "SP-1e2") and the renderer's (`320d4b882`, the mini's mint M156, run 156; LANDED "SP-1e2's renderer half"),
  on the CO round's SPE marks (all at the leans) and the step-0 plans (`step0-sp1e2.md`, SPE-Q26…Q40 at the leans,
  23:22Z; `step0-sp1e2r.md`, GO'd 11:03Z, SR-Q5 (i) ruled 11:59Z).
  - fieldd joins the agents a spark starts in one stretch of its own run's work to one crew, closed at that run's
    first idle with no talk call in flight, or at its end. A held spawn keeps its crew; Allow one more joins it.
  - The crews are kept in item 159's record, members kept after they end, and served whole, with what each live member
    waits on, by `compose.sparks.crews.subscribe` to the person's windows and devices.
  - fieldd's crews write each crew's act line ("Started 4 agents · Opus 5.5 · high"), which closes item 180. Chat
    hangs the crew's card under it, live from the crews door and the board; a row press reveals that member's pane.
  - Owed: J1 and J2 by James's eye (at their leans; the page `FCt3B8hw6AsAQ3fDHYRS1m`); the crew rung (SPE-Q34 (a):
    the smoke's stub agent has no MCP); eyes on the catalog's plates; the phone's card (PC).
  - Not here: Stop all and Pause all (SP-1e4); the watch card (SP-1e3, HELD).
- **TH-1 and TH-2, Chat's thread as the spark's conversation**: LANDED 11-05 (`d5c6995fb`, the mini's mint M147,
  run 147; LANDED "TH-1 and TH-2"), on the CO round's TH, TH0 and CO marks (TH-Q3 (b) James's click, the rest at the
  leans) and the step-0 plan (`step0-th.md`, RULED 2026-11-04 23:16Z).
  - fieldd keeps each of a spark's runs as its transcript in the spark's own folder, each line MAC'd, and a worker
    of its own serves it to the person's windows by ticket.
  - Chat's thread draws that conversation; Send goes through `compose.sparks.say`; the pane leaves Chat; the head
    carries Jump to, Wake and Pause.
  - Not here: Copy a message, TH-3's marks.
- **Item 177, the sessions' records on the one signer**: LANDED 11-05 (`7b4ec2b90`, the mini's mint M149, run 149;
  LANDED "Item 177"), on item 172's Found 1 (filed 04:30Z by cp-landing) and the step-0 shape (`step0.md`; VF-PM's
  GO 05:12Z, D1 upheld, D2 (B)).
  - SessionRecordStore runs on RecordSigner and item 172's StoreGuard. Its key is read and made as base64, as it
    always was (`keyEncoding`), so a record signed before 177 verifies after it.
  - A sign-out and a set's delete ask first, and refuse UNAVAILABLE {agents, records-unreadable} before anything is
    retired. The readers that only look go on with none, and say so in fieldd's log.
  - For James's eye (draft words; not a hold): "VibeField can't read the sessions it keeps; nothing was changed".
- Next, in order (the CO waves matrix, `lanes/co-plan/plans/co-waves-matrix.md`):
  - **SP-1e4** (SP-1e: CH-D2's live cards in Chat's thread): Stop all and Pause all on the crew card, now that the
    card has landed (SP-1e2). SP-1e3 stays HELD.
  - **CP-4a2b's last two mints**, in Q-A0 (a)'s order: M-r2, the flow's own engine; M-d, CP4-S18's refusal, the
    doors, the verbs and the kill matrix (the owed lists in LANDED "CP-4a2a", "CP-4a2b's M-h" and "CP-4a2b's
    M-r1"). Then CP-4b…4f: Chat, the desk applier, Godview's flow mark, the watchdog, the board's light edits.
  - **CP-5b…5d**, which is MT-7: Codex and Grok, once their MCP processes can be named; Grok also once it takes a
    spark's brief and allowance (PU-O). Only CP-5c's Codex claim commit waits for step 7's profile card (CP5-Q2 (d),
    §12 Q11).

**ES — Chat's empty state, "The night that becomes the window"** · vibe-field-b4 (lane `lanes/es`, branch
`es/catalog-role`) · law DESIGN.md §2.4/§2.10/§3/§5/§6/§8/§9 (the ES page `1GdkfmnTxynAp6wHTbAa3a`, *Your First Spark*)
- Ruled 11-08 (James, on the page): ES-D1…D7, all seven at their leans, then "All ruled with leans, now please start
  implementation" (04:32:54Z; DECISIONS "ES").
- Landed 11-08: **ES-1 + ES-2** (`14ce7b7a8` → `6b8a4b09f`, M226, run 226, an ff of `042ca0f2e`; LANDED
  "ES-1 + ES-2"): Chat's empty panel is the hatch's night, its words on the night's ink, and New spark is Off from the
  kit's own button where no agent here can be a spark; a first job opens the sheet carrying itself and is sent once,
  as Send sends.
- Landed 11-08: **ES-3 + ES-4** (`121569672` → `2c34727a3`, M238, run 238, an ff of `4db42a816`; LANDED
  "ES-3 + ES-4"): the night leans toward New spark and closes onto the sheet's sky like a portal, lent to the sheet's
  window and handed back at its own moment, and the starters are filled from this Mac. The hatch's goldens were made
  again for it, and R23b's allow-list names the starters' ruled agents (run237's red, #21).
- Landed 11-09: **ES-4 (role)** (`13753ff01` → `7d7019a23`, M241, run 241, an ff of `70eb8a3cf`; LANDED
  "ES-4 (role)"): the catalog row carries the hello's ruled starter (`starter`, `starterAgent`), the starters name no
  agent, and R23b's allow-list retires `starters.ts`'s row. The kit's seven mirrors moved with it.
- Landed 11-09: **ES-6** (`828d3075a` → `f3cbbc469`, M260, run 260, in the field-app chain, an ff of `68f489ac2`;
  LANDED "UM-3's plate, Q20, Q5 and ES-6"): `smoke:chat-night`, desk-gates row 36, judges Chat's empty night on the
  real GPU: it stands, the lean, the close, Cancel's fold, the hand-off. James ranked it first (03:04:05Z).
- Landed 11-09: **ES-Q1 + ES-5a to 5d** (`a8b91ea47` → `e6de35f09`, M270, run 274, an ff of `535db8a9f`; LANDED
  "ES-Q1 + ES-5a to 5d"): a starter with nothing to name reads bare (James, 07:53Z), and the phone's empty Chat is the
  night, its starters filled by the Mac's rule and held to its golden, a starter carried into the sheet as a first job
  and sent once, after the hatch.
- Next: 5e, the portal on the phone, a spike that needs a device and James.
- Owed: James's eye on the phone's night, its motion and its interim Off sentence, on a device (LANDED "ES-Q1 + ES-5a to
  5d"); James's eye on the built night, its lean and its portal on a real GPU, and the starters on his own board;
  CLAUDE.md's "six mirrors" erratum, on James's word (LANDED "ES-4 (role)"); gate:landing, landing-only;
  `smoke:chat-night`'s first real window (row 36, a Mac landing row, on James's word).

**HG — History's first view and its waits, "The Room Behind Glass" and "The Mark Holds"** · vibe-field-7c (lane
`lanes/hg`, branch `hg/glass-r5`) · law DESIGN.md §5/§6/§8/§9 (the HG pages `U12DeYQrZB4YRjycrR4wuR` and
`9ByDzaNGQaijgSHW6GrZUb`)
- Ruled 11-08 (James, in words; the pages keep no picks): page 1 "good" (05:56:00Z), page 2 "good, go with your lean
  and start implementation" (06:35:59Z), every mark at its lean (DECISIONS "HG-D1…HG-D6 · HG-W1…HG-W5 · HG-L1").
- Landed 11-08: **HG-1 + HG-2** (`121c1d0e4` → `3264c54f1`, M235, run 235, an ff of `75969189e`; LANDED "HG-1 + HG-2"):
  History before its past is the room behind glass, the room itself frosted behind the History pane in the Setup
  Assistant's glass. Its act says "Bringing in…" through the kit's `running`, and a census with nothing to bring in
  says "Your history starts here." with Look again.
- Landed 11-08: **items 263 + 264**, HG-2's two smoke reds (`b07ea239a` → `9d2b8d03d`, M239, run 239, an ff of
  `4bb2ec7b9`; LANDED "Item 263" and "Item 264"): `smoke:godview`'s History rung reads the view's own room and, while it
  waits, the card behind glass; the catalog walk captures a still document (the wait, the bracket and one re-walk). Item
  265, the catalog's three mount-time movers, is filed for their owners.
- Landed 11-09: **item 267**, history-glass's leave timed by the DOM (`efba34925` → `519132f1a`, M242, run 242, an ff of
  `758e6f6da`; LANDED "Item 267"): a MutationObserver stamps the layer's flip to its leave and its removal, so a late
  look cannot move the length; the red's 200 ms made load stays in the row.
- Next: **HG-3**, rosetta's `waitMark` (RO-40; James opens its PR, `lanes/hg/open-hg3-pr.sh`), then rosetta-room
  0.1.6 and its EL8; then **HG-4**, History's holds in the living mark (`hg/hold`), re-based with the same act.
- Ruled with it: a slice that adds a lazy import or a new module to field-app runs the census assert as a door row
  (the LANDED entry's second finding).
- Owed: James's eye on the built room; gate:landing, landing-only.

**IS — VibeField's insides are never a person's to read (items 280, 281 and 282)** · ow-design (lane `lanes/i280`) ·
law DESIGN.md §9 "VibeField's insides are never a person's to read" (item 280), the page *Insides on Screen*
(`NqLUt9USAjt5mWCCYzPKRs`; its source `draft/insides-on-screen/page.html`) and the build order
`lanes/i280/plan/build-order-281-282.md`
- Ruled 11-10: the rule, in James's words at 00:46Z (DESIGN.md §9 quotes them whole); the failed start's one sentence,
  accepted by VF-PM at 01:13:08Z; the page's eight picks, all A, 02:34:58Z to 03:32:49Z (DECISIONS "insides · IS-281 ·
  IS-282-1…IS-282-7"); the build order, accepted by VF-PM at 05:20:40Z.
- Landed 11-10: **item 280** (`6014068ec` → `93e41770b`, 3 commits, M277, run 289, an ff of `40b499b9d`; LANDED "Item
  280"): a start that failed says one sentence, "VibeField couldn't start.", over Retry, and what failed goes to the
  log whole.
- Landed 11-10: **item 281** (`c8dee7c9f` → `82cd1fd1c`, 8 commits, M279, run 292, an ff of `57096484d`; LANDED "Item
  281"): while a start goes well the bar alone speaks, on the splash, the switch, Setting up and the veil; item 299's
  doc rides as its commit 8.
- Landed 11-10: **item 300** (`d10b64f09` → `a0538cad3`, 3 commits, M280, run 293, an ff of `82cd1fd1c`; LANDED "Item
  300"): the veil's bar fades in where it stands on the island's curve, and reduced motion is 90ms for all of it.
- Next: the rule (§9's paragraph widened from a start to every room, doc only), then 282's slices in the build order's
  sequence, with item 293 (ob/ui) before 282-7.
- Owed: the Mac witness of a failed start; item 295, with no owner (the failure sentence's contrast over the field);
  the veil in the product's own window (read by grep, not watched). The window rows at 280's main are closed by the
  landing table at `a0538cad3` (LANDED "Item 281").

**Release rails — WP12 · TD · BP · FW packaging · RD** · prod-builder (resting) · law `specs/build-wp12-updater.md`,
`specs/trust-and-distribution.md`, the three `specs/electron-*.md` + `electron-packaging-implementation-plan.md`,
`specs/build-wp8-bundled-plugins.md`, `draft/thinking-browser-profile.md` (BP), `draft/thinking-release-deps.md` (RD),
`draft/thinking-release-management.md` (RM: RL3 (a), RL4 (a), RL5, RL6 (a), RL7 (a), RL8 (a) ruled)
- Next: **nightly-20261028**, the first carrying `field-freeway-host` (FW packaging `f47987f18`…`a91fcf351`), and
  round 3, the host's live witness in a package. Then the first-beta list (§3 item 7).
- prod-builder's review of `4758b9837` (install.ts's census while the inventory is stale) is owed.
- Landed 11-08: **items 249 and 250** (`458de3e5b` → `05df1fe85`, 3 commits, M222, run222 on vf-m2; LANDED
  "Items 249 and 250"):
  - every macOS compile or link names its SDK: one `xcrun --sdk macosx` lookup, handed on as `-isysroot` or `-sdk`,
    at six sites;
  - the Last run row reads the host's own days.
  - vf-m2's first verifies, run220 and run221, were host findings: Xcode 26.3's ld against the CLT 27.2 default SDK.

**EL8 — the pins** · vibe-field-5c (template lane `hl-el8-0724`) · law DECISIONS TB, the manifests
- Landed: ghosttea 0.13.7 + truffle 0.7.23 (`5ba36785b`); truffle 0.7.24, the split (`af3f3078f`, DECISIONS TB (a)).
- Watch: the kit's Swift plane (0.7.26) rejoins the desktop's truffle 0.7.27 at the first ghosttea that declares it.
  Next events: a later
  puppeteer release (§3 item 3; 0.3.0 pinned 10-28, `1469639a6`), mille's first release. The next event's kit pre-boots the
  simulator (`/Volumes/SamsungRed/lanes/hl-k1/kit-template.sh`, item 77's k1). CLAUDE.md names no pin since its dated pass (2026-10-28), so an EL8 event leaves it alone.

**Fixer** · fixer · law the LANDED item entries
- Landed since the audit: items 82 (`714ecbaae`, `8828601ed`), 83 (`f0b5342ac`), 84 (`68296443f`), 85 (`7eda2ee38`,
  `b60e80398`), 89 (`238a960bc`), 87 (`8d56b2bd8`) and 113 (`218dc3d9e`); the stack's eight, landed as the merge
  `0b4cb2ff0`: 94, 86, 90, 96's first half, 93, 97, 92 and 101; and the shell lease's cleanup race (`2422bdf5c`).
  Then items 102 (`4e07f0308`, in the mint `cbc376da5`) and 118 (`9e0457b3c`, in `7b143fc51`); and 118's slice 2
  with item 122 and item 121's evidence (`41f27d8cc`, `e3b70d38b`, `0543de224`), the mint `cf0a2982d`.
  Then items 120 (`dd8d5e84d`) and 93's zombie half (`dc2d54a4c`), the mint `b6363425b`.
  Then items 116 (`684fd4dae`, one smoke census) and 122b (`198fee645`, the remote door's endpoints wait), the
  mint `06e1385d7`. Then ST, the durable Stop (`9196da93f`, `69f9414f3`, `7de74165b`, `7cbd2b59f`), landed as its
  rebased tip itself, run 41 (LANDED "ST"; DECISIONS ST-D1…D8, written DS-D1…D8 until 10-31 07:52Z). Then ST's
  rename (`cc99532f6`) with fd's kit half (`e45142626`), the mint `f2c695b69`, run 45. Then items 121 (`624c11443`,
  a fallback-born run re-attaches on its signed placement; the mint `4c86c2923`, run 49) and 125 (`62fa4d718`,
  `agent-status.ts` retired; the mint `3798a5fc1`, run 51).
- Queue: item 80 (DS-5c's wall-clock gap margin, `doc-sync-service.test.ts`, shaped with the DS owner; its sibling
  TC-S3, item 120, landed in run 34) · item 71 (persona refresh window) · item
  73 (`unregistered_webcontents` false positive on every factory window) · item 74 (the generation-1 port forward before
  the main world, live-surfaces) · the sibling 5 s waits (§6 Gates) · item 91 (MF-1's field-projection row judges a
  board settled from one pair of 750 ms readings, `agent-session.test.ts:2835`; red in item 87's first verify at load
  257; its red-first inverted on 10-29, so a read comes first) · item 117 (the smoke:canvas HAND bar-return
  class on the mini, 250 ms vs 200 ± 40; filed from FG's run 7, `lanes/records/item117`) · item 96's own half
  (the parts alone ×N and on CI; which of the 13 bare `30_000` rows keep a named constant; the one row still past a
  second) · item 111 (the Artifact panel's Copy does nothing in the app: a plugin's web clipboard write under the empty
  grant set, item 102's class; an SDK clipboard-write door over HN B2's host copy door (landed) unless HN B3 claims
  it; *closed by FL-2, 2026-11-09: the panel is the app's now, and Copy URL deals a card*) ·
  item 112 (main decodes a clipboard PNG of up to 64 MiB with no pixel bound; an IHDR read before decoding against
  one new contracts constant, its literal ruled alone; HN B2 is in) · item 115 (`pnpm dev`'s nx watcher outlives a
  runner that ends without `shutdown()`: a watcher host on a stdin pipe, and a SIGHUP handler; after 111 and 112) ·
  item 126 (fd's: FakeCellDoorTests' stale-route row times out under heavy load) · item 128 (row 26's
  hidden-Studio step needs an unlocked screen: a hidden window's page never goes `hidden` on a locked one; control
  paid 18:29:53Z, green unlocked; owed: the arming rule in row 26's doors; LANDED "PR #6 landed through the
  train") · item 129 (GitHub's macOS verify red five pushes on the catalog's Hub wait, its real 10 s bound
  crossed before the click: fixed in M59 `2d2f41046`, tests only, HN-8's design kept; proof paid 20:20Z, main's
  push-event verify run 41235730001 green, PR #7's re-run green (41239299536); nothing owed; LANDED "Item 129") ·
  item 130 (the phone's sign-out kept History's cache, against AP-D4: `35b9248d4`, with SP-D12's comment
  `f8d93b4a2`, as the merge `6130153f8`, run 61; IOS-10a's sign-out words paid in `a9a62c20a`; LANDED "Item 130") ·
  items 131, 133, 134 and 139 (fieldd's slow-cleanup warning waits for its own clock; the phone stage checks the
  field-native its smoke launches; a smoke dead before its rows names its kept HOME and the stage says the fatal, and
  134b's smoke refuses a missing field-native at once; the rosettad control row reads at `close`: `130906443` as the
  merge `230e72848`, run 75; owed: PT-S3 L1's re-run on a built lane, PORTALS's; LANDED "Items 131, 133, 134 and
  139") ·
  item 141 (the TREE-dies row's wait for its grandchild ends on a beat or the tree gone, inside the row's own budget,
  never a 5 s clock: `15428f2a8` as the merge `2d91c6a5c`, run 77; LANDED "Item 141") ·
  item 137 (a shell promoted to an agent left the Godview and was reborn: the window's `ModelBoardFold` dropped an
  id another key of the desktop still held, against M22's one body; found by PG-3a0's probe; `a13132333`,
  `49935e71b`, M70 run 70, a pure fast-forward; nothing owed; LANDED "Item 137") ·
  item 138 (a peer's rows moved in the window's order, the rain's columns, on a whole re-send that changed
  nothing: the fold listed `#held` by insertion; now by the board's device order, each row it still holds in
  place; found by PG-3a's design check; `569ee11cb`, M74 `815babbd3` run 74; nothing owed; LANDED "Item 138") ·
  item 144 (the projection bench's count self-check left the remote cut's bare terminals out since PG-2: red,
  ungated; found by PG-3a's light; `8cf8c1a05`, M80 `d14e97880`; owed: PG-1e0's erratum at a draft slot; LANDED
  "Item 144") ·
  items 142, 143 and 145 (a smoke's process is gone when the kernel says so, in the launchers' reap and the in-app
  teardown, and `unreaped` is said of the rest; release-notes' row and typed-agent's real-zsh row name their measured
  15 s: `00b6fe2ac` as the merge `fc2a896ec`, run 81; LANDED "Items 142, 143 and 145") ·
  item 146b (the phone stage places a Simulator.app's start by its `etime` between two reads of the clock, never by
  `lstart`'s local wall time, so DST's repeated hour cannot make the run's own app foreign; perf-lab's lstart an
  identity string, left: `ab0199542` as M87, a fast-forward, run 87; LANDED "Item 146b") ·
  item 147 (the ground-truth page waits for rosetta's `indexed`, never the session row's first sight: rosetta writes
  the row `pending` before its entries; test-only: `f3554436d` as the merge `10368b597`, run 91; LANDED "Item 147") ·
  item 148 (users.json's mint and the layout stamp are created whole: tmp, fsync, a link that fails EEXIST; a bare
  "wx" create named the file before its bytes, and `detectLayoutState` read it outside the lock: `75e1bd31a` as
  M90, a fast-forward, run 90; LANDED "Item 148") ·
  item 150 (the board screen reads a row keyed "" as keyless, never `removed: [""]`: a screened delta RowsDelta refused
  looped the replica's reopen; `47ee475bd` as the merge `a6dc43cd2`, run 94; LANDED "Item 150") ·
  item 153 (the test suites remove the temp roots they make: a row's root at its end, fieldd's files-host bundle under
  a run root its global-setup removes; ~300 vf-* dirs a verify run before, 33,345 on the gate host: `50c30574a`
  as M102, a fast-forward, run 102; LANDED "Item 153") ·
  item 156 (Settings → Devices stays a row under the account head: UA-7's fold dropped the whole Account group,
  Devices with it, so a connected Mac had no way in from Settings: `95be4565c` as M103, a fast-forward, run 103; LANDED
  "Item 156") ·
  item 157 (the kit's lane helper returns once the client has READ both legs' acknowledgements, so a re-tap takes the
  fast path its row tests; run 3's stall is held until its lines are read, and the loopback test doors bind 127.0.0.1
  with no reuse; test-only: `c91484e93` as the merge `c737af492`, run 105; LANDED "Item 157") ·
  item 166 (the app workspace's Package.resolved moves to the kit's ghosttea 0.13.7 and truffle 0.7.23, the Swift
  file every EL8 since 2026-09-16 left at 0.10.1: `62dfa4ba2` as M111, a fast-forward, run 111; LANDED "Item 166") ·
  items 164 and 165 (the burn rate and the token counts print JavaScript's digits through FieldAgents' `JSNumber`:
  no trap at 2^63, ∞ or NaN, and a tie the window's way: `84482a1fe` as M114, a fast-forward over the icon studio's
  lint fix `78ef3515a`, run 114; LANDED "Items 164 and 165" and "The icon studio, biome-clean") ·
  item 136 (the Setup Assistant's actions, fields and headlines wear tokens, its one placeholder at 4.5:1 or more:
  `cc8894c46` as M117, a fast-forward, run 117; LANDED "Item 136") ·
  item 168 (fieldd's drain rows read the host's own record of each stop, never the wall clock: the stop's
  deactivated record says how its calls and its cleanup ended; `8dc80cc1d` as M119, a fast-forward, run 119;
  LANDED "Item 168") ·
  item 122's floor half (paid: idle,
  idle-class, the ramp of run 53's verify and the peak of run 55's, load1 34.09–42.52, warm max 201 ms against the 15 s,
  0 missed; LANDED "item 122's floor half, measured"; nothing owed).
- **Item 77b**, FieldTerminalTests' 60 s block. The 5 s shape is fixed: (d) `b1e9bf53d` runs AttachDeadlineTests
  `.serialized`, because each row's 1 s deadline covers the dial too and rows started together stampeded the loopback
  dial under load. k1 is separate: `test-without-building` cold-boots a Shutdown simulator, and pre-booting it
  (`simctl bootstatus -b`) removed the 5 s dial shape (cold 14/20 red, pre-booted 0/20); that is ruled into the next
  EL8's kit script, not landed in the repo. Pre-booting does NOT remove the 60 s block (UIKit's first-touch synchronous
  XPC; stalled 2/20 booted, 0/20 cold): it stays the fixer's, and a quiet-window kit run is owed.

**Upstream** · focus-session · law `draft/petitions/README.md`
- truffle #242 (the pnpm-audit job) merged `5a8f88b5` on James's click, 10-27 21:14Z. T8 (an app-chosen hostname
  prefix) released in 0.7.25 and taken at the EL8 to 0.7.27 (M249), TS-8c's to turn on;
  T12 (a typed start refusal) held as a candidate; T13, the one T row for T7's
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
   - Q4: landed 2026-11-09 as M246 (`5efa48d52`; LANDED, "Q4 + MV's gate fixes"): the desk's wind is 8 s, a
     thumbnail ≈ 10 s.
   - Q5: landed 2026-11-09 as M260 (`285330c61`; LANDED, "UM-3's plate, Q20, Q5 and ES-6"): a size refusal says its
     advice again and stands 6.6 s; every other note keeps 2.4 s. Owed: the phone's half and James's eye.
   - Q13 (`costRatePerMin` on the desk row, the phone reading `desk`, D-i18) is superseded by PG-D1 (a), 2026-10-29:
     the phone reads the model's remote cut (PG-3), and `desk` retired into it at PG-2 (10-31). D-i18's status flipped
     in PG-0.
   - Q20: landed 2026-11-09 as M260 (`f4f8337c7`, census `2a164e8cb`; LANDED, "UM-3's plate, Q20, Q5 and ES-6"):
     SettingsPanel is its own chunk, loaded when it is opened; run 260's P6 measured it (the boot closure −3.9% raw).
   - Q21: verified and struck as worded 2026-11-09 (LANDED, TP-S3f's correction).
7. **The first beta, `v0.9.0-beta.1`** (release rails; RL6 betas `v0.9.0-beta.N`). The plan is the page *VibeField 0.9
   Launch* (2rsVWUF9); James ruled its calls, LP-D1…D20, at the leans on 2026-11-05 at 01:04Z (DECISIONS LP). The target
   is 7 Nov: every launch date lands by 9 Nov (James, 2026-11-06 23:39Z; it was 19 Nov). Wave 1 builds code-only, off
   `f599761bc`: `lp/rails` · `lp/ar7j` · `lp/bp9` · `lp/ios-store` · `lp/notices` · `lp/harden` (with `lp/paths`,
   item 170) · `lp/feedback` · `lp/td4`. The operating drafts are in `draft/launch/`.
   - **Phase 0, unstick the nightly** (done 11-05): `nightly-20261104` published at 00:25Z (run 41848947270), and W10
     passed on it at 01:24Z; `release-signing` takes main and `v*` only (LP-D20, 01:09Z). Its manifest's `touched`
     line is LP-D16's first data point.
   - **Phase 1, the DMG a stranger downloads** (5–10 Nov, the release lane):
     - the DMG itself signed, notarized and stapled before SHA256SUMS, a stable's fixed-name download, and build
       provenance: LANDED 2026-11-05 (M136 `650877282`, LANDED "LP-1"); owed: the first signed release's W rows;
     - the real macOS floor, 14 (LP-D4: `mac.minimumSystemVersion` and every policy's `floors.os`): LANDED (M136);
     - a clean-Mac install row on macOS 14, 15 and 26 VMs on the mini, quarantined as a browser downloads it (new);
     - a usage string for every system prompt the clean-Mac row meets: LANDED 2026-11-05 (M155 `ef31f162f`, LANDED
       "Item 181"), 25 keys in our words, the hardened seven walled; owed: the signed W row and James's hand;
     - each shipped daemon its own entitlements, with no inherited `allow-jit`, and its release signature read
       back: LANDED 2026-11-05 (M133 `f514215f4`, LANDED "LP-6"); owed: the signed witnesses (W rows);
     - no build paths in shipped binaries: LANDED 2026-11-05 (M135 `96606efa9`, LANDED "LP-6b"); owed: the first
       remapped release's witnesses, and truffle's sidecar (item 170, petition T14);
     - third-party notices on the Mac and on iOS: LANDED 2026-11-05 (M131 `02b47ba2a`, LANDED "LP-5"); the
       staged `Resources/legal` witness passed at run 133; owed: the packaged one on the first signed nightly;
       and every staged bundle has its notices row, both ways: LANDED 2026-11-05 (M151 `ed533687f`, LANDED "Item 178");
     - the surface lab out of production builds (Q3): LANDED (M133, witnessed by run 133's build:renderer);
       `package-census --assert --strict` green, in verify: LANDED 2026-11-05 (M145 `20eef65de`, LANDED "LP-6c");
     - LOG-39's packaged checks in `release.yml`;
     - `cargo audit` blocking again once the yanked chacha20 moves (Q28);
     - build-provenance attestations on the DMG and zip: LANDED (M136, LANDED "LP-1"); owed: the first signed
       release's witness;
     - the version-less `VibeField-mac-arm64.dmg` on stables (LP-D17): LANDED (M136, LANDED "LP-1"); owed: the
       first signed release's witness.
   - **Phase 2, the product blockers** (5–18 Nov, parallel lanes):
     - **A** BP-D9 (a) as ruled: LANDED 2026-11-05 (BP-1c, M134 `da1a3d695`) → R4, row 31 (`smoke:profile`) on a
       signed nightly · R3 (the mini) → BP-2, downloads (BP-D2: "at the first beta") → BP-D5's row with UA's user
       removal. *(Struck 2026-11-09, James, DECISIONS "FL": the pane ships in no packaged app, so R4, row 31, BP-2 and
       BP-D5's row leave the beta's gate and return with the pane.)*
     - **B** AR-7j, typed agents managed in the packaged app (LP-D1, D2): LANDED 2026-11-05 (M128 `45c3680a3`, LANDED
       "AR-7j"). Owed: its packaged row `verify-agents-package` (desk-gates row 34) green on the first signed build,
       with the start cost measured.
     - **C** sessions survive an update that leaves the daemons alone: D11's measurement, then TD-4 by code hash
       (LP-D16): LANDED 2026-11-05 (M139 `bb49a3eab`, LANDED "TD-4"); owed: two signed nightlies with an unchanged
       field-native, `touched` naming none, a live terminal surviving the apply. W11's PTY clause rides it.
     - **D** RD-6, CI in prod shape: rosetta's published `rosettad` archive pinned by checksum (RD-D7), then mille's
       release (PR #44) and an exact pin.
     - **E** the scope freeze (VF-PM, James; `draft/launch/scope-freeze-proposal.md`): what 0.9 holds, and item 152
       and 169 (a say forgotten across a fieldd restart, 152's class) fixed, or the feature they touch kept out.
     - **F** testers report a problem in one place (LP-D18): LANDED 2026-11-05 (M142 `d48b6fe6d`, LANDED "LP-7"). Owed:
       James's security contact before beta.1's cohort arrives (a SECURITY.md with a private contact, or private
       vulnerability reporting turned on), and the first tester's report through the form.
   - **Phase 3, iPhone and iPad to external TestFlight** (by 8 Nov, was 5–19 Nov; the iOS lane and James):
     - the App Store export and uploads signed in with an App Store Connect API key (build 4's upload failed on 09-20,
       and build 5 was archived but never uploaded, so the next build is 6, carrying P0-H1 and everything since 09-13):
       LANDED 2026-11-05 (M144 `1e2023717`, LANDED "LP-4"); owed: James's `archive 6` and `upload 6 store` from his own
       account, with every agent quit for the upload;
     - MARKETING_VERSION 0.9.0 (RL6), ahead of the cut so build 6 archives as 0.9.0: LANDED 2026-11-06
       (`d300ad0e0`, LANDED "LP's 0.9.0"), with the camera prompt's "this device" (`84193fcab`);
     - what App Review would reject: Apple's logo off the Mac's mark, two vendor marks, one window and the
       acknowledgements bundled: LANDED (M144, LANDED "LP-4"). "Better CRT (legacy)" (CC BY-NC-SA upstream) stays on
       the phone by James's word (11-05, 06:02Z), and no author or licence-link line is added ("attribution no",
       06:18Z). About reading the acknowledgements' full texts, Privacy Policy and Support on About and on the welcome
       (where a signed-out person reaches them), and About's non-affiliation line: LANDED 2026-11-06 (M165
       `7a7f22623`, LANDED "IOS-13a"). The record lists VibeField's own rosetta row, and About draws only the parts
       others made: LANDED 2026-11-08 (item 259, M236 `83cf67316`). Owed: item 184, the font rows' version and names
       (James's eye);
     - Tailscale's log upload ships on in build 6, declared (James, 2026-11-07 07:11Z; it was owed off): the
       privacy manifest LANDED (`aa1f10bbb`, LANDED "LP's privacy manifest"). Off stays a truffle Swift option;
     - iPad: one window in v1: LANDED (M144). Its words in Settings and the way in ("this iPad", `DeviceWord`):
       LANDED (M165, LANDED "IOS-13a"). The lock's and the other surfaces' words: LANDED 2026-11-06 (M172
       `fad2d5433`, LANDED "LP-4's word pass"). Owed: a pass on 11- and 13-inch iPads;
     - build 6 internal, then the owed device checks;
     - the marks' permission emails (James);
     - the review Mac, the review identity and the filmed video (LP-D5, D6; `draft/launch/review-mac-runbook.md`);
     - external TestFlight through Beta App Review;
     - the Mac's add-phone door naming the App Store.
   - **The first launch's lineup** (James, 2026-11-09; DECISIONS "FL"; LANDED "FL-1"): the browser pane, the notebook
     and the comment pad's hook are out; the note, the print, the mini mat and the whiteboard ship. Owed through the
     betas: a desk picture card reaching an agent (`copy-to-hand.ts` sets `paste: ""`), several images dropped landing
     as several prints (`cards-outside.ts`), the note's typing and cut-off text (an ICE release), and the first board
     as a small moodboard (a design round, with images we own).
   - **Phase 4, the gate and the cut** (target 7 Nov, was 19 Nov):
     - The gate: phase 1 done; B and D done (A struck 2026-11-09); C measured, and fixed or said in the notes; the
       scope frozen; James on a signed nightly with its checks green (James shortened RL6's five days, 2026-11-07
       00:07Z); and one person who isn't James installs from vibefield.dev on a clean Mac and gets an agent running.
     - Owed before the cut: measure the order of `releases.atom` and of the sign job's "previous" pick on a scratch
       repository (`draft/launch/policy-only-release.md` §4.3). If they follow commit dates, F1 (carry by publish
       order) and F2 (tag on a fresh cut commit) land first, on James's call.
     - The cut: 0.9.0 committed in `apps/desktop/package.json` (the iOS one landed ahead); `release/0.9` made
       (LP-D3); James pushes `v0.9.0-beta.1` and approves twice. Its rows: W10, the clean-Mac row from the website, and
       a channel row.
   - Dropped for 0.9: EDP-22's universal build (LP-D9: Apple silicon only; revisited at 1.0 if Intel users ask). Still
     owed: the build job's `macos-26` image (the Xcode 26.3 pin stands until then).
8. **Then the soak, and stable `v0.9.0`** (target 9 Nov, was 3 Dec).
   - The soak:
     - betas from `release/0.9`, each with W10 and the beta-to-beta update on two Macs;
     - a yank drill on the beta channel through the policy-only path (LP-D19);
     - iPhone and iPad 0.9.0 submitted by 8 Nov (was 24 Nov) with manual release (LP-D10), released the same hour
       as the Mac stable.
   - The exit: one day on the newest beta (James shortened the seven days, 2026-11-07 00:07Z) with no open crash,
     data-loss, security or update-failure bug; a beta-to-beta update witnessed; clean installs passing on every
     supported macOS; and App Review's approval.
   - Main moves to 0.10.0 the same day.
   - Before 1 Feb 2027: a Developer ID certificate under G2, in CI, with its swap drill.
   - 1.0 adds Linux (RL3 (a); no Linux leg exists) and, on James's call, Windows (RM-4; the 10-26 production-readiness
     read put it out of scope; Azure signing unstarted).

## 4 Parked — valid, unscheduled

| Track / item | Parked state | Re-entry | Doc |
|---|---|---|---|
| DS / SP — sync planes | DS-7 LANDED (M66 `c0d68b94d`, 2026-10-31): another desktop's transcript by ticket — the owner mints for the window's daemon, which re-homes the index serve's set onto its own egress route (9424 now routable); History hands the room another desktop's sessions of a project here; **owed: the two-desktop run (James, steps in LANDED "DS-7")** · DS-9 (E3 and artifacts in the app, files) · SP-4 probe → SP-4 → SP-7 (OPENED 2026-11-06 on James's word; road 7a, a spark's transcript for Chat's thread: M-b, the kit's reader, LANDED 2026-11-06 (`432784612`, LANDED "SP-7a's M-b"), M-a, the home's carry and the owner's routed serve (9426), LANDED 2026-11-06 (`d6fe77980`, LANDED "SP-7a's M-a"), M-b2, the phone's routed serve and its `device`, LANDED 2026-11-06 (`3b8611ec4`, LANDED "SP-7a's M-b2"); road 7b, the phone's History from rosettad by grant through rosetta's Swift client (James 22:56Z, `sp7b-swift-rosetta-reader` (b); DECISIONS "SP-7b"): 7b-1, the phone's ticket by both roads, LANDED 2026-11-07 (`41331646e`, LANDED "SP-7b's 7b-1"); 7c, its terminal asks through its home, LANDED 2026-11-07 (`c8c580fcb`, LANDED "SP-7b's 7c"); 7b-2a, the ticket's `rest` leg (the index serve's http(s) origin) and the projection's golden pairs, LANDED 2026-11-08 (`c435f1e6e`, M223, LANDED "SP-7b's 7b-2a"); rosetta's `clients/swift` (RO-39) released in rosetta 0.1.5 (2026-11-08); the EL8 to 0.1.5 LANDED 2026-11-08 (`68b80fb95`, M230, LANDED "EL8 — Rosetta 0.1.5"; its Swift row PAID on vf-m2 by item 257's mint, M233 `b3a5930b2`, at main `f1670584e` + 257's three test files; the exact-tree witness stays the old mini's); item 259, the iOS record's own rosetta row and About's filter, LANDED 2026-11-08 (M236 `83cf67316`, LANDED "Item 259"); 7b-2b, the kit's reader and the projection in Swift, LANDED 2026-11-09 (`870edfa9e`, M253, LANDED "SP-7b's 7b-2b"), dark; then its injection and W1 on the old mini (James's disk); owed: item 247, a tool's strict `attachments`) → SP-5 → SP-8 (after AR-6) → SP-D4's view state, Follow off, LAST (ruled (a) at the lean, VF-PM 2026-10-31) · PeerLink and the asleep roster (a forward dials a desktop the roster calls asleep, ~15 s to `unreachable`; LANDED "DS-7", Found) · wave 2's residue (§6) · the two built trades ACCEPTED (Q29: whole-value streams lose the 250 ms leading edge; self-served keyed calls are not journaled), reopened only if a witness shows a lost update | an owner + the two-desktop run (Tailscale app QUIT) | `thinking-desktop-sync-plane.md`, `thinking-sync-planes.md`, `design-06-sync-planes.md` |
| TD-4…TD-7 | the registry's listing gates, attestation/rebuild, the R2 posture (TD ladder §9) | third-party plugins | `specs/trust-and-distribution.md` |
| History finish (AR-8) | B-D4/B-D5 (the doors federate; no window asks for another desktop's past; the phone reads none) · PJ-8 acts across desktops (PlaceRef + the params idempotency key), unblocked by DS-7 (another desktop's sessions are in the room, their acts said "ran on ‹desktop›") · projects only another desktop holds, and its Home and Temporary, in the list (PJ's design; DESIGN.md §8's DS-7 amendment) · the Peek's "Everything" across desktops (K5) · R8/R9 and P2's runs (§6) | the History lead's slot | `build-hf.md`, `thinking-ar-history-room.md`, `thinking-project-places.md` |
| PJ-5 · PJ L5 | Godview's project chip, "Open in History", synced ink, where line: unbuilt; re-judged against One Frame and MV before any build (Q16) · the project key unkeyed (`normalize.ts:172`, version 1) | the re-judgement · a mesh-shared secret | `thinking-project-places.md` |
| FS | FS-3 the files consumer on the desk (a kind or panel; `pickFolder()` → `attach(root)` is built) · FS-4 over DS-7's road (one route per owner desktop, `OwnerRoutes`; the workspace serve needs its DS-L6 claim) · FS-5 the phone viewer · GitService replaces the interim git port (R2; M5) | a desk lane · mille's release | `thinking-files-service.md`, `draft/files-service/build-fs.md` |
| FW — the freeway | F1's device round before leaving `-vf-freeway`, which witnesses F1b's exit (the kit asks through its home since 11-01, `284e4af9d`; LANDED "F1b's kit half") · FD1/FD2 (truffle precondition met; need an owner), FD3/FD4, F4, FW-D10's slice, FW-R1…R10 · FW-DF-1/DF-2 (§6) | James's device round; an owner for FD1/FD2 (History lead) | `draft/thinking-freeway.md` v0.3 §13/§14/§16; LANDED "F1b — the forwarded phone approval", "F1b's kit half" |
| AR-6 — approvals + prompts | Phase 0 paid (P0-H, 09-25); AG-1 shipped as AR-S1/AR-S2. Waits on AR6-D1…D9 (unindexed; re-verify §0's anchors at the pinned puppeteer). PU-15 rides it. A 1.0 exit | James rules AR6-D1…D9 | `thinking-ar-approvals-prompts.md` |
| AR-7 later slices · AR-S4e3 | AR-7f leak detector, AR-7h bash/fish, AR-7i prewarm (AR-7j LANDED 2026-11-05, M128 `45c3680a3`) · S4e3 options, Needs/Needed by, EX6/EX7, other profiles | an AR lane | `thinking-ar7-typed-agents.md` §5.6, `thinking-ar-agents-settings.md` |
| MV-8b ruling 8 | the transcript-provider migration: puppeteer 0.2.3 still ships adapter-claude's `observation/transcript/provider.ts` | its own track after MV | DECISIONS MV-8b, `docs/agent-plane/architecture.html` |
| MV · SB | third-party views (MV-D14) · SB-4, SB-6 (after DS); SB's M4/L7/M5/L8 RULED at the built leans (Q14); SB-5 was delivered by PJ-7 (PJ-7's own Q4) | the next MV slot | `design-mv.md`, `thinking-spawn-bloom.md` |
| Desk Phase 6 | STRING (ports on objects, ICE's wires, the Wire tool DK-D29) · OBJECT KIT (panel, controls, screens, cables, `process`) · AGENT'S EYES, now the tool plane's rooms (`thinking-tool-plane.md` §13; the `canvas_*` rows for DK-D26's MCP canvas tools; DT-5's control lane, the reserved `surface.control` scope) · UPLOAD PLANE + the mini-app bridge (SP-D9/SP-D7; UP v0.1 and MB v0.1 drafted 10-01; UP-D1…D8, MB-D1…D9 unruled; AH-D10's cross-device CAS rides it). It replaces the four dogfood packs (Q9); the microservice pack retires or becomes an OBJECT KIT `process` candidate | a thinking doc each; STRING first | `thinking-desk-migration.md`, `thinking-upload-plane.md`, `thinking-mini-app-bridge.md` |
| Mind map pack | the next release's headline, not 0.9 (James, 2026-11-09, DECISIONS "FL"); waits for STRING; redesign from Paper & String (MD-1…MD-15); v3's MM-D1…D14 were cut for the pre-desk canvas, MM-D14 moot (DK-D30) | STRING's thinking doc | `draft/mindmap/`, `thinking-mindmap-pack.md`, `predesign-mindmap-evidence.md` |
| The bare mat's menu | "Paste here", "New note here": unbuilt | a desk lane | DESIGN.md §8, ICE design-015 §7 |
| PT — PORTALS | PT-S is §2's (resumed 10-29; PT-S1 built 10-18 and 10-29, gated and looked at 10-29, LANDED 10-30 `1de84540b`; item 119's fix LANDED 10-31 `265325d09`; PT-S2 built code-only and light-green 10-30, LANDED 10-31 `e4aa3d367`; PT-S3 built code-only and light-green 10-31, LANDED 10-31 `c564de0e4`, its live run owed to James's unlock) · then PT-C, PT-T (form ruled last, PT-D10) · James's 10-14 A2, B4, the 5 s wind tail, unbuilt | PT-C, PT-T: after PT-S (PT-D11's order: the simulator, window capture, the terminal) · A2, B4, the tail: a PT lane | `thinking-portals.md`, `draft/portals-maps/`, ICE design-019 |
| PLUG follow-ups | the KIT slice · third-party listing (P8e: TD registry + R2 process host; PA-24, §20.5, §21.8) · sideload · R2 `host:"process"` · PRC-5's power loss (§6) · PRC residual policies (§14–§15) · per-section undo/⌘Z/timeline (D29′, P7) | first-party publishing; third-party plugins; a Settings history design; runtime validation is tracked separately in §6 | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md` |
| TP / TC | D6's cell half, C5, D5, the lineage break (§6) · TC RATIFIED as built (Q6: TC-D1/D2 as amended by WG-D1, D3, D15, L1c at TM-1); TC-S4…S8 (vault, broker, replay, drain-migrate, warm tiers) parked · TP-S4…S6 (S4's typeable mirror struck) | a TP lane · a ghosttea next-major or a P0 witness across a floor restart · measured demand | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md` |
| GT | G29 upstream (then GT-D22's file half) · GT-D22 (§5) · smoke row 13b: attach through DS-4e to a second staged desktop · Q2 superseded 2026-11-02: Stop ends the agent; Pause cancels its current turn and keeps it open | G29's release · the two-desktop run | `specs/godview-terminal.md` |
| IOS | the rebuild and TestFlight (§5) · phone Settings ("Settings in a Pocket", page Hof2zWpt, revised 2026-10-31 against `02c902a8d`: 8 marks, none picked yet; IOS-10a LANDED 2026-11-01 as `a9a62c20a`, run 67, at the page's leans, after FW, SP and PG; next: its later slices, LANDED "IOS-10a") · the phone's splash (IOS-11, James's PR #10) LANDED 2026-11-02 in M104 `f2854bf2f`, run 104, LANDED "PR #9 and PR #10"; on it, The Way In (track WI, page 5cvau5EQ; WI-D1…D8 ruled A by James 2026-11-02 11:13–11:15Z) is ACTIVE, §8's WI row: WI-1 LANDED 2026-11-02 in M108 `8cfe4a59d`, run 108, LANDED "WI-1 (with WI-2) and WI-4"; WI-3, the lock, LANDED 2026-11-04 in M116 `ae2d44c00`, run 116, LANDED "WI-3 — the lock"; WI-1's owed witness LANDED 2026-11-04 in M120 `576172d99`, run 120, LANDED "WI-1 — the owed witness"; next on it the Desktop slice, held for James · the phone's Chat (track IOS-12, page *Chat in a Pocket* M6kri6s5; PC-D1…D8 ruled A by James 2026-11-04) is ACTIVE, §2's IOS-12 block: IOS-12a LANDED 2026-11-05 in M125 `4fcb471af`, run 125, LANDED "IOS-12a"; IOS-12b LANDED 2026-11-05 in M127 `8255a10b3`, run 127, LANDED "IOS-12b"; IOS-13a (Settings for App Review, the 0.9 launch) LANDED 2026-11-06 in M165 `7a7f22623`, run 165, LANDED "IOS-13a"; IOS-12c's M-c1 (the fold) LANDED 2026-11-06 in M179 `2b9b66c14`, run 179, LANDED "IOS-12c's M-c1"; IOS-12e (the star in Metal) LANDED 2026-11-06 in M186 `09378c9ec`, run 186, LANDED "IOS-12e"; IOS-12c's M-c2 (the thread) LANDED 2026-11-06 in M191 `eda440d58`, run 191, LANDED "IOS-12c's M-c2"; IOS-12d's M-d (needs you) LANDED 2026-11-07 in M209 `ef9457363` (verified at `1b9179c86`), run 209, LANDED "IOS-12d's M-d"; IOS-12f's M-f1 (New spark) LANDED 2026-11-07 in M218 `27c75681f` (verified at `3ed4e77e0`), run 218, LANDED "IOS-12f's M-f1"; item 241's 241a (the Off pill) LANDED 2026-11-07 in M219 `fba72f50d`, run 219, LANDED "Item 241 (241a)"; its 241b (the Mac's Off pill) LANDED 2026-11-08 in M225 `493ad96b0`, run 225, LANDED "Item 241 (241b)"; IOS-12f's M-f2 (@ on the phone) LANDED 2026-11-09 in M266 `d9fe8e6c2`, run 266, LANDED "IOS-12f's M-f2"; 12f is whole · K-D5's ghosttea `customInputView` petition (unfiled) | James rebuilds; external TestFlight | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `apps/ios/TESTFLIGHT.md` |
| NF | COMPLETE; owed: item 52 (b)'s phone half (its routed ghosttea client) · headless floor-on-tailnet rows over TS-1's authKey path (`029af0e6f`) if wanted · native-floor §7 into the T posture | an NF lane | `specs/native-floor.md` |
| Native push (APNs) | SP-D8: the relay after AR-6; pairing is the account; README's `services/push-relay` row is deferred | AR-6 | `thinking-native-push.md`, design-06 L4 |
| LOG | LOG-39 (beta list) · LOG-V5 (rides Windows) · LOG-V8 retention (James's product call) · LOG-V7 optional | the beta checklist | `specs/logging-and-diagnostics.md` |
| SNAP | live checks (§5) · a still onto the desk as a `desk.photo` dragged from the tray → SNAP-2 under `surface.capture` → SNAP-4 (Windows round) · the perf review's leads | a SNAP lane | `thinking-screenshot-tool.md`, `draft/reviews/screenshot-performance-2026-09-24.md` |
| WIN | WIN-5 visual · WIN-7 live mesh (`TRUFFLE_TEST_AUTHKEY` via TS-1's authKey) · WIN-8 = RM-4's Windows leg (Azure signing, EDP-39) · WIN-D6…D9 (James) · residue: the win32-gated concurrent-edit doc-sync rows (their skip text claims coverage behind `TRUFFLE_TEST_AUTHKEY`), group-kill → Job Objects, snapshot-prune EBUSY (`doc-service.ts`) · LSF §18's Windows rows (LSF-3/3C/6; the LSF-3C spike's re-run reads `draft/archive/executed/specs/live-surfaces-agent-browser-spike.md`), PRC-5's Windows filesystem, M11, predesign-03 §6's coexistence ask, SNAP-4 ride it · a pipe-name squatter makes field-native fail closed (deliberate) | a Windows leg on the release rails | `thinking-windows-port.md`, `docs/WINDOWS_PORT_STATUS.md` |

## 5 Owed by James — live surfaces only

**Rulings**
- BP-D9: a desk profile lives inside Electron's userData (lean a) — blocks R4 and the desk's sign-ins.
- AR6-D1…D9 (AR-6) · AR-D24…D35 (one batched ratification; Agent Profiles) · QL-D1…D10, QL-D12…D17 (built as
  QL-1/QL-2) · GT-D22 (adopted as built; the web-only narrowing above all).
- NF-D3/NF-D5's long-pending read, or record them as answered by the as-built code.
- MB-D1…D9 and UP-D1…D8 (proposal pages owed first, LANDED :7954) · SP-D4, ~~D11~~ *(struck 2026-10-31: ANSWERED
  2026-10-29 by PG-D2 (a) and PG-L4.6, as DECISIONS' SP row, design-06 and `thinking-sync-planes.md` record it)*, D12.
- Whether the phone (`vibefield.simulator`) ships among `BUNDLED_PLUGINS`: no, for 0.9 (James, 2026-11-09, DECISIONS
  "FL") · WIN-D6…D9 · LOG-V8. `PT-S-vs-PHONE.md` §5's seven choices are ruled (James,
  2026-10-29 00:25Z, "Go with your leans"; its §6, the work kept) and leave the list.
- DK's parked build rulings ((17)/(53), (48), (83), (92), (95), (97); DECISIONS DK addenda). (86) is answered by Q18
  and D22's "packaged built-ins" by WP8 (`5e7507d6c`); both leave the list.

**Witnesses (his hands, his devices)**
- ST-D1's live half: how long each catalogued agent takes to be heard after a Stop, on his signed-in agents, before
  `AGENT_STOP.HEARD_WITHIN_MS` (3 s, provisional) goes final — LANDED "ST".
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
- PG-3's acceptance (J-E4): the phone against its home's window on one live board, row for row within a 1 s settle
  (Q-P4), with 3e's visible changes as he picked them 11-02 (J-E1…J-E10) — LANDED "PG-3e".
- HN's console-window rows are all paid: 11k, the Hub in the head's smoke:godview rung, at run52b (M52 `c564de0e4`,
  2026-10-31; LANDED "HN — smoke:godview's rungs"), with 11h and SP-1c's 11l in the same row. The rest
  are paid: smoke:canvas's HN rows at run 30b and item 123's four HAND rows at runs 35b and 38b, and smoke:godview's
  re-aimed 11h (a card played into a real pane) and 11j (a program's OSC 52 reaching main's copy door, no card) at
  run 38b (M38 `5321b12ac`), where item 124's launch rung PASSED (LANDED "Item 124"). *Corrected 2026-10-31 (item
  123): this line said "HN B1's and B2's" and "runs 22 and 26" while it listed B3's rows too.* *Corrected 2026-10-31
  (run 38b): it listed "the Hub in the head" among smoke:godview's rungs; no such rung exists.* *Built as 11k on
  2026-10-31 (M44).*
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
- The Setup Assistant's glass on the field (FG-3a; drawn by the field since FG-3b; its panes in the frame since FG-4a;
  its holds and the logo since FG-4b): the forming, the fit in a small window, the steps' band, both themes, and the
  hand-off's frame or two as it forms; each pane's head and actions at one height, a long list's scroll under its
  fade, Profiles' login whole above it; a load's logo and one line, never a flash, the welcome's title card, Setting
  up's line and Start now, the band's fill, and the logo inverted by day and white by night, over the live field and
  over the still; the sheet's scrim close by hand (FG-D27).
- Cards in Hand's B1: the hand at the window's foot (a capture dealt, a card held and reached, ⇧⌘V's list), the line
  `[views] snapshot create`, the desk's Copy ⌘C, a card played into a pane and onto the desk.
- Cards in Hand's B2: Settings', History's and the Setup Assistant's copies dealt into the hand from their buttons; a
  picture copied with its words; ⌘V with no caret and a drag from another app; History's New terminal ⌘T in the
  project it shows.
- Cards in Hand's B3: the pill's package and its dot, the sheet's two shelves and the Hub's tiles on Artifacts, the
  package circle under a cover and in the terminals' title bar, reduced motion's fades, a narrow window.

**Releases, edits and chores**
- Releases: puppeteer 0.3.0 PUBLISHED 10-28 08:19Z and pinned (`1469639a6`, with QW1 stack B) · a later puppeteer
  release (0.3.x or 0.4.0) for AO-7's `installRecipe`, item 50's env seam, item 39 and the tuck (push and merge
  `vf/item-39`, `vf/after-a` first) · mille's first
  npm release · adopt rosettad's published archives (RD-D7) · RD-4's pipelines (who runs them is open, §9).
- The Mac mini (Q24): full Xcode was INSTALLED there (James, 2026-10-28 ~20:54Z: Xcode 27.1, 27A9275; read 20:57Z:
  `actool` and Icon Composer's `ictool` executable, the two files `run-electron-builder.mjs` requires), and row 30
  (`smoke:update`), the one gate row that needs it, ran there 5/5 that evening (§6). The mini is OFFLINE from
  2026-11-05 (at James's account switch; LANDED "CP-4a2b's M-h"): vf-m1 is the lane host now, and row 30 has not run
  there. James cleared the mini's leftovers by hand from Claude's read-only list (2026-10-28 ~15:18Z). Agents delete
  nothing.
  *Corrected 2026-11-06: this line said the install was DEFERRED (James, 2026-10-28 08:46Z: "not able to install
  xcode on mini right now, please run those test on this mac instead"), with row 30 on James's Mac, and that Claude
  would list the mini's leftovers.*
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
- `smoke:update` raises a keychain dialog with a person present (use a run keychain; the fixer's item). Row 30 ran on
  the Mac mini once its Xcode was in (Q24, §5): 5/5 at `3e6c941a8` (prod-builder, 2026-10-28 21:09–21:14Z) under
  Xcode 27.1 and `TMPDIR=/tmp`. Under the lane's own TMPDIR the per-run `meshdata.sock` path was 104 bytes, over the
  103-byte `sun_path` limit, and the first try's run 5 went red (`channel-unresolved`, 21:08Z). Unattended (the
  first try, armed 21:03Z), runs 1–4 waited on no keychain; attended (the rerun), each run took ~19 s longer with a
  SecurityAgent up (the dialog waiting, inferred). The mini is offline from 11-05 and row 30 has not run on vf-m1, so
  the next gate:landing on James's Mac carries it (full Xcode 26.6 there, both files read 2026-11-06). Until the run
  keychain is built, a person present cancels each run's dialog (never Reset, never a password). *Corrected
  2026-11-06: this line said row 30 runs on James's Mac because the mini's Xcode was deferred.*
- `cargo audit` runs report-first (`audit.yml`, `continue-on-error`); chacha20 is YANKED in Cargo.lock (run 40590297837); harden it after chacha20 moves (Q28, §3 item 7).
- Shipped Rust daemons inherited `allow-jit`, shipped binaries embedded `~/.cargo/registry` paths, and `package-census
  --assert --strict` was red on MV's chunks (`build-hf.md` M3–M5) — LANDED "LP-6" (each daemon its own entitlements),
  "LP-6b" (no build paths) and "LP-6c" (the census strict in verify, on a fresh baseline).

**AL and the dev runner**
- The dev runner's SIGTERM teardown dies before `stopDaemons` under `pnpm dev` (three times 10-17); read why, fix at the cause — `draft/handover/2026-10-17-focus-audit.md`.
- After an unclean exit, a pair adopted across a shell-only change keeps its floor, loses its cells to the start-up reaper, and the floor starts its host again — LANDED "TC-S2 + GT-2d".

**Agent plane (AR · AO · MV · Godview)**
- ST's owed: PU-K (James files it; asks 1–2 close DESIGN.md §8's two gaps, the 8 s arithmetic and a spark's Stop
  with no pane state, and ask 4 the unverified coalescing residual) · drawing the Stop on the phone, a later iOS
  slice (fd's; the PG/IOS track) — LANDED "ST", "ST's rename and the kit half".
- Item 50: agent probes inherit fieldd's env (EL7); one puppeteer seam (`BuiltinProviderOptions.env`, abort on stop) also ends fieldd's agent-inventory probes outliving its stop (QW1 stack A's `4c54f20c7` covers an adapter's helper once the pinned puppeteer asks) — DK-18 follow-up (a).
- COLORFGBG: ghosttea writes it into every session, an agent's included; EL7 accepted ghosttea's value 10-23 — decide whether an agent's value is VibeField's own.
- Item 60's doors: James's veto on the phone's bounded reply; whether `project.figures` says a count beside `clipped`; the phone's "N more" for `omitted`; a revisioned delta past a page (measure first) — LANDED "AR/SP — item 60's three doors".
- AR-S4e2's probes: each install form's first real run on a throwaway profile; a >512-char Claude inventory id — LANDED "AR-S4e2".
- AR-7 §11's three puppeteer petitions, "none filed yet": file or drop with a dated note — `thinking-ar7-typed-agents.md` §11.
- `s3eInstrumentDebt` (`smoke.ts:7772`): does keystroke-echo move onto the routed path, and is the flip-witness still meaningful for panes born keep-until-exit? The perf lab no longer throws (`2cb776f27`) — Godview owner.
- Godview smoke reload rows still wait on `CANVAS_READY` for 60 s (`smoke.ts:7992`, `:10079`); wait on `DESK_READY` (`smoke.ts:999`); no red since August — low.
- The perf lab leaves its fieldd data root (`/tmp/vf-smoke-*`); `teardownLab` should call `removeSmokeRoot` — DK-18 follow-up (c).
- MV's owed: the cd row's failure dump still lacks the active pane's last rows, which need a test door in the product or ghosttea (LANDED, M246); the after-MV list — LANDED §MV "Known, not fixed", §SWF.
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
- `smoke:studio` reds when its window is covered: give Studio's acceptance window DK-11's frames. *Note 2026-10-31 (PR #6): DK-11's frames (`backgroundThrottling: false`) keep a covered page visible, while `UI_SYSTEM.md` now keeps Studio's throttling on and row 26 waits for the page hidden; shape this with item 128.*
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
| truffle | `truffle-core = "=0.7.27"` (Cargo.toml) + the five npm sidecars 0.7.27 (protocol 13) · Swift exact 0.7.26 (Package.swift's `truffleRelease`; lock `release.swift`), which ghosttea 0.14.0 declares | the split, DECISIONS TB (a), `af3f3078f`; EL8-TRUFFLE (track DR, 2026-11-07) moved cargo and npm to 0.7.27; Swift rejoins at the first ghosttea declaring 0.7.27 |
| ghosttea | 0.14.0 on cargo (`=0.14.0`), npm and Swift | the EL8 of 11-02 (LANDED "EL8 — Ghostty 1.4"); no checkout needed; `../ghosttea-0.11.2` is only the overlay's coordinate |
| ICE | `@vibecook/ice` 0.17.0 exact (overrides row) · strata 0.13.0 via ICE · `loro-crdt` ^1.13.8, one resolution | EL8 |
| puppeteer | `@vibefield/puppeteer-*` 0.4.0 exact (the lock's `e6e4753de`) | the EL8 of 11-10 (LANDED "EL8 — puppeteer 0.4.0"; RD-5a-2 `a04850e29` took it exact at 0.2.3); `../puppeteer` is the overlay's coordinate |
| rosetta | `@vibefield/rosetta-protocol` / `-room` 0.1.5 exact · the kit's `RosettaClient` 0.1.5 exact (`let rosettaRelease`) · rosettad built from `../rosetta-pin` at `811e554c6` (protocol and store schema 30) | EL8 11-08 (`68b80fb95`, M230; 0.1.4 at `a8ab1f13f`, 11-07); npm, Swift and the daemon archives released (v0.1.5); adopting the archives remains RD-D7; the Swift row is PAID on vf-m2 by item 257 (M233 `b3a5930b2`); its exact-tree witness stays the old mini's |
| mille | `link:../mille-pin` at `c8160d5` (`@vibecook/mille`, `mille-ui`) | FS-1b; no release past v0.3.4; exit RD-6 |
| rustc | 1.99.1 (`rust-toolchain.toml`) | EL8 |

Petition status lives in `draft/petitions/README.md`. Still open or owed there:
- **ghosttea:** G29 (the link hook names its session; drafted; gates GT-D22's file half) · G30 (the routed
  `copySelection` answers nothing, so ⌘C in a pane copies nothing; HN-5's pane copy waits on it) · candidates to file:
  D6's `encodeInput` seam, D5's renewal, browse-handler injection (absent at 0.13.7), a real `prepare()` (the
  first-frame half MET by `session-drawn`, 09-29), whether `paste()`/`sendKey()`/`sendText()` say they sent, the "last
  pane closed" hook (AL), K-D5's `customInputView` · G27 parked (a second Swift consumer).
- **truffle:** T8 (the app-chosen hostname prefix; taken at 0.7.27; TS-8c) · T12 (a typed start refusal; held; a PR when
  James says) · T13, the one T row for T7's route-name pinning (Q22; owed, not drafted); T7's other follow-ups (the per-direction idle reap, a held
  route id's refusal, loopback pages) are recorded as accepted.
- **rosetta:** RO-24…RO-27 (#23–#26) shipped in 0.1.2; VibeField RPC/UI adoption remains follow-on work. RO-28 (#27,
  AO-8) shipped in 0.1.3 and is adopted (the face's titles). RO-32 (by digest), RO-33, RO-34a and RO-35 shipped in
  0.1.4: RO-33 and RO-34a are adopted at the History door, and the export and RO-35's signal have no caller yet. Still
  filed: RO-8 (retire/forget a runtime), RO-11 (`/ws/meta`'s removal event and resumable stamp,
  DS-6's follower's ask; DS-7 landed without it, the follower still diffs snapshots), RO-17…RO-23, and RO-10's
  follow-ups. RO-4's remainder is adopting the released daemon archives (RD-D7). RO-31 (a copy port in rosetta's room;
  History's Copy waits on it, HN-5).
- **puppeteer:** 0.4.0 PUBLISHED 11-09 (`v0.4.0` = `e6e4753d`) and pinned at M274 · a later release for
  AO-7's `installRecipe`,
  item 50's env seam, item 39 and the tuck · PU-12 (verify first) · PU-19 filed as #47 (AO-8) · PU-15
  (with AR-6). PU-R (UM-D7, the bloom's buds wear their fuel, #76) and PU-S (UM-D6, an agent's body wears its profile,
  #77) shipped in 0.4.0; PU-R's consumer is VibeField's.
- **mille:** M11 (with WIN). **ICE:** I47, I48 (named, parked) · the remount edge (a pointer `leave` with no point; a
  candidate if presence UX needs it) · NodeNext portability. **strata:** S3/S4's residue (parked: a measured join or
  reload wall on a real desk document).

## 8 Tracks

| Track | State | Law lives in | Next |
|---|---|---|---|
| TS — the Tailscale door | ACTIVE; TS-0…3b, 4a, 4b, 5, 6, 7, 8a, 8b landed | `thinking-tailscale-onboarding.md`; DESIGN.md §5/§6/§8/§9/§13 | TS-8c (T8 taken at truffle 0.7.27; the prefix OFF until every shipped plane reads the tag) |
| AO — Bring Your Agents | ACTIVE; AO-0…6b3 landed | `thinking-agent-onboarding.md` | AO-7 on a puppeteer release after 0.3.0 (`installRecipe`) |
| FG — the first run on the field | ACTIVE; FG-0…3a landed 10-30, FG-3b, FG-4a, FG-4b, FG-6, FG-5, FG-6c, FG-O2, FG-O2's judge and its fix, FG-6's catalog, FG-6's frozen frame 10-31, FG-6's follow-up 3, the catalog judged and its follow-up 1 11-01 | `thinking-first-run-glass.md`; DESIGN.md §2.1/§5/§6/§8/§13; desk-gates row 32 | the glass's literals (item 136) → James's product question |
| AL — app lifecycle | ACTIVE; AL-1…3, 5, 7, 8a, 9 landed | `thinking-app-lifecycle.md`; ESR §7.3 | AL-6, Last exit, relaunch cap |
| AU — Updates That Wait | ACTIVE; B1–B4 (AU-0…AU-7) landed 10-30/31 | `thinking-update-ux.md` §7 (page sources `draft/update-ux/`); DESIGN.md §2.5/§2.8/§6/§8/§9/§13; EDP §5.2/§6.4/§11; ESR §7.3 | the owed eyeballs, the first signed nightly with notes, the physical rows |
| PG — the phone's Godview | ACTIVE; PG-0, PG-1a…1d, PG-1e0 (measured: neither), PG-1f's pin test and PG-2 (the remote cut) landed 10-31; PG-3 (3a…3f), PG-9a and PG-4s 11-01…11-02; PG-4t, then PG-7, PG-5 and PG-8 as one stacked mint, then PG-6, 11-04; PG-9 (S1–S4b, then S4a, S4c and S5a), 11-05 | `thinking-phone-godview.md` §7/§8; `design-mv.md`; `design-06-sync-planes.md` | S5, James's device run, by his recipe page (published 11-05) |
| HN — Cards in Hand | BUILT; B1–B3 (HN-0…HN-8) landed 10-31 | `thinking-cards-in-hand.md` §6 (page sources `draft/cards-in-hand/`); DESIGN.md §1/§5/§6/§8/§9/§10/§13 | the console-window smoke rows; D10 (James) |
| QW1 — Godview swarm QA, fix wave 1 | ACTIVE; stacks A and B landed 10-28, B on puppeteer 0.3.0's EL8 pin | `godview-swarm-qa-plan.md`; `thinking-ar-reattach.md` | QA wave 1 |
| Release rails (EDP/ESP, WP12, TD, BP, RD, RM) | ACTIVE; nightlies live, W10/W11 passed | the release specs; `thinking-browser-profile.md`, `thinking-release-deps.md`, `thinking-release-management.md` | round 3; the first-beta list |
| EL8 — pins | ACTIVE (watch) | DECISIONS TB; the manifests | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); Swift rejoin; mille's release |
| AR — agent runtime | PARKED; AR-3…AR-5b, AR-7, AR-7j, AR-S1…S4e2, AR-S5 landed | `thinking-ar-agent-plane.md`, `thinking-ar-data-topology.md`, `thinking-ar7-typed-agents.md`, `thinking-ar-agents-settings.md` | AR-6 on AR6-D; AR-7j LANDED (M128 `45c3680a3`) |
| MV — monitor views | PARKED; landed 10-08 | `draft/monitor-view-sdk/design-mv.md`; DESIGN.md §8 | puppeteer 0.3.0 pinned 10-28 (`1469639a6`); item 39 and the tuck wait on a later release; QL ratifications |
| History (AR-8) / PJ | PARKED; PJ-1…4, 6, 7 landed; DS-7 hands the room another desktop's sessions | `build-hf.md`, `thinking-ar-history-room.md`, `thinking-project-places.md` | R8/R9; B-D4/B-D5; PJ-5 re-judged; PJ-8 (unblocked) |
| DS / SP — sync planes (was C — mesh) | PARKED; waves 1–3 and DS-7 landed | design-04, `design-06-sync-planes.md`, `thinking-desktop-sync-plane.md`, `thinking-sync-planes.md`, `thinking-c6-meshdata.md` | the two-desktop run (James); DS-9; SP-7 (opened 11-06; 7a's M-b, M-a and M-b2 LANDED; the device run next) |
| FW — the freeway | PARKED; F1 landed 10-20, packaging 10-27, F1b's desktop half 10-31 (M63 `599998fdd`), its kit half 11-01 (M93 `284e4af9d`) | `thinking-freeway.md` | James's device round (the flag-off); FD1/FD2's owner |
| FS — files service | PARKED; FS-1a/1b/2 landed | `thinking-files-service.md`, `build-fs.md` | FS-3 on the desk; mille's release |
| PT — PORTALS | ACTIVE (PT-S, resumed 10-29); browser landed 10-14; PT-S1 (the phone as a kind) built 10-18 and 10-29, gated and looked at 10-29, LANDED 10-30 (`1de84540b`); PT-S2 (the phone's producer) built code-only and light-green 10-30, LANDED 10-31 (`e4aa3d367`); PT-S3 (the gates) built code-only and light-green 10-31, LANDED 10-31 (`c564de0e4`) | `thinking-portals.md`, `draft/portals-maps/` (PT-S: `PT-S-the-simulator.md`), `draft/ground/PHONE.md`, ICE design-019, LSF spec | PT-S3's live run (on James's unlock) → PT-S4 (touch); then PT-C, PT-T |
| Desk Phase 6 | PARKED; replaces the four dogfood packs (Q9) | `thinking-desk-migration.md` | STRING's thinking doc |
| DK — the desk migration | COMPLETE; landed 10-09 | `thinking-desk-migration.md`, `thinking-the-desk.md`, ICE design-015…018, `docs/desk-gates.md` | James's parked build rulings |
| GT — Godview terminal | PARKED; the deck's ladder done (GT-0…GT-8) | `specs/godview-terminal.md` | G29; GT-D22; row 13b |
| TP / TC — terminal pipeline and custody | PARKED; TC RATIFIED 10-28 (Q6) | `specs/terminal-pipeline-v3*.md`, `specs/terminal-custody.md`, `thinking-terminal-mesh-cells.md`, `thinking-floor-wedge.md`, `thinking-inventory-latency.md` | D6's cell half |
| MA — Apps (was AH — Artifact Hub) | ACTIVE since 11-05 (MA-D1…D13 ruled; MA-4 in 0.9, James 11-06); MA-0a + MA-1a (M152), MA-3 (M157, M162), MA-4 (M166), MA-3f (M268) and MA-6 (M269, M272) landed; AH-1…3 landed, AH-4 unledgered; Live apps are field-app's since FL-2 (M267), `plugins/browser` gone | `thinking-mini-apps.md`, `specs/artifact-hub.md`, design-06 §5; DESIGN.md §2.9/§8/§9/§13 | MA-3h; MA-5 after SP-4; James's device rows and stills for MA-6 |
| DR — the Drive | ACTIVE since 11-06 (DR-D1…D13 ruled; D14, D15 open); DR-1a, DR-2a, DR-1b, DR-3a (W3's VF-FLOOR), the EL8s to rosetta and truffle, DR-3b (W3's VF-RELAY) and DR-1 (B) as MA-3f landed (M183, M188, M190, M203, M205, M217, M249, M268); wave 1's sibling PRs merged and released 11-06 | `thinking-drive.md` v0.3 (page sources `draft/drive/page/`); `thinking-mini-apps.md` | D14 and D15 (James); the EL8 to mille and the substrate slice; DR-2…DR-5 |
| RV — the review fixes (Godview, terminal, puppeteer) | ACTIVE since 11-06; items 191 (RV #2 half A, M192), 192 (RV #6, M193), 201 (RV #17, #43, #49, #48, #50, M194), 203's VF-W1 (RV #1's pin-free half, M196) and VF-W3a (M274, with #73), 211 (RV #97, #96, #93, #116, #95, #47, M199), 212 (RV #30, #29, #67, M201) and 216 (item 192's census row, M204) landed; W1–W2 building, the sibling lanes local | `draft/rv/` (plan.md, james-asks.md, lead-rulings.md); `lanes/rv/review/` | ghosttea 0.15.0 → EL8-g |
| UM + SE — profile meters and one search | ACTIVE since 11-06 (UM-D21…D28 and SE-D1…D5 ruled on the page; UM-D16 E, D19 A; D3, D4, D8, D12…D15 at the leans); UM-0…UM-2 landed 11-06 (M-U1 `c9493b957`, run180, M180); UM-3 and SE-1 landed 11-06 (M-desk `ed8099c1e`, run187, M187); UM-4 and SE-2 landed 11-06 (M-phone `d6d76d079`, run198, M198) | `thinking-profile-meters.md`; `lanes/um/PLAN.md` §4; DESIGN.md §2.7/§5/§8/§9/§13; `docs/agent-plane/usage-meters.md` | UM-5 (UM-D14, the plan filter) in wave 2 |
| PLUG — shipped core | COMPLETE: P0–P7, P8b–d (P8c via WP8), PRC-4/5; later publishing/validation work is separate | `specs/plugin-architecture.md`, `thinking-p8-loadable-artifact.md` | existing product gates; no blanket 24-hour prerequisite |
| PRC-6 — plugin runtime validation | OPEN; diagnostics in draft [PR #7](https://github.com/vibefield/vibefield/pull/7); Linux CI passed, full verification and calibration pending | `thinking-prc6c2-physical-soak.md` §9–10 | full verify → guarded 32-cycle current-desk calibration + listener control; historical failures stay open; literal 24h only for that claim |
| PLUG — publishing | PARKED: KIT/P8e | `thinking-p8-loadable-artifact.md`, `specs/trust-and-distribution.md` | publishing scope; TD registry + R2 process host |
| IOS — companion | ACTIVE; IOS-8f landed 10-30 (`user.me`: the corner wears its home desktop's face and name); item 130 landed 10-31 (a sign-out clears History's cache, AP-D4); IOS-10a landed 11-01 (the phone's Settings, `a9a62c20a`); IOS-11 landed 11-02 (the phone's splash, James's PR #10, M104 `f2854bf2f`); WI-1 landed 11-02 (the way in, M108 `8cfe4a59d`; the WI row); item 161 landed 11-02 (a set that never comes up backs off and stops waiting at the dial); WI-3 landed 11-04 (the lock, M116 `ae2d44c00`; the WI row); IOS-12a landed 11-05 (the phone's Chat, its cross-plane changes: `sparks.use`, the spark and needs-you doors through the home, `compose.sparks.say`, the remote row's `spark`; M125 `4fcb471af`; §2's IOS-12 block); IOS-12b landed 11-05 (the phone's Chat, the tab and the list: the bar's third tab, each spark as the Mac reads it, its face, each desktop's last word or never heard; M127 `8255a10b3`); IOS-13a landed 11-06 (Settings for App Review: Privacy Policy and Support on About and the welcome, the bundled acknowledgements read with their texts, the non-affiliation line, the device named as its platform names it; M165 `7a7f22623`); IOS-12e landed 11-06 (the phone's Chat, the star in Metal: the engine's own live face, held to its rows and stills; Chat's list draws it; M186 `09378c9ec`); IOS-12c's M-c2 landed 11-06 (the phone's Chat, the thread: a spark's conversation drawn as the Mac's at touch pitch, read through the home and answered by your words, its draft held while its desktop is away; M191 `eda440d58`); IOS-12d's M-d landed 11-07 (the phone's Chat, what waits on you: Needs you heading Chat, the Mac's card at a thread's foot, an answer through the home; M209 `ef9457363`); IOS-12f's M-f1 landed 11-07 (the phone's Chat, New spark: the Mac's sheet at touch pitch, its sky the engine's hatch in Metal, the face flown to its row; M218 `27c75681f`); IOS-12f's M-f2 landed 11-09 (the phone's Chat, @ at touch pitch, a chip in the sentence, the handle in the card; M266 `d9fe8e6c2`); item 241's 241a landed 11-07 (a pill that is off draws §7's Off, the quiet look with its words in t4; M219 `fba72f50d`), and its 241b 11-08 (the Mac's kit pill draws §7's Off; M225 `493ad96b0`); item 257 landed 11-08 (the kit's tests build on vf-m2's Xcode 26.3 and pass under Xcode 27.3's test runner, all but item 167's; the EL8's row 6 paid there; M233 `b3a5930b2`); item 259 landed 11-08 (About lists the parts others made, and VibeField's own rosetta row rides the iOS record undrawn; M236 `83cf67316`) | `thinking-ios-app.md`, `thinking-ios-swarm.md`, `thinking-ios-account.md`, `thinking-ios-history.md`, `apps/ios/TESTFLIGHT.md`; the page *Chat in a Pocket* (M6kri6s5; sources `draft/ios-pocket/chat/`), DECISIONS PC | 12f is whole (M-f2 landed 11-09, M-f1 and 12d's M-d 11-07, and 12c's M-c1 and M-c2 and 12e 11-06); item 242 (the phone's faint words, sorted), items 248 and 251; the rebuild; TestFlight build 4 |
| WI — the way in | ACTIVE; WI-4 and WI-1 (with WI-2) landed 11-02 (M108 `8cfe4a59d`, run 108): the two states, the way in on the splash's field; item 163 landed 11-02 (Settings' unreachable signed-out head and empty list retired); WI-3 landed 11-04 (the lock: Face ID over a curtain above everything, the way in's last step, Settings › Lock; M116 `ae2d44c00`, run 116); WI-1's owed witness landed 11-04 (M120 `576172d99`, run 120); the mark keeps its place (`WayInView.markFades` shut) until James's word on its fade | the page *The Way In* (5cvau5EQ, v5; sources `draft/ios-pocket/way-in/`); DESIGN.md §8 "The phone's way in", §9 "The way in" and "The lock"; DECISIONS WI | the lock's four hand rows and draft words (James; LANDED "WI-3 — the lock"); the Desktop slice, held for James (item 160) |
| UA — users and accounts | COMPLETE except witnesses | `specs/users-and-accounts.md`, `thinking-ua-phone-account.md` | the phone's second-account witness |
| NF — native floor | COMPLETE; one owed line | `specs/native-floor.md` | item 52 (b)'s phone half |
| LOG — logging and audit | PARKED; item 78 landed | `specs/logging-and-diagnostics.md` | LOG-39 for the beta |
| UI — design system | COMPLETE; owed slices | `DESIGN.md`, `docs/UI_SYSTEM.md` | InlineNotice tones; the desk sweep |
| SNAP — screenshot tool | PARKED; SNAP-0/1/1a/3/3a/3b landed | `thinking-screenshot-tool.md`, `draft/composer/build-edge-trays.md` | live checks; the still as `desk.photo` |
| SD — the sound identity | ACTIVE since 11-05 (SD-D1…D22 ruled at the leans); SD-1 landed 11-05 (DESIGN.md §14 and `@vibefield/sound`, M126 `1ebe7b461`, run 126); SD-2 landed 11-05 (the desktop hears it, M138 `9e5b6eec8`, run 138); SD-3 landed 11-06 (away, M181 `67034fe61`, run 181) | DESIGN.md §14; `draft/sound/design-sound.md` | SD-4, the phone |
| WIN — Windows port | PARKED since 08-24 (`c16e618f4`) | `thinking-windows-port.md`, `docs/WINDOWS_PORT_STATUS.md` | a Windows leg on the rails |
| LSF — live surfaces foundation | COMPLETE; LSF-4 landed 10-26 | `specs/live-surfaces-foundation.md` | consumed by PT; §18 Windows rows with WIN |
| CO — the compose plane | ACTIVE; CP-0, SP-1a, CP-1a…1c, CP-1d, MT-0, CP-2, SP-1b, SP-1c, SP-1d, CP-3 (`ce6577783`, run 88), TU-1 (`57569bca3`, mint M96), the handle (`045f10ec7`, mint M100), items 158 and 159 with CO-1b (`9b3164ccf`, mint M129), CP-5a (`fc70097e3`, mint M140), CP-4a1 (`1a3ca5f24`, mint M143), SP-1e2's fieldd half (`068cab410`, mint M146), TH-1/TH-2 (`d5c6995fb`, mint M147), SP-1e2's card (`320d4b882`, mint M156), CP-4a2a (`c07039551`, mint M159), CP-4a2b's M-h (`aebd6a80b`, mint M163) and M-r1 (`c92b33692`, mint M168) landed | `compose-plane/thinking-roled-agents.md` §15–§17, `compose-plane/v2/`, `thinking-tool-plane.md`; the CO round (Druyc3Ua); DESIGN.md §2.10 | SP-1e4 · CP-4a2b…4f · CP-5b…d |
| ES — Chat's empty state | ACTIVE since 11-08 (ES-D1…D7 ruled at the leans); ES-1 + ES-2 landed 11-08 (M226 `6b8a4b09f`), ES-3 + ES-4 landed 11-08 (M238 `2c34727a3`), ES-4 (role) landed 11-09 (M241 `7d7019a23`), ES-6 landed 11-09 (M260 `f3cbbc469`), ES-Q1 + ES-5a to 5d landed 11-09 (M270 `e6de35f09`) | DESIGN.md §2.4/§2.10/§3/§5/§6/§8/§9 (the ES page `1GdkfmnTxynAp6wHTbAa3a`) | 5e (a device and James); ES-6's first real window (row 36) |
| HG — History's first view and its waits | ACTIVE since 11-08 (HG-D1…D6, HG-W1…W5 and HG-L1 ruled at the leans); HG-1 + HG-2 landed 11-08 (M235 `3264c54f1`); items 263 + 264 landed 11-08 (M239 `9d2b8d03d`); item 267 landed 11-09 (M242 `519132f1a`) | DESIGN.md §5/§6/§8/§9 (the HG pages `U12DeYQrZB4YRjycrR4wuR` and `9ByDzaNGQaijgSHW6GrZUb`) | HG-3 (rosetta's `waitMark`, RO-40) → rosetta-room 0.1.6's EL8 → HG-4, History's holds in the living mark |
| NR — native re-arm | ACTIVE since 11-08 (opened by VF-PM 19:53Z, Q1–Q5 answered); S0–S2 landed 11-08 (M240 `33162a078`) | `draft/thinking-native-replay-rearm.md`; DECISIONS NR | S3 with the integration lane after EL8-TRUFFLE; the named follow-ups (LANDED "NR S0 + S1 + S2", Not this entry) |
| A — shell and spine | COMPLETE | design-03, `specs/electron-shell-refactor.md` | — |

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
   words on loads ("nothing more"). *Ruled (a) at the lean, 2026-10-31 04:15Z (VF-PM; James may overturn): Cancel
   shows under the line after 6 s. Built with FG-4b and landed in its mint `a5106c727` (run 40), with Esc cancelling
   from the start in the Setup Assistant.*
4. **HN's D10, the sheet's two shelf headers** (`draft/thinking-cards-in-hand.md`; B3's design review): the page drew
   one caption style for both of the pill's sheet's shelves, and the build keeps each shelf's own header, as the doc
   allows. Lean: as built.
5. **Should a title win in @?** (the handle's Q1; `lanes/co-plan/plans/handle-plan.md` §6): @ never reads a title,
   so a titled session @ offers reads its handle, its folder else its agent's label, on the needs-you card as in @.
   A title would need the board's row to carry one, and @'s rule first: a slice of its own. Lean: as built.
6. **ES-Q1, a slot with nothing to fill** (DESIGN.md §8 "Chat's list", the jobs, "Filled from this Mac"; track ES):
   RULED by James 2026-11-09 07:53Z, "go bare form": a project or a run this Mac cannot name drops out ("Keep track of
   my agents"; "Have Codex review my agents' work until it's clean"). Landed as M270 (`e6de35f09`; LANDED "ES-Q1 + ES-5a
   to 5d").
