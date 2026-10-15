# VibeField — Roadmap

> **Status:** the living now/next file — the corpus's single answer to "where are we, what's
> next." REWRITTEN in place at each milestone (never appended); history goes to `LANDED.md`,
> decision status to `DECISIONS.md`, petition status to `draft/petitions/README.md`, law
> stays in the design docs + specs. Last rewritten: **2026-10-14 — THE BROWSER PANE LANDS, THE HISTORY IS CLEAN FOR ITS FIRST PUSH, AND THE TRUST MODEL HAS ITS FIRST SHAPES (`fb9efdb3` · `5062139e` · `562ea33a` · `87ce111a`).**
> Seven landings on main in one day, each gated on the tree that landed; main is a fast-forward of origin's `b4adabb2`, 1,674 commits ahead. Nothing is pushed: the gc after the history rewrite and every push, siblings first, are James's.
> - **PORTALS, PT-6b — the browser pane is in the product** (`fb9efdb3`, 243 commits, James's go to the PORTALS session, fast-forwarded 21:59Z; LANDED "PT — PORTALS lands"): a live page on the desk as an object kind, the plugin `vibefield.browser-pane`, over ICE `0.16.0`; two lane gates at 24/26 and the gate on main at 24/26, every red main's own (check:deps' mille row, DK-14's AIMED rung) or the screen's (a covered window), each of those green alone. Next: PT-S (the iOS simulator portal) designed by Thursday 10-16, built after WP8 (RL7 (a)); then PT-C, PT-T. PORTALS has a track row below from this rewrite on.
> - **RL1(c) — `work/godview-audit-2026-09-25/` is out of every ref's history** (`11200ba7` + records `87ce111a`, 2026-10-14; LANDED "RL1(c), before the first push"): 1,524 commits re-identified, the records remapped mechanically, the map at `docs/sha-map-2026-10-12.tsv`; the first push is a plain fast-forward. James runs the gc (the old objects stay recoverable until then) and the pushes: mille, puppeteer, rosetta, ghosttea, then VibeField.
> - **RD-5a, the rosetta half** (`fe01ac79` · `562ea33a`; LANDED "RD-5a, the rosetta half"): `@vibefield/rosetta-protocol` and `-room` 0.1.1 exact, rosettad still from the pinned checkout, CI's sibling token retired. The puppeteer half waits on a 0.2.2 cut: the fifteen commits the 0.2.1 release lacked are ported on `swf/port-0.2.2` (`ce127f4`), James's to push.
> - **TD-0 — the trust-root has a shape** (`11c8fa67` · `5062139e`; LANDED "TD-0 — the trust-root has a shape"): `TrustRoot`, `UpdatePolicy`, `RegistryIndexV2`, `scripts/trust-keygen.mjs`, the ledger's `trustRootKeys` blocker. TD-1 is James's: five keygens into his keychain, per `draft/handover/2026-10-14-td1-james-keygen.md`.
> - **PJ-7, both halves** (`eec6df74`, `a508721e`): a launch names a place, a resume needs no path or persona, the phone reads History over `project.*` and launches by place. **SWF** (`ca9b9992` · `8a851973`): the swarm's crowd fits its field (puppeteer `d3e82aa`).
> - **fix7** (`b030de84` … `6da4cf2b`; LANDED "PJ-7, the first phone run's fixes"): History says when the index is down and rebuilds it after an upgrade, a folder list never waits behind mille's watcher, the first launch sheet draws, an agent's card can attach again, and the index can be restarted from History.
>
> **Ruled today:** the Trust Docket, TD-1…TD-18 at the lean — one offline root, three online roles, a signed update feed, a registry that rebuilds and hosts what it lists, community plugins at R2 off by default, core plugins bundled (`specs/trust-and-distribution.md` v0.1; DECISIONS, the TD row). The Release Docket is all ruled: RL5 the `@vibefield` npm scope (by James's publishes), RL6 the pre-1.0 shape is 0.9.0, RL7 PT-S design-only this week, RL8 a local signed dogfood build with the two-Mac check first.
>
> **Found today, now law:** main's `smoke:canvas` has been RED on the AIMED rung since W7 (`42f8d5b6`, 10-12) — a launch no longer births a shell and the rung's precondition went stale; it stayed hidden because landings since then ran three gates, not the list; the History lead's errata correct those entries at source, and every landing runs `pnpm gate:landing` in full from here. The MV lead's test-only fix (`f160cc66`, gated 12/12 and smoke:canvas 2/2) awaits James's word. Two more gate classes named: a smoke window covered by another app (Studio's row; the fix is main's: keep drawing when covered), and a shared cargo target written by another checkout (each gating lane owns its `CARGO_TARGET_DIR`). One Mac, four gating sessions: the PM holds the Mac for one session at a time with `/Volumes/SamsungRed/lanes/PM-WINDOW`; every runner waits on it and on `VF_PERF_LOCKS`.
>
> **In flight:** RD-3 LANDED 2026-10-15 (`e38dfdc6`) and closes the RD track's VibeField lanes — RD-4 (the five repos' pipelines, `draft/handover/2026-10-15-rd4-james-pipelines.md`), RD-5 and RD-6 wait on James's pushes and publishes (James's status: `draft/handover/2026-10-15-prod-track-status.md`); **WP12 L1 LANDED 2026-10-15** (`dfc4b832` `9f9e4ec5` `0682ac15`: the updater core, TD-3's client half, DEV-witnessed) and L2 (WP12c: adoption after an update, the apply gate) is next (prod-builder); the DK-14 fix (the MV lead), a rebase and one word from landing; PT-S's one-page design (PORTALS, due 10-16). **James's items:** the gc; the pushes; the TD-1 keys and the `release-signing` environment; the puppeteer branch push and the 0.2.2 cut; the Spotlight exclusions for `/Volumes/SamsungRed/lanes` and `/rust`; the ten `dui` Electron processes.
> Debts: "Open debts" below carries this day's and the earlier waves'.
> Previous rewrite, kept for continuity — **2026-10-12 — GODVIEW ROUND 3 IS BUILT: THE STORIES HEAD, AND THE TERMINALS GO AWAY, COME BACK AND FILL THE WINDOW (`384602e1`, `66f746ad`, `60403758`).**
> Godview round 3 is on main whole: eight landings since the 10-10 rewrite, the History lead's six through lane land3 and the MV lead's two by James's fast-forward, each gated on the tree that landed. Nothing is pushed.
> - **The Stories head, TV-8 and the perf lab's debts** (`384602e1`, 2026-10-12, on James's "Merge now, diagnose after"; LANDED "GV-D1 + TV-8 + MV lab debts"): the instrument bar is gone. The monitor's views switch in a row of glass circles on the frame's head row, marks only and with no "Add a view" circle (N13 (a)). System control is the palette's act. An ended lane on the timeline opens its session in History. The canvas's head is hidden under any cover; History had shown it through its glass since One Frame. The perf pair: one row worse (swarm × n60 task), which James accepted as noise on the MV lead's reading of the per-round signs, and the swarm's style recalc went with the bar. The head's reserve is lent to the swarm as an obstacle. The swarm still reached under the circles, and the diagnosis James ruled for after the landing found its sizing at fault, not the band: no body is smaller than r 50, so the crowd outgrows its field and spills past any edge, as it did unseen under the bar. On his "Fade now + sizing later" the field dissolves under the head (`619535b1`, LANDED "The field dissolves under the head"; light-theme rain's own ground fades there too). Then the sizing (`8a851973`, puppeteer `d3e82aa`, LANDED "The swarm's crowd fits its field"; James: "Shrink together", "Pull takes the field's shape"): one shared scale with a floor at r 28, a pull weakened along the field's long side, and the words stepping down from full to the name and one line to the name alone. Twenty agents now settle below the head; past the floor the crowd still overlaps.
> - **The terminals' wrapper** (`a052f247` … `66f746ad`, 2026-10-11/12; LANDED "GV round 3, the terminals' wrapper"):
>   - the deck's door (`away · up · maximized`) and the window's lights door;
>   - the Lip: a 30 bar with the groove, the frame's tone, the panes in a well;
>   - a session with no pane opens beside the focused pane, up to three (GV-D4);
>   - the Lip's minimize puts the terminals away, and any session called brings them back as they were left (GV-D5's call, GV-D6);
>   - the edge decides on its let-go: under 120 left or a fling down puts them away, anything else stays and is remembered, and the monitor's field ends 12 above the edge;
>   - maximized: the Lip becomes the window's title bar, by its button, a let-go above 104 or a fling up, and the frame's search stands in it (GV-D11);
>   - and its close (`42f8d5b6` · `0f7aab0b` · `60403758`; LANDED "GV round 3, finished"): a launch opens on the monitor alone and the first call brings the last run's panes (N14 (a)); ⌘W on the last pane puts the terminals away (N16 (a)); the rest is 5/13 of any window, floor 232, the slider retired (N15 (a)).
> - **Honest states the gates turned up:** the line never says "Pasted into …" for a paste the pane dropped; History's acts never end in silence; the deck's queued floor reads are bounded.
>
> Left of round 3: a look on a real window at what the offscreen smokes cannot see (the lights' move, a real fling, the launch's first call, ⌘W on a last pane, other heights). PJ-7 (N10 (a)) LANDED 2026-10-14 (LANDED "PJ-7, the daemon half" and "PJ-7, the kit half"; Q1–Q7 at the lean, `project-places/build-pj7.md`): the phone reads History over `project.*`, launches by place at a profile, a model and an effort, blooms and resumes. The first run on James's iPhone (2026-10-14, his computer-use tester) was blocked by a stale dev index and found six defects, all fixed (LANDED "PJ-7, the first phone run's fixes"); the tester reruns the blocked cases. Next on the History list: the room's batched figures and the repository's address (R8, R9) and the past for other desktops and the phone (B-D4, B-D5); PJ-8 after DS-7 (truffle's egress). The debts lane, PJ-6 and the swarm's sizing are landed.
>
> **James ruled the whole *After Wave 2 Docket* on 2026-10-12** (republished under his current account, https://claude.ai/artifact/RvcaxJnoLhXMz3HcKHZx1G; DECISIONS, the N row): every mark at the lean but N7. **N7 (b) held pushes; RL1(c)'s implementation below resolves the audit-history hold.** truffle's egress release this week (N11 (a)); after round 3, a debts lane beside PJ-6, then PJ-7 (N10 (a)). N2 (PK2) closed: the Stories head ended it. Upstream, for ghosttea: `paste()` / `sendKey()` / `sendText()` say whether they sent.
>
> Debts: the debts lane is LANDED (N10 (a); lanes dfd and dui), in five parts: "Debts, first part" (fieldd's honest budgets, doc-sync's teardown, kill-matrix row 6), "Debts, second part" (Godview's filter kept for the run, N4 (a); the search's 120 ms step, round 3's last mark; the launcher rung's focus race), "Debts, third part" (History's day heads frost, N3 (a), measured first), "Debts, fourth part" (index-timeline instrumented, fieldd-client's `timeoutMs`, the routed read bounded at 5 s, every kill-matrix create retried) and "Debts, fifth part" (the four reds met while landing were the tests' own races, index-timeline's among them). Owed: which callers pass a timeout, field-native's flush behind its backoff, rosettad's signal handler armed after it announces (rosetta's), and smoke:canvas on the live display for N3. "Open debts" below. **RL1(c) resolves the audit-history hold; publication remains James's step, in the sibling-first order above.**
> Previous rewrite, kept for continuity — **2026-10-10 — HISTORY LISTS YOUR PROJECTS, AND GODVIEW'S TIMELINE READS THE PAST (`bda60ddd`).**
> Wave 2 of the History finish is on main: four slices since the 10-09 rewrite. James ruled docket v9 on 2026-10-09, every mark at its lean (DECISIONS, the AR-8 finish row). Nothing is pushed.
> - **PJ-4 phase A** (`32bb14d6`, 2026-10-10): fieldd tags every session with its project key. Figures merge across folders and desktops and say when they are partial. Project inks deal on the cool half (DESIGN.md §2.9).
> - **AR-8 P2** (`25a9689d`, 2026-10-10): Live now in Godview. The Peek searches what is running through the monitor's find door, and its right half watches the live terminal (wall R26). FindSheet, FIND and ⌥0–⌥9 are off Godview's stage.
> - **PJ-4 phase B** (this landing): History draws your projects through the room's optional host inputs.
>   - Your colour, each desktop's mark, the sections (Live now, Pinned, Temporary folded at the foot, Hidden), New agent, ③'s folders by desktop, the chips.
>   - Pin, hide, rename and split act through `project.intent`, each where it acts (H4).
>   - The Peek's past picture is the room's own reader (PK3).
> - **TL** (this landing): Godview's timeline draws a row's recorded past before its current state, and the runs that ended.
>   - fieldd reads rosettad's `/api/activity`, or the catalog's session bounds, at a window's ask, and lends it as the view contract's `history` capability.
>   - Only runs this runtime ran are lanes. Nothing here records.
> - **Siblings, at James's "Merge" (2026-10-10):** rosetta (the room's host inputs, the reader, `GET /api/activity`, protocol 27) and puppeteer (the history capability, the monitor's history port, the timeline's view half). The pins are in "Upstream / sibling pins".
>
> Next for History:
> - DS-7/SP-7 (other desktops' sessions and transcripts, the phone's) wait on truffle's egress release. Until then History lists this desktop's sessions, with marks for the rest (H3).
> - PJ-6 (model and effort in New agent) LANDED: the launch (LANDED "PJ-6, the launch") and Resume at the session's own model ("PJ-6, Resume"; puppeteer pinned on its unmerged branch `vf/pj6-resume-selection`, James merges). PJ-7 (the phone over `project.*`, with the phone's launch rows) LANDED 2026-10-14 in two halves (LANDED "PJ-7, the daemon half", "PJ-7, the kit half"): the place spawn on the receiving desktop, the phone's History over `project.*`, the launch sheet's Profile · Model · Effort rows, the bloom → the sheet, Resume and Jump to on the phone; its witness, green, a launch from the phone that lands in the named place on the named desktop, over a real fieldd from the simulator. Next: PJ-8 (acts across desktops) after DS-7.
> - The past for other desktops (B-D4) and for the phone (B-D5).
>
> Open with James, none decided by this landing (N2–N4 on his page *After Wave 2 Docket*, published 2026-10-10 with the lead's leans):
> - PK2: the search circle hangs 8 px below Godview's 40 px bar. The Stories head ends it: with the bar gone the circle stands on the head's own row. N2 asks only whether a stopgap is wanted before that (the lead's lean: none).
> - The sticky day-head band in History (DK-15's `history-room-glass.css`).
> - GV-D5: whether Godview's filter persists.
>
> **Ruled 2026-10-11, to build (James, answering the MV lead's walk-through; DECISIONS, the One Frame row and the TV row):**
> - **Godview round 3's unbuilt half (N12 (a)).** GV-D1…GV-D12 were ruled on 2026-10-02 and built only as far as search (the Peek). The MV lead builds the Stories head (GV-D1), without the "Add a view" circle until adding a view exists (N13 (a)). The History lead builds the terminals' wrapper and the title bar when maximized (GV-D4…D7, D11, D12). `DESIGN.md` moves first, in one docs commit.
> - **TV-8:** an ended lane opens in History (the MV lead's command and click, the History lead's resolve). TV-1…TV-7 are as landed.
>
> Debts: "Open debts" carries this wave's and the 10-08/09 wave's. **RL1(c) resolves the audit-history hold.** The lock's rosetta, puppeteer and mille revisions still need James's sibling-first publication before another machine can fetch them.
> Previous rewrite, kept for continuity — **2026-10-09 — HISTORY, FINISHED ON ONE DESKTOP: THE PEEK, JUMP TO, THREADS, IMAGES, THE PACKAGED APP (`37e40da9`).**
> Four History landings since MV (and the desk, DK, landed among them), each gated on the tree that landed; nothing pushed.
> - **AR-8 History gaps** (`3ec58bf7`): recorded images draw, where every one had read "Image data was not recorded"; paths under home read `~/…`; delegated threads sit under their parent through a window-local `threads` table and `index.threads`, and search keeps the hits inside them.
> - **EL8** (`3b8374bb`): rosetta `eab2f57` (#8; nested subagent histories ingest) and mille `c8160d5` (linear hydration; a folder macOS stalls or holds only in iCloud says so in words, with TIMEOUT and `dataless` refusals). PJ-2's test race is fixed by ordering. Three test budgets that had reddened most loaded gates are fixed: the model stream, the AR-7 floor wait, the design-system page.
> - **AR-8 packaged History** (`4dd952c5`): rosettad and the agent shim ship, signed, in the app; `vibefield-app://shell` is witnessed end to end against a real rosettad. Chromium's local-network access did not engage.
> - **The Peek and Jump to** (`37e40da9`, rebased onto the desk's landing):
>   - History's search is the frame's Peek: ⌘F printed on one button, Everything over `index.search`, open at the line. The interim and ⌘G retire.
>   - A History session running here offers Jump to, which shows its pane in Godview through the deck's one new verb `reveal` — MV lead: that is the only Godview change.
>   - Resume refuses a running session in words.
>   - Under the Peek the cover, the still and the chrome recede and the desk's box never does (DK-15 held).
>
> Its next list is spent: P2, PJ-4 and the timeline's past have landed (the rewrite above), and DS-7/SP-7 still wait on truffle's egress release. Its six debts moved to "Open debts", unchanged.
> Previous rewrite, kept for continuity — **2026-10-08 — THE DESK LANDS: VIBEFIELD'S CANVAS VIEW IS ICE'S DESK (track DK, `desk/landing` DK-0…DK-19 — main takes it by ONE fast-forward at the cutover).**
> One WebGPU renderer draws object kinds on the cutting mat under One Frame's chrome: ICE's six reference kinds (and,
> from the product's plugin set, VibeField's comment pad — dev runs only until WP8 stages plugins in a packaged build), the
> selection bar and its menu, tools in hand, the pegboard behind the line, Send to… as a draft, the covers over a still that
> costs nothing, peers on the mat, the unavailable states. The plugin door is re-cut around `defineObject`
> (`contributes.objects`, the SDK's `/desk` door, the kind-conformance harness, `vibefield-plugin try`; the ten-minute bar met
> in 5 min 34 s). The pre-desk boards are refused, never converted (DK-D13…D16), and everything that drew a widget as DOM or GL
> is retired (DK-17: every row of the retire table gone). ICE `0.14.0` → `0.15.0-desk.1`…`desk.7` → `0.15.0` on `latest`
> (petitions I20–I45). The gates at DK-19, run whole on the merge and again on the ledger's tip: every landing gate green —
> `pnpm still` and eleven smokes, the product desk rig's TAKE rows among them — red only by main's three known rows
> (preflight's ghosttea sibling, check:deps' mille links, fieldd's AR-7b row 1) and, each run, one fieldd row under the test
> stage's load that passed alone twice (`docs/desk-gates.md`). After main was merged a third time (`ef5d5ad8`, MV and the
> ghosttea pin) and the puppeteer sibling prepared at MV's pin by its own frozen install, the gates ran whole on `fab71fa0`:
> every gate green — preflight and AR-7b now too, by main — but check:deps' mille row (main's) and the test stage, red each run
> by rows under load that passed alone twice. The fourth merge (`4853e9d6`, AR-8) and the fifth, the final (`1fa5d8f7`: AR-8's
> packaged History, EL8's pins, the design prototypes' removal) passed the cheap stages and their suites; the orchestrator's
> full gate on the final merge is the grade. Next: the cutover (`docs/desk-gates.md` "The cutover": the fast-forward, then both
> Macs upgraded TOGETHER and James's eleven two-Mac steps, which decide (20)'s stamp wait and (95)'s drag strip); the follow-on
> programs PORTALS · STRING · the OBJECT KIT · the AGENT'S EYES · the UPLOAD PLANE (each a thinking doc of its own); FS-3's
> desk tree; James's parked calls (DECISIONS, "DK — the build's rulings"). **RL1(c) resolves the audit-history hold; publication remains James's step, in the sibling-first order above.**
> Previous rewrite, kept for continuity — **2026-10-08 (evening) — MV LANDED: GODVIEW'S FIVE VIEWS ARE SDK MODULES OVER ONE BACKEND (`7a0893d8`; puppeteer `594d222`).**
> MV: Godview's list, rain, swarm, timeline and spend views are pure-presentation modules on `@vibecook/puppeteer-view-sdk`
> over `@vibecook/puppeteer-monitor`, one backend per desktop beside the runtime. Windows and the phone hold replicas of its
> model, and the monitor is runtime only: the status ledger and the history book are gone (MV-D13). Spend (MV-7) is the
> runtime-only watchlist, ported as built. The wall holds every registered view in fail mode, chrome boundaries back off
> instead of looping, and the monitor's bar renders only when its own inputs move.
> Against the qualified integration tip: 0 worse, 18 better. Against pre-MV: 0 worse, 36 better, and 2 shifted (the
> timeline style James accepted). Ghosttea moved to James's `10d0b17` after it, as its own EL8 commit (`4387a973`).
> James landed it with "land it". Nothing is pushed. See LANDED §MV.
> Next for MV: the perf lab's debts (lane `mv/lab-debts`: the warm-up over every measured view, the deck wait's reason,
> the audit's end-of-launch load, the heap after a collection); TV-8, an ended lane opens in History; the Stories head
> (GV-D1; N12 (a), N13 (a)); the rest of the after-MV list (LANDED §MV, "Known, not fixed"); History
> read from rosettad (AR-8) is TL-D8's successor [LANDED with wave 2 as TL: the `history` capability; LANDED §TL, "the
> timeline reads the past"]. The other tracks' next is as the PJ entry below says.
> Previous rewrite, kept for continuity — **2026-10-08 — PROJECTS ARE FIRST-CLASS: RECORDS, DOORS AND A PER-DESKTOP HOME (PJ-2 `6c4e8621`, PJ-3 `e103d48b`).**
> PJ-3: the `project.*` doors (list, get with `movedTo`, sessions, pings with `regrouped`, intent), a key memory that survives a
> restart, `project.read` never plugin-eligible, paths only for the user's own devices and never accepted in a request (P1).
> PJ-2: records in the synced library — a first act freezes the colour (P3), splits and dismissals bound to records, the later
> act wins, a relink keeps them; `project.intent` live for desktop windows (P2); placeIds re-keyed to the persisted local id
> (the roster id moved at link and relink). James's J1–J11 are scored truth (145 rows on three desktops; J11: Home is a project,
> one per desktop). Upstream merged at his word, nothing pushed: mille main `c8160d5` (M8 linear loading, M10 bounded reads,
> G1/G2/G3/G6), rosetta main `eab2f57` (RO-15); the mille-git spec erratum v2 is ready to apply. **RL1(c) resolves the audit-history hold; publication remains James's step, in the sibling-first order above.**
> Next: VibeField's mille pin `baa0de8` → `c8160d5` (an EL8 event; the doors surface `ETIMEDOUT`/`EDATALESS`); PJ-4 (History's
> project page — needs rosetta's room) [PJ-4 LANDED: phase A `32bb14d6` 2026-10-10, phase B with wave 2 — LANDED §PJ-4 phase A,
> §PJ-4 phase B] and PJ-7 (the phone over `project.*`); DS-7 and FS-4 at truffle's egress release (R12);
> the phone over-the-air run (R8); FS-3 with DK; FS-5. Test health: `design-system.test.tsx` times out under load in every gate.
> Previous rewrite, kept for continuity — **2026-10-08 (dawn) — PJ-1 COMPLETE: EVERY DESKTOP KNOWS ITS PLACES, AND FIELDD GROUPS THEM INTO PROJECTS (`f6d57ced`).**
> PJ-1a (`f6235540`): one remote normalizer (DS-D9's `familyOf` delegates), the grouping engine as a pure function in fieldd, and a
> redacted golden corpus — 132 rows on the Mac, 143 on three desktops, 0 trap pairs, identical on the unredacted data. PJ-1b
> (`f6d57ced`): one hardened git runner in the files worker for every caller, the `placeFacts` op, a scanner whose facts ride the
> catalog's project rows (no new table), `taskRoots` in the agent catalog, and `ProjectGroups` over local ∪ replicated places,
> held for PJ-3's doors. James's J3–J11 judgments remain for the golden truth. Upstream: rosetta RO-15 MERGED to its local main
> (no VibeField pin move — the fix is in rosetta's own app); mille M8 (linear loading) + M10 (bounded reads) built and gated
> together, awaiting James's R15; mille-git G1/G2/G3/G6 in build. **R9/R10's audit-history hold is resolved by RL1(c); James publishes in the sibling-first order above.**
> Next: PJ-2 (records: names, inks, links, splits) and PJ-3 (the `project.*` doors); DS-7 and FS-4 at truffle's RFC 026 egress
> release (R12: soon); the phone over-the-air run (R8); FS-3's desk tree with DK; FS-5.
> Previous rewrite, kept for continuity — **2026-10-08 (morning) — THE FILES & HISTORY DOCKET RULED; A LIVE FILES SESSION OUTLIVES ITS TICKET (`b05b7172`).**
> James ruled thirteen calls and the twenty-four project-places marks on one page (DECISIONS, the FS and PJ rows). R1: a ticket's
> expiry bounds redemption only, so History's file column no longer resets every 9.5 minutes; R6: each attachment is audited, a
> place keeps the identity it was touched with, the viewport cap is named (LANDED §FS session fix-ups). PJ-D1…D24 all at the lean:
> PJ-1 (= AR-8e) is unblocked; James's judgments J1–J11 remain for its golden fixtures. **R9 (c)/R10 (b)'s audit-history hold is resolved by RL1(c); publication remains James's step.**
> Upstream, built and awaiting James's word: rosetta RO-15 (`ro/15-git-sha-guard`); in build: mille M8 (linear hydration) and
> M10 (time-bounded reads), which land fsm8 first; the mille-git spec erratum patch is drafted for James to apply.
> Next: PJ-1's build plan; DS-7 and FS-4 at truffle's RFC 026 egress release (R12: soon); the phone over-the-air run (R8);
> FS-3's desk tree with DK; FS-5. GitService replaces the interim git port at mille's release (R2), which waits on James's publication of the pinned siblings.
> Previous rewrite, kept for continuity — **2026-10-05 — FS WAVE 2 AND PACKAGED FILES VERIFICATION.**
> FS-1b attaches History to the files worker through single-use tree/git tickets and a renderer Worker;
> bodies and diffs bypass fieldd RPC and Electron main. Root and principal loss revoke both legs, and worker
> death reconnects to a fresh snapshot. FS-2 browses Recent places, home and volumes on the selected desktop,
> copies its absolute paths, and sends `agent.spawn {cwd}` through its existing product door. The launch sheet
> keeps one height, folder first with a separate chooser above it. Mille’s unpublished window is pinned at
> `baa0de8` in a dedicated checkout. The git port remains the read-only interim.
> Next: FS-3 with DK; FS-4 with DS-7 after truffle’s RFC 026 egress release; FS-5 the phone file viewer.
> FS packaging closeout: the macOS arm64 bundle and its Developer ID-signed fieldd/mille worker pass
> the Files suites, deep signature verification and fuse audit, from a path with spaces and an accent.
> The census includes the Files inputs and handwritten service plugins. The over-the-air phone run and
> a complete notarized release remain owed. See LANDED §FS-1b / FS-2 and §FS packaging closeout.
> Previous rewrite, kept for continuity — **2026-10-03 (evening) — AR-8 ON ONE DESKTOP: HISTORY IS ROSETTA'S ROOM IN THE FRAME (`93b614c1`); THE ROOM MERGED UPSTREAM; THE PIN AT `00b9786`.**
> AR-8a: rosetta's History room extracted upstream as `@rosetta/room` behind four injected ports (catalog · session ·
> assets · host), 211 files moved, nothing visible changed, MERGED to rosetta main `00b9786` at James's "Do merge for
> me". AR-8b: fieldd's `index.session` · `index.project` · `index.projectDay` and `index.openTicket` — an RO-10 grant over
> rosettad's loopback, the daemon behind a per-start bearer. AR-8c: the room mounted in FR-1's History slot on the covers'
> glass over `field-app/src/history/`'s adapters; Resume on the line; the CSP admits the loopback plane; a real session
> streamed through the room with fieldd carrying none of it (526 bytes in 10 frames); `smoke:godview`'s History rung;
> DESIGN.md §8's History canon. The pin moved `eecae7a` → `00b9786` (the room; Rust unchanged), then `856bd80` (RO-13 + RO-14, 2026-10-04). Owed: the Peek's `openAt`
> + Jump to (GT), delegated threads, a home-dir door, attachments, AR-8d the guest, AR-8e = PJ-1 (RO-13's file reads and the lazy
> History chunk LANDED 2026-10-04). SP-6 LANDED 2026-10-04 (`3269eab0`: the phone's History reads over the door — `index.timeline` pages, the `index.session.subscribe` tail, the kit's cache and honest words; the bodies swap to tickets at SP-7). Next in the ruled order: DS-7 (at truffle's RFC 026
> release) · AR-8d. See LANDED §AR-8a, §AR-8b, §AR-8c.
> Previous rewrite, kept for continuity — **2026-10-03 — DS WAVE 3 LANDED `3a58fb5d`: THE SEAT, THE REMOTE ATTACH, COMPACTION, THE PHONE'S HOME AND THE TICKET TEMPLATE — AND THE ROSETTA TRACK UNBLOCKED.**
> DS wave 3 (built 2026-10-01, landed at James's word of 2026-10-03): the take's engine-side CAS and the window-keyed
> attach ledgers; Godview attaches another desktop's session by the owner's engine handle; canvases compact to a Loro
> shallow snapshot at an epoch bump under the holders' watermark; the phone HOMES to one desktop and `field.agents.v1`
> is retired on both sides; SP-3's `RemoteEndpointSet`, the route-per-process driver, `PORTS.INDEX_SERVE` and
> `index.openTicket` declared `direct-plane-unbuilt`. The same day the rosetta track's blockers were walked and ruled:
> the pin at `886baede` (protocol 26) read from a checkout dedicated to it (W-D10); RO-1 + RO-10 rebased for James's
> merge; SP-D5 (a) and SP-D13 (a); AR-8's shape — rosetta's room as a package behind ports, a plan first; the order
> AR-8 on one desktop → SP-6 → DS-7. See LANDED §DS wave 3, §EL8 (the pin).
> Previous rewrite, kept for continuity — **2026-10-02 — TL LANDED `e89aeb17`: GODVIEW'S TIMELINE; THEN THE WORKING TREE COMMITTED.**
> TL: Godview has a fourth view, TIMELINE: each agent a lane in birth order, its afternoon one wake in its project's
> colour, a map of the day to scrub, the swarm's bodies at the head relit to the moment looked at. Under it fieldd keeps
> a status ledger per run (`users/<fuid>/agents/history/`, read through the `agent.history` door by an EL7-tolerant
> reader), so the record survives Godview closing and fieldd restarting [retired 2026-10-08 at MV's landing by MV-D13:
> Godview is runtime only]; puppeteer carries the view. James ruled
> TL-D1…D17 on the page *Where the Time Went* and landed it with "land it properly". See LANDED §TL.
> The same evening James asked for the tree's uncommitted work to be committed properly, one slice per commit: the AR
> sign-in usage refresh with its puppeteer half (pin `6392865`) · the Me menu as solid chrome and the Settings head as
> one tile (UA) · the deck's 72px grip (GT) · DESIGN.md's ground paragraphs · UI-G1 the glyph set (`0b8c9fce`),
> landed from the tree over a main 357 commits past its branch · the three design studies of 2026-09-22 (After
> Hours, Face Club, the living mark) · the DS ledger, ROADMAP and DECISIONS records below. See LANDED §AR…§UI
> (2026-10-02).
> Next: **unchanged from the DS wave 2 rewrite below** (James's four sibling merges and pin moves, then the seat lane
> and the rest of the DS/SP order), plus: DS wave 3 (`ds3/land` `f321f576`, 40 commits, gated 2026-10-01) waiting on
> James's word over a main that has since moved; puppeteer pushed before CI fetches its pin; `pnpm commit-draft` for
> TL's and the glyphs' draft records; James's calls on the living mark's 53 MB of review renders and on the `work/`
> phase-0 and verification records, which carry personal details and the repository is public; contracts'
> `container.portal` stays staged in James's tree until ICE ships `resolvePortal`.
> Previous rewrite, kept for continuity — **2026-10-01 — DS WAVE 2 LANDED `6856b52e`: THE PLANE CONSUMED, HARDENED, AND THE PHONE'S GROUND LAID (65 commits over `d71883fe`).**
> James, on the morning's roadmap status after wave 1: "good, plan and go ahead" — seven Opus lanes from main, each on its own SSD worktree,
> landed sha-for-sha onto `ds2/landing` with seven lead commits closing what never reached the lanes (three of the lead's mid-flight messages
> were lost outright; the plan doc's "Decisions taken mid-wave" list is the channel of record) and two REAL gate reds (an fsync'd writer
> that made a pre-existing reconciler race deterministic; a stream floor that delayed a delta one row read at once), each bisected to its
> commit and fixed; the gate green on the third run at load 23; "go" — the fast-forward kept James's three overlapping WIP files by
> three-way merge. Built: DS-1b the egress arm compiled against RFC 026 as built, egress asked once per floor boot and failing closed with the
> floor's own honest state, the production rewriter, the two-floor probe PASSED on the real tailnet (the feature flips ON at truffle's pin
> move) · D1 the peer kind is the transport's to give · DS-5b PA-32's bias and settings CROSS · DS-5c the host hardened and the inbound phone
> gate · DS-6b the replica's reset, digest and states · DS-D15's client half · SP-1 the subscription descriptor, the lint, the projection
> helper, `system.tick` · SP-2 + DS-4b the kit's door brick v2 (a bidirectional keepalive — the sidecar reaps each direction) and the take on
> focus. See LANDED §DS wave 2, `work/ds-wave2-2026-10-01.md`.
> Next: **James's four merges + pin moves (unchanged; truffle's flips `truffle-egress` ON, then the two-desktop run with the Tailscale app
> QUIT) → the seat lane (the engine-side CAS + DS-4c) · the renderer half of DS-4's remote attach → DS-7 (after rosetta's pin) → DS-8 → DS-9
> → DS-D14 → SP-3 → SP-6 → SP-4 → SP-7 → SP-5 → SP-8** — the two owed designs (SP-D7, SP-D9) beside; three findings for James (the health
> stream's phone reach, the moved streams' 250 ms first-change latency, the sidecar's held route id).
> Previous rewrite, kept for continuity — **2026-10-01 — DS WAVE 1 LANDED `d71883fe`: THE DESKTOP SYNC PLANE IS BUILT, SIX SLICES IN ONE WAVE.** James,
> the day after ruling DS-D1…D18: "go ahead, work on all sides (vibefield, rosetta, puppetear, ghosttea, truffle) to push things
> forward, plan, split works, fan out opus5.5 subagents to help and work on parallel works" — ten Opus builders in ten worktrees on
> the SSD, six on this repo from one base commit, four on the siblings; the lead landed the six in order (facts → egress → board →
> terminal → history → intent) and the gate went green at `90f53317`. Then "now do a review": eight readers, read-only, one blocker
> (DS-5 made the settings document cross desktops with no PA-32 revocation bias — a stale desktop could re-grant a revoked plugin
> capability) and seven seams where one lane's reclassification outran another lane's guard (forwarded births outside the mint guard; a
> phone reading desk content by routing; a peer restart dropping the shared link through a workaround for a defect another lane had
> already fixed; Godview's mesh reader never retrying; receipts caching retryable refusals; two roster readings; stale comments). Then
> "go ahead, fix properly": the settings document held OFF the host (the library rides alone; DS-5b is the bias), every seam closed
> with a red-proven row, the two ruled federated-subs defects fixed at last, 55 commits, the gate green again at `d71883fe`, and
> "land" — the fast-forward kept James's four overlapping WIP files by three-way merge. Built: DS-1 the egress facade (the VibeField
> half; truffle RFC 026 BUILT on `rfc026-egress`, feature OFF) · DS-2 `onBehalfOf`, receipts with OUTCOME-UNKNOWN, the roster's
> four states, the census reclassified · DS-3 the mesh board, Godview on it, the poll retired · DS-4 the forwarded ticket, the
> rights `[geometry, input, read]` for every self principal, the take · DS-5 the Loro-level host and the library (the ICE1 spike
> PASSED) · DS-6 the history catalog replicated, the merged doors, search by asking. See LANDED §DS wave 1, `work/ds-wave1-review-2026-10-01.md`,
> `work/ds-wave1-2026-09-30.md`.
> Next: **James merges and releases the four sibling branches and moves the pins (truffle on a petition window with the five npm
> sidecars, protocol 5 → 6; rosetta's pin move carries PROTOCOL_VERSION 24; puppeteer; ghosttea) → DS-1b (consume RFC 026: fail-closed
> per floor boot, the real arm re-typed, the two-desktop witness with the Tailscale app QUIT) → DS-5b (PA-32's bias as the install
> set's merge rule, then settings cross) → D1 (the peer daemon's identity transport-derived) → DS-7 transcripts by ticket · DS-8 the
> phone re-homes · DS-9 E3 and artifacts in the app · DS-4b/4c** — and still owed from the companion page: the mini-app bridge and
> the upload plane, as designs (SP-D7, SP-D9).
> Previous rewrite, kept for continuity — **2026-09-25 — P0-H LANDED `b7bbcbc3`: PHASE 0 ON HARDWARE IS PAID.** James: "for phase 0, i just
> plugged in my iphone, can you use it instead?" — build 5 went onto the iPhone over the cable, the hands-on part went
> to a computer-use agent, and by the evening of the 25th the phone had held ONE live activation on a cell of this
> desktop for 10 min 20 s: one `tailnet` ticket (00:04:11Z, the first this desktop ever wrote), the renewal 510 s
> later (P0-C's schedule to the second), input received past the original grant's expiry. Four defects stood in the
> way and none was in the record: the phone's URL loader refused the door (ATS, -1022 — P0-H1); the sidecar's
> WebSocket forward dropped the route's `/t/<secret>` path, so fieldd took the phone for the LOCAL door and refused
> its hello ("invalid token" — petition T6, James's repo; a locally built sidecar under `.vibefield/sidecar/` carries
> the fix until a release does); the floor's management reader starved behind a `tsnet.ListenTLS` wait and read as
> a wedge, costing four boots and every terminal (P0-H2: `native.mesh.*` on one bounded FIFO worker, design-02 §2.7);
> the phone attached frames before the cell had created the activation and its leg's sends overtook each other
> (P0-H3, TPv3 §5.4). See LANDED §P0-H, `work/phase0-result-2026-09-25.md` for the run.
> Next: **T6 upstream and the EL8 event that retires the sidecar override; G28; a Release build's Connect on the
> device and the TestFlight build that outlives the cable; the second-account witness on the phone** → James's
> rulings (D4 the phone's sign-out and switch; the deck's kill affordance; the terminal-doors switch) → design-06
> (UA-P-6) → AG-1 → AR-6 proper.
> Previous rewrite, kept for continuity — **2026-09-16 — UA-P-W / UA-P-4 / UA-P-5a LANDED `87987bc4`: the truffle side of the
> account foundation is BUILT, and the mesh runs scoped to the login on both planes** (James: "now plan and
> work on the truffle side of work, land the proper and solid". Petitions T4 and T5 became truffle RFC 025
> "login-scoped nodes" on local branches of his repo — a per-NODE login allow-list evaluated at the hello by
> WhoIs (4004, before our hello is revealed; a gated node never falls open), Layer 3 reporting only matching
> logins (the sidecar carries `loginName`, protocol 5) and evicting a peer whose login turns refused,
> sender-bound store slices, the login on every identity surface of the Rust core, the bindings and the
> Apple plane — two read-only reviews each found a HIGH and both are fixed. VibeField consumes it through
> CLAUDE.md's petition window, reopened on three planes and pinned by one revision (`siblings.lock.json`
> `truffle`; the sidecar built beside `field-native`). Then the consumption: the floor starts GATED on the
> linked login and rebuilds the node when the gate moves, `MESH_BUS_CARRIES_CONTENT = true` — the bus is
> back, scoped; the phone starts gated on its own remembered login, reads the bus only inside the gate,
> and its corner says WHO. See LANDED §UA-P-W, §UA-P-4, §UA-P-5a and `draft/thinking-ua-phone-account.md`
> §7.) **Same day, later (UA-P-X, tip `723cb356`): James said "push and release" — truffle 0.7.14 is RELEASED
> (PRs #190/#188/#191/#193, the release PR #192 → tags `truffle-v0.7.14` and `v0.7.14`, crates.io and npm at 0.7.14)
> and the window CLOSED on cargo and npm; SwiftPM stays on the path package pinned at the released commit because
> ghosttea's Swift manifest pins truffle exactly at 0.7.12 in every published tag (petition G28; LANDED §UA-P-X).**
> Next: **G28 — a ghosttea Swift release at truffle 0.7.14, then the kit's exact pin and the ghosttea pin move
> in one EL8 event; the two-account tailnet witness and Phase 0 on hardware** → James's rulings (D4 the phone's
> sign-out and switch; whether a slice from a SLEEPING desktop is drawn — UA-P-5a draws it; the deck's kill
> affordance) → design-06 (UA-P-6) → AG-1 → AR-6 proper.
> Previous rewrite, kept for continuity — **2026-09-15 — UA-P LANDED `68b62fb1`: the account is the ground** (James asked
> whether the iOS app honors the desktop's user-account foundation — one VibeField user ↔ one tailscale
> login, the mesh on top of it. A three-lane audit said no: the phone had no account of its own and dialed
> every VibeField node on the tailnet, the store bus was a namespace that reached every node with the roster,
> its route secret and every agent's branch and blocker, and an unlinked or corrupt-link desktop failed OPEN.
> James ruled: unlinked = a default local account and an OFFLINE desktop, the posture derived from the link
> (NF-8 collapses into it); every store SCOPED to the login identity; documents only among same-login
> desktops; an artifact's audience defaults to its owner; the secret never rides a store or the disk; one
> local user per tailscale account. Landed: the floor starts its node only to capture or as the linked
> account, with a capture belt that refuses serves and stores; the second link refused; the sidecar adds the
> secret path on forward so the phone dials a bare root on the new fixed port 9423; nothing content-bearing
> rides the bus until truffle can gate it by login (petition T5); the phone discovers desktops by their doors
> and draws no stranger's; see LANDED §UA-P and `draft/thinking-ua-phone-account.md`). Next: **Phase 0 on
> hardware and the two-account tailnet witness** → James's rulings (D4 the phone's sign-out and switch;
> GM-D10 is answered by D2; the deck's kill affordance; the unlinked-desktop preset is answered by D1) →
> the truffle petitions T4 and T5 → AG-1 → AR-6 proper.
>
> Lives in main-tracked `docs/` (moved from `draft/` 2026-08-02). Corpus citations here
> (`specs/…`, `thinking-…`, `predesign-…`, `research/…`, `petitions/…`) resolve under
> `draft/`, which stays dev-local-only.

## Where the project stands

The direction since 2026-09-13 evening is ONE goal with three witnesses (§0 of
`thinking-godview-mobile-first.md`): the desktop Godview reads as the reference, the phone's
field is the desktop's live fold, and a tap on a body opens the same PTY the deck shows over
truffle with the write grant handed over by the desktop. The wave that landed 2026-09-13/14
(LANDED §MF-1, tip `6b26cf23`) built all three on the desktop and the simulator; James's QA the
same night (§MF-1a, tip `f999b6e1`) found the phone on the wrong tailnet namespace and the mesh flag
breaking the floor — both fixed — and the design that followed found the mesh flag and the desktop
deck mutually exclusive by construction. James ruled **T directly** (`thinking-terminal-mesh-cells.md`):
the phone as a routed T1 client through the sidecar's proxy to the cells' own doors. **That rollout
LANDED the same morning (§TM, tip `bbe551a5`)**: the in-process serve, the TSP1 adapter and the bearer
key are gone; fieldd mints remote tickets and drives a sidecar route per live cell; the kit carries the
routed client and the phone attaches over it. The live path is witnessed to `FramesLegAttached` over
a real tailnet by a key-gated probe; what is NOT witnessed is a phone on hardware — Phase 0 is James's
hand sign-in with `FIELD_NATIVE_MESH=1 FIELD_NATIVE_TERMINAL_MESH=1`, the deck and the phone on the
same cell, and the rulings still open (GM-D10 the store's audience, a kill affordance for the deck).
The evening's review (§TM-r, tip `496f9e3f`) found and fixed the cold-boot reading that would have
blocked Phase 0 first, the real cause of the probe's missing seed (a starved credit window and a cell
clamp that starved it silently), a serve that outlived fieldd, and the phone's readers tested on
hand-typed JSON. What a review cannot do is stand a phone in front of a real cell — Phase 0 is still
the witness, and the floor's `terminalMesh` flip on a real node install rides it. The day after (§UA-P,
tip `68b62fb1`), the account became the ground the mesh stands on: an unlinked desktop is offline, a linked
one interacts only with nodes under its own tailscale login, the phone discovers desktops by their doors on a
fixed port and draws no stranger's, and the bus carries no content until truffle can scope it by login.
What Phase 0 must now also show is the second account: a colleague's login on the same tailnet seeing
nothing of yours, which no headless run can stand up. Since 2026-09-16 (§UA-P-W/4/5a, tip `87987bc4`) the mesh IS
scoped on both planes — the floor's node admits only the linked login at the hello and Layer 3 reports only
its peers, the phone's node likewise on its own login — so the second-account witness now has something
concrete to falsify: a colleague's desktop must never appear in the roster, never receive a slice, and be
refused at the hello with 4004.

**Phase 0 on hardware is PAID (2026-09-25, LANDED §P0-H).** The phone stood in front of a real cell: one
activation, ten minutes and twenty seconds, the grant renewed on schedule and input received after the
original grant would have expired — the desktop's own audit ledger holds the first `tailnet` rows it ever
wrote. What the day found was not in any record: ATS on the phone, the sidecar's WebSocket forward losing
the route's private path (T6), the floor's reader starving behind a TLS listener, and the routed client's
handshake and writer ordering. What it did not stand up is the second account on the phone (the desktop's
half is paid, §UA-P-4d), a Release build's Connect on the device, and the phone across a fieldd restart.

The P0 exit criterion — *real daily agent work, sessions surviving app restarts* — is half
held: the board survives daemon restarts (B3), PTYs survive everything up to field-native (the
NF kill matrix), docs sync across the mesh (C6), and the plugin/settings/logging/distribution
rails are in. **The missing half is the agents themselves** — the AR track, running over the
landed native floor, watched from the GT deck.

AR is IN FLIGHT since 2026-09-12 (AR-0). The runtime is **puppeteer** and agent history is
**rosetta** — James retired chopsticks and spaghetti on 2026-09-04 — and neither is published,
so this tree consumes them as pinned SIBLING CHECKOUTS (`siblings.lock.json`, `pnpm siblings`,
the fenced `link:` block in `pnpm-workspace.yaml`; CLAUDE.md §Machine setup). What AR-0 landed:
the pin machinery revived from the truffle era, walls R20–R22, the Nx sibling stamp, the
renderer's sibling-mode `fs.allow`, and fieldd's **rosettad supervisor** (one index daemon per
user root, `FIELDD_ROSETTAD_BIN`, projected into `FielddHealth.rosettad`, kill matrix in
`packages/fieldd/test/rosettad-supervisor.test.ts` + an opt-in live row). ~~What is still true:
there is no `agents.ts` in `packages/contracts/src`, **no source imports a puppeteer package
yet**, and the only agent surface is `MockAgentField` behind the Godview monitor's explicit MOCK
label.~~ **Correction 2026-09-14 (the TM review's record lens): that sentence photographs the tree
at AR-0 and was already false when AR-2 landed — it is an AR-0 paragraph left unrewritten, not a
current state.** As of this rewrite: `packages/contracts/src` holds four agent modules
(`agent-field.ts`, `agent-index.ts`, `agent-session.ts`, `agent-usage.ts`); **45 files import a
`@vibecook/puppeteer*` package** (fieldd's src and test, field-app's godview, monitor, swarm views
and design system); and the renderer's `MockAgentField` was DELETED at AR-3 `6b5e1612` — the fold
behind `remote-session-field.ts` replaced it, and only dated comments still name it
(`packages/field-app/src/godview/monitor/remote-session-field.ts:12`). The phone's Swift class of
the same name survives as a screenshot fixture behind `-vf-demo-fleet` and is no live path
(`apps/ios/README.md:103`).
Every dependency AR named is landed and waiting — the NF floor, the GT deck, C7
spawn-through (now puppeteer's `prepareInvocation`) — and the seam it plugs into is one module
wide. The design is `draft/thinking-ar-agent-plane.md` (the triad, §17 delta 2026-09-12); the
workbench is `draft/thinking-ar-sibling-workbench.md`. **The data topology is RATIFIED
2026-09-12** (`draft/thinking-ar-data-topology.md`, AR-D15…D22 in DECISIONS): per-user ingestion
with consent by construction (a root under `users/<fuid>/` is enrolled, never discovered; the OS
user's `~/.claude` is discovered by every user and consented per user), a machine-scope
`<root>/machine/` for agent distribution (the one UA-D1 exception), and personas as puppeteer
profiles whose roots are the agent data folders. The two upstream prerequisites for the first
ingested persona LANDED the same day and are pinned: **RO-2**'s start-time half (rosetta
`3f7ac0f` — `rosettad serve --enroll FILE`, many runtimes per kind, consent by construction,
ledger directory per runtime; live mutation stays a rosetta open decision, fieldd restarts the
daemon on change) and **PU-7** (puppeteer `719d98d` — `ProfileService.observationRoot`, Pi's
managed binding moved one level in, RFC 006 addendum). **AR-1 LANDED 2026-09-12 (`c7fe5fda`):**
the contracts (`index.*` and `agents.*` rows, the two local-only scopes `index.manage` and
`agents.manage`, the `machine/` + `agents/` + `enrollment.json` LAYOUT segments with
`LAYOUT_ROOT_LEVEL` as the never-re-root set, the enrollment record and the index projections in
`agent-index.ts`, six fixtures) and fieldd's half of the topology: the enrollment record
(`users/<fuid>/index/enrollment.json`, VibeField's truth AND rosettad's `--enroll` input) is
published before every spawn, `--home` is the OS home explicitly, and the four `index.*` doors
are live — `status`/`discoveries` as projections (no origin, no enrolled root's path),
`enroll`/`retire` audited and bouncing the daemon only when the record changed. Witnessed
against the scripted daemon (9 rows) and the REAL rosettad (3 rows: an empty home's roll call, an
enrolled empty root live from the first start, and revocation). Upstream, the same day: **RO-2c**
(rosetta `af6f0d7` — the file is AUTHORITATIVE for discovered-kind consent; before it the
daemon unioned the projection's persisted flag in, so the record could add consent but never
revoke it). **AR-2 LANDED 2026-09-12 (`f9f04763`):** puppeteer's first import — one agent runtime
per fieldd from the built-in providers, everything it would keep under `~/.puppeteer` injected
from this user's root (the registry at `agents/profiles.json`, managed roots under
`agents/roots/`, update transcripts under `machine/agents/updates/`; PU-8), the eight `agents.*`
doors live, and the persona path: `agents.profiles.create` allocates the root, registers the
profile and enrolls its OBSERVATION root (PU-7) in the enrollment record under the kind the roll
call joins — no table in VibeField: puppeteer names the provider's native layout root, rosetta's
census names the kind for that spelling — bouncing the daemon (**erratum 2026-09-22, AC-3:** the kind
is now the catalog row's seam column and the roll call is the WITNESS — LANDED §AC); delete retires (rows kept),
unregisters, deletes the root; every daemon ready re-applies the record to the personas (R4 as
built). The machine scope is real: `machine/agents/distribution.json`, written under the root
lock by `agents.setActive`/`agents.update`, read by `agents.installs`/`agents.releases`.
Witnessed against the scripted daemon (10 rows, with a scripted `claude` on a private search
path) and the REAL rosettad (a claude and a pi persona enrolled under `claude-code`/`pi`, live,
then retired). CI installs puppeteer's packages with a filtered frozen install (a clean room
needs no electron-ghostty; PU-6 no longer gates). What is still true: the active-executable
choice reaches spawns from the next boot; no window asks for `agents.manage` (the Agents settings
section is still owed after AR-4) — *2026-09-22, AR-S1 `19b35b1b`: the desktop window holds
`agents.manage`, for Settings → Agents.* **RULINGS 2026-09-12
(James, the whole AR-D1…D14 and FV-D1…D8 slates — DECISIONS):** the track is scoped to rosetta +
puppeteer, Godview and History (composing, characters, the Assistant view → their own track after
AR); the ownership model is corrected — transcripts and live appends are rosetta's for every
session; runtime observation and control exist only for sessions born in OUR panes and there they
are GUARANTEED (managed · ingested · remote; the observed tier and the correlator door are gone);
agents in other terminal apps are ingested with consent and controlled only by resuming them in
one of our panes; a fieldd restart RE-ATTACHES (resume-when-idle the fallback), the shell restart
has no gap; all four views are spine content; the History view has no send box and Godview's is
pane-only. The build order was re-cut: AR-3 spawn + fold + persisted continuations → AR-4 stable
ingress/re-attach → AR-5 the views port (AR-D13a, PU-5 with the injected history port) → AR-6
approvals + prompts → AR-7 the typed agent, managed (LANDED 2026-09-28; strict grammar
coverage now includes all nine vendor agents; classification review fixes cancelled utility flags,
conditional one-shot modes and exact native shortcuts) → AR-8 the History view (spine,
behind RO-1, brought forward now). **AR-3 LANDED 2026-09-12 (`6b5e1612`):** the runtime is lent the
floor — the AgentHost over `TerminalService.spawn` with a clean allow-listed environment, the fold
(`agent.list`/`agent.subscribe`), the four doors, the continuation persisted per managed session,
the monitor's mock module deleted; the REAL Claude Code alive and idle in a PTY on the agent cell
(LANDED §AR-3). **AR-4 LANDED 2026-09-12 (`ba1a1eab`; PU-1 upstream `d013fef`, pinned):** stable
ingress — the durable claim and the pinned ingress in every record, a releasing stop, the
re-attach at the next boot's first inventory, PENDING rows that resume-when-idle replaces on
rosetta's evidence or `agent.resume` replaces by hand; the REAL Claude Code back at epoch 2 on the
pinned port with its hooks flowing (LANDED §AR-4). **AR-4b LANDED 2026-09-13 (`8c0725a5`; PU-1b
upstream `8402184`, pinned):** the six reviewers' fixes — session records are SIGNED and only
agent-cell PTYs are ever re-adopted (EL7: a dropped file could otherwise terminate a live PTY and
choose the vendor's cwd), the claim is the authority on the epoch, every wait is a verdict and
every throw restores the pending row, D36's `locality` column is ENFORCED for all 131 local rows
(a gap since the column was declared), the deck's replacing mount refuses rather than landing a
resumed stranger in the user's pane and a managed row's id became its RUN; upstream, a detach now
RELEASES its bindings and keeps the process's staged files — PU-11's cause, probed and fixed
(LANDED §AR-4b). Owed after it: `deletePersona` under a live run is untested; PU-12
(`providerVersion` unpersisted, so a re-attached session's usage rail is unverified). **AR-5-0
(2026-09-13, `f6b2accc`):** the pins moved to James's follow-ups (puppeteer `d2b0600`, rosetta
`e8d907a`) and every AR suite was re-witnessed at them — the first slice of the AR-5 plan
(`draft/thinking-ar-views-port.md`; LANDED §AR-5-0). **AR-5 LANDED 2026-09-13 (`fe6b3d0a`; PU-5a
upstream `f33da93` the package · `b9a0ce9` · `77f24fd` · `33d8369` · `8af9df9` · `5389449`, pinned):** the
views port — the monitor's views are `@vibecook/puppeteer-views` (the swarm on WebGPU with its
physics behind a DRIVER port that VibeField's worker fills, the list, the rain, the instrument
bar with VibeField's tools in its slots, the usage column, the ⌘F find sheet), the two ports
adapted in the renderer over fieldd's new doors (`agents.usage` + `.subscribe` over puppeteer's
account-usage monitor, now a runtime service; `index.sessions` + `index.search` over rosettad's
search), project colours per record §02, the catalog mounting the shipping swarm over the
package's own fixtures; found and fixed upstream on the way: the find sheet kept focus on close,
no view drew a peer's name or its host's write policy, the palette read the wrong root on a
two-root page, the swarm's bodies had no source attribute for a harness (LANDED §AR-5). Owed
after it: the `adoptCanvas` phase-2 condition is a measurement, not a date; DESIGN.md's Godview
citation is still James's edit; PU-12 and `deletePersona` under a live run as before. **AR-5b
LANDED 2026-09-13 (`5bb79329`; puppeteer `4d734c9` + `b0f08ec`, pinned):** the six reviewers'
fixes — the chrome slot's rule, the `index.search` and `agent.usage` scopes, the query scrubbed
from the log, the walk in flights under a deadline with no fabricated root, the reconcile
before the first reading, the credits-only and `unknown` readings, the orphaned mount, and
upstream the column following its port, an optional hit root, a React-free physics subpath,
`@webgpu/types` as a dependency (LANDED §AR-5b; the owed list there names what the review
found and this slice did not take: the swarm loop's missing test above all — PU-13).

**History and Godview's past, as they stand after wave 2 (LANDED §PJ-4 phase A, §AR-8 P2, §PJ-4 phase B, §TL
"the timeline reads the past").**
- History is rosetta's room in the frame (AR-8c), and it lists YOUR projects. fieldd files every session under
  its project key. What the room draws beyond its own rows is handed through the room's optional host inputs:
  your colour, each desktop's mark, the sections, the acts, New agent, ③'s folders, the chips.
- Search is the frame's Peek in both views. Everything searches the record, and its past picture is rosetta's
  own reader. Live now searches what is running, and its picture is a watch-only pane.
- Godview's timeline draws the recorded past of the runs this runtime ran. fieldd reads it from rosettad at a
  window's ask and lends it to the view as `history`. Godview still records nothing.
- Not there yet: another desktop's sessions and transcripts (DS-7) and the phone's (SP-7); acts across desktops
  (PJ-8); the past for other desktops and the phone (B-D4, B-D5). (The phone over `project.*` and model and effort in
  New agent are landed: PJ-7, PJ-6.) Sessions VibeField never ran are not on the timeline; whether they should be is James's (TV-7).

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
| B — canvas & docs | B1–B4 landed; persistence half of P0 holds since B3. **SUPERSEDED 2026-10-02 by track DK (DK-D11)** — the canvas view becomes ICE's desk; B's integration (the R3F mount, the DOM/GL widget faces, the tray island) retires with it | design-03 · 03·A | — |
| PLUG — plugins | P0–P7 COMPLETE; P8b artifact loading and P8d authoring kit COMPLETE. PRC-0 through PRC-3d landed; **PRC-4/PRC-5 COMPLETE**; **PRC-6a/6b/6c1/6c2a LANDED through `c88acdd`**. **Re-dated 2026-10-08 — the OBJECT DOOR (track DK, DK-D22; on `desk/landing`, main's at the cutover):** `contributes.objects` and the SDK's `/desk` door (DK-0f's contract, spec v0.4 → DK-6), the kind-conformance harness and the playground v2 (DK-7), the `contributes.widgets` contribution RETIRED and refused by name (DK-8), the runtime with kinds — enable, disable and update remount the desk, a kind's faults contained (DK-9) — and the kit judging a plugin outside any workspace, `vibefield-plugin try` on the desk (DK-10: the ten-minute bar met in 5 min 34 s). | `specs/plugin-architecture.md` §8.8/§8.9/§12.7/§12.8/§18.5/§20/§21.9/§23/§24.4/§24.6 · `thinking-plugin-runtime-composability.md` · `thinking-prc6-diagnostics-soak.md` | **PRC-6c2b now:** execute and archive the literal 24-hour physical verdict. **P8c LANDED with WP8 (2026-10-15, `40178d20`)** — a packaged app carries the browser, the browser pane and the pad under a signed index; P8e gates third-party listing. **The KIT slice** (plan addendum (80), from DK-10's (27), (29) and (32)) rides the plugin kit's publish (P8c/WP8), not the desk landing: `--try <dir>` on the INSTALLED app (it opens the renderer's `?deskTry=` door), `check`'s out-of-tree typecheck and tests (the kit carrying `tsc` and vitest against its own SDK copy), and a prebuilt app in the kit for a cold `try` (a warm one is 27–32 s today). **The mind map pack waits for STRING** (below, Next up). |
| PLUG — PRC-5 update coordinator | **COMPLETE.** PRC-5a identity `c5dcca9`; 5b slots `6817116`; 5c candidate authority `3fa514f` + `1602654`; 5d renderer replacement `6cafd0a`; 5e coordinated authority through `0c58fe7`; 5f positive death `b35f73d`; 5g durable epoch/boot fence/physical two-window restart `137f086`. | plugin-architecture §18.5 · `thinking-prc5-update-coordinator.md` | Release portability only: literal power-loss and Windows filesystem witness. Protocol follow-on is PRC-6. |
| PLUG — PRC-6 diagnostics + soak | **IN FLIGHT THROUGH PRC-6c2a; PRC-6c2b PREFLIGHT GREEN.** 6a `26fcfdf` bounded the shared projection; 6b through `9fb74f8` landed passive aggregation/logging/behavior folds; 6c1 `bf281bf` landed exact censuses/inverses; 6c2a through `c88acdd` landed the packaged physical runner, durable evidence path, monotonic duration, five-minute observation-gap gate, and active suspension blocker. The 32-cycle calibration holds 13 lifecycle gates at zero; the duration calibration holds all 14 gates at zero; the listener and sample-gap controls fail for their named reasons. Electron 583/583, field-app 514/514, fieldd 580 + 1 skip. | plugin-architecture §23/§24.4/§24.6 · `thinking-prc6-diagnostics-soak.md` | **PRC-6c2b:** one uninterrupted 24h run; archive JSONL + passing literal-duration verdict. |
| C — mesh | **DS WAVE 3 LANDED 2026-10-03 (`3a58fb5d`; built 2026-10-01 as `f321f576`, 40 commits over `6856b52e`, merged over main `fe895567`; LANDED §DS wave 3): THE SEAT, THE REMOTE ATTACH, COMPACTION, THE PHONE'S HOME, THE TICKET TEMPLATE** — DS-4c/4d the take's engine-side CAS and the finalize re-check, forwarded attaches keyed by the window · DS-4e Godview attaches another desktop's session by the owner's engine handle (`terminal.sessions` federates `{device?}` under `FORWARDED_SELF_ONLY`; the pane says "no road to <desktop> yet" and re-asks once) · DS-5d compaction (a Loro shallow snapshot at the epoch bump under the holders' watermark; a below-root import PANICS the wasm and is contained; ICE 0.11.0 opens the shallow envelope) · DS-8 the phone homes to one desktop and reads the field through its board; DS-D14 EXECUTED, `field.agents.v1` retired on both sides · SP-3 `RemoteEndpointSet` + the route-per-process driver + `PORTS.INDEX_SERVE` 9424 + `index.openTicket` declared `direct-plane-unbuilt` · D36's health stream to local principals only · W-D10 the rosetta checkout dedicated to its pin; owed: DS-7 at the RO-1 pin move, DS-9, E3, the two-desktop run with the Tailscale app quit (James, after truffle's release), the SP-D13 slice · **DS WAVE 2 LANDED 2026-10-01 (`6856b52e`, 65 commits over `d71883fe`; LANDED §DS wave 2): THE PLANE CONSUMED, HARDENED, AND THE PHONE'S GROUND LAID** — DS-1b the egress arm compiles against truffle's RFC 026 as built (every `NodeError` matched exhaustively; the feature flips ON at the pin move), the floor asked ONCE per boot and every dial failing closed with the floor's own honest state, the production `EgressCellRewriter` re-homing a forwarded ticket's doors onto one loopback route per owner desktop, the two-floor probe PASSED on the real tailnet · D1 the `peer-fieldd` kind is the transport's to give (a derived node id + a `docHost` roster row; a claim is `tailnet`), the hello ack names the device, a call's deadline never drops the shared link · DS-5b PA-32's bias — the install-set split per field, revocation generations as a grow-only key set, `standingDecision`, settings CROSS and ride the shared fsync'd writer · DS-5c the host hardened (the inbound phone gate, the HELLO/GET proof, re-greets, residency, `SystemDocFile`, fair reassembly, `held-elsewhere`) · DS-6b the replica's reset, digest and roster-read states · DS-D15's client half (one keyed call, a window echoes the key) · SP-1 the subscription descriptor + the registry lint, `projection.ts`, four streams floored, `system.tick` · SP-2 + DS-4b the kit's door brick v2 (a bidirectional keepalive — the sidecar reaps each direction; roster-aware dialing; a subscription table; `PHONE_BUDGET`) and the phone's take on focus. Seven lead landing commits closed what never reached the lanes and two real gate reds. **Next: James's four merges + pin moves (unchanged) → the seat lane (the engine-side CAS + DS-4c) → DS-7 (after rosetta's pin) → DS-8 → DS-9 → DS-D14 → SP-3…SP-8; the two owed designs** · **DS WAVE 1 LANDED 2026-10-01 (`d71883fe`, 55 commits over `d1232ccb`; LANDED §DS wave 1): THE DESKTOP SYNC PLANE IS BUILT** — DS-1 the egress facade (six `native.mesh.egress.*` verbs with goldens both sides parse; `UnsupportedEgress` in production, honest `egress-unsupported`; `TruffleEgress` behind cargo feature `truffle-egress`, OFF; `socks5.ts`; PeerLink dials through the node's SOCKS5 when the floor offers one and falls back, logged; the `EgressRoutes` port; truffle RFC 026 BUILT on `rfc026-egress`, James's to merge) · DS-2 the facts ground (`onBehalfOf` on every forwarded call — authorized as the peer daemon, recorded as the window; receipts with an explicit OUTCOME-UNKNOWN; the roster's awake/restarting/asleep/incompatible; agent acts `federate`, the fold `stream`, the terminal and index doors `federate`) · DS-3 the mesh board (`agent.subscribe {scope: "mesh"}` multiplexed per device, never re-folded; the `desk` projection; Godview reads the one door — the 2 s poll and `listHosts` DELETED; a device dropdown) · DS-4 a terminal on another desktop (the take in the cell: `transfer_geometry` to the caller on its own right, one CAS on the lease; every self principal `[geometry, input, read]`; the forwarded ticket through the `RemoteCellRewriter` port — `egress_unavailable` until DS-1b wires the route; `takeGeometryOnFocus` passed to the workspace, inert until ghosttea's pin moves) · DS-5 the intent plane (the ICE1 spike PASSED; fieldd a Loro-level host, a peer's checkpoint MERGES; the library system document, `doc.delete`, `elsewhere`; eager replication to every awake desktop, phones out; windows pushed what a peer merged; **the settings document HELD OFF the host until DS-5b**) · DS-6 history across desktops (the repository family; the rows machinery; the follower of rosetta's `/ws/meta`; `index.catalog.subscribe` for peer daemons; the replica persisted; `index.projects/sessions {scope: "mesh"}` by keyset; `index.search {scope: "mesh"}` by asking with `sources`; `PEER_FIELDD_SCOPES`). Reviewed by eight readers before main moved (`work/ds-wave1-review-2026-10-01.md`); one blocker and seven seams fixed on the branch. **Next: James's merges + pin moves for the four sibling branches (truffle on a petition window with the sidecars, protocol 6; rosetta with PROTOCOL_VERSION 24; puppeteer; ghosttea) → DS-1b → DS-5b → D1 the peer identity → DS-7/8/9, DS-4b/4c; retire `field.agents.v1` (DS-D14, now possible)** · **DS-0 RATIFIED 2026-09-30: THE DESKTOP SYNC PLANE (LANDED §DS-0)** — James ruled DS-D1…D18 on its page, every one as leaned: intent replicates (CRDT) · facts federate (rows with a durable cursor; the board multiplexed per device) · bytes go direct (tickets); the missing pipe is EGRESS (no desktop process reaches the tailnet through our node — PeerLink rides the OS network; petition T7 = truffle RFC 026: E1 SOCKS5 · E2 loopback routes · E3 HTTP proxy); fieldd becomes a Loro-level host (C6-1 revisited); the library system doc; the phone HOMES to one desktop (settles SP-D2/D3/D10); DS-D5's note makes the last-focused pane hold the terminal's geometry on any device, the phone included. `design-06-sync-planes.md` v0.1 seeded. *(its Next — DS-1 ∥ DS-2, the ICE1 spike — was PAID by DS wave 1, above)* · **P0-H LANDED 2026-09-25 (tip `b7bbcbc3`): PHASE 0 ON HARDWARE** — the phone held a live cell terminal on this desktop for 10 min 20 s over the sidecar's route (one `tailnet` ticket at 00:04:11Z, the renewal 510 s later, input past the original grant's expiry); the sidecar's WebSocket forward dropped the route's `/t/<secret>` path (petition T6 — a locally built sidecar at `.vibefield/sidecar/`, named by `.env`, until a release carries it) and the floor's mgmt reader starved behind a TLS listener (P0-H2) (LANDED §P0-H) · **P0 LANDED 2026-09-24 (tip `c6a8a39a`): what a Phase 0 run would have hit** — a floor restarted under a live fieldd is asked for its posture again (UA-P-0j; it had stayed off the tailnet until fieldd restarted); a restarted fieldd replaces its predecessor's `product` serve instead of adopting it (P0-S; the phone's door on 9423 had aimed at a dead port); every client a restarted fieldd mints is new to the cells (TP-R21; a tailnet client's first grant had met the old high-water, `GRANT_GENERATION_ROLLBACK`); the phone renews (P0-C, the IOS row) (LANDED §P0) · **UA-P-X 2026-09-16 (tip `723cb356`): truffle 0.7.14 RELEASED with RFC 025; `truffle-core = "=0.7.14"` from the registry, npm sidecars 0.7.14 (protocol 5), the cargo patch gone** · **UA-P-4 2026-09-16 (tip `87987bc4`): `MESH_BUS_CARRIES_CONTENT = true` — the bus carries content again because truffle RFC 025 gates a node by login at the hello, reports only its peers, and binds every slice to its authenticated sender; the device roster takes a slice only for a device the registry lists; petition T5 answered per node, not per store** · **UA-P 2026-09-15 (tip `68b62fb1`): the bus carries NO content until truffle can scope a store to a login — `mesh-bus.ts` `MESH_BUS_CARRIES_CONTENT = false`; the roster derives from the peer registry's WhoIs logins; petition T5 (a per-store login allow-list at the hello, sender-bound slices = TF-2's fix, the accept loop honouring the app-peer filter, no fail-open) is the return path; GM-D10 is answered by UA-P-D2** · **TM 2026-09-14 (tip `bbe551a5`): the terminal mesh rides the sidecar's reverse proxy — one route per live cell on `PORTS.TERMINAL_CELLS_SERVE` 9422 (its own listener: truffle's `Proxy` has no route update, a shared listener would bounce the product door on every cell churn), the linked login the allow-list, `ws://` inside WireGuard; the TSP1 ports and `terminal.v1.hosts` retired** · **`field.agents.v1` since MF-1 (2026-09-13): the field projection as a synced-store slice, gated on the product serve, capped at 64 KiB with `omitted`; GM-D10 (the store's audience) OPEN; TF-2 (truffle applies slices under the payload's id) filed** · C1–C6 + T1 COMPLETE; the P2 mesh chapter closed | design-04 (amended 09-30) · `design-06-sync-planes.md` · `thinking-desktop-sync-plane.md` · `thinking-sync-planes.md` · `thinking-c6-meshdata.md` | DS-1 egress (T7) → DS-2 → DS-5 (the Loro-level host; doc existence = the library) → DS-3 the mesh board → DS-4 the second desktop's terminal → DS-6/7 history → DS-8 the phone re-homes → DS-9; artifact product work in AH |
| AH — Artifact Hub | **IN FLIGHT** — AH-1 serving `9f80f0c`; AH-2 catalog `9c17c46`; AH-3 desktop runtime `8c07bf4`; AH-4 preview runtime in implementation; live AH-1 proof + AH-3/AH-4 physical closeout owed | `specs/artifact-hub.md` | land/review AH-4 + physical two-device witness → AH-5 phone |
| D — widgetlab port | COMPLETE (code) | `thinking-widgetlab-port.md` | visual fidelity pass = James's eyeball (§5 checklist) |
| LOG — logging/diagnostics/audit | L0–L6 + post-L6 hardening COMPLETE (§23: 31/32 accepted) | `specs/logging-and-diagnostics.md` | LOG-39 packaged multi-platform CI · LOG-V5/V7/V8 decisions |
| NF — native floor | **P0-H2 LANDED 2026-09-25 (`abc6f9f8`): the floor answers its heartbeat while a mesh listener waits** — `native.mesh.*` requests enter one bounded FIFO worker (`MESH_CONTROL_LIMITS.MGMT_PENDING_MESH_REQUESTS` 32 beside the byte budget), off the socket reader the watchdog's ping rides; a `tsnet.ListenTLS` wait had read as a wedge and cost four boots and every terminal (design-02 §2.7's dated correction; LANDED §P0-H) · **UA-P-4 2026-09-16 (tip `87987bc4`): `spawn_bring_up` passes `.login_allow([login])` in linked mode and `MeshHandle::start` REBUILDS the node when the gate moves (the gate is fixed for a node's lifetime, RFC 025 §3.1 — the capture→linked promotion is a restart now); peer rows take `whois.login` from Layer 3's `Peer.login_name`, the self row carries `loginAllow`; the window's sidecar sits beside `field-native`** · **UA-P-0a 2026-09-15 (tip `68b62fb1`): the node exists only to capture a login or as the linked account — `native.mesh.start`/`stop`, the capture belt refusing `serve.add`/`store.set`, the state dir 0700; `FIELD_NATIVE_MESH` is a forced-on development override, not the product's switch; NF-8's toggle collapsed into the link (UA-P-D1)** · **TM-1/TM-3 2026-09-14 (tip `bbe551a5`): the in-process TSP1 serve, `ghosttea-truffle`, the hosts store and the TSP1 ports LEFT the floor at TM-1 — cells serve unconditionally, the flag means only "the doors are published" and the hello says so (`terminalMesh`); MF-2a's mint RETIRED at TM-3** (`d205548b`/`b1e330f7` landed it; the capability, its key file and its env var are deleted — the write right is an attach-grant claim, TM-D3). MF-2f's `create_private` STAYS and the pairing secret is its one remaining member. NF-8 the posture toggle owed; the floor has NO auth-key path (an interactive login only), so no headless test can make a floor join a tailnet — an NF follow-up · NF-0…7 landed; **NF-remote (§7)** landed 2026-08 and RETIRED 2026-09-14 (native-floor §7's dated note): the TSP1 posture — the floor serving TSP1, hosts published, writes gated, proved on a real tailnet at GT-4 — is gone with the serve it required | `specs/native-floor.md` | NF-8 · the auth-key path for headless floor-on-tailnet rows · per-device tokens (GT-D6) are MOOT since TM-3 — no token exists to scope |
| IOS — companion | **IN FLIGHT** — **SP-6 LANDED 2026-10-04 (`3269eab0`): the phone reads a real desktop's History over its door** — `index.timeline` (backward pages, cut at 100 rows for a phone, `clipped`) and `index.session.subscribe` (a rows tail at a 1 s floor; always a snapshot first; resync → reset) in contracts + fieldd over rosetta's own page route and session socket; the kit's `FieldHistory` filled from the reads per desktop, grouped by desktop with the home first, an LRU cache keyed {device, session, stamp} replaying offline under the record's honest words, the arrival pill, clipped text and missing attachments said in words; the kit 1,019 tests green on the simulator; the loopback door witness; owed: the live loopback over fieldd + rosettad from the simulator, the over-the-air run on James's phone, H-D6's chip, Sign out → cache clear, SP-7's ticket swap (LANDED §SP-6) · **DS-8 LANDED 2026-10-03 (DS wave 3, `3a58fb5d`): the phone homes to one desktop** — its last home, else the first self desktop that answers; the field through the home's mesh board (rows stamped `device`), re-homed by the roster on loss; a sleeping desktop's rows stay, greyed; a desktop that stopped this phone says so for its backoff; `field.agents.v1` retired (DS-D14); the kit suite 994 in 11 bundles green on 10-01 · **SP-2 + DS-4b LANDED 2026-10-01 (`6856b52e`, DS wave 2): the door client brick v2** — a receive deadline of 2.5 × the door's announced tick and the phone's own ping after `min(announced, 120 s)` (the sidecar reaps EACH DIRECTION of a served socket; SP-L7 corrected), the roster asked before every dial, a subscription table per door (cursors, gap → resnapshot, cadence per subscribe), `PHONE_BUDGET` mirrored and pinned and enforced, a stopped client replaced on a backoff, the door outranking the slice once hello'd, pause/resume one desktop at a time; DS-4b the pane TAKES the seat on focus (claim · one transfer · one retry; no `geometry` right → no verb); the kit suite green (its two known time-sensitive re-ask rows green alone); the device run is James's · **P0-H1 + P0-H3 LANDED 2026-09-25 (`d2c761b8`, `b7bbcbc3`): the phone on hardware** — an ATS exception for `ts.net` and nothing else (the first door probe died in the URL loader, -1022); frames attached only after the cell acknowledges control (four ticket mints in twenty seconds before); one serial writer per leg, bounded (a later send overtook a suspended one and markers left `ph`); kit 897/164; build 5 (`b25a9ddd`) on the device over the cable, the Debug builds of the day carried the fixes (LANDED §P0-H) · **P0-C LANDED 2026-09-24 (`e5c68d54`): the phone renews its write grant** — due 30 s before the cell's input margin, one `requestId` across retries; a lapsed attach re-attaches and reads `.attaching`, never "this session ended"; an attach refused for its grant re-attaches over the live legs instead of sitting at "connecting…"; kit 868/158; no TestFlight build carries it yet, and Phase 0's phone needs one (LANDED §P0) · **IOS-8 + IOS-9 LANDED 2026-09-23 (fast-forward to `ecc3a8bb`): the corner is the account, and the phone has two tabs** — the owner's face (the contracts' deck, the sticker die-cut by Core Image) in a glass circle at the bar's left, its menu grown from it (you · your desktops, the sleeping ones remembered · Settings… · the connection's act · Sign out, which forgets the keys, the login, the desktops, the face and the ledger and keeps the person's appearance and snippets; local, since truffle's Swift node has no logout); the mesh chip and sheet retired; the bar ours — Field · History centred, search right, one 62 pt row of the system's Liquid Glass at the system bar's measured metrics, because `TabView`'s bar could not seat the account at the left; History's ledger, project, document and search over the records' corpus behind `-vf-mock` (the door reads owed, and the real path says so); the TERMINAL chip in the card's `···`; kit 862/158 (LANDED §IOS-8a…§IOS-9e) · **IOS-7 2026-09-20 (tip `4f9b4d7d`): the field caught up with the reference's one-ink revision and RFC 008 — one surface and one ink at eight weights, the folder as the project's only colour, the state line in the name's place on an orange/blue ground lit in waves, the ring's climb, the burn ladder on estimated USD (unpriced on today's wire, D-i18); kit 815** · **UA-P-X 2026-09-16 (tip `723cb356`): the kit consumes the RELEASED truffle 0.7.14 by path (pinned at `v0.7.14`'s commit) until ghosttea's Swift tag moves its exact 0.7.12 pin — G28** · **UA-P-5a 2026-09-16 (tip `87987bc4`): `AccountGate` — the node starts gated on a remembered login (one restart per fresh sign-in; absent is not a switch; another login re-gates and clears nothing, D4's), the store bus reads only inside the gate, a refused desktop's board is held off the field, the corner reads "<login> · <domain>"; kit 806/150** · **UA-P-1 2026-09-15 (tip `68b62fb1`): discovery by the door on port 9423 (a 403 is not your desktop and is never drawn; a hello with a grant is), the store reader dormant until the scoped bus returns, "signed in to <tailnet domain>" in the corner (the login itself waits on truffle petition T4); sign-out and switch (UA-P-D4) OPEN** · **TM-4/TM-5/TM-5a/TM-3 2026-09-14 (tip `bbe551a5`): `FieldRoutedTerminal` the routed T1 client (two legs on the node's `urlSession`, grants, byte credits, the envelope), the attachment over it with `RoutedTerminalFrameSink`, the TSP1 half and `GhostteaTruffle` out of the kit (`truffle` a direct dep at exact 0.7.12), the write key's Keychain item and `WriteKeySheet` gone with the bearer; next Phase 0 on the device** · **IOS-4a…4h and 4e LANDED 2026-09-13/14 (tip `6b26cf23`): `FieldProduct` client + `FieldStore` reader · `FieldLink` the live field · the join's five faces · the grant from the sheet · the corner's link token and line; next Phase 0 on the device, IOS-EL8 the ghosttea pin, the mesh sheet's door line, `notes`** · IOS-0/2/2f + IOS-EL8 · IOS-3a…3e + 3r (2026-08-05/06) · **IOS-3c (the write key's Keychain home), IOS-5a…5e + 5v (the input card, in the canvas's chrome), IOS-6a…6d (the field is RFC 005's swarm on Metal) ON MAIN 2026-09-13 `09c526ab`** · **IOS-TF internal TestFlight `168548c4`** (build 1 = the pre-IOS-3c app; build 2 archived from this tree, its upload owed to Xcode's sign-in) | `thinking-ios-app.md` §10–§12 · `thinking-ios-swarm.md` · `apps/ios/TESTFLIGHT.md` | fieldd projects RFC 008's three usage fields onto `field.agents.v1` (D-i18's door) · James rules D-i18…D-i20 · upload build 2 → the device gates (the shader compile at first launch, 30 Hz physics under the 120 Hz blend, 7 pt type, VoiceOver per body, the tab bar as an obstacle) · D-i11…D-i17 rulings · the fieldd binding (the agent fleet is still the mock; the project-colour door) · the History door reads (H-0/H-1, `thinking-ios-history.md`) · IOS-8f `user.me` (the face over the door) · James's word on AP-D3/D4/D5 · the device run of the corner, the bar and a live sign-out |
| GT — Godview terminal | **IN FLIGHT** — **The deck is round 3's wrapper, LANDED 2026-10-11/12 (`66f746ad`; its close `60403758`):** the Lip's 30 bar with its 40 × 6 groove, the well, minimize and away, the edge's let-go, maximized as the title bar (DESIGN.md §2.7, §8; LANDED "GV round 3, the terminals' wrapper"); the 72 × 4 grip of 2026-10-02 is replaced · **TL LANDED 2026-10-02 (`e89aeb17`): Godview's timeline** — a fourth view, each agent a lane through the day, over fieldd's status ledger and the `agent.history` door, so the record survives Godview closing and fieldd restarting (LANDED §TL; TL-D1…D17 ruled) [*corrected 2026-10-10:* the ledger and `agent.history` were retired on 2026-10-08 by MV-D13; since wave 2 the timeline reads the past from rosettad through the `history` capability and Godview records nothing — LANDED §TL, "the timeline reads the past"] · **Spawn bloom LANDED 2026-09-30 (SB-0…SB-3):** a long press on the swarm's empty ground blooms this desktop's Agent Profiles; letting go opens a terminal under the one chosen, born where the pointer let go, its shell bound to the profile (AR-7g) so its launcher's launches and typed agents run under it or are refused naming the fix (SB-D7); the list view's ＋ TERMINAL is the same tree as a menu. Other desktops wait on the sync plane (SB-6), the phone is SB-5 (LANDED §SB-0…SB-3). **Swarm pointer correction LANDED 2026-09-29:** inherited bubbles now drag, hover and select through the same visual ID as physics; current agent identity is preserved for actions. Real Electron/WebGPU pointer checks and 60 focused tests pass. **Launcher ownership corrected 2026-09-28:** startup activity no longer consumes empty-shell receipts; final launcher replacements explicitly release the old shell and inherit its bubble body. Mirrors, late input and failed handoffs are covered; the native launcher witness passes. **Clean agent exit LANDED 2026-09-28:** confirmed completed exits return attached panes to a fresh shell and launcher in the same folder; conditional replacement preserves mirrors, focus and fullscreen, and releases late births after detach. Conversation history stays resumable. **Attachment cleanup LANDED 2026-09-28:** untouched local shells, including the first shell, disappear when their final attachment closes or is replaced. Pending termination hides the bubble immediately and refusal restores it; shared receipts retain used/restored/remote/agent/mirrored sessions. Real Electron replacement/close witnesses pass. **Monitor creation simplified 2026-09-28:** SPAWN and agent/profile dropdowns removed; swarm long press opens an empty terminal through the normal workspace birth path. **Pane lifecycle LANDED 2026-09-28:** unused-shell close removes its monitor bubble, surviving equal groups rebalance, empty panes have fullscreen, and both hosts share frame animation with fixed terminal pixels and one settlement resize. The isolated Electron regression passed; see LANDED §TP — pane lifecycle and stable fullscreen. **TP WebGPU optimization LANDED 2026-09-27; review fixes LANDED 2026-09-28: bounded atlas pages reserve positions before encoding, glyph pixels own their storage, and named pins reject unrelated revision mismatches; retained scroll rasters, submit counters and covered-mirror demand remain. Pixel witnesses and 325 targeted tests pass (LANDED §TP — WebGPU review fixes). **Startup benchmarks LANDED 2026-09-28:** real split-to-shell acknowledgment and native preparation are measured separately; forty clean-profile splits and 180 echo keys completed. Optional native model names no longer gate readiness; warm speedup remains unresolved against the null control (LANDED §TP — startup benchmarks). Full verification currently stops on unrelated Rosetta checkout/pin drift; the exact revisions and other gate limits are recorded in that landing. Next: native thread creation/materialization stalls, owner-profile gateway-to-TUI timing, source cadence, frame fan-out, native snapshot copies and GPU/presentation qualification.** · **GT-8 LANDED 2026-09-25 `14ac43fc` · `b76644a0` · `811329ca` · `0db71c10`: terminal links — ghosttea 0.12.0 on the cargo and npm planes, Behavior → Links a This Mac switch, a ⌘-clicked web link opens through fieldd's `terminal.link.open` (GT-D22), a file link found and not asked for until ghosttea's hook names its session (G29), and TC-S3's just-born-session routing race closed** · **GT-7 LANDED 2026-09-24 `0f97948b` · `451941e0` · `21168bf3` · `a3d277b1` · `12d6c2b4` (+ the gate's `d1952af6`): Settings → Terminal, rebuilt — one page over two owners (this window's look · this Mac's `config.ghostty`), the loader's dry run on every draft (`terminal.config.validate`) and its verdict re-checked at write, import / export / reveal through the shell's file dialogs, the viewer's glass v2 (an ordered effect stack; Godview's backdrop opacity and blur saved), and ⌘K ⌘, ⌘⇧V kept over a focused pane (GT-D18…D21)** · GT-6 the record's pane frame + GT-6a…d · GT-0…3 + 3v/3m/3f/3p/3c + **GT-4 the mesh, both halves** (its floor half — the in-process TSP1 serve — RETIRED at TM-1 2026-09-14; the remote posture is T, `thinking-terminal-mesh-cells.md`) + **GT-5a…d the code review's fixes** landed (spec v0.5, GT-D10…D22); the kill matrix ran over a real tailnet | `specs/godview-terminal.md` | the deck's own ladder is done, and GT-7 closed GT-D12's `configEditor` follow-up (by replacement) and GT-D11's unmet half (Behavior → Sessions states a session's lifetime). **Upstream:** G29 — ghosttea's link hook hands over a URL and no session, so the deck asks for web links only; the day it names the session, GT-D22's Finder half is already built. (ghosttea 0.12.0 released 2026-09-25 with the links; its publish job's npm wait is fixed upstream, #64.) **The swarm on WebGPU and the other views ARRIVED at AR-5 (2026-09-13, `fe6b3d0a`)** as `@vibecook/puppeteer-views` (AR-D13a; puppeteer's Godview is the reference, ours the product — AR-D14); *erratum 2026-09-13: the 09-12 phrase "mounted into the worker's `adoptCanvas` socket" was GT-D16's expectation restated — as built the package's renderer paints on MAIN behind a physics DRIVER port and the socket stays unused; the spec's GT-D16 carries the correction*; the monitor's one mock module was DELETED at AR-3 (the local field is fieldd's fold through the deck's door); smoke row 13b unskips when a peer can be staged in the harness |
| MV — Godview's monitor views | **LANDED 2026-10-08 (`7a0893d8`; puppeteer `594d222`)**. The five views (list, rain, swarm, timeline, spend) are SDK modules over one backend per desktop, runtime only. The wall runs in fail mode, chrome boundaries back off, and the bar renders only when its inputs move (LANDED §MV). **Since wave 2 (TL): MV-D4's reserved seam is filled.** A view that declares `history` is lent the record's past, and the timeline draws it (puppeteer `c20a07d`, a view-sdk minor); the backend still records nothing (LANDED §TL, "the timeline reads the past") | `draft/monitor-view-sdk/design-mv.md` (MV-D1…D22) · `build-mv.md` (the plan of record, M1–M203) · DESIGN.md §8 · `docs/UI_SYSTEM.md` · `draft/history-finish/surveys/timeline-shapes-v2-mv-answer.md` (the history capability's shapes) | the perf lab's debts (`mv/lab-debts`) · TV-8, an ended lane opens in History · the Stories head (GV-D1; N12 (a), N13 (a)) · the after-MV list (LANDED §MV) · third-party views (MV-D14) |
| UI — design system | **LANDED** 2026-08-05/06; **Studio architecture landed 2026-08-26** — tokens → primitives → production compositions → a catalog that mounts shipping views → one real product + isolated Studio under the active dev host, with explicit ephemeral live appearance and ownership enforced by test · **UI-G1 LANDED 2026-10-02 (built 2026-09-24): the chrome's glyph set** — 48 drawings in one 24-unit box, 38 Instrument + 10 Hardware, drawn by `FieldGlyph` on the desktop and by template assets on the phone from one generator; DESIGN.md §13 is the law and an inline `<svg>` icon is refused by test (LANDED §UI-G1) · **Three design studies LANDED 2026-10-02 (drawn 2026-09-22), catalog-only:** After Hours (DESIGN.md §11), Face Club (§11.1), the living mark and its Logo Studio (§12); none is drawn by the product yet (LANDED §UI 2026-10-02) | `DESIGN.md` (authority) · **`docs/UI_SYSTEM.md`** (where it lives in code) | the catalog's own acceptance is an eyeball (light/dark · keyboard focus · reduced motion · narrow); the browser-only catalog remains available without live-product authority |
| UA — users & accounts | **IN FLIGHT** — **The Me menu and the Settings head LANDED 2026-10-02 (drawn 2026-09-22):** the menu is solid chrome, never glass; the Settings head is one tile with a "Switch user" row (DESIGN.md §8; LANDED §UA 2026-10-02) · **Phase 0 on hardware PAID 2026-09-25 (LANDED §P0-H)** — the phone's tailnet caller is in the desktop's own-actions ledger, the first ever; the second-account witness on the PHONE stays owed · **UA-7c LANDED 2026-09-22 (`0361e6cf`): a user switch is one transition** — the window defocuses into the next user's face, the reload happens under a frame both windows share, and the face flies home to the Me corner; the product entry is render-blocking; the tray's Switch User is not covered (LANDED §UA-7c) · **UA-7b LANDED 2026-09-22 (`73136f74`): Setup's pane 2 fits its shell, and a new user's Back opens a users chooser** (LANDED §UA-7b) · **UA-7 LANDED 2026-09-22 (`135bd9dd` + review `9d11c838`): a user is known by a face** — an emoji face (a sticker by default, a coin by choice) replaces the accent dot; the Settings gear becomes the Me menu, grown out of the face; Settings is headed by the account; `⌘,` exists; UA-D18 (the face travels with the login) is GATED on the settings doc joining doc sync; the waiting count has no feed; owed: screenshots in the product window and the tray, and design-03's Settings-IA fold (LANDED §UA-7) · **UA-P-0g LANDED 2026-09-20 (`f161e866`): the link ACT reaches the UI** — found preparing Phase 0: nothing in the renderer called `user.link.begin` or read `linkState`, so an unlinked desktop (or one that pressed Unlink) offered nothing and blamed the retired `FIELD_NATIVE_MESH` flag; the offline face now offers `Link Tailscale account` on both surfaces, `capturing` shows the address, and `link_corrupt` / `login_unavailable` / `login_already_linked` speak in the daemon's own `linkDetail` (LANDED §UA-P-0g) · **UA-P-W + UA-P-4 + UA-P-5a LANDED 2026-09-16 (tip `87987bc4`): the truffle side of T4/T5 built upstream as RFC 025 and consumed through the petition window; the floor starts GATED on the linked login (capture and the dev override stay ungated; a pre-protocol-5 sidecar degrades with truffle's sentence verbatim); the bus is back, scoped; the phone starts gated on its own remembered login with one restart per fresh sign-in and says WHO; D4 (sign-out and switch): the phone's lean BUILT at IOS-8d (a local sign-out; no switch — sign out, then in), the ruling still James's** · **UA-P-0 LANDED 2026-09-15 (tip `68b62fb1`): the posture derives from the link — `native.mesh.start {capture | linked}` / `stop`, a capture belt, `linkState` with the corrupt and tagged paths loud, the unlinked grant branch deleted; the second link refused (one local user per tailscale account); the artifact audience defaults to its owner; the secret crosses the proxy on forward; the bus carries no content; documents only among same-login desktops — DECISIONS UA-P-D1…D8; D4 (the phone's sign-out and switch) OPEN; the two-account tailnet witness owed since UA-4 is now the witness for everything here** · spec v0.2 RATIFIED 2026-08-05; UA-0 `fcd0af9` · UA-1 `ca1ce49` · UA-2 `3750f20` · UA-3 `15832c0`+`30aece8`+`96e9e9d` · UA-6 `a4bed08`+`1a2a846` · **UA-4 door `105e6bd`** · **UA-3w wizard `1e27c7b`** · **UA-5 second user `cfe87b8`+`f3aa78a`+`e83033a`** — **CODE COMPLETE: all nine slices across two days**, three by worktree agents, zero integration-fix commits on the last two; the sun_path regression James's first real boot found is fixed (`d6f8489`); UA-D12 landed in full (ephemeral ports everywhere — the two-pair audit on real daemons is the V5 mutex's tombstone) | `specs/users-and-accounts.md` | **Physical witnesses only:** S1 live probe (`cargo test --ignored` + TRUFFLE_TEST_AUTHKEY) · two-account guest refusal (gates ANY shared-tailnet login) — **HEADLESS since UA-P-4d 2026-09-20 (`b4a61f23`)**: a fourth ephemeral node on a SECOND user's auth key (`TRUFFLE_TEST_AUTHKEY_GUEST`) asserts roster, slice and the 4004 hello with controls, skips loudly without the key; **RUN LIVE 2026-09-21 on a second human login: 4004 at the hello, never in the roster, no slice either way, every control green — PAID on the desktop plane** (LANDED §UA-P-4d witness); the phone-side guest view stays with Phase 0 · the switch kill-matrix row (a live session in user 1 survives switch-away-and-back) · the switcher/wizard eyeball in both themes (the link act itself only exists since UA-P-0g) · **Phase 0 prep 2026-09-20:** the two-account witness goes headless on a second user's auth key (`TRUFFLE_TEST_AUTHKEY_GUEST`, lane `uap/guest-probe`); the phone needs TestFlight build 4 (archived 09-20 from the IOS-7 tree, upload owed to Xcode's Organizer); `FIELD_NATIVE_TERMINAL_MESH=1` must reach the floor and the mesh override must be off for a single gated bring-up |
| EDP/ESP — distribution & packaging | specs ready (EDP v0.3 · ESP v0.2 · plan v0.2); WP1–9 landed — **WP8 2026-10-15 (`40178d20` `5e7507d6`): the product's three plugins (browser, browser pane, comment pad) staged under a signed index, the trust-root's `bundled` role; fieldd verifies at two grains; a package with no identity is refused** — WP10 half-built (signing proven locally, notarization never run) · **WP12 L1 LANDED 2026-10-15 (`dfc4b832` `9f9e4ec5` `0682ac15`; plan `specs/build-wp12-updater.md`, approved at the leans)**: the pins (electron-updater 6.8.9), the shapes and `@vibefield/trust`, the verify chain (trust-root → channel heads → the channel's policy → the feed, before any download, against the build's floor), the custom provider and the controller core — DEV-witnessed; nothing installs until WP12c's gate · WP11/13 and WP12c–f not · 2026-10-14: trust model RULED (TD, `specs/trust-and-distribution.md`): the WP ladder gains the trust-root (TD-0/1) before WP10's beta; WP12 gains the signed feed; a registry track opens after WP8 · lead: the prod-builder session (TD · WP · RD), serial lanes | the three `specs/electron-*.md` · `specs/electron-packaging-implementation-plan.md` · `specs/build-wp8-bundled-plugins.md` · `specs/build-wp12-updater.md` | WP12 L2 (WP12c: adoption after an update — WP8's debt row — the apply gate, the prepare-restart op) → L3 (WP12d policy levers + doctor, WP12e the release workflow and its TD-3 `sign` step) → L4 (WP12f, `smoke:update`); the RD track's VibeField lanes are done (RD-3 landed 2026-10-15, `e38dfdc6`); RD-4…RD-6 wait on James (the RD-4 hand-off); WP10's notarization run waits on TD-1 and the Apple credentials — `package:mac:release` now refuses only at `--require-release-key`, until TD-1's keys and the `bundled` secret exist (unwitnessed RELEASE-keyed until then); then WP12b/e with the signed feed (TD-3). **Gate on RL8/WP10 (PM, 2026-10-15):** the browser pane is bundled since WP8 (TD-7) — ESP §16 item 7 (persistent-profile lifecycle, cookie clearing, downloads, per-site permission UX) and ESP-11 (cookie encryption verified on the SIGNED build) are owed before RL8's dogfood build carries a persistent browser profile, and before any beta; the reversal is a one-line revert of 5e7507d6. Immutable Releases is already ON (10-12) |
| TD — trust and distribution | RULED 2026-10-14 (18 calls) · **TD-0 LANDED 2026-10-14 (`11c8fa67`)**: `TrustRoot`, `UpdatePolicy`, `RegistryIndexV2` in contracts; `scripts/trust-keygen.mjs` (prints a secret only to a terminal); the ledger's `trustRootKeys` a TD-1 blocker (identityRevision 5), the checker holding the embedded root equal to it · TD-2 LANDED with WP8 · **TD-3's client half BUILT with WP12 L1 2026-10-15 (`0682ac15`)**: the UpdateProvider verifies the trust-root, the channel heads, the policy and the feed before any download, DEV-witnessed; TD-1, TD-4…TD-7 unbuilt | `specs/trust-and-distribution.md` · the hand-off `draft/handover/2026-10-14-td1-james-keygen.md` | **TD-1: James mints the root and the roles in his own terminal (the hand-off), then a lane runs `trust-keygen embed`** · **TD-2 LANDED with WP8 (2026-10-15, `40178d20`)** — the bundled index signed by the `bundled` role, the staged trust-root verified against the app's root keys · TD-3's `sign` step rides WP12e (L3); its gate (a real nightly refused on a bad signature) waits on TD-1 · the registry repo (TD-4) after WP8 |
| RD — release deps (dev shape vs prod shape) | **RD-5a's rosetta half LANDED 2026-10-14 (`fe01ac79`)**: rosetta's npm packages are exact, and rosettad is still built from the pinned checkout (RD-D7 later); preflight prints the shape (`shape: dev — …`); the CI token is retired · **RD-1 + RD-2 LANDED 2026-10-15 (`60eb1cf5` `c4431a62`)**: the lock's `release` (rosetta carries both coordinates), `pnpm siblings render --prod` and the pre-commit shape hook, `pnpm siblings use NAME` / `use --none` — the overlay a gitignored root `.pnpmfile.cjs` with a dev lockfile, the committed lock never the overlay's (§3 decided by the spike, ICE as the stand-in) · **RD-3 LANDED 2026-10-15 (`e38dfdc6`)**: the cargo overlay a generated, gitignored root `.cargo/config.toml` with Cargo.lock skip-worktree while it stands; the Swift overlay the manifest's own rendered `let truffleRelease` line (SwiftPM caches a manifest by its contents plus its environment — a read file and the environment eliminated, §3·A); every commit refused while a lock is hidden; proved on stand-ins, nothing flipped to prod · RD-D11 RULED by fact (RL5, `@vibefield`); RD-D4 decided by the spike; RD-D5 BUILT and RD-D6 amended by measurement (RD-3); RD-D1…D3, D7…D10, D12 at the lean | `thinking-release-deps.md` (§8 the slate; §3's dated note and §3·A; §10–§12 the amendments) · the RD-4 hand-off `draft/handover/2026-10-15-rd4-james-pipelines.md` | RD-5a-2: puppeteer exact at the release cut from `swf/port-0.2.2` (James pushes and cuts it) · RD-4's pipelines (James's hands, per the hand-off), then RD-5 per sibling — one EL8 commit each: the ghosttea fork's `release.cargo` once `10d0b17` is on its remote, truffle's `release.swift` at G28 — and RD-6 (CI prod shape only) |
| WIN — Windows port | **IN FLIGHT** — WIN-0…4 landed `5ffd30b`/`85cce04`/`f982d27` (2026-08-11; ratified 2026-08-10, James: "follow your plan"): gate + dev loop portable, the endpoint law in two languages (WIN-D1), the native plane on named pipes with a real stderr floor, the pair's probe/env/spawn doors, the stop VERB (WIN-D5; WIN-D3 resolved by construction) — all proven on the box (WORKSTATION4090) · **WIN-6 terminal hosting landed `03cc648`** (WIN-D2 adopted 2026-08-11: hosting in GA — the ConPTY kill matrix, two-plane adoption, and frame-plane I/O all on the box; the case-variant env-strip gap booked upstream as G13) · **WIN-5 the app BOOTS on Windows** (`51aa3ab`) — `pnpm smoke` green headless over ssh: shell + pipe-joined daemon pair + renderer + a live godview terminal, all on the box · **WIN-7 opened** (`edd5882`) — the mesh finds its `.exe` sidecar on Windows | `draft/thinking-windows-port.md` (plan; spec graduates with the track) | box gates green (Rust workspace incl. terminal_unit 14/14 · terminal_mesh 7/7 · mesh unit 3/3; fieldd terminal-seam 3/3 · terminal-kill-matrix 6/6 · the full fieldd suite 454/2-skip (the 2 = the tracked concurrent-edit doc-sync pair) · fieldd-client 12/12 · field-app 417; `pnpm smoke` boots headless over ssh); next: WIN-5 VISUAL polish (WIN-D9 chrome, tray `.ico`, glyphs — needs a Studio eyeball), WIN-7 live mesh witness (needs a tailnet auth key), WIN-8 packaging + the EL8 pin delta (electron-builder vs EDP-39) |
| LSF — live surfaces foundation | **LANDED 2026-08-15/16** (`9a8ee9b1`…`90b54219`; spec RATIFIED v0.9) — browser OSR + SCK/Simulator producers, ticketed transport, renderer WebGPU store, Swift capture helper, labs + 20-min soaks all green on macOS; **ledgered LATE 2026-08-28** (entry §LSF — the second recurrence of the 2026-08-07 drift class) | `specs/live-surfaces-foundation.md` (LSF-D1…D16) | consumed by DT below; **DEFERRED (2026-08-28, James):** the §18 Windows rows (LSF-3/3C/6) and the LSF-4 signed-helper artifact (rides EDP/WP10) |
| DT — dev tool pack | **RE-TARGETED to PORTALS — DK-D19/D20 (ruled 2026-10-02), executed by the desk landing:** the browser's page widget, `BrowserPageView` and `smoke:browser-widget` RETIRED at DK-5 (the desk draws no DOM widget), `vibefield.browser` keeps only its Artifacts panel, DT-D1/D5 SUPERSEDED. The browser — with the screen-capture kit and the iOS simulator — returns as a proper object kind over a live-surface / render-target pipeline (an ICE live-texture seam, the next ICE design after 0.15.0); the live-surfaces foundation (LSF) and the pool's `{ liveSurface }` door (a PANEL's view since DK-17) stand for it. The record before: **IN FLIGHT — DT-0 RATIFIED 2026-08-28 (James, same day as the draft); REORDERED FIRST among the production packs** (mind map's MM-D1…D14 gate unchanged, order at source in `thinking-prod-dogfood-packs.md`); DT-D1…D12 in force and DT-D10's deltas FOLDED (PF2 amendment · 03·A §5.5 supersession · sharedTexture EL8 pin-note · roster rows · `ctx.pool`/P8-D4 closure notes) — browser widget into `vibefield.browser` + mac-only `vibefield.devtools` (Simulator · window capture) | `thinking-devtools-pack.md` (DT-D1…D12) · `specs/live-surfaces-foundation.md` | **DT-1 COMPLETE + DT-2a LANDED (2026-08-28 evening: 1a `b35f3132` vocabulary · 1c `501bb978` main authority+reuseKey · 1b `5d35b0b0` fieldd policy door · 2a `0e3b6056` renderer pool — two slices by Opus worktree builders, reviewed; ledger §DT-1+DT-2a incl. the owner.pluginId token-model gap)**; **DT-2 COMPLETE same evening** (2b `1aef94ec` present door + view layer · 2b-2 `d8440045` catalog section + ctx.pool door, builder-built · 2b-3 `7f48ce0e` plugin eligibility + compliance; ledger §DT-2 incl. the surface.close custody debt carried to DT-3's top); **DT-3 COMPLETE — for real this time. The 08-29 00:06 completion was FALSIFIED by the first live run (James: "not working at all"); §DT-3e ledgers the three defects — plugin-lease mints structurally impossible `d9a0e103` · no surface scopes on the window token (same commit) · the tray sandbox-mount holding a hidden live browser `8886f1d6` — and the new witness `pnpm smoke:browser-widget` `d5735150`: real daemons + renderer, screenshots per rung, typed input round-tripping through a real page, URL-bar steering; two exit-0 runs (one entirely on the CPU fallback, GPU disabled); batch gate exit 0 at load ~190**; **DT-3f LANDED same evening (James's second live report: the page didn't fill the card) — the logical viewport follows demand end to end (`175d40a5`: demand grows `logicalViewport` · element box = layout ask, pre-DPR pre-zoom · largest-area fold · producer born-at/actuates/reports the current layout · inset-pinned canvas breaks the element←frame←demand aspect lock) + the smoke measures fill/layout and survives the loaded host (`322f20dd`: non-4:3 spawn, geometry rung, input-free `/size` relayout rung, GL-death relaunch, churn heal, grading controls); full ladder exit 0 incl. two cards at two viewports; ledger §DT-3f**; owed: James's both-themes eyeball (now with a filling page) · `pnpm smoke:canvas` census witness; next: DT-4 devtools pack (pickers over `surface.sources`, mac-only manifest — its rig now exists) → DT-5 control lane. **Re-dated 2026-10-08:** DT-4 and DT-5 wait for PORTALS' thinking doc (the desk migration's Phase 6); the both-themes eyeball and the canvas census witness retired with the widget. |
| SNAP — screenshot tool | **SNAP-0 LANDED 2026-09-09 `46c0c190`** — the `research/screenshot2` prototype (a WeChat-style native screenshot: capture-then-freeze, window snap, loupe, five marks, Enter copies the still) ported as a SHELL-plane tool under SNAP-D1…D9: contracts `screenshot.ts` + 7 fixtures · `@vibefield/screenshot` (Node-only, wall R19) · the macOS Swift helper and the Windows Rust crate (its OWN cargo workspace) · `window.vibefield.screenshot.capture()` + `FieldHost.screenshotCapture?` + View ▸ Take Screenshot on ⌃⌘A / Alt+A, optional, never boot-fatal. **SNAP-3 LANDED 2026-09-23 `b46c0f05`** — the consumer is the **clipboard edge tray**: a still reaches the page through the shell-owned `vibefield-still://stills/<basename>` scheme (a retained still by basename, realpath-checked, nothing else on disk; the third row of the ONE scheme registration; `img-src` admits it), the View menu's capture is told to the page over `vibefield:screenshot:result`, and the tray on the window's left edge — the notch (N1) and its drawer (P4), one path at two scales in opaque solid chrome (DESIGN.md §5's one stated exception; §8's edge-tray canon; §10's left edge) — holds one column of capture tiles by day, hover/pin/⌘⇧V/Escape/filter, and the Snap tile as the product's door; a capture FLIES into the notch (560ms on the island curve, shrinking; the bump; the count). Catalog specimen in five states, both themes; 37 new tests. **SNAP-1 + SNAP-3b LANDED 2026-09-24:** default-on global shortcut with a Desktop preference and visible registration status, system-tray action, display-coordinate conversion, and retained-still native Quick Look. **SNAP-1a LANDED 2026-09-24:** macOS helper prewarm/reuse, fresh capture per command, startup timings, hover/crop fast paths; native service and focused checks green; actual updated shortcut latency still needs a live press | `thinking-screenshot-tool.md` (SNAP-D1…D9; D3 amended by James 2026-09-24; D4 corrected 2026-09-23/24) · `draft/composer/build-edge-trays.md` (the plan) · `draft/composer/compact.html` §15–19 · the helpers' READMEs · `docs/WINDOWS_PORT_STATUS.md` §SNAP-4 | **James's first live press (2026-09-23) found two bugs, fixed at SNAP-3a `14c97bf7`:** ⌃⌘A never reached the menu (the canvas keymap's ⌘A select-all tests `metaKey \|\| ctrlKey` and preventDefaults, and macOS Electron offers the key to the page first) — the chord is now taken in main on `before-input-event`, ⇧⇧'s door; and the fly-in set its end state on an animation frame, which an occluded window never fires — it now waits for visibility and commits after a forced reflow. **SNAP-1/3b verification:** 209 focused tests, shell/field-app/fieldd typechecks, Windows cross-check and rustfmt green; the running macOS app reports ⌃⌘A globally registered. **Live checks still owed:** press from another app on the secondary display, real fly-in, and native Quick Look. `pnpm verify` stops at unrelated preflight blockers (rosetta pin/worktree and the iOS scheme filename). Next: the still onto the CANVAS — an image widget (none exists) and drag-from-the-tray → the right-edge Artifacts twin once D-7 is ruled → SNAP-2 `shell.screenshot.capture` under `surface.capture` → SNAP-4 the Windows box round + WP10's inside-out signing of the nested bundle |
| AR — agent runtime | **IN FLIGHT** — **History wave 2, LANDED 2026-10-10 (`bda60ddd`)** — PJ-4 phase A (`32bb14d6`, 2026-10-10: the join column, merged figures with `partial`, cool-half inks), P2 (`25a9689d`, 2026-10-10: Live now in Godview through the monitor's find door, the watch-only live peek behind wall R26), then PJ-4 phase B (History draws your projects through the room's host inputs R1–R7 and H4's slots; New agent; the Peek's past picture is the room's reader, PK3) and TL (the timeline reads the record's past: rosetta's `GET /api/activity`, the doors `index.activity` and `agent.recordedLanes`, the monitor's history port, the view contract's `history` capability; only this runtime's runs; nothing recorded here) — LANDED §PJ-4 phase A / §AR-8 P2 / §PJ-4 phase B / §TL "the timeline reads the past"; rosetta `2a91bf0` (protocol 27) and puppeteer `c20a07d` pinned; open with James: PK2, the sticky day-head band, GV-D5, TV-1…TV-8; next DS-7/SP-7 at truffle's egress release, PJ-6, PJ-7 · **History finished on one desktop, LANDED 2026-10-08/09** — the gaps (`3ec58bf7`: recorded images, the home door, delegated threads and `index.threads`), EL8 rosetta `eab2f57` + mille `c8160d5` (`3b8374bb`), packaged History (`4dd952c5`: rosettad + the shim signed in the app, the app origin witnessed), the Peek P1 + Jump to P3 (`37e40da9`: the frame's search over Everything with open at the line, the interim retired, Jump to via the deck's `reveal`, Resume refusing a running session) — LANDED §AR-8 History gaps / §EL8 rosetta eab2f57 + mille c8160d5 / §AR-8 packaged History / §AR-8 the Peek and Jump to; plan `draft/history-finish/build-hf.md`; its next (P2, PJ-4, the timeline's past from rosettad) is the wave-2 segment before this one · **AR-8d LANDED 2026-10-05 as FS-1b: History’s worktree guest attaches to the files worker by ticket** (LANDED §FS-1b / FS-2) · **The search interim LANDED 2026-10-04 (`02d59994`): History searches with the room's own sheet until the Peek lands** — RO-14's props consumed (`shortcut: null`, no key printed; `emptyPrompt`), the sheet's open state as the frame's one value (`history-search` surface), ⌘G/⇧⌘G on the stepper only when there is something to walk, the room's layers starting at the head band's foot; AR-D41 stays the end state and the interim goes with the Peek (LANDED §AR-8c search interim) · **RO-13 + RO-14 LANDED 2026-10-04 (`e78d8130`; rosetta main `856bd80` → `bf72978`, the pin at `856bd80`): recorded files open in the room** — a `files` scope on the desktop window's grant (minted for the window only; every other principal stays read-only), the lease reading through the client with wrong-scope mapped to the receipt's words; upstream the file route needs `read` AND `files` for its own session; the room's `shortcut`/`emptyPrompt` props exist and are not yet passed — the search interim is the next follow-up (LANDED §RO-13) · **AR-8c follow-ups LANDED 2026-10-04 (`8b628335`): History is its own lazy chunk** (initial graph 892.8 → 756.1 KB raw / 211.5 → 190.2 gz — the +137 KB had been the room's render-blocking SHEET in the app manifest; "Opening History" and "could not open" faces in DESIGN.md §8; prefetched at idle; `bundle:assert` holds the room out of the initial graph) **and `siblings:pin` typechecks the consumers** (a red keeps the SHAs and exits 1; `--skip-typecheck`; LANDED §AR-8c follow-ups) · **AR-8c LANDED 2026-10-03 (`93b614c1`): History is rosetta's room in the frame** — `@rosetta/room` (AR-8a, MERGED upstream to rosetta main `00b9786` at James's "Do merge for me"; the pin moved there, EL8) mounted in FR-1's History slot on the covers' 72% glass over four adapters in `field-app/src/history/`: the catalog over `index.changes.subscribe` + paged `index.projects`/`index.sessions` (DS-L4's `index.catalog.subscribe` is the peer door and refuses windows — a plan erratum at its source), a per-session lease over `index.openTicket`'s grant to rosettad's loopback that renews before expiry and repoints rosetta's own client, grant-read images in at most 192 object URLs, a host port with the guest closed in its own words (AR-D38); Resume (`agent.resume` by native id) on the line and in the palette; the packaged CSP admits `http://127.0.0.1:*` and `blob:`; `check:deps` holds `@types/react` to one version across linked siblings; the real-rosettad witness streams a session through the room with fieldd carrying none of it (`AR8C_WITNESS`: five doors, 526 bytes in 10 frames); `pnpm smoke:godview`'s History rung; DESIGN.md §8's History canon; catalog 11a on `@rosetta/room/fixtures`; 29 red proofs; the gate green on its first run (LANDED §AR-8c) · owed: the Peek's Everything scope + `openAt` and Jump to (GT; the interim's sheet and the `history-search` surface go with it), delegated threads (roots only), a home-directory door, attachments, AR-8e = PJ-1, a packaged-build ticketed socket (plan risk 4) · **AR-8b LANDED 2026-10-03 (`349f6b69`): fieldd's History doors and the direct plane's ticket** — `index.session` · `index.project` (the three aggregates in one flight) · `index.projectDay`; `index.openTicket` mints an RO-10 grant over a loopback `IndexEndpointSet` (600 s, audited; plugins refused, the phone and peers still `direct-plane-unbuilt`); rosettad runs behind a per-generation bearer with the three flags, credentials deleted after ready; the first grant opened a real session's socket on the pinned daemon (LANDED §AR-8b); **AR-8a MERGED upstream 2026-10-03** (`@rosetta/room` built on rosetta `feat/room-package`, rebased onto main, fast-forwarded to rosetta main `00b9786` at James's word, the branches deleted; LANDED §AR-8a) · **The rosetta track, 2026-10-03 (the blocker walk, all leans ratified but TL-D8, which is the Godview monitor-views architecture work's):** the pin at `eecae7a` (the RO-1 + RO-10 merge, protocol 26; LANDED §EL8 2026-10-03), then `00b9786` with the room (AR-8c, the same evening), read from the checkout dedicated to it, `../rosetta-pin` (W-D10, `3a58fb5d`); RO-1 + RO-10 MERGED and PUSHED upstream (`feat/direct-plane-grants` rebased onto rosetta main `886baed` in the lane `ro1-rebase`, its gate green, fast-forwarded, the push reconciled with PR #6) — the VibeField half (the supervisor's flags, the bearer, the ticket's grant) landed as AR-8b; **AR-8's shape RULED** — rosetta's room extracted upstream as a package behind injected ports (the puppeteer-views precedent), mounted as spine content in the frame's History slot (FR-1's placeholder; One Frame §9 "History, joined"), the plan WRITTEN the same day — `draft/thinking-ar-history-room.md` (dev-local; AR-D36 ruled, AR-D37…D43 leans, the upstream ask RO-12 the room as a package, slices AR-8a upstream ∥ AR-8b fieldd's doors and the ticket's grant → AR-8c the mount → AR-8d the guest → AR-8e = PJ-1), ONE desktop first over rosetta's own project rows, PJ-D1/D2/D15 deferred to its second slice; **SP-D5 (a)** bounded pages over the door until RO-1, then tickets; **SP-D13 (a) LANDED 2026-10-03 `355dffd8`** — `index.search` in the tailnet preset, `INDEX_TAILNET_LIMITS.MAX_ROWS` 100 at the four index doors for tailnet callers, the peer daemon unbounded (LANDED §SP-D13; SP-6 unblocked); the order after this landing: AR-8 on one desktop (LANDED the same day) → SP-6 (the phone's reads) → DS-7 (transcripts by ticket across desktops, when truffle's egress release switches DS-1b on) · **Sign-in usage refresh LANDED 2026-10-02:** a persona login that exits signed in re-reads that account's usage at once instead of keeping its pre-login failure for up to 30 minutes (fieldd `AccountUsageService.signedIn`; puppeteer `6392865`, pinned; LANDED §AR 2026-10-02) · **AR-7 grammar expansion LANDED 2026-09-28: Grok, Kimi, OpenCode, Hermes, Antigravity, Copilot and Pi join Claude/Codex for strict typed invocation; adapter-owned help/utility/one-shot/external classification, explicit unsupported-argument refusal, nine offered vendor agents. Preview status stays preview; latest-version live pane proofs, packaged shim runtime and non-zsh integration remain follow-ups (LANDED §AR-7 grammar expansion).** · **AC (the agent catalog) LANDED 2026-09-25 over main (`adb7f936`; built and reviewed 2026-09-22 as the chain `5f09ef2b` → `116b3346`, the fieldd half ported onto AR-S2's split runtime, the picker beside AR-S5's profile tabs — LANDED §AC): VibeField decides which agents it supports in ONE hand-maintained table (`packages/contracts/src/agent-catalog.ts`), wall R23 holds it to both pins at preflight, fieldd's doors answer from it, the deck badges it, the phone reads it over the wire; AC-D1…D11 RULED (DECISIONS; the slate and the as-built are in `thinking-ar-agent-catalog.md` §10/§13); owed: the deeper AC-D8 (the registry read BEFORE launch, RO-9), codex's real-daemon join row (AC-D6), the per-pane `resumable` gate, the picker's catalog specimen, the live badge witness, the field row's blocker carrying its transport (the `ReplyChips` exception), PU-16/RO-9 upstream (non-blocking) — LANDED §AC** · **AP-DOCS LANDED 2026-09-22 (`577309f3`): the agent plane documented as one system — `docs/AGENT_PLANE.md` the hub, `docs/agent-plane/{architecture,system,api}.html` the umbrella, the aggregation and the doors; puppeteer's host-integration page and rosetta's daemon-api page on branches in James's repos with their errata (LANDED §AP-DOCS); AR-L1 is a law CANDIDATE with no known live violation — ratification is James's call** · **AR-5-1 LANDED 2026-09-21 (`d4e60d8d`): the puppeteer pin moves to James's `2f5ce002` (usage accounting isolated from transcripts, USD costs on the wire, the swarm's one-ink revision) — the gate is green again; the renderer's usage cache now merges per run like upstream's host store (a silent break typecheck could not see); the desktop already carries the USD fields (`coreUsage`'s key list is what drops them), the phone's projection is D-i18 (LANDED §AR-5-1)** · **AR-6-0 LANDED inside MF-1 2026-09-13 (`agent.interrupt`, the deck's stop verb); AR-6 proper after Phase 0 and AG-1; AR-7 landed 2026-09-28; AR-8 behind the goal** · AR-0 the sibling workbench landed 2026-09-12 (puppeteer + rosetta as pinned sibling checkouts; walls R20–R22; the rosettad supervisor + kill matrix) · **AR-1 LANDED 2026-09-12 `c7fe5fda`** (the `index.*`/`agents.*` contracts, the two local-only scopes, the topology's LAYOUT segments, the enrollment record published before every spawn + `--enroll`, the four `index.*` doors live and witnessed against the real daemon; RO-2c upstream — the file is authoritative) · **AR-2 LANDED 2026-09-12 `f9f04763`** (puppeteer's first import: the runtime in fieldd with the injected registry/roots/transcripts, the eight `agents.*` doors, the persona path enrolling observation roots under joined kinds, the machine-scope record under the root lock, CI's filtered puppeteer install; witnessed against the scripted and the real daemon); the other half of the P0 exit | `thinking-ar-agent-plane.md` (triad design, §17) · `thinking-ar-data-topology.md` (RATIFIED; the record, the doors) · `thinking-ar-sibling-workbench.md` · design-04 (D33 proposed retired / D37 / D38) | puppeteer-in-fieldd over the NF seam (D2 stands); **slates RATIFIED 2026-09-12 (AR-D1…D14 amended, FV-D1…D8; DECISIONS)** — scope: rosetta + puppeteer, Godview + History; **AR-3 LANDED 2026-09-12 `6b5e1612`** (the host over the floor, the fold, the four doors, the persisted continuation, the mock deleted — LANDED §AR-3) · **AR-4 LANDED 2026-09-12 `ba1a1eab`** (stable ingress: the durable claim + pinned ingress, the re-attach at the next boot, pending rows and resume-when-idle; PU-1 upstream `d013fef` — LANDED §AR-4) · **AR-4b LANDED 2026-09-13 `8c0725a5`** (the six reviewers' fixes: signed records + the agent-cell rule, the claim as the epoch's authority, verdicts and fences, D36's locality column enforced, the replacing mount's refusal and the row id by RUN; PU-1b upstream `8402184` — the release path, PU-11's cause — LANDED §AR-4b) · **AR-5-0 2026-09-13 `f6b2accc`** (the pins moved to James's puppeteer `d2b0600` + rosetta `e8d907a`, every AR suite re-witnessed at them incl. the real claude and real rosettad rows, one long-socket-path test root fixed — LANDED §AR-5-0; the AR-5 plan is `thinking-ar-views-port.md`, its slate AR5-D1…D7 unruled at the time — **RULED "built as leaned" 2026-09-13, see DECISIONS**); **AR-5 LANDED 2026-09-13 `fe6b3d0a`** (the views port: `@vibecook/puppeteer-views` pinned at `5389449` with the swarm on WebGPU, list, rain, the bar, the usage column and the find sheet behind two injected ports; fieldd's `agents.usage`/`.subscribe` and `index.sessions`/`index.search` doors; project colours; the catalog on the shipping swarm; four upstream fixes found by this consumer — LANDED §AR-5) · **AR-5b LANDED 2026-09-13 `5bb79329`** (the six reviewers' fixes: one blocker — the usage column had no rule — eleven majors across scopes, the walk, the poll's first frame and the adapters, the orphaned mount behind the gate's red; puppeteer `4d734c9` + `b0f08ec` — LANDED §AR-5b); next: **AR-6** approvals + prompts (pane-only send box) · **AR-7 LANDED 2026-09-28 (`8d8f8ce9`; puppeteer `2a81fc1` pinned): a typed agent is a managed agent — puppeteer's spawn-through kit (PU-17) + classified grammars for Claude and Codex (PU-9a), fieldd's gateway, panes born integrated, the typed run on the fold with its own re-attach proof, the smoke's typed row; STRICT from the first landing (AR7-D1); owed AR-7j the packaged launcher runtime, AR-7f the leak detector, bash/fish, James's dogfood — LANDED §AR-7** · **AR-8** the History view as spine content behind RO-1 (RO-1 asked now, in parallel); **AR-S1 LANDED 2026-09-22 (`19b35b1b`; puppeteer `ea90c34` pinned, on no remote branch until pushed): Settings → Agents** — the shared half of the design record's R1 pass 16: the shelf, Check for updates, Update with the vendor updater's own output, each agent's page; two new doors `agents.operations.subscribe` + `agents.reveal`; puppeteer's `planUpdate`/`releaseChannel`/`available`/`onOutput` (LANDED §AR-S1; the series in `draft/thinking-ar-agents-settings.md`); **AR-S1b LANDED 2026-09-22 (`a3a68b08`; puppeteer `2cba428` pinned, on no remote branch until pushed): the update fixes from live use** — the updater's output rendered as a terminal shows it, `agents.update.stop` and the page's Stop, receipts that say `unchanged` instead of claiming currency, Kimi's native installer updated by its own install script, Hermes's budget for its gateway drain (LANDED §AR-S1b); **AR-S1c LANDED 2026-09-22 (`88fad3bf`): the page opens at once** — fieldd reads the installs at boot (the product's daemon only) and `agents.installs` answers that inventory, `{refresh}` and Check for updates read the Mac again (LANDED §AR-S1c); **AR-S2 LANDED 2026-09-23 (`41d79b64`; puppeteer `50ac021` pinned, on no remote branch until pushed): Agent Profiles** — puppeteer's profile sets (one account per agent per profile, one default, sign-out) and the host's half: every profile one folder under its user, `users/<fuid>/agents/profiles/<set>/` (AR-D24), the six `agents.profileSets.*` doors, sign-out that waits for its sessions (AR-D25, witnessed under a live run — the old `deletePersona` gap closed), the Settings pages with the login pane in front of its door (LANDED §AR-S2); **AR-S2b LANDED 2026-09-23 (`c383dc62`; puppeteer `4240196` pinned): the review round** — five reviewers' findings fixed across puppeteer, fieldd and the page, and every agent that signs in in a folder can be added (LANDED §AR-S2b); **AR-S2c LANDED 2026-09-24 (`0e321805`; puppeteer `74dc03a` pinned): plans in the profile** — puppeteer reads a profile's plans from its sign-ins (`profileSetPlans`, `borrowedFrom`, the views' company marks); each plan once as a card with every usage window, each agent wearing badges of the plans it holds (AR-D26; LANDED §AR-S2c); **AR-S2d LANDED 2026-09-24 (`faf146a4`; puppeteer `2c874bf` pinned): the usage meter and its names** — C1 kept and refined as Line · Glow · Halo (the % laid out in pixels, never touched by the now line; a flared line; a lit head; white on orange in the dark); every window named as its company names it, Luna Reserve held until in play (AR-D27; LANDED §AR-S2d); **AR-S5 LANDED 2026-09-24 (`0b17bf92`; puppeteer `e447d00` pinned): Godview's profile tabs** — every Agent Profile a tab in the bar (the record's T3), the others' sessions receded, new sessions started under the chosen one; the bar's type back to §04's 9 px 700 in both hosts (AR-D28; LANDED §AR-S5); **AR-S4a–b LANDED 2026-09-25 (`fb582770`; puppeteer `63bf175` pinned): Extensions, read** — every agent's plugins, marketplaces, MCP servers and skills read per profile from its own stores (RFC 006 C1; eight agents, Copilot owed), and each Agent Profile's servers and skills on its page as pass 24's grid, read-only (AR-D29; LANDED §AR-S4a–b); **AR-S4b2 LANDED 2026-09-25 (`d0852609`): the rest of the reading** — an agent's Extensions rows in its profile, each agent's own lists and a page for every server and skill, read-only (LANDED §AR-S4b2); **AR-S4c's first slice LANDED 2026-09-25 (`bd87ef52`; puppeteer `7926ca9` pinned): the acts** — a server or skill an agent holds turned on, off or out through its own command or protocol from the grid's cells, P7 confirms when a click reaches further, the run card (AR-D30; LANDED §AR-S4c); **AR-S4c's second slice LANDED 2026-09-27 (`22f4d299`; puppeteer `1def18f` pinned): a server's sign-in and sign-out** — the agent's own login in a pane on the page, its own logout as an act, Codex's every-profile sign-in behind P7, and a floor race that stranded a quick pane's husk closed (AR-D31; LANDED §AR-S4c2); **AR-S4d's first slice LANDED 2026-09-27 (`4f6a7a4b0b9023848a2df2ec79b159bbbc070d6c`; puppeteer `524709b` pinned): a server kept once** — turned on for an agent that holds none of it by the agent's own add, its keys in the keychain and given at launch, Add server with Turn on for (AR-D32; LANDED §AR-S4d); **its second slice LANDED 2026-09-27 (`680b3ab932ba0b64f15d6792bcca9c8c6af5ce6c`; puppeteer `852c288` pinned): a skill kept once** — linked where each agent looks, Codex's copy moved to the shared folder, Add skill, and a change made outside VibeField said (AR-D33; LANDED §AR-S4d2); **S4e's first slice LANDED 2026-09-27 (`48b0b9fed4fbcfcea7bf126336055b7235d19bf0`; puppeteer `78451b9` pinned): a plugin an agent holds** — its own page, the agent's switch, Update, Remove and Remove with its data, or why not in the agent's words; the lists' rows open their pages (AR-D34; LANDED §AR-S4e); **S4e2 LANDED 2026-09-28 (`8c90cd0c386fa219b53e509d6779039f6ce4c3c9`; puppeteer `4600241` pinned): browse and install** — an agent's catalogs from its own files, Install and Install…, Check for updates, marketplaces added, fetched again or removed, a typed source planned as it is typed (AR-D35; LANDED §AR-S4e2); S4e3 (options, needs, EX6/EX7, your other profiles) next; PU-12 stays owed |
| CO — composing, characters, the Assistant view | **DEFERRED 2026-09-12 (James)** — its own track after AR: multi-agent composing (four-views §6 group chat, FV-D4's grouping, FV-D5's observed sends), agent characters (FV-D3 home, FV-D8 in the fold), the Assistant view (four-views §5, undesigned) | `thinking-four-views.md` §5–§6, §9 | opens when AR's P0 exit is witnessed; nothing in AR waits on it |
| DK — the desk migration | **LANDED 2026-10-09 — the cutover: main fast-forwarded to `desk/landing` (`31d0d44e` in the rewritten history; LANDED §DK "the desk lands"); CLOSED 2026-10-08 at DK-19.** RULED 2026-10-02/03 (DK-D11…D32; DK-D1…D10 on 09-25 — DECISIONS). VibeField's Canvas view is ICE's desk — one WebGPU renderer drawing object kinds on the cutting mat under One Frame's chrome — by a CLEAN migration: the pre-desk boards refused, never converted. The ladder, every slice graded on the orchestrator's own gates (the landing log in `draft/desk-migration-maps/`; each SHA the slice's last commit as it stands on the lane, after DK-10b's rebase): **Phases 0–1, on main 2026-10-03** — DK-0b ICE 0.14.0 cut (ICE `e9e1876`) · DK-0c the nine 0.15.0 asks I20–I28 (ICE `6709989`) · DK-0d the desk's chrome CANON in DESIGN.md (`6412c45e`) · DK-0f the plugin door v2 contract (`4276ca22` + `cdb15459`) · FR-1…FR-4 the frame (`9fb01584` · `662c9a2c` · `5338e04f` · `8d1cf298`). **Phase 2, the first green** — DK-1+2 the pin to 0.14.0 and the SDK door made minimal (`29a6d39a`, `2e4e1c18`) · DK-3 the host swap, the desk drawn (`8e890631`) · DK-4 documents on the desk, stills in the explorer (`520b2ea5`) · DK-5 the estate, every smoke on its own profile (`4585d0c6`; its main fix `7da141a0`). **Phase 3, objects and the door** — DK-6 the SDK's `/desk` door, ICE's clock drawn as a plugin (`4bb4713f`) · DK-7 the kind-conformance harness, the playground v2 (`59c7cd08`) · DK-8 the comment pad, `contributes.widgets` retired (`91bda4f6`) · DK-9 the runtime with kinds (`d195a4b7`) · DK-10 the ten-minute bar MET in 5 min 34 s (`64d419b3`) · DK-10b the lane rebased onto main, the stillness rows (`ebcbf612`). **Phase 4, chrome on the mat** — DK-11 the bar, its menu, right-click, the status line (`a5622353`) · DK-12 tools in hand (`8546cb91`) · DK-13 the pegboard (`40a335c7`) · DK-14 Send to… (`3ac958e7`) · DK-15 the covers' still (`de46d04d`) · DK-16 peers on the mat, the desk that can't draw (`74ab4bff`). **Phase 5, the landing** — DK-17 main merged in (`87cae67b`), the retire table executed, the banner's sentence (`e0426b38`) · DK-17b ICE's last batch adopted at desk.6, then desk.7 (`d29c603c`) · DK-18 the `0.15.0` pin and the gates written down (`9816fd3e`; `docs/desk-gates.md`) · DK-19 main merged again (`695ff9d1`) and this ledger, then a third time (`ef5d5ad8`, MV; its merge fix `ed9706db`) a fourth (`4853e9d6`, AR-8) and a fifth, the final (`1fa5d8f7`). ICE `0.14.0` → `0.15.0-desk.1`…`desk.7` → `0.15.0` on `latest`: petitions I20–I45, every one LANDED. | `thinking-desk-migration.md` (the plan; §13 the rulings) · `thinking-the-desk.md` (the argument; DK-D1…D10) · `one-frame/design-one-frame.md` · `mat-chrome/design-mat-chrome.md` · ICE `draft/design-015…018` · `docs/desk-gates.md` (the gates; the cutover) | **The cutover** (`docs/desk-gates.md` "The cutover"): `git merge --ff-only desk/landing` on main, with James's word, once main is quiet; then the fleet upgraded TOGETHER (both Macs at once, plan (93)) and James's eleven two-Mac steps, which decide (20)'s stamp wait and (95)'s drag strip. Then Phase 6 — each program a thinking doc of its own, none gating: **PORTALS** (an ICE live-texture seam; the terminal, the browser, the screen-capture kit and the iOS simulator as object kinds — DK-D19/D20; the browser LANDED 2026-10-14, the PT row) · **STRING** (ports on desk objects + ICE's wires pass; the mind map as paper and string) · the **OBJECT KIT** · the **AGENT'S EYES** (`canvas.read`/`canvas.render`, the MCP canvas tools) · the **UPLOAD PLANE**. James's parked calls: DECISIONS, "DK — the build's rulings"; the follow-ups: "Open debts" below. |
| PT — PORTALS (live surfaces as desk kinds) | **THE BROWSER LANDED 2026-10-14 — main fast-forwarded to `fb9efdb3` (PT-1…PT-6b, 243 commits; LANDED §PT).** RULED at the leans 2026-10-09 (PT-D1…D13 — DECISIONS). Live surfaces return to the desk as object kinds over ICE's live face (design-019, M24; ICE `0.16.0`): the browser as the plugin `vibefield.browser-pane` — live pages over LSF, picked up and used (clicks, the wheel, keys, IME, touch, frames of other sites through their own sessions), honest faces (failures, stills on the keyed shelf, the parked desk, six pages alive at most), and a held still page lets the desk sleep. Typing into a frame of another site is a stated limit. Gates at the landing: the builder's and the orchestrator's 24 of 26 on the lane, 24 of 26 on main (DK-14 main's; studio the covered window, green alone). | `thinking-portals.md` (the plan; §7 the slate, §4 the ladder and the rulings) · ICE `draft/design-019-the-live-face.md` · `specs/live-surfaces-foundation.md` · `draft/ground/BROWSER.md`, `PHONE.md` · the landing log `draft/portals-maps/landing-log.md` | **PT-S, the iOS simulator** (view-only v1; PHONE.md folded): its one-page design by Thursday 2026-10-16 (RL7 (a); `draft/portals-maps/PT-S-the-simulator.md`), built after RL2 lands; then **PT-C** window capture and **PT-T** the terminal (its form ruled then, PT-D10). The pane ships in a packaged app since WP8 (2026-10-15, `5e7507d6`: bundled under TD-7, that lane's rebase finding); gate on RL8/WP10 (PM, 2026-10-15): ESP §16 item 7 (persistent-profile lifecycle, cookie clearing, downloads, per-site permission UX) and ESP-11 (cookie encryption verified on the SIGNED build) are owed before RL8's dogfood build carries a persistent browser profile, and before any beta; the reversal is a one-line revert of 5e7507d6. After the landing: A2, B4 and the wind's 5 s (James, 2026-10-14); the carried items in "Open debts". |
| FS — the files service | **FS-1a, FS-1b and FS-2 LANDED 2026-10-05** (LANDED §FS-1a, §FS-1b / FS-2): the always-on worker and row doors; History’s ticketed worktree guest (= AR-8d), read-only tree/git sockets through a renderer Worker, bounded/recovering leases; the phone’s folder-first launch sheet and separate SFTP-like picker with exact Copy path and spawn on the chosen desktop. Places anywhere except a filesystem root; only admitted renderer/self principals read rows. **FS-3 service prerequisite LANDED:** a current desktop window can choose an existing folder through the native picker; fieldd audits and persists its canonical picked export, and `WorkspaceClient` attaches that returned root directly. Cancellation and failed grants create no export. DK still owns the tree widget and drag integration. Mille M4/M6/M7 and mille-git PRs 1–7 are merged upstream at `baa0de8`; the dedicated `../mille-pin` window remains until release, and the interim git port remains in use. | `thinking-files-service.md` · `draft/files-service/build-fs.md` · `draft/handover/2026-10-05-handover.md` | FS-3 desk consumer with DK, using `pickFolder()` → `attach(root)`; FS-4 at truffle’s egress release (with DS-7); FS-5 the phone viewer; real phone and complete notarized release; Files worker packaging/signing witnessed in §FS packaging closeout |
## In flight now

**PORTALS — the browser LANDED 2026-10-14 (`fb9efdb3`; LANDED §PT); nothing in build.** PT-S, the iOS simulator portal, is
designed by Thursday 2026-10-16 (RL7 (a)) and built after RL2 lands. The landing's follow-ups — A2, B4 and the wind's 5 s
(James, 2026-10-14), the SLEEP judge's gaps — wait for their slot ("Open debts", PORTALS). The plan of record is
`draft/thinking-portals.md` (§4 the ladder and the rulings).

**History and Godview's past — wave 2 is landed; nothing of the History finish is in build.** The plan of record
is `draft/history-finish/build-hf.md` (§6 has each lane's state). Ruled 2026-10-12 (the docket's N3, N4), for the debts lane
after round 3 (N10 (a)):
- History's stuck day heads frost (N3 (a)): BUILT `caa7b482` (DESIGN.md first; measured under a cover first: no frame cost,
  about 5 points of a core in the GPU process while the list scrolls).
- Godview's filter is kept while the app runs and cleared at launch (N4 (a)): BUILT `d4530fcc`.

**Godview round 3 — BUILT (2026-10-11/12).** The Stories head (GV-D1) and TV-8 landed at `384602e1` (the MV lead's);
the wrapper at `66f746ad` (the History lead's, lane land3; GV-D4, the Lip GV-D7/D12, minimize and away GV-D5's call
and GV-D6, maximized as the title bar GV-D11); the launch (W7, N14 (a)), ⌘W on the last pane (N16 (a)) and the rest
on any window (N15 (a)) at `60403758`; the search's 120 ms step at `96bd2859` (the debts lane). Left: a look on a real window. PK2 ended
with the bar (N2 closed).

**SNAP — the screenshot tool. SNAP-0 LANDED 2026-09-09 (`46c0c190`): the tool is in the
tree; the overlay's live witness is James's.** The prototype James built in
`research/screenshot2` on 2026-08-18 (its own Electron host, "Deskline") is now a VibeField
tool the app can call: main spawns `field-screenshot-helper --once`, reads ONE JSON line
(`ready` lifts a 20 s pre-overlay timer; `ok` names a PNG on disk that is also on the
clipboard; `cancel`; a typed `error`), and answers the page or the menu with the contract's
`ScreenshotCaptureResult`. What is proven: the contract in three languages (the same seven
fixtures parsed by zod, Swift and Rust), the host library against a scripted helper (30
tests: one live helper, the deadline, every honest ending, dispose, the still ring), the
door (registered sender, request checked, answer validated before it crosses), the menu
model (the chord claimed once, the item present-but-disabled with no helper), the macOS
build + harness + a real `--capture-test` on this Mac (3456×2234 @2×), the Windows crate's
format/check/clippy from the mac. What is NOT proven: the macOS overlay itself — an agent
must not put a full-screen overlay on James's display, so his first ⌃⌘A in `pnpm dev` is
the witness — and the Windows crate as itself (SNAP-4, `docs/WINDOWS_PORT_STATUS.md`). The
consumer is **SNAP-3, LANDED 2026-09-23 (`b46c0f05`): the clipboard tray.** EL2's choice
went to the scheme — `vibefield-still://` serves a still only while the tool retains it, by
basename, and the CSP's `img-src` admits it; a capture main runs from the menu is told to the
page over `vibefield:screenshot:result`; the tray on the left edge (the notch and its drawer,
DESIGN.md §8) holds the captures and a Snap tile, and a capture flies into the notch. What is
NOT proven there either: the fly-in on a REAL still — the same ⌃⌘A in `pnpm dev` is the
witness. Still unbuilt: the still onto the CANVAS (no image widget exists; drag from the tray
waits on one) and the right-edge twin (D-7). At `b46c0f05` the gate could not run end to end
(preflight: the rosetta checkout off its pin; `pnpm lint` red only on the untracked `work/`
and `docs/design` files); typecheck 25/25, the three touched suites and the bundle assert
ran green.

**TP — the terminal pipeline (custody through pixels). RATIFIED 2026-08-22 — the S3 LADDER IS COMPLETE THROUGH TP-S3f (2026-08-23): fully routed, bridge gone, session events landed round-trip through petition G24 in one day.**
The spec is ratified in full (James, 2026-08-22: **TP-D1 = T1**, **TP-D26 = C′**, **mark 21 = (a)**,
marks 2–19 as recommended) and SPLIT per mark 19 into four documents: `draft/specs/terminal-pipeline-v3.md`
(the normative v1 CORE PROTOCOL, v0.11) + `-rollout.md` (§13 deltas · §15 slice plan + landing log ·
§20 item 7) + `-capabilities.md` (resume · snapshot-demand · profiling-envelope · geometryAdmin · the
advanced rendering) + `-performance.md` (§18 · §19); the protocol stays a closure CANDIDATE until core §20
items 4–7 exist (1, 2, 3, 5 do; 4 is half real). **Wave 1 (all on main, 2026-08-21/22):** TP-S1a `f799ffc` ·
TP-S0b `19ff4d9` · TP-S1b `06c7b26` · TP-S0a `983aa92` · TP-§20a `427f71b` · TP-S2 `0f10b22` · TP-S1r
`cd6f47d`+`0950474` · TP-S2b `98d2d6e` · TP-S0c `0da66d9`+`d1b8429`+`2c2c43b` (see LANDED.md). **Wave 2:**
**TP-S3a LANDED `bc273fa`** — the cell-side CONNECTION LAYER in OUR harness (`field-native/src/tp/`: jcs ·
grant · ledger · wire · door): two loopback WS doors per cell (`/control`, `/frames`, one ephemeral port),
Origin at the upgrade, the silent-1008 pre-auth class, HMAC/JCS grant verification against the SAME
vectors as the TS minter, the high-water + nonce ledger with tombstones, one leg per channel with higher-
generation replacement (`4002`), `LegHeartbeat/Ack` + `4004`, `1001` on drain; the floor delivers the key
+ the renderer origins on the bootstrap line, the cell's `doors` ride the route row into
`TerminalOpenTicket.endpoints`; contracts gained message TAGGING and `registries.TERMINAL_PIPELINE`
(§20 item 5 as data, provisional); the CSP widens under the rollback flag only (`--terminal-direct-door`,
tested both ways); **the Origin probe (`pnpm smoke:terminal-door`) is green on the first run — the
app-scheme renderer's DOCUMENT and a WORKER both reached `ConnectionAccepted` under
`vibefield-app://shell`.** **TP-S2b-widget LANDED `d9c2e8b`** — the mirror is a BUILT-IN canvas widget type through the
host's own registry door (`registerBuiltIn`; SDK untouched; roster-driven session picker; TP-R4a re-proven in
widget form; `widgetTypes` 22 → 23 with `stagedPlugins` unmoved is the census witness). **TP-S1m LANDED `39eb38f`** — the ticket-mint lever, measured: there isn't one (a mint is 6 ms; S0c's "≈57 %" was a
single-station instrument reading a renderer main-thread stall as a daemon round trip — errata at source; the
cold-open trace now carries send edges + the create path, fieldd's audit ledger is read at teardown, a gated
six-arm hop ladder asserts order; the real lever is the deck mount's ~150 ms of blocked main thread).
**TP-S3b LANDED `5ba4a72`** — static activation, cell side: the ACTIVATION table (one activation per
{client,session}, idempotent/conflict/atomic-replace), the two-dimensional lease (read-only never
`InputAllowed`; the cell's own lag call), `DeclareDemand{none|live}` → the ghosttea view (warm/hot), the
BYTES credit ledger, and the per-activation pump (seed = a forced full frame; deltas base=last-sent; ONE
`catchup` repairs any dropped-frame lineage; bounded → `stopped{overload}`) — proven end-to-end against a
REAL /bin/sh session + a REAL WebSocket client. **TP-S3c LANDED `e0eefa9`** — the minimal geometry
SEAT, cell side: the geometry lease with the CELL the authority over ghosttea's
`claim_control_checked`/`resize_view_checked` (cell-minted `holderGeneration` stable across resizes;
cell-side `geometryRevision` + CAS; the "empty seat or own" rule + a standalone release ghosttea 0.10.1
cannot express itself; claim / resize-by-reclaim / holder-only transfer / release + the FOUR auto-releases:
detach, leg loss, grant expiry, renewal-drop), a geometry-capable view attached read-write, and the honest
`SeedRequired{epoch-changed}` migration reason — a claim RESIZES THE REAL PTY, proven end-to-end against a
real session + client; focus ⇏ claim is the G23 bundle's, not the cell's. **TP-S3d LANDED `547fde5`** — the writer/admission fairness FLOOR (§8): the frames writer is a TWO-LANE PRIORITY scheduler (urgent incrementals + control replies jump bulk transfer chunks, re-inspected after every chunk = the bulk-induced-HOL floor; a bulk byte-semaphore bounds `maxBulkBytesAdmittedAhead`, closed on writer exit); class-aware admission (`urgentReserve` — bulk draws connection credit only down to the reserve, urgent draws the full window); a delta over `maxUrgentPresentationUnitBytes` becomes a bulk catch-up; the fairness floor (a stalled activation exhausts only its own account, never the connection's — TP-R15a). Three knobs added to `TERMINAL_PIPELINE`/`ProtocolLimits`. Proven: the writer-priority unit (urgent jumps every queued bulk), the reserve + floor unit, the
oversized→catch-up e2e. **Then the ghosttea 0.11.0 lockstep LANDED `6a115b3`** — the G22/G23 bundle
(in-process `ServiceSessions`; the routed renderer runtime), EL8-pinned across Cargo/npm/preflight,
gate-green; the cross-repo drift-guard re-verified 42/42 golden vectors. **Erratum (2026-08-23):
"Next: S3e" was WRONG — S3e retires the bridge, but the routed path cannot yet TYPE.** TPv3
specifies the input AUTHORITY (§5.4 `InputAllowed`; §18.1 `sendKey`) and never defines the input
VERB: `TpMessageType` has no input tag, the cell door no input arm, and ghosttea 0.11.0 confirms the
hole from the other side (`encodeInput` absent ⇒ `routed-input-suppressed{wire-verb-unavailable}`).
Verified a VibeField-ONLY slice, no upstream: `ghosttea-react`'s `sendExtension` ships the message
raw (un-type-checked), and the engine's `authorize_input` already fences input by `(view, client,
attachment_epoch, input_sequence)` — the fencing is built and tested upstream; VibeField carries the
coordinates. Proposal + design + evidence in `thinking-terminal-input-verb.md`. **Mark 22 RATIFIED
2026-08-23 (all five sub-questions as recommended) and TP-S3-input LANDED `d265d70` the same
day:** `SendInput` on the control leg (tag 22 of `TpMessageType`, control-inbound 8; the op union
mirrors the engine's input serde and the Rust fixture test deserializes the golden vectors into
ghosttea's OWN `KeyInput`/`MouseInput` — the cross-crate drift guard), the cell-door arm (cell gate:
own leg · `leaseEpoch` placement fence · the `input` lease dimension · a synchronous renewal-margin
backstop · a presenting view; refusals are drop-and-audit with NO per-keystroke ack; ghosttea's
`authorize_input` — read-only / stale-epoch / monotonic-sequence — is the engine backstop), and
field-app's bounded `createRoutedInputEncoder` (one monotonic wire sequence per activation across
all G23 DOM views/remounts; one slot per admitted session with guarded activation/session/owner
release; capacity, exhaustion, malformed and unknown input return null — closed, not guessed;
`location`/`timestamp` projected away). The contract now pins the engine's exact u8/u32/f32 fields
and JSON-safe i64/u64 subset; Rust also refuses f32 overflow-to-infinity. Proven: typing `exit` over
the wire TERMINATES a real `/bin/sh`; a replayed
`inputSequence`, a stale `leaseEpoch` and a read-only viewer all leave the human-input epoch
unmoved (8/8 reruns). **TP-S3 PRODUCTION INTEGRATION LANDED `67c043d` (2026-08-23):** the
production cell installs G22 `ServiceSessions`, so UDS births and
both T1 doors resolve one session registry and one `FrameHub`; fieldd exposes the exact
transport-private `terminal.sessions` summary and returns the birth summary + first routed ticket
atomically; Electron main carries one fixed bridge/routed selector plus shell policy on bootstrap;
and the pool installs G23's routed host/runtime, multi-cell ticket routing, bounded input encoder,
and exact termination inverses behind `--terminal-direct-door`. The integration review fixed three
real boundary races instead of timing around them: UUID-derived engine `u64` epochs now map to
cell-local monotonic JSON-safe `modelGeneration`s; a create ticket is primed for the first
activation rather than re-entering observation-gated `openTicket`; and the one-shot Workspace list
waits only through fieldd's explicit `unobserved` state. Render prewarm is bounded at 5 s.
**Production proof:** four consecutive clean packaged direct-mode runs applied a real frame,
reached `PresentationReady` + `InputAllowed`, typed a `touch` command through the focused
`TerminalSurface` and observed its filesystem side effect, while process census found no legacy
terminal bridge; measured cold open was 213–279 ms, inside the 300 ms target. **TP-S3e LANDED
`8d47dbda` (2026-08-23): the bridge is GONE.** The rollback flag, the bridge utility +
`terminal.connect`/`connectTicket`, the legacy trio and the S1 unions are removed across five
packages; `TerminalOpenTicket.endpoints` is REQUIRED and a keyless/doorless cell answers
UNAVAILABLE, never a half ticket; production `connect-src` admits the cells' loopback doors
UNCONDITIONALLY — the deliberate reversal, its CSP suite rewritten to assert the new policy on
purpose (84/84); the retired `connectTicket` door answers NOT_FOUND, tested; suites migrated to the
routed truths (multi-cell replaces the single-cell pin; kill-matrix/seam attach over
`daemon.native.terminalEndpoints`, the fieldd-plane truth). **Named instrument debt (the one S3e
residue):** the godview smoke's flip-witness/$PWD/keystroke-echo rows and the perf-lab's
`runInPane` rode the UDS automation door via the retired product ticket — skip-marked LOUDLY
(`s3eInstrumentDebt` on the smoke verdict; the lab throws) until the **AR-lane automation surface**
(fieldd-brokered `automation_input`) exists, which AR wants anyway; smoke row 12 (bridge-kill
recovery) retired WITH its failure mode — nothing severs transport-but-not-sessions any more (leg
death, runtime recovery and floor death each have their own witness). **TP-S3f LANDED `da5919c0`
(2026-08-23): routed session events — petition G24 CONSUMED, a one-day upstream round trip**
(drafted from S3e's three gap rows → amended by the ghosttea-side review → released as ghosttea
0.11.1 → consumed; the lockstep bump is `85f7d769`). The `SessionEvent` verb (tag 23, cell →
client on the control leg: `exited{all four exit facts}|removed|resync`) rides behind the
**`session-events` capability — the FIRST capability the cell speaks** (TP-D25; load-bearing: an
un-negotiated client protocol-closes on any unknown tag); the cell subscribes ONCE to G22's
lifecycle bus through the `SessionSource` seam and fans out connection-scoped; the host answers
ghosttea's routed metadata refresh from ONE coalesced `terminal.sessions` snapshot per turn,
custody-checks each event against the ticketed `cellBootId`, and drives `applySessionEvent`
(upstream's appliers are the UDS ones — parity by construction). Four findings landed
load-bearing: a VERB-driven kill's Removed/Exited arrive INVERTED (the host holds an exit-less
removed ≤10 s and flushes in the intended order — order repair, never invented evidence); the
smoke's keystroke synthesis had dropped SHIFT since GT-2 (silent on case-insensitive APFS);
the deck's chrome is fact-driven now and settles once, so box-exactness rows start settled;
ghosttea's `runtime.terminate` drops local registration in both transports, so a deliberate OWN
kill never gets an event-driven face (row 10 says so; row 9's floor-side kill is the
death-blindness witness). **The three S3e gap rows UN-GAP on a full green ladder (ok:true, 69
fields):** `paneMetaPersisted` · `killedPaneFace: exited` · `rehydratedCwd` (the relaunched
shell's own first-prompt OSC 7, realpath-compared — that row LEAVES `s3eInstrumentDebt`); cold
open 255 ms. Standing debts now: the AR-lane instrument rows (flip-witness + keystroke-echo —
the two left on `s3eInstrumentDebt`); `STALE_ROUTE` raised by custody = TC-S6; the wall-100 rAF
zero-frames reading; divider drag ≈52 Hz (G23 item 9); DECISIONS.md carries no TC-D row
(pre-existing).

**PLUG.** **P8b COMPLETE — the artifact loads.** One evening closed the rung the whole ladder
existed for (2026-08-13, four commits): the owed CORS probe ran FIRST and redesigned the rung
before any code — P8-D9/P8-D10 refuted (the import map binds bare specifiers straight to
app-origin singleton chunks; the fetch client is the document), the real blocker exposed as
P8b-2's own `corsEnabled: false` (an illegal CORS destination refuses module fetches before
headers are consulted — as landed, NO plugin module could ever load), and the
inline-map-under-CSP-hash mechanism proven end to end (`0b8ad13`). The probe's fourth verdict
then flushed out the week's hidden regression: P8b-2's second `registerSchemesAsPrivileged`
call had stripped the app origin's SECURE CONTEXT while `standard` survived — `smoke:canvas`
silently red since `ad8b804`, ICE dying at `crypto.randomUUID` — fixed by the one-call law
(`scheme-registration.ts`, `39c165a`; the registration-call COUNT is now a tested property).
Rung 0b made the map's key set registry data (`ded012b` — the 9 externals + both SDK subpaths,
measured from real artifacts two independent ways; unmappable specifiers now refuse at pack
time). Then the rung itself (`608e78e`): eleven singleton chunks + the deterministic inline
map, the staged loader joining `plugins.modules` to registry records through plugin-runtime's
new `registerRecord` door, async `activate` under a real §10.4 deadline, `BUNDLED` demoted to
dev-only with dead-branch elimination proven by marker. Witnessed on the final sha:
`SMOKE_CANVAS {"widgetTypes":21,"plugins":4,"stagedPlugins":4}` · verify VERBATIM exit 0.
**P8b-3e landed the same evening** (`089274c`): the seam e2e — real registry + real authority
wired STRAIGHT into the real protocol handler over a real on-disk artifact, nothing double'd;
six rows including the §8.4 disable/re-enable control WITH its own built-in sensitivity check
(a caching `authorize` serves the disabled plugin at the instant the honest wiring refuses it)
and the EL7 symlink-after-minting row, mutation-probed. **P8d then opened the next morning and
landed its first two slices in parallel worktrees that joined blind** (`5cfd0b4` + `0478f08`,
ledger entries §P8d-1/§P8d-2): the `vibefield-plugin` CLI with its 39-class typed refusal
catalog and the schemas-generated authoring reference under gen-freshness; the playground
verdict runner with 44 authored states and honest `skipped-gl` rows. Roots: `pnpm plugin` ·
`pnpm playground`. `create-plugin` closed the kit (`a3c4897`, docs fixed + anchor-pinned
`a7d434f`, ledger §P8d-3). Remaining in P8d: **the measured ten-minute bar alone**, its
subject in motion — the pack redirected twice and landed ECS-native; v3's MM-D14 proposes
the bar decouple to a template toy (`thinking-mindmap-pack.md`, awaits James). Rung 3's
R3-0 platform prep is **CLOSED (2026-08-18, ledger §R3-0)**: S2 `e66143a` · W1 `30fd403` ·
S3 `57c4720` · S1 `a002dc5` LANDED, and probe P1 ran (blob anchor export works under the
production CSP; evidence §F). **W2a–W2d SUPERSEDED** — the ECS door's substance landed as
design-009 `defineBehavior` + PRC-4d/e, `thinking-plugin-ecs-door.md` is HISTORY/substrate,
and no door ratification is owed; `thinking-mindmap-pack.md` carries a 2026-08-18 as-built
refresh (decisions unchanged). The build rungs open on **MM-D1…D14 ratification alone**,
behind the binding visual-consistency read — DESIGN.md ·
UI_SYSTEM · design-kit · existing widgets. P8c LANDED with WP8 (2026-10-15); P8e gates any third-party
listing.

The runtime-composability amendment underneath that work is now ratified
(`thinking-plugin-runtime-composability.md`, PRC-D1…D13, 2026-08-15). PRC-0 LANDED
`7e0a0e8`: a shared activation-ownership core and exact structured runtime targets. **PRC-1 LANDED
`4831b0a`**: the renderer now uses child-bound ownership,
withdraws publications synchronously, awaits LIFO cleanup, blocks overlap while same-realm work is
non-quiescent, and teaches the authoring API from generated docs. **PRC-2 LANDED `96fcd81`**: the
service worker shares that ownership tree, and every disable/reload/revocation/crash/shutdown path
uses one typed route-drain protocol with exact generations and correlated cleanup. PRC-3 exact
target work has started: **PRC-3a LANDED `4c4755c`**, promoting semantic/observation equality,
canonical per-face authority projection, private candidate commit, refresh fallback, and
proof-carrying force. **PRC-3b LANDED `2dbb359` + `22a4f71`**: product clients rotate credentials
without identity churn and replay owned subscriptions, while renderer/service lease mint and
installation are fenced against stale observation and backend generations. **PRC-3c LANDED
`2df838b`**: each plugin/device service is one exact desired target; providers stay private until
worker activation commits, observation-only grants rotate credentials in place, and relevant
authority changes replace behind the common drain. **PRC-3d LANDED `e747af3`**: each
plugin/window renderer now owns a privately staged command/surface/style candidate, a stable ICE
widget facade, immediate registry reconciliation, honest same-realm close, and a boot-to-window
shutdown barrier. A review counterexample proved bindings may arrive after activation; the same
mutable publication owner now admits those acquisitions and still withdraws the whole live set at
one close edge. **PRC-4a behavior design/proof completed 2026-08-16.** Released ICE 0.6 and real
React controls refuted call-time ordering, late behavior binding, raw-handle serialization, and a
separate passive registration owner. An isolated upstream candidate moved the contract from 5/5
red to 6/6 green, preserved 546/546 core tests, built through the public facade, and passed 5/5
consumer controls. The revised design seals complete behavior intent with the renderer and gives
the document layout owner one synchronous, sorted registration batch keyed by exact runtime
generation. At that checkpoint, petition I16/release remained the adapter gate and no production
behavior contract was claimed. PRC4-E10 closes the compatibility assumption: an
installed-package-shaped scratch consumer on patched ICE 0.6 + strata 0.12 passes five typechecks,
SDK **17/17**, shell **560 + 1 skip**, all **453** non-socket field-app controls, production builds,
and bundle assert. The eager graph remains **473.1 KB raw / 126.1 KB gzip**; total renderer output
adds **50,111 bytes (0.534%)**. A direct sibling link duplicated React and is retained as the
negative control—release evidence must prove physical peer singletons. PRC4-E16 closes that
production-install caveat: `0b8d009` lands stock ICE 0.6 / strata 0.12 through the real registry
lockfile/preflight, and `5e6cb16` extends the resolver guard across Loro, ICE, strata, React, and
React DOM. At E16, I16 publication still gated the durable/runtime base; I17/I18 plus product
presence gated only the later ephemeral profile.
PRC4-E11 closes the manifest-shape question: one inline full descriptor costs 39,576 bytes for the
16-row realistic fixture (15.1% of the cap), while digest + sidecar saves only 2,705 bytes and
loses atomic headless truth. A 23-family mutation matrix and real patched-package round trip pass;
fieldd can validate widget pre-attachment ids/data without code. Real ICE controls also refute
`writes:[]` as read-only and prove an unregistered handle can construct dormant rider data with no
guest/hook. PRC-4d therefore binds every declaration inertly, requires requested `canvas.write`,
and lets only the effectively granted subset enter a document-generation batch.
PRC4-E12 closes the dormant-data product choice with a 5/5 policy model and 6/6 real-package
matrix. Durable v1 bytes survive a fresh process that imports no behavior, remain writable, and
later migrate 41→42 under v2. Runtime values re-adopt only in the same World; a new engine reapplies
declared defaults and drops ad-hoc riders. Ephemeral facets are publication effects: current ICE
leaves them stale on unregister, guest suspension, and singleton quarantine (which has no ledger
edge), while presence-writer removal sends a real remote component tombstone. Petition I17 assigns
that inverse to ICE rather than a VibeField status poller; E13 then isolates its production gate.
PRC4-E13 closes the generation-host mechanism at 7/7: initial sorted registration precedes
create/open, cleanup reverse-unregisters before document close, grant loss/regrant preserves
dormant runtime data and unaffected peers, breaker state survives engine replacement, and failed
or invalid candidate batches cannot disturb authority. The same run exposes the production
presence boundary: create/open plus standalone `attachPresence(world)` leave authorized ephemeral
intent blocked with no guest, while `docs.join({presence})` activates it once. Renderer intent now
carries authorization and the document host derives execution from generation coeffects. The base
profile explicitly refuses plugin ephemeral manifests; I16 alone gates durable/runtime, while
I17/I18 plus a document-room fieldd presence lane gate the later ephemeral profile.
PRC4-E14's bounded stress is 2/2 green: 64 live authority cycles preserve one unaffected init;
128 engine generations each end with zero guests/subscribers and share one chronic breaker row.
The 24-hour heap/fd/port/log/presence soak remains PRC-6 and is not inferred from this fast loop.
PRC4-E15 closes the production contract-thread assumptions at 6/6 plus strict typecheck. Current
passthrough parsing accepts unknown behavior bytes, but fieldd drops the top-level declarations
while copied widget riders survive—an inconsistent half-contract. The public record reader already
preserves a projected row, so PRC-4d needs typed verbatim projection, not a manifest fetch or daemon
code load. The candidate also pins strict descriptor/attachment semantics beneath the tolerant
outer reader, stable `behavior-store-unsupported`, inert binding under denied grants, staged
authorization from effective grants, and exact host mapping for the new SDK behavior subpath.
PRC4-E16's installed release matrix is 10/10 green. `defineBehavior`, the harness, lifecycle, and
dormant runtime mechanics work through field-app's actual package resolution. The same matrix
refutes the assumption that the bump carried I16: `describeBehavior` and registration options are
absent, and live order, cross-engine behavior-ledger seed, facade diagnostics, and thenable
rejection remain red. Focused singleton, field-app/plugin-sdk typecheck, SDK 17/17, and E15 6/6 +
strict typecheck gates pass. PRC-4c is therefore landed ahead of PRC-4b; the next base move is the
bounded I16 release and exact-pin follow-up, not a VibeField-owned descriptor or partial contract.

PRC4-E17/E18 close that release gate. The published I16 matrix is **5/5**, the I17/I18 matrix is
**5/5**, and ICE 0.8.1 correctly declares strata 0.13.0. VibeField consumes one physical Loro/ICE/
strata/React graph, passes preflight, all **22/22** project typechecks, and the workspace suites.
Strict NodeNext declaration portability remains upstream debt; VibeField's Bundler contract is
green. I18 is consumed, leaving only the product presence lane and remote tombstone witness for
the later ephemeral profile.

**PRC4-E19 / PRC-4d LANDED `95da1b8`.** Strict complete descriptors and widget riders now travel
from the signed manifest through fieldd into the renderer. The React-free SDK behavior door binds
every declaration privately, compares the exact ICE description, seals before publication, and
derives execution authorization from the effective `canvas.write` grant while preserving dormant
handles under denial. The old systems row and ephemeral admission fail with stable structured
codes; authoring, CLI, build, scaffold, import-map, bundle, and generated docs all share the same
contract. Acceptance is green across all **22/22** workspace test targets and typecheck targets.
**PRC4-E20 / PRC-4e LANDED `6289795`.** Complete renderer candidates publish canonical,
identity-bound rows into a window-scoped catalog. Each committed document layout lifetime
subscribes before snapshot, installs authorized durable/runtime behaviors before `docs.open/create`
with ICE order keys and prior breaker state, rolls back failed additions, and reverse-unregisters
before persistence unbind and every document close/reset. The window ledger is bounded and omits
document/runtime generation from chronic identity. A corrupt journal now ends the old behavior
generation before closing and registers a fresh one before the quarantined replacement. Focused
acceptance is **26/26**; field-app is **477/477**; all **22/22** workspace test/typecheck targets,
preflight, dependency, lint, generated, bundle, and patch gates pass.
**PRC4-E21 / PRC-4f LANDED `9fc2de6`.** A real example plugin declares v2 durable migration,
runtime state, a deliberately thenable breaker, and one widget riding all three. The vertical row
builds its ignored artifact from committed inputs, discovers it through fieldd, imports only the
emitted bytes through the renderer singleton harness, stages it, and installs it through the real
generation host. Child-authored v1 count 41 migrates to 42; six deny/regrant cycles and nine total
engines preserve durable values, reset fresh-engine runtime values, carry suspended strike 3, and
balance **45 register / 45 unregister** with every closed edge quiet. The experiment repaired the
playground's missing behavior-declaration/handle bridge; the field runtime required no change.
All **23/23** workspace test and typecheck targets plus production boundary gates pass.
**PRC4-E22 / PRC-4g1 CORE CODE LANDED `43929e7` + `81c21fd`.** The renderer attaches released
ICE facade presence only after document open/create and preserves behavior-unregister → presence-
detach → document-close order. Its already-ticketed document socket demultiplexes opaque presence
pushes ahead of persistence replies. One bounded `PresenceRoomRouter` keys authority only from the
redeemed document, retains one newest snapshot, shares a daemon lane-id allocator with doc sync,
and fences graceful lane close with MeshData BARRIER/BARRIER_OK.

The native leg is a hybrid rather than a mislabeled reliable stream: authenticated QUIC installs
OPEN/READY routes and carries terminal FINAL/STOP control; steady state uses shared UDP 9441 with a
versioned 20-byte header, ≤1,150-byte datagrams, a 64 KiB logical ceiling, sequence wrap, and one
newest incomplete message per lane. Graceful close reliably replays the retained latest snapshot;
receiver rejection stops the opener and permits exact reopen; a retired bridge lane drops late UDP.
Focused acceptance is field-app **44**, fieldd room/doc-lane **43**, fieldd-client **8**, contracts
**25**, native codec **4/4**, and native lane controls **6/6**, plus all **23/23** typecheck targets,
all-target Rust check and warnings-denied clippy. The ignored two-daemon witness then passed **1/1
in 35.11 s** on the real tailnet with the pinned sidecar: reliable record boundaries, 4,242-byte
fragmented presence, terminal replay deduplication, receiver STOP/reopen with post-reopen delivery,
and vanished-peer `peer-unreachable` repair. A broad Rust lib run separately passed 63 tests and hit
only the sandbox's pre-existing socket-bind refusal.

E22 separately refutes admission: sixteen legal 4 KiB ephemeral facets emit **66,498 bytes**, over
the 64 KiB logical cap, and runtime writes are unbounded and unattributable at the aggregate frame.
I19 asked ICE for a descriptor-bearing enforced facet budget. Commit `ce43bad` kept the stable
refusal while that was genuinely missing; E23 below records its published resolution and removal.

**PRC4-E23 / PRC-4g2 LANDED `1fecb94` + `ce92023`.** Published ICE 0.9.0 preserves the I16–I18
surface and adds optional, identity-bearing `maxFacetBytes`. Exact-artifact probes prove canonical
complete-cell UTF-8 boundaries, no-residue default refusal, synchronous last-good runtime refusal,
captured-write enforcement, and three-strike quarantine followed by I17 remote withdrawal. The
host still validates the claim because disabling ICE dev guards permits malformed declaration
shapes even though byte enforcement itself remains production-on.

Wire measurement selects a 48 KiB plugin window plus 256 bytes per declaration: one maximal
128-byte id adds 139 wire bytes, and sixteen empty maximal-id facets add 2,224 bytes, so a claims-
only sum is insufficient. A fully charged 16-facet plugin with maximal identifiers plus maximal
core profile/selection emits **48,776 bytes**, leaving **16,760 bytes** under the independent
64 KiB guard. Static validation refuses a plugin that cannot fit alone; the generation host admits
eligible plugins atomically in canonical plugin-id order and may skip an oversized candidate so a
later smaller one still fits. Values are never truncated.

The packaged conformance artifact now carries a bounded presence facet through fieldd discovery,
the emitted renderer bundle, sealed descriptor identity, the production generation host, and the
product document-presence composition across two engines. Grant withdrawal unregisters the
producer and the second engine observes I17's tombstone. E23 is **8/8** against the installed ICE
artifact; all **23/23** typecheck targets, changed suites, **61 field-app files / 473 non-socket
tests**, preflight/single-copy, generated artifacts, targeted lint, and the production bundle wall
pass. The broad sandbox run's remaining failures are only pre-existing local socket binds refused
with `EPERM`. **PRC-4 is complete.**

**PRC-E18 / PRC-5a LANDED `c5dcca9`.** The evidence model freezes one service plus two exact
renderer incarnations at ingress close, holds newcomers outside the vote, advances the current
revision once at a logical epoch, and keeps routes closed through commit or retained-old recovery
acknowledgements. Orderly close, positive renderer death, and control disconnect have distinct
outcomes; update-id/incarnation replay, concurrent update, and post-commit rollback are refused.
The production seam gives Electron main one stable participant id per logical window and one
incarnation per cross-document generation. fieldd requires that tuple when minting a window token,
stores a defensive copy, and derives it into the local-token principal; renderer update acks have
no participant field to forge. The boot path uses the stable id for exact renderer targets while
browser harnesses retain an identity-less fallback. Strict bounded contracts pin update artifacts,
snapshots, commands, epochs, participants, and acknowledgements without registering a half-
implemented RPC surface. **PRC-5b LANDED `6817116`:** immutable full-artifact-SHA revision slots,
durable private staging, base-slot CAS pointer publication, fail-closed registry resolution, legacy
adoption, and conservative orphan recovery pass 7 new cases plus 13 registry regressions. The
compatibility installer still prepares/commits back-to-back, so reload coordination is unchanged.
**PRC-5c LANDED `3fa514f` + `1602654`.** Registry preparation now returns a code-free candidate
record/manifest/root without moving live maps, and registry runtime identity is the full signed
artifact slot so same-manifest code changes remain distinct. Episode-bound path-free module grants
resolve only the explicit candidate root and require exact-current promotion. The common target
controller can hold a fully activated target in `prepared`; service replacement drains old
providers, starts from the explicit root, keeps typed handlers unavailable, and requires the exact
candidate row at one synchronous commit edge. Base/grant/disable movement and discard revoke the
candidate; retained old authority can restart. E19 is **5/5**, the focused production gates are
fieldd **40/40**, plugin-runtime **42/42**, and Electron staged-serving **6/6**, with four dependent
typechecks green. **PRC-5d LANDED `6cafd0a`:** one stable controller/facade now replaces immutable
artifact sources behind the held-target law; deferred import follows old quiescence, candidate
publication is synchronous, registry/commit queue order is tolerated, and post-commit old recovery
is impossible. E20 is **10/10** and field-app is **495/495**. **PRC-5e** then supplied the
authenticated source/ack lane, exact revocation inverse, held-newcomer gate, and activated
renderer/service install barrier through `0c58fe7`. **PRC-5f `b35f73d`** separated bounded
replacement requests from positive renderer-death evidence. **PRC-5g `137f086`** made the
artifact/epoch pointer the journal, fenced surviving realms on daemon boot change, and passed real
pre/post-rename child death plus a packaged two-window restart. PRC-5 is complete. **PRC-6a
`26fcfdf`** then separated the rich recursive debug snapshot from a globally bounded flat wire
projection, replaced open event objects with a compact typed 64-row ring plus omission count,
retained exact close/force facts without runtime objects, and turned a measured 2,000-deep stack
overflow into a deterministic 64-level ownership ceiling. Forced-GC retention and 2.4k/9.6k
timing controls pass. **PRC-6b `06860e0` + `078d8fc` + `9fb74f8`** then landed passive exact
service/renderer/update/behavior aggregation, lifecycle logging, and bounded Plugin Manager/Doctor
disclosure. **PRC-6c1 `bf281bf`** adds exact ownership censuses, releases terminal code/schema/
promise retention, refuses false zero after failed boundary teardown, and passes a falsifiable
120-cycle production-seam soak. **PRC-6c2a through `c88acdd`** lands the packaged
real-worker/two-window/restart/log runner and falsifiable physical calibration. Thirteen lifecycle
gates stay zero for 32 clean cycles; its listener control fails 1→2→3. A duration-mode terminal
calibration holds all 14 gates at zero while proving Electron's suspension blocker active. The
runner records raw OS ranges around seven-reading medians, measures duration monotonically, rejects
an observation gap over five minutes, and cannot label a short prefix as the 24-hour claim. Literal
duration remains PRC-6c2b.

**DT.** The dev tool pack opens, reordered to FIRST among the production packs (James,
2026-08-28 — mind map has prior work pending; macOS lands first, the Windows port defers
with the LSF Windows rows). The foundation it consumes is already landed and ratified:
track LSF (2026-08-15/16, ledgered late — see the reconciliation entry) built the whole
local runtime, and the production preload/renderer-host even carry the transport today;
what's missing is exactly four seams, named in `thinking-devtools-pack.md` §3 — the
authority door (no production `issue()` caller; `surface.*`/`shell.surfaces.*` don't
exist), the surfaces pool + ICE demand adapter + `ctx.pool` SDK door (P8-D4's closure,
absent from the SDK by honest omission), the widget faces themselves, and DT-D10's
ratification deltas (PF2 amendment · 03·A §5.5 supersession · EL8 pin notes — **FOLDED at
ratification**). DT-0 is **RATIFIED as DT-D1…D12** (James, 2026-08-28, same day as the
draft): browser face lands in `vibefield.browser`,
Simulator + window capture in a new mac-only `vibefield.devtools` (`engines.platforms`
already exists in the manifest schema); scopes `surface.attach/browser/capture` with
`surface.control` reserved for the DT-5 agent lane (LSF-3C's selected
`webContents.debugger` boundary; pixels never depend on control). The ladder: DT-1
authority · DT-2 pool/presentation (parallel worktrees, open now) · DT-3 browser
widget through the real staged chain · DT-4 the devtools pack · DT-5 the control lane.

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
colors in the §2.6 accent slots (`--vf-accent-1..8` now real tokens); ~~AR replaces exactly
one module (`MockAgentField`) and deletes the label.~~ **DONE 2026-09-12 at AR-3 `6b5e1612`: the
module and the label are gone and the monitor reads fieldd's fold** (correction 2026-09-14, the TM
review's record lens — the future tense had outlived its slice by two days).
GT-3f closed the G11 loop inside one
day — drafted morning, landed upstream in 0.9.1, consumed by evening: shaders are LIVE and
viewer-local (four ports as §8 chips; the withheld-upstream list renders honestly for the
first time; the floor's config document provably untouched by a viewer's choice). James's
own `6646f1b` (chopsticks-UI match, per-mode themes) landed between slices and everything
stacked cleanly. **GT-4 landed the mesh in two halves**: the monitor became the door (remote
sessions are monitor citizens — bubbles, columns, rows — and clicking one attaches the active
pane; no palette), and ~~the floor joined the tailnet, borrowing the gateway's single truffle
node rather than standing up a second~~. The kill matrix ran for real — three ephemeral nodes,
one seeing the host's session and refused write, the other holding the capability and
accepted, with no fieldd anywhere. ~~NF-remote is complete with it.~~ **Erratum 2026-09-14 (the TM
review's record lens): the struck halves narrate a floor that no longer exists.** GT-4's floor half
— the in-process TSP1 serve with `ghosttea-truffle` attached at construction, borrowing the
gateway's `Arc<Node>` — RETIRED at TM-1 `afc35b15` (TM-D7, no rollback flag), and the crate left
the workspace with it. The kill matrix as run is history and stands as written, but NF-remote
names nothing in the floor today: the remote posture is T, each cell's own door reached through
the sidecar's route (`thinking-terminal-mesh-cells.md`). The same correction sits at the code's
source, in `packages/field-native/src/services/terminal.rs`'s header.
GT-3p made the deck fast the honest way: James's own groundwork
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
artifact IPC, or renderer path textbox was added. Packaged discovery landed with WP8's
signed bundled-plugin index (2026-10-15); the final both-theme/reduced-motion/native-picker witness is owed.
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
row was *live view · type with mirror-write · reconnect banner* — the middle third was not
reachable until that leg landed. **CORRECTED 2026-09-14 (TM-3):** that leg is not owed and never
will be. MF-2/G4 shipped the capability leg on 2026-09-13, and TM-5 then moved the phone onto a
routed T1 attach whose grant carries `input` for a self peer — so TM-3 deleted the capability, the
Keychain slot and the sheet. The middle third is reachable, and it is a grant right, not a key.

**UI.** A track the roadmap never had a row for, built entirely by James: `DESIGN.md` said what
the product should look like and nothing said where that direction lived in code.
`docs/UI_SYSTEM.md` now names four layers — tokens → primitives → colocated product
compositions → catalog harnesses that may stage a production component but never redefine its
selectors — and `c188195` did the migration the rule implies at a net **585 lines deleted**
across 52 files. The load-bearing claim is that **the catalog mounts shipping views, not
replicas**, and it is a maintained boundary rather than a cleanup: `ui-system-boundaries.test.ts`
rejects catalog-only replicas and production selectors in catalog CSS. `3ca1f8a` gave it
`pnpm dev:design`, originally an isolated Electron UI Bench on the production window/security
factory. On 2026-08-26 that standalone shell was retired in favor of one Studio-capable dev host:
the real product and isolated Studio now share the supervisor and Vite server, with a narrow
ephemeral appearance router and production leakage gates. The episode worth remembering:
`11765bc`'s import was *correct* by R5's
own description and the wall failed anyway, leaving `pnpm verify` red at preflight on main for
about 22 hours across four GT-5 builders and the whole IOS-3 ladder.

## Next up — the options on the table (James's call)

- **History and Godview's past — after wave 2 (LANDED §PJ-4 phase B, §TL "the timeline reads the past").**
  - **Ruled 2026-10-12 (the docket, all at the lean but N7):** the day heads frost (N3 (a)); Godview's filter kept while the app
    runs (N4 (a)); the Peek keeps its watch-only terminal (N5 (a)); after round 3 a debts lane beside PJ-6, then PJ-7 (N10 (a));
    truffle's egress this week (N11 (a)); N7 (b)'s audit-history hold resolved by RL1(c) on 2026-10-14; James alone publishes, siblings first.
  - **Godview round 3: BUILT** — the Stories head and TV-8 (`384602e1`), the wrapper (`66f746ad`), the launch, ⌘W and
    the rest (`60403758`), the search's 120 ms step (`96bd2859`, the debts lane). Left: a look on a real window.
  - **Waiting on truffle's egress release:** DS-7 and SP-7, which bring other desktops' sessions and transcripts
    into History and onto the phone. History lists this desktop's sessions until then (H3).
  - **Not waiting on a release:** the room's batched figures and the repository's address (R8, R9: built
    upstream, not yet passed) · the past for other desktops and the phone (B-D4, B-D5).
- **DS — after wave 2 (LANDED 2026-10-01 `6856b52e`; LANDED §DS wave 2; `work/ds-wave2-2026-10-01.md`).** The plane is
  built, consumed on this side and hardened; the phone's ground (SP-1, SP-2, DS-4b) is laid. **James's (unchanged):** merge, release
  and pin the four sibling branches — truffle `rfc026-egress` (the pin move flips `truffle-egress` ON; the review's follow-ups plus
  wave 2's: the sidecar refuses ANY held route id even for the same target and lists no in-flight placeholder) · rosetta
  `feat/direct-plane-grants` (PROTOCOL_VERSION 24) · puppeteer `feat/device-dimension` · ghosttea `feat/geometry-take`; then the
  two-desktop run with the Tailscale app QUIT. **Then:** the seat lane — the engine-side CAS for the take and DS-4c window-keyed
  attach ledgers · the renderer half of DS-4's remote attach by `device` (no renderer site forwards a mutation yet) · DS-7 transcripts
  by ticket (RO-1/RO-10 consumed at rosetta's pin move) · DS-8 the phone re-homes (on SP-2) · DS-9 E3 and artifacts in the app,
  files, compaction · DS-D14 retire `field.agents.v1` (once the phone reads the field through the door, usage fields included) ·
  SP-3 the ticket template → SP-6 (LANDED 2026-10-04, over the door; SP-7 swaps the bodies to tickets) → SP-4 probe → SP-4 → SP-7 (after RO-1) → SP-5 → SP-8 (after AR-6). **Found, James's to weigh:**
  `system.health.subscribe` is phone-reachable (scope null; the locality wall refuses only peer daemons); the four moved
  whole-value streams reach a window up to 250 ms after a change that used to arrive at once (a leading-edge emit when idle is the
  trade, against the board's "one frame per window" and SP-D12's budget); local idempotency for self-served keyed calls is out of
  DS-D15's scope. Still owed from the companion page (SP-D7, SP-D9 ruled NOW): the mini-app bridge and the upload plane, as designs.
- **PLUG → the mind map pack (ECS-native)** — *re-dated 2026-10-08 (the desk landing): it WAITS FOR
  STRING, the desk migration's Phase 6 program (ports on desk objects and ICE's wires pass; the mind map as
  paper and string). The desk records and carries ports but draws no wire until then (plugin spec §12.8), and
  the v3 design below was cut for the pre-desk canvas.* The record before: the chosen thread, and the runway is now
  CLEAR. P8b and the P8d kit are COMPLETE; the pack's design is `thinking-mindmap-pack.md`
  v3 (node entities + engine Wire edges + ordered-ChildOf structure + a sweep-drag
  auto-growing frame + geometry as DERIVED state maintained by a declared behavior;
  evidence §A–§F), carrying a **2026-08-18 as-built refresh** (decisions unchanged). The
  platform it consumes all landed: the ECS door's substance arrived as **design-009
  `defineBehavior` + PRC-4 (COMPLETE)**, dissolving the old door ratification, and
  **R3-0 platform prep is CLOSED** (ledger §R3-0 — S2/W1/S3/S1 landed
  `e66143a`/`30fd403`/`57c4720`/`a002dc5`; probe P1's verdict in evidence §F: blob anchor
  export works under the production CSP). **Gating now: ONE ratification — MM-D1…D14**
  (the pack doc's §8: the decisions, the MM-D14 bar call — a P8d gate change — the D5
  drag stance, the D12 collapse deferral). Then R3-1…R3-5: the pure core
  (layout/opml/tx-shape suites), the visible map behind the binding visual-consistency
  read (`thinking-prod-dogfood-packs.md` §3), the living map (keyboard, focus store,
  gesture txs, the layout behavior live), the OPML door, the signed `.vfplugin` joining
  the smoke census — plus the upstream ICE demand entries argued from real use (per-wire
  styling/labels · Hidden · spawn-focus; the tx-meta and move asks SHIPPED upstream and
  left the list). Plan: `thinking-p8-loadable-artifact.md` · pack:
  `thinking-mindmap-pack.md`.
- **AH-4 closeout** — review and land the preview runtime (the bundled browser plugin is staged
  and signed since WP8, 2026-10-15), then run the both-theme/native-picker plus desktop-B preview/refresh,
  Truffle symlink/allow, and cross-origin physical witnesses. AH-5 adds the phone list; the
  AH-1 physical two-client proof can run alongside this work.
- **UA physical witnesses** — the track is code-complete; an evening with a second
  device closes it: the S1 live probe, the two-account guest refusal (gates ANY
  shared-tailnet login), the switch kill-matrix row (live session survives
  switch-away-and-back), and the switcher/wizard eyeball in both themes.
- **WIN ladder continues** — WIN-6 terminal hosting landed (`03cc648`); **WIN-5's functional boot is
  PROVEN** (`51aa3ab` — the whole app runs on Windows: `pnpm smoke` green headless over ssh, shell +
  pipe-joined daemon pair + renderer + a live godview terminal) and **WIN-7's sidecar resolves**
  (`edd5882` — the mesh finds `sidecar-slim.exe`). Next: WIN-5 VISUAL polish (WIN-D9 chrome, tray
  `.ico`, glyphs — a Studio eyeball, not porting), WIN-7's live mesh witness (needs a tailnet auth
  key — the coexistence spike is cheap, the box runs host Tailscale today), WIN-8 packaging. Named
  residue, none blocking: the WIN-6 env-case gap is booked
  upstream as G13 (a case-variant private-env key leaks past ghosttea's case-sensitive strip on
  Windows; row 6b is an `it.fails` witness that flips green when the pin consuming G13 lands); the two
  concurrent-edit doc-sync tests are win32-gated (a slow-box stall past the raised 15s timeout under
  sustained load — the router is in-process, transport is proven in `quic_lane_transport.rs`
  — **correction 2026-08-11:** that proof is `#[ignore]`d behind `TRUFFLE_TEST_AUTHKEY`, which the box
  does not have, so those rows' skip text claims coverage that does not exist today);
  ~~MockMgmtServer + mesh-lane `fakeBridge` still bind filesystem paths (~20 suites)~~ **— RETIRED
  2026-08-11, and already false when written: `f982d27` itself made `mock-mgmt` pipe-aware and every
  construction site resolves through `nativeEndpoint`, so those suites run un-skipped on win32**;
  `process-service` group-kill → Job Objects (**narrowed 2026-08-11**, see WIN-9); snapshot-prune
  EBUSY policy (verified still unhandled — `doc-service.ts` ~429-446 logs the retry-less failure and
  the two legacy removals below it swallow it silently).
- **WIN-9 — the review's fixes (2026-08-11, LANDED; gate green on the box → see LANDED).**
  A five-agent read-only review of the WIN stack plus a gate run on the box found five real defects,
  each fixed with a control run proving the witness can fail: the production **CSP enumerated
  9410/9411 while UA-D12 made every port ephemeral**, so Chromium refused the renderer's own socket
  and `doc.list` timed out at 8 s — **not a Windows bug** (production mode on macOS reproduces it at
  the same commit), and its own test pinned the defect with a row named *"never widens connect-src to
  the loopback wildcard"*; **`bundle:assert` graded shell bundles nothing in the verify chain built**,
  so THE gate was red on every clean checkout **including CI on `origin/main`** (pre-existing since
  `fc78b84`, platform-independent); **win32 group-kill orphaned every MCP stdio server** (`kill(-pid)`
  throws ESRCH there, and the fallback reached only the `cmd.exe` shim); **the meshdata byte lane
  still dialled a filesystem path** field-native binds as a pipe, so WIN-7's mesh sync would have
  failed silently inside a best-effort catch; and **`service-graph.mjs` externalized the win32 entry
  point**, so `pnpm dev` silently watched only a plugin service's entry file and no sibling module.
  Five packages' test suites were still mac-shaped and are ported. A sixth defect surfaced once the
  harness stopped masking it: **an atomic document save can fail on Windows** — `rename` over an open
  target is EPERM there, so `doc-service`'s commit point could lose a save whenever a scanner or
  indexer held `current.json` (predicted at `thinking-windows-port.md` §7.4 and never closed; now a
  bounded win32 retry). **Still open from that same §7.4 family: the other publish paths it named —
  users.json, log segments, the audit chain — none of which retry today.**
  ~~**The residue this pass CREATED**~~ — **CLOSED by WIN-10 the same day.** WIN-9's suite port added
  nine win32 skips, and one class (POSIX mode bits) meant nothing on Windows asserted that the log
  root, crash dumps, `shell.token` or the audit chain land owner-only. WIN-10 gives EL7's
  "private at rest" a real Windows expression (owner-only DACLs on the private roots, children
  inheriting) and asserts it on both platforms in their own true terms; four of the five symlink
  skips also became real junction-based tests. See the WIN-10 ledger entry.
- **WIN-10 — the two guarantees POSIX gave for free (2026-08-11, LANDED).** Mutual pairing auth:
  D8's MAC proved the CLIENT, nothing proved the SERVER, and unix got that free from the 0700 run
  directory while WIN-D1's flat pipe namespace does not — a local squatter that wins the bind race is
  dialled by fieldd's connect-probe and could hand it terminal endpoints and an auth token. Closed on
  both mgmt and the meshdata lane with a per-connection nonce + `fn-ack`-context proof (WIN-D10),
  refused when absent because tolerating absence IS the downgrade. Plus private-at-rest (above), the
  MCP door's missing executable policy, case-insensitive `isUnderRoot` on NTFS, five sync commit
  points still on a bare `renameSync`, and a `(OI)(CI)`-on-a-file bug this slice wrote and its own
  control run caught (an empty DACL that locks the owner out of `shell.token`).
  **Still open, deliberately:** a squatter holding a pipe name makes field-native fail closed
  (refusal to boot, not compromise); `artifact-preview-capture`'s thumbnail rename; and the stale
  "proven by the packaged gate" comment in four fieldd test files.
- **AR** — the agent tracks; the reason everything else exists, and the only thing between here
  and the P0 exit. Its seam is one module wide and every dependency it named is landed.
- **The phone on a device** — IOS-3c…IOS-6 are on main (2026-09-13, `09c526ab`) and TestFlight
  carries them from build 2; what no fixture can answer is owed to a real iPhone: the shader
  compile at first launch, the feel of 30 Hz physics under the 120 Hz blend, the type at 7 pt,
  VoiceOver per body, the tab bar as an obstacle — and the fieldd binding (the agent fleet is
  still the mock).
- **Packaging WPs** — the ladder toward the signed macOS beta (WP10).
- **LOG-39 packaged CI** — also carries NF's 24h-soak gate.
- **ESR follow-on** bundle slice.

## Open debts (dated, sourced)

**PORTALS' follow-ups (2026-10-14; LANDED §PT; `draft/thinking-portals.md` §4; the landing log `draft/portals-maps/`):**
- **smoke:studio reds when its window is covered** (main's smoke). Studio publishes on its window's animation frame and
  keeps `backgroundThrottling: true`; the acceptance's Studio window should keep its frames, as DK-11 did for the main
  window. Witnessed 2026-10-14: red with the window covered (the gate on main), green alone with it seen.
- **The SLEEP row's judge** (the C1 review): M1, the lease's end must witness the re-lend (the editor active and shown,
  the hand's `stats().pageLeases` up by one); L1, the pane's own driver must have followed a key, a wheel or an arrival;
  L2, `still` read over a window, not an instant; L3, the arrival's anchor read before the stir.
- **B5** the still sweep forgets only what the DOCUMENT deleted (a design first) · **R5** each refusal stamped with its
  load · **V7** a failed page asked back while it waits for a slot is stopped again when its face reopens (the ask must
  be main's word, in its state) · **pressable
  shadow-hosted frames** (V2–V5, one design).
- **IDLE (the USE set) reds in an OFFSCREEN window only** (3 desk submits, no frame, no arrival; `fb9efdb3` and fix7
  alike, the History lead's control 2026-10-15; 0 on every visible gate). Read from the code, unwitnessed: other panes
  taking stills (`still-taker.ts:146`, one submit each) inside the 1.2 s watch, which counts the whole desk's submits.
  Witness `stillsTaken` across the watch offscreen; then count the held face's own submits, or settle the stills first.
- **To check:** a typed address may not be drawn while it is typed (the editor's text is transparent; the pane reads it
  at ⏎). PLAUSIBLE, from the C1 review.
- **Measurements owed and stated limits:** the host page's own clicks miss by up to 4 CSS px across the width (PT-5d
  M18); a mouse press at a page scale past 1 into a frame rests on units alone; typing into a frame of another site is
  refused and counted (James, 2026-10-12).

**History wave 2's follow-ups (2026-10-10; LANDED §AR-8 P2, §PJ-4 phase A, §PJ-4 phase B, §TL "the timeline reads the
past"; `draft/history-finish/build-hf.md` §5):**
- **The no-record rung is out of the default gate (M21).** `smoke:godview` runs with rosettad, so `timelineNoRecord`
  only reports there. Run `smoke:godview` a second time with `FIELDD_ROSETTAD_BIN` unset at any landing that
  touches the past door.
- **The past is this desktop's only (B-D4).** `index.activity` federates and `agent.recordedLanes` takes a `device`,
  but no window asks for another desktop's past, and the phone reads none (B-D5).
- **R8 and R9 are built upstream and not passed.** The room can take every project's figures in one ask
  (`projectStatsBatch`) and the repository's address from the host. VibeField's adapter passes neither, so History
  asks `project.figures` once per project.
- **P2's owed measurements stand:** the paired perf run (`pnpm perf:godview --source-a model`, M40) and a paired
  capture against the pre-P2 tree; the CDP trace of the blur-18 scrim over the live swarm.
- **The live peek's ground uses the token default,** not the viewer's terminal appearance (P2).
- **`--vf-cyan` (231°) and `--vf-ink-info` (235°) sit inside the first project arc.** DESIGN.md §2.9 records it; the
  ruled band is not moved (PJ-4 phase A).
- ~~**No kit mirrors for the keyed fixtures** (`index-sessions.keyed`, `project-summary.hidden`)~~ — *paid 2026-10-14
  (LANDED "PJ-7, the kit half"): both mirrored and named required in `check-ios-fixtures`.*
- **Gate hygiene the wave found:**
  - `pnpm siblings:pin` rewrites the whole lock in a layout biome refuses; a pin commit keeps the sha line only.
  - A smoke in a fresh lane, before any cargo build, exits 1 in 22 s with no reason line.
  - The smoke's shot directory under the OS temp is shared by every lane.
  - One `capture:godview` launch in four timed out waiting for the deck's pane; it passed alone.
- **Upstream, found (the petitions' status lives in `petitions/README.md`):**
  - rosetta's room lets go of a chosen project when no session is chosen: `openAt({projectId})`, or an in-place re-key.
  - The room's fold falls back to its row count when given none, so a host cannot say "no count".
  - rosetta's `cargo test` leaves four untracked `crates/*/bindings/` folders.
  - puppeteer's `pnpm format:check` is red at the pin on `scripts/capture-swarm-states.mjs` alone.

**History finished on one desktop: the wave's debts (2026-10-08/09; `build-hf.md` M3–M5; moved here from this file's
head, unchanged):**
- Every shipped Rust daemon inherits `allow-jit`.
- Shipped Rust binaries embed `~/.cargo/registry` paths with the build user's name.
- `package-census --assert --strict` is red on MV's renderer chunks.
- A dying smoke orphans rosettad.
- EACCES is not yet honest words.
- Retired plugins' ignored build folders in an old tree turn `glyphs.test.tsx` red.

**The desk landing's follow-ups (2026-10-08, DK-18 and DK-19; the landing log's notes, plan addenda (95)–(97)):**
- **(a) fieldd's agent-inventory probes outlive its stop** (main's, AR-S1c): the owner's agent CLIs (kimi, agy,
  copilot, opencode, a python) still run after fieldd exits; a smoke's teardown asks them as orphans of its run.
- **(b) With no desk, B and the line's ⊕ still flip the Objects surface:** over the unavailable card the create turns to
  its ✕ ("Close  Esc") with no board to raise (`Composer.tsx`'s `create` toggles the surface when `board === null`).
- **(c) The perf lab leaves its fieldd data root** (`/tmp/vf-smoke-*`); only its Electron profile is per run (DK-18).
- **The remount edge — a candidate ICE ask, NOT filed:** a freshly mounted desk's pointer adapter has heard no mouse
  fact, so after a remount (the Reload, the retry, a plugin's kinds toggled) a pointer that leaves the window off the
  chrome says nothing, and a peer in that state hides by idle (8 s), not at once. The ask: a `leave` with no point
  (`docs/desk-gates.md`, "Edges said, not gated").
- **Per-worktree cargo targets (environment):** every checkout and worktree builds into ONE target —
  `~/.cargo/config.toml`'s global `[build] target-dir = "/Volumes/SamsungRed/rust/target"`, which a checkout's own
  `target` link does not override — and cargo does not rebuild across checkouts: its dep-info paths are
  package-relative, so a crate is fresh when this checkout's sources are older than another checkout's last build.
  DK-18 met it (a control worktree's `field_native` linked into the lane's tests); DK-19 met it again (a throwaway
  worktree's fieldd test setup rebuilt `field-native` into the shared target despite its own `target` link — with
  sources identical to the lane's that time). A target per worktree (`CARGO_TARGET_DIR`) ends it; until then touch
  the Rust sources that differ and `cargo build -p field-native` before gating (`docs/desk-gates.md`, the hygiene).
- **The thumbnail follows an edit by ≈ 22 s** (plan (97)): the explorer's owed still waits for the desk to rest, and
  ICE's ambient wind keeps it awake 20 s after the last touch plus its 2 s ease (design-015 D-D9, DESIGN.md §6 M5) —
  James's call: keep it, shorten `deskLayer({ ambientIdleMs })`, or take the still at a quieter moment.
- **For James, outside the repo:** the DK-18 builder's stray `require("electron")` downloaded `~/node_modules/electron/dist`
  (307 MB) and `path.txt` (2026-10-08T08:10:51Z); nothing uses them — remove both.

**Packaged agent plane (2026-10-05, FS packaging closeout):** the signed Files worker is witnessed,
but the release stage still declares bundled plugins absent (`scripts/stage-package.mjs`, WP8).
The same allowlist omits `rosettad` and `agent-shim.cjs`: `packages/fieldd/src/bin.ts` configures
rosettad only from `FIELDD_ROSETTAD_BIN`, and `agent-gateway.ts` expects the shim beside the daemon
or withholds launchers. These need their packaged resource resolution and installed-app witnesses
before the signed beta. The Files artifact test uses a source fieldd control host and does not
claim those product flows. Notarization and the physical-phone run also remain open.
*Corrected 2026-10-10: the rosettad and shim half closed on 2026-10-08 (`4dd952c5`, LANDED §AR-8 packaged
History). Both ship signed in the app, and the packaged origin is witnessed end to end. The bundled plugins
(WP8), notarization and the physical-phone run remain open.* *Corrected 2026-10-15: the bundled plugins
closed with WP8 (LANDED §WP8); notarization and the physical-phone run remain open.*

**Adoption after an app update (2026-10-15; filed by WP12 L1 as WP8 promised, LANDED §WP8 "Owed";
`specs/build-wp12-updater.md` D10):** production adoption checks only the user id and the contracts major
(`fieldd-supervisor/src/probe.ts:78-88`; `expectedBuildId` is dev-only, `electron-shell/src/main/fieldd.ts:83`), so
after an app update the shell can adopt an older fieldd, whose plugin roots and trust anchor (read once at spawn,
`fieldd/src/bin.ts:62-81`) are the old app's. Worse, `incompatible-contracts`, `user-mismatch` and `foreign-listener` fall
through to a SPAWN over a root a live daemon may hold (`supervisor.ts:108-117`; EDP §8.4 step 7). Closes with WP12c
(L2): a production build identity, the bounded replace path, the three refusals.

**DS wave 2 follow-ups (2026-10-01, from the landing `work/ds-wave2-2026-10-01.md` "Decisions taken mid-wave" and the lanes' reports):** the four moved whole-value streams (device · artifact · services · profileSets) carry a trailing-edge floor of 250 ms — a first change after idle reaches a window late by up to one window (the leading-edge emit is the trade) · `system.health.subscribe` is phone-reachable · nothing sweeps egress routes a superseded daemon left (they linger until node teardown) · the truffle sidecar refuses ANY held route id even for the same target and lists no in-flight placeholder — the floor mirror is the only idempotence (T7) · mgmt error data nests under `data.details` · the probe harness reads `.env` relative to the worktree · the renderer half of DS-4's remote attach by `device` does not exist (launcher, routed host, Godview's remote attach all local) · a self-served keyed call is set aside, not journaled (local idempotency named, not built) · `FORWARDED_MINTS` and the keyed-forward set are different sets · the engine-side CAS for the take and DS-4c stay owed · from DS-6b: `page`/`pages` not folded into `rows.ts`, design-06 §5's `catalog.db` vs per-table JSON, project-family's case and port, a consumer throwing inside live frame routing still uncaught · from DS-5c: compaction (the S4 fence is in place for it) · the kit's device run and the two-desktop run with the Tailscale app quit.

**DS wave 1 follow-ups (2026-10-01, from the review `work/ds-wave1-review-2026-10-01.md`; the builders' own 'not fixed' lists are in that record):** the `peer-fieldd` principal is minted from the hello's self-declared kind (`product-api.ts` ~703) and since DS-6/DS-3 that kind carries `index.search`, the catalog door and the desk board — D1 · egress falls back to the OS network per DIAL on any answer but a proxy grant (`egress.ts` ~133; unchanged behaviour while every answer is `egress-unsupported`; a DS-L5 downgrade once egress is live) and every dial queues on the floor's mesh FIFO for a fixed answer — DS-1b · the take is a CAS on the lease, not the engine (`door.rs` `handle_geometry`); finalize never re-checks the destination activation · the inbound doc lane admits any self peer's VERSION (UA-P-D5 enforced outbound only, `doc-sync.ts` ~649) · the host never evicts a document (`loro-host.ts` ~170); system-doc persistence is neither fsync'd nor serialized against merge persists; four chunk-reassembly slots per peer shared across docs; the HELLO/GET proof race; a lost eager-replication answer is never resent · the DS-6 reader: an interrupted forced reset freezes a replica (`index-mesh.ts` ~791), a reader-dropped row makes the digest disagree forever, fieldd-client replays the first attach's cursor on a blip (now a supplier — `index-mesh` uses it; `react.ts` `useSubscription` passes no `onReplayFailed`) · no client sends `forward.idempotencyKey` or reads `forward.receipt` (the client half of DS-D15) · a call deadline drops the shared PeerLink link (pre-existing) · `godview-monitor.test.tsx`'s 3 s WebGPU row is a load lottery (red at load 166, green at 37) · the stale `[input, read]` claims were corrected at their sources; the iOS kit still has no lease verb (DS-4b).

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
- **The plugin platform's remaining seams are P8's rungs — four rows consolidated 2026-08-13**
  (they were separate debts dated 2026-08-09; the thinking-p8 §7 fold map ran).
  ~~Install-a-widget~~ **CLOSED the same evening — P8b-3 landed `608e78e`, the artifact
  loads, staged census witnessed; the P8b-3e seam e2e landed hours later (`089274c`), so P8b
  is closed WHOLE** (`LANDED.md` §P8b-3/§P8b-3e) · the §5.4 authoring kit = **P8d** (critical path for the ratified
  agents-author-widgets destination; bar subject in motion — `thinking-mindmap-pack.md` v3
  MM-D14) · `PluginWidgetProps`
  §12.1 + PA-27's curated canvas tier = **P8e** (gates any third-party listing) ·
  **`ctx.pool`** stays deferred to its first attachment kind (AR — and the dev-tool pack when
  its track opens; `thinking-prod-dogfood-packs.md`). Decisions incl. the P8-D1 withdrawal:
  `thinking-p8-loadable-artifact.md` §3.
- **The census smoke sits in NO gate — two silent-red eras in ONE WEEK (2026-08-13).**
  `smoke:canvas` is the only witness for "the canvas boots and the plugins load," and it runs
  only by hand: the bundle-class red hid 2026-08-06→10 (four days, two ledger entries), and
  P8b-2's secure-context clobber hid 2026-08-11→13 (`crypto.randomUUID` died at ICE; found
  only because P8b-3's integration re-ran the smoke). `pnpm verify` carries `bundle:assert`
  but never boots Electron. Options, James's call: fold `smoke:canvas` into `pnpm verify`
  (~60–90s per run, needs `TMPDIR=/tmp` guard baked in), a pre-push hook, or a scheduled run —
  but the current answer ("whenever someone remembers") has now lost twice.
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
  papered over by the listing's `readWrite` (2026-08-07). **Resolved 2026-09-13:** the leg landed as IOS-3c `9b07fc61` on
  `ios/keyboard` (the Keychain store, WRITE KEYS in settings, the token supplied at attach) and
  reached main in the `ios/swarm` merge `09c526ab`.
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
- ~~**`terminal.connectTicket` is reachable from another device** — `terminal.attach` federates
  via `TAILNET_SCOPES` and `locality:"local"` is declared but never enforced, so a
  WhoIs-verified peer can mint this device's floor ticket. Bounded (the token authenticates
  only on local unix sockets) but it is a daemon credential crossing a device boundary for no
  reason, and it falsifies GT-D6's "only spine code receives it" (GT review, 2026-08-06).~~
  **RETIRED 2026-09-14 (the TM review's record lens) — both halves of the row are gone, and had
  been for some time.** The door itself retired at TP-S3e with the bridge it fed: there is no
  sessionless mint left to reach (`packages/fieldd/src/daemon.ts:1894`, and
  `packages/fieldd/test/terminal-service.test.ts:645` reds if anyone re-registers it). And
  `locality` stopped being a declaration at AR-4b — the column is READ on every call, refusing a
  `peer-fieldd` principal outright and refusing a foreign `device` before the forwarder
  (`packages/fieldd/src/product-api.ts:733` and `:757`), which this file's own AR-4b paragraph
  already states.
- ~~**Our mirror-write secret leaves the device**~~ — upstream reused the one configured string
  as the VIEWER's outbound token, so attaching to a peer handed it the string that granted write
  on our own sessions. **CLOSED 2026-09-14 (TM-3)** by deletion rather than by the per-device-token
  upgrade it argued for: there is no configured string on any plane. A grant is signed per cell
  boot, per client, per session, and carries no credential the holder can replay elsewhere
  (GT review, verified at the pinned source, 2026-08-06).
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
- **AH-3 packaged-plugin discovery — CLOSED 2026-10-15 (WP8, LANDED §WP8):** a packaged build stages the browser,
  the browser pane and the pad under a signed index, and fieldd registers them only when the index and every byte
  verify (the renderer's dev-only bundled fallback still folds away in production, as P8b-3 made it).
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
- ~~**`ghosttea-truffle` writes unstructured `[terminal-mesh]` lines to STDERR** — latent
  violation of native_logging's absolute no-stderr law (which today only meets the
  flag-off floor); the `field_native.sidecar.stderr` capture is the fixing pattern
  (GT-4, 2026-08-06).~~ **RETIRED 2026-09-14 at TM-1 `afc35b15`: the crate left the workspace
  with the TSP1 adapter; the floor has no terminal-mesh code to write anything.**
- ~~**`apps/ios/**` is stale against 0.9.2**~~ — **CLOSED, and it was already closed when this
  row was written.** IOS-EL8 (`4f2b21d`) landed the bump hours after GT-4 recorded the debt, and
  the row was simply never retired. Verified 2026-08-07 in `apps/ios/VibeFieldKit/Package.resolved`:
  ghosttea `0.9.2` (rev `b55b803`) and truffle `0.7.12` (rev `2cf5732`) — both planes name one
  wire. Standing lesson for this file: a debt row is a claim with a shelf life, and a rewrite that
  only *adds* is not a rewrite (GT-4 2026-08-06, retired 2026-08-07).
- **Smoke row 13b (remote bubble → attach) is still skipped** — ~~the floor is ready and the
  check is honest (`remotePeer:"unavailable"`), but unskipping needs a PEER staged in the
  smoke harness, i.e. a second floor. Harness work GT-4 did not take (2026-08-06).~~ The check is
  still honest — `packages/electron-shell/src/testing/smoke.ts` reports
  `remotePeer: "unavailable"` with the monitor's own state and never fakes a host — but **the
  "ready floor" this row waited on was the in-process TSP1 serve, deleted at TM-1 `afc35b15`
  (correction 2026-09-14, the TM review's record lens).** Under T the row's subject changed: a 13b
  witness now means a SECOND desktop's cell, reached through that desktop's sidecar route by this
  deck's routed client. That is **TM-6, DEFERRED behind the goal** (TM-D6: a desktop has no tailnet
  socket of its own, and an outbound forward is uncosted). So the row waits on TM-6, not on harness
  work; the row's own comment in the smoke source still names GT-4's half, and rewording it is the
  deck lane's.
- **Two ghosttea petition candidates, unfiled and UNNUMBERED** — an unfiled browse-handler
  candidate: let a host inject the remote banner's browse handler (today, with the palette
  disabled, a mounted remote pane that ENDS renders a "Browse sessions" button that does
  nothing) so the monitor can be the door there too. And an injectable `MeshRuntime` seam, so the
  terminal mesh adapter need not hold the truffle node at construction — today a node arriving
  after the 20s budget does not attach until the pair bounces (GT-4, 2026-08-06). **G14 WITHDRAWN
  2026-09-14 at TM-5 `f7ecae67` (moot: the mesh adapter is gone from the floor and the phone's node
  is its own `FieldTruffleRuntime`);** ~~G13 stands.~~ **Correction 2026-09-14 (the TM review's
  record lens): this row's title reused TAKEN numbers, and "G13 stands" is false.** G13 is the
  ghosttea env-strip case-fold petition — drafted 2026-08-11, LANDED in ghosttea 0.10.1 and
  CONSUMED the same day — so that clause said nothing about a browse handler; the browse-handler
  candidate has never had a number and is named without one above. The `MeshRuntime` seam WAS
  filed, as **G26**, and withdrawn 2026-09-14 as moot under T (the TSP1 adapter and
  `with_terminal_mesh` left the floor at TM-1); the FILED **G14** is a different petition, the
  phone's `GhostteaTruffleRuntime` namespace, and its TM-5 withdrawal above is exact. Petition
  identities live in `draft/petitions/README.md` — read a number there before citing one.
- ~~**The attach path with the mesh gateway genuinely UP is unexercised** — that combination
  has never booted outside the probe's hand-built services (GT-4, 2026-08-06).~~ **PAID
  2026-09-14 at TM-2b `4848a39b`: the key-gated live probe (`terminal_cell_route_probe.rs`, on
  `TRUFFLE_TEST_AUTHKEY`) stands ephemeral tailnet nodes beside a real floor, cell and PTY and reaches
  `FramesLegAttached` with real rights through the real sidecar's proxy. Still beyond a headless run:
  the floor's OWN tailnet join (no auth-key path) and a foreign login at the allow-gate (a second
  account) — Phase 0's.**
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

- **History by project (PJ-4 phase B)**, both themes: the list's order and its folds, a row's marks and "n live",
  New agent's menu, ③'s folders by desktop, the chips, pin and hide in both places, rename and its refusal.
  Photographs: `/Volumes/SamsungRed/lanes/pj4/shots-final/` (the catalog plate and the smoke's own).
  - With it, his call on the sticky day-head band (photo `/Volumes/SamsungRed/lanes/room/shots-v3/band-column2.png`).
- **The timeline's past (TL)**: the seam, the past-moment words, the record's sentence under SINCE, the ended lane.
  The MV lead's page *The Timeline's Past* carries the captures and the eight marks TV-1…TV-8.
- **PK2 (P2)**: Godview's head, both themes, with the search circle 8 px below the 40 px bar.
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
  Studio makes this one command beside the real product; `pnpm dev:design:web` remains the
  daemon-free catalog-only loop (UI track, updated 2026-08-26).
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

**Wave 2's siblings (2026-10-10; James: "Merge").** rosetta and puppeteer each carry half of this landing, and
`siblings.lock.json` pins them as gated:
- **rosetta `2a91bf0`** (`facd8139`): branch `vf/history-wave2` = `vf/room-host-slots` `3449648` plus
  `vf/activity-route` `db6dd7e`, fifteen commits on main `eab2f57`. It holds the room's host inputs R1–R9, the
  exported reader, ROOM API v3 and `GET /api/activity`. PROTOCOL_VERSION 26 → 27 is lockstep with fieldd: a
  rosettad from before the pin reads `incompatible`.
- **puppeteer `c20a07d`** (`ba73674f`): branch `vf/timeline-past-view` = `vf/monitor-history-port` `a4f088e` plus
  the MV lead's nine view commits, thirteen commits on main `594d222`. A TV pick that changes pixels moves it once
  more: one puppeteer commit, one EL8 pin.
- As landed on 2026-10-10: rosetta main `2a91bf0`, puppeteer main `c20a07d`. No pin was re-made.
- Neither sha is on a remote branch, and mille's `c8160d5` (EL8 `45e63dbf`, 2026-10-08) is unpushed too. Until
  James publishes the siblings in the RL1(c) order above, `node scripts/siblings.mjs fetch` cannot create these checkouts on another machine.

**Four sibling branches await James (2026-10-01, DS wave 1 — still true after wave 2, whose DS-1b consumed RFC 026 on this side, so truffle's pin move is what flips `truffle-egress` ON; each pin move is its own EL8 event):** truffle `rfc026-egress` (5 commits on `9f0d628` = v0.7.14: RFC 026 egress, sidecar protocol 5 → 6, `Node::loopback`/`egress_*`, NAPI; consumed by VibeField's `TruffleEgress` arm only when the feature turns on — DS-1b — on a petition window that moves `truffle-core` AND the five npm sidecars together) · rosetta `feat/direct-plane-grants` (5 commits on `496bcdd`: RO-1 bearer + RO-10 grants; rosetta main is already PROTOCOL_VERSION 24 against the pin's 23 — the lanes ran a protocol-23 `rosettad` built at `/Volumes/SamsungRed/rust/ds-rosettad-pin`; the pin move carries 24 and the follower sends the bearer, review follow-ups in `petitions/README.md` RO-10) · puppeteer `feat/device-dimension` (5 commits on `a4b5290`: PU-17) · ghosttea `feat/geometry-take` (7 commits on `8a0930e`: G23's take, `takeGeometryOnFocus`). Reviews: `work/ds-wave1-review-2026-10-01.md`. ·

**The desktop's sidecar is a LOCAL OVERRIDE since P0-H (2026-09-25):** `.env`'s `FIELD_NATIVE_SIDECAR_PATH`
names `.vibefield/sidecar/sidecar-slim-0.7.14-ws-target-path`, truffle 0.7.14's `sidecar-slim` built with
petition T6's patch (the WebSocket forward keeps the route's target path). The pins below are UNCHANGED —
the five npm sidecar packages still read 0.7.14 and `siblings.lock.json` still names `9f0d6287` — so a
fresh checkout, or a `.env` without that line, runs the released sidecar and the phone is refused at its
hello. The exit is a truffle release carrying T6 and one EL8 event moving the npm rows to it; then the
override directory goes. ·

truffle `=0.7.12` (exact crates-io + exact platform sidecar packages; T2 consumed at AH-1) — **Erratum 2026-09-22: `=0.7.14` since UA-P-X 2026-09-16 (`723cb356`): `Cargo.toml` `truffle-core = "=0.7.14"` and the five npm sidecar packages at 0.7.14; the SwiftPM plane still reaches the same commit by path (G28). The manifests are the authority, never this clause** ·
ghosttea `=0.12.0` on the cargo and npm planes (GT-8b `b76644a0`, 2026-09-25; `=0.11.1` since the lockstep bump `85f7d769`; preflight pins the
cargo row and all four npm rows — *errata 2026-09-14, TM-1 `afc35b15`: this line said "+
**`ghosttea-truffle =0.11.1`**"; that crate LEFT the workspace with the TSP1 adapter when the
terminal mesh moved onto the cells' own doors (`thinking-terminal-mesh-cells.md`, TM-D1 ruled T), and
preflight's pin table forgot it at TM-1a `c2ba516f`*) while
`apps/ios/VibeFieldKit/Package.resolved` sits at **`0.10.1`** — NOT one version on all planes
(*errata 2026-09-12, the AR-0 review: this line had said `=0.9.2` "on all planes" since GT-4
2026-08-06 and trailed the manifests twice over; the manifests are the authority, read the
number there*) · **puppeteer `c20a07d` + rosetta `2a91bf0` since wave 2 (this section's first paragraph); before them puppeteer `594d222` (MV, `6bb7f22e`, 2026-10-08) + rosetta `eab2f57` (`be5a563b`, 2026-10-08) — *errata 2026-10-10: this clause went on naming `6392865` and `856bd80` through both of those moves; the lock is the authority, read the sha there.* Earlier: puppeteer `6392865` (2026-10-02, the sign-in usage refresh — was `2f5ce00` AR-5-1 2026-09-21, then the AR-S/AR-7/QL pins) + rosetta `856bd80` (2026-10-04, RO-13 + RO-14 merged — the `files` grant scope and the room's search props; main went on to `bf72978`, the room README, which nothing here builds; ON THE REMOTE — was `00b9786` 2026-10-03 evening, rosetta main with `@rosetta/room` merged — AR-8c; Rust, Cargo.lock and `clients/ts` byte-identical to `eecae7a`'s; before that `eecae7a` the same afternoon, the RO-1 + RO-10 merge `ee6724e` plus the Node-lib fix, protocol 26; `886baede` `c3c2c4a7` the same morning, `d3cf325` 2026-09-28 `0a8fab05` protocol 23, `e8d907a` AR-5-0 2026-09-13) = SIBLING CHECKOUTS pinned by SHA in `siblings.lock.json`, rosetta's read from the dedicated checkout `../rosetta-pin` since W-D10 (2026-10-03; `node scripts/siblings.mjs fetch rosetta` creates it once the pin is on the remote)** (AR-0, 2026-09-12; `pnpm siblings` prints the state, `pnpm siblings:pin` is the upgrade event — since 2026-10-04 it also typechecks the consumers; chopsticks 0.1.4 retired with the pivot; **puppeteer `b0f08ec` / rosetta `e8d907a` since AR-5b, 2026-09-13 (AR-5 pinned `5389449`) — the lock's package list gained `@vibecook/puppeteer-views`, the seventh `link:` row, whose React peers are checked by VERSION against this tree's copy, never counted as a second copy; `@rosetta/room` joined 2026-10-03 (AR-8c), and `check:deps` now also holds `@types/react`/`@types/react-dom` to ONE version across every linked sibling**) · strata **0.13.0** (via ICE;
the lockfile holds one physical strata/Loro graph) ·
`@vibecook/ice` **0.15.0** (an exact registry pin of a RELEASE — preflight refuses a `0.15.0-desk.N` for it; **moved by the
desk landing: 0.11.0 → 0.14.0 (DK-1, 2026-10-03) → `0.15.0-desk.1`…`desk.7` (DK-3…DK-17b, each exact) → `0.15.0` FINAL
(DK-18 `490357dd`, 2026-10-08; `latest`)** — from DK-4 on, the ICE1 probe's fixtures regenerated with each move; was 0.11.0 since
2026-08-25, the build-selected magnet grid; pin-drift history 2026-08-07: this line and `CLAUDE.md` had trailed the manifests
at 0.2.0) · **`apps/ios` carries its own pins** (*errata 2026-09-14, the TM review's record lens:
this clause read "`apps/ios` is in lockstep too (`Package.resolved`: ghosttea 0.9.2 / truffle
0.7.12), which is what retires the staleness debt above" — stale, and contradicted by this very
paragraph, which corrects the ghosttea number ten lines up.
`apps/ios/VibeFieldKit/Package.resolved` reads ghosttea **0.10.1** (revision `ad97fdb3`) and
truffle **0.7.12**; the phone is NOT in ghosttea lockstep with the cargo and npm planes at 0.12.0 (0.11.1 until GT-8b),
which is GM-D7, still open. The manifest is the authority — read the number there, never from this
line*). **The 0.9.2 release exists because of GT-4**: our
`=0.7.12` and upstream's `=0.7.11` could not resolve together, and James moved ghosttea to
meet us rather than the reverse — the exact-pin law producing a loud manifest error instead
of a silent `Arc<Node>` split. G7/G8/G9 consumed at NF-7; G11 filed→landed→consumed at GT-3f
in one day; G10 (spawn props) plus two UNNUMBERED candidates — a first-frame signal +
`prepare()`, and browse-handler injection — named and unfiled (*errata 2026-09-14, the TM review's
record lens: this list called those two "G12" and "G13" and called "G14" unfiled. All three numbers
are taken. **G12** is the `ghosttea-vt-sys` build fingerprint (landed in ghosttea 0.9.3, consumed);
**G13** the terminal env-strip case-fold (landed in 0.10.1, consumed); **G14** the phone's
injectable mesh runtime, FILED 2026-09-14 and WITHDRAWN at TM-5 `f7ecae67` — filed, not unfiled.
The Rust injectable-runtime seam this list meant by "G14" was filed as **G26** and withdrawn the
same day. `draft/petitions/README.md` is the authority on a petition number*); C7 implemented
upstream,
consumption rides AR. Full petition status: `petitions/README.md`.
