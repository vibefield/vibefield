# The desk landing's gates

DK-18, the desk migration's Phase 5 (`draft/thinking-desk-migration.md` §5, "the gates on the final SHA"): every gate the
cutover of `desk/landing` needs, what each proves, where it runs, and its verdict at the landing SHA. Two commands run them.

- **`pnpm verify`** — THE gate (CLAUDE.md, "Commands"), CI's: the stages below in one `&&` chain. It stops at its first red,
  and `preflight` is red in every worktree whose sibling checkouts are off their pins (ghosttea's today), so a worktree's grade
  runs the stages ONE AT A TIME — `pnpm gate:landing --with-stages` does, every one even after a red, and says a red that is
  MAIN's known row as main's (`red — main's: …`, still counted red).
- **`pnpm gate:landing`** — the landing-only gates, by ICE's example (its `gate:landing`: required at every landing, out of
  `ci` because it needs a GPU): `pnpm still` and every desktop smoke, in order, ONE AT A TIME, each a fresh process with Nx's
  cache and daemon off (`NX_SKIP_NX_CACHE=true NX_DAEMON=false`), each smoke on its own temporary profile with its run's
  daemons stopped by its teardown and held gone by its launcher's row. One verdict line a gate, the run's own words for its
  result under it and its log's path (the test stage: every project's count, and a project whose count Nx did not print
  said so); exit 1 on any red. Each gate runs in its own process group, and one still running after `--timeout-min` (30)
  is stopped WHOLE — SIGTERM to the group, as the kit's `try` stops the app; the smoke launchers forward it to Electron and
  still take their daemon row — and RED: a hung gate never holds the list. A ^C (or a SIGTERM) to the script stops the
  running gate the same way, hears its teardown, starts no gate after it, and says `"stopped"`. `--only a,b` and
  `--from <gate>` run a part, `--list` prints the list, `--logs <dir>` keeps the logs there (default: a fresh directory under
  the OS temp, named on the first line). The Mac is kept awake while it runs (`caffeinate -w`). Run it on a quiet machine:
  other sessions' Electron and vitest load the timing rows, and a timing row red under load is re-run at a quiet moment before
  it is called (the K-H rule).

## The list

Verdicts at `f1c026a4` (2026-10-08 08:43–08:59Z, `pnpm gate:landing --with-stages`, one run; load 7 at the start, 94 under
the test stage). The commit after it adds this document and CLAUDE.md's lines for it — no code. Every smoke's `SMOKE_DAEMONS`
said `"left": []`.

| # | Gate | Command | What it proves | Where | Verdict |
|---|---|---|---|---|---|
| 1 | preflight | `pnpm preflight` | tool versions (cargo-typify), the EL8 pins (ICE `0.15.0`, truffle, ghosttea, loro), the sibling checkouts at `siblings.lock.json`'s pins, the import walls, the agent catalog (R23) | CI · every checkout | red — MAIN's (exit 1): ghosttea at `10d0b17bbc14`, the lock pins `8a0930e86fc7`; the same row alone on main's tip |
| 2 | check:walls | `pnpm check:walls` | the import-boundary walls ON THEIR OWN (R1–R25, `--self-test` then `--enforce`) — a red preflight never hides them again (plan (85)) | CI | ok — self-test passed, clean |
| 3 | check:deps | `pnpm check:deps` | one copy each of loro-crdt, ICE, strata, react (EL8's single-copy law) | CI | red — MAIN's (exit 1): the second loro / ICE / strata copies all under the main checkout's `node_modules` (FS-1b's mille links); the same three rows on main's tip; this checkout's own one each |
| 4 | check:retired | `pnpm check:retired` | no name the retire table deleted comes back in code (DK-17) | CI | ok |
| 5 | check:ios-fixtures | `pnpm check:ios-fixtures` | the iOS kit's fixture and registry copies equal contracts' | CI | ok — 20 registry values identical |
| 6 | icons:check | `pnpm icons:check` | the app's icon set current | CI | ok |
| 7 | typecheck | `pnpm typecheck` | every project's tsc (25 projects) | CI | ok — 25 projects |
| 8 | lint | `pnpm lint` | biome over the workspace | CI | ok — 1,976 files, no error (35 warnings, none in a file DK-18 changed) |
| 9 | fmt | `cargo fmt --check` | the Rust workspace formatted | CI | ok |
| 10 | lint:rust | `pnpm lint:rust` | clippy at `-D warnings` | CI | ok |
| 11 | bundle:assert | `pnpm bundle:assert` | the renderer's initial chunk budget, World and History lazy, three nowhere | CI | ok — initial 764.1 KB raw / 191.6 KB gz; World, History lazy |
| 12 | test | `pnpm test` | every project's suite — the ICE1 envelope probe among fieldd's (its fixtures written at the pinned ICE) | CI | red (exit 1) under load 94: fieldd `2 failed \| 1907 passed` — AR-7b row 1 (MAIN's: the same assertion on main's tip) and `service-drain-deadline` "expected 209 to be less than 175" (a timing bound; alone, twice: green). ALONE after: fieldd `1 failed \| 1908 passed \| 23 skipped` — AR-7b alone; field-app `1890 passed \| 1 skipped` (Nx printed only 64 KiB of it in the stage; its exit there 0); the other 23 projects green in the stage |
| 13 | test:rust | `pnpm test:rust` | the cargo workspace's tests | CI | ok — 302 passed, 9 ignored, 23 suites |
| 14 | gen:check | `pnpm gen:check` | the generated contracts, the plugin authoring docs and the ghostty keys fresh | CI | ok |
| 15 | still | `pnpm still` | the playground's Dawn stills against their goldens — the clock's and the pad's (with its writing, I35) — host-bound: Metal, `webgpu` 0.4.0, `@napi-rs/canvas`'s darwin-arm64 binary (plan (45)) | landing | ok — 10/10, byte for byte |
| 16 | smoke | `pnpm smoke` | the shell boots the pair on its own profile: fieldd healthy, field-native connected, its units up | landing | ok |
| 17 | smoke:canvas | `pnpm smoke:canvas` | THE DESK in the product, GPU on — boot, pixels, theme, the freeze, idle, presence at rest, the bar, tools in hand, the pegboard, the TAKE rows (below), Send to…, the thumbnails, the REST rows, the covers, peers across two windows, the device's faults, the pad, the retry, the refusal | landing | ok (292 s): TAKE 8/8; LANDED min 5.1 ms (250); REST still 318 ms, wind 22,041 ms, cover 102 ms; PEERS IDLE hid at 8,038 ms; COVER_BUDGET 34 / 25 / 25 ms (240); ISOLATION: neither window ever the key window |
| 18 | smoke:canvas:no-gpu | `pnpm smoke:canvas:no-gpu` | `--disable-gpu`: the heal's three retries, then the no-adapter card in the canon's words, a cover over a desk that never drew (plan (77); reuses smoke:canvas's build) | landing | ok |
| 19 | smoke:canvas:no-webgpu | `pnpm smoke:canvas:no-webgpu` | `--smoke-no-webgpu` (the page given no `navigator.gpu` — Electron 43 hides WebGPU by no switch): the no-WebGPU card, said once, no retry (plan (77); reuses smoke:canvas's build) | landing | ok |
| 20 | smoke:kind-faults | `pnpm smoke:kind-faults` | a plugin's broken kind refused at create and a faulty one struck at 3 of 3 — the desk drawing on (DK-9) | landing | ok |
| 21 | smoke:plugin-restart | `pnpm smoke:plugin-restart` | a plugin with kinds enabled, disabled, updated and regressed, the desk remounting; fieldd restarted under two windows, the soak (DK-9) | landing | ok |
| 22 | smoke:plugin | `pnpm plugin try examples/plugins/desk-clock` | the try board as an author runs it (DK-10): the kit stages the example clock ALONE in a dev root of its own and runs `pnpm smoke:plugin` on a fresh profile — its kind laid on a fresh board, made on the host's device (its WGSL compiled), picked on the drawn frame. A bare `pnpm smoke:plugin` stages nothing and says so | landing | ok — "DRAWN … picked across 144 × 144 CSS px" |
| 23 | smoke:godview | `pnpm smoke:godview` | Godview against the real pair: panes born, split, closed through the workspace's doors; the typed agent in a pane; the line's keys (B on the canvas raises Objects and puts it away — GPU-less here, so the frame's Objects surface: DK-18 re-aimed the row off the tray island DK-13 deleted) | landing | ok |
| 24 | smoke:terminal-door | `pnpm smoke:terminal-door` | the cell's T1 doors admit the packaged renderer's Origin from the document and a worker (TP-S3a) | landing | ok |
| 25 | smoke:terminal-direct | `pnpm smoke:terminal-direct` | Godview's direct terminal proof | landing | ok |
| 26 | smoke:studio | `pnpm smoke:studio` | the Studio's physical acceptance — product and Studio sessions and preloads apart, a real appearance edit applied, replayed across a reload, restored when Studio closes — on a FRESH dev root (plan (88), below) | landing | ok — `STUDIO_PHYSICAL` ok, the fresh root removed |
| 27 | the product desk rig | rows of smoke:canvas (TAKE, LANDED) and the census below | each kind taken off the pegboard by the pointer and drawn where it lands; the take's landing timed by the K-H discipline | landing | with #17 |
| 28 | the two-desktop check | James's steps, below | presence across two DESKTOPS over a real mesh; (20)'s stamp-wait drop; a real pointer in the `.app-drag` strip | two Macs | not runnable on one Mac (below) |

`pnpm verify`'s chain is rows 1–14 in that order. `pnpm gate:landing` is rows 15–26; `--with-stages` puts 1–14 first.

## The hygiene every smoke keeps

- **Its own profile** (DK-5): `apps/desktop/packaging/run-smoke.mjs` mints an Electron profile under the OS temp, hands it as
  `--user-data-dir`, removes it once Electron has exited (`SMOKE_PROFILE_REMOVED`). The app's shared profile is never touched.
- **Its daemons stopped, and waited for** (plan (39)): the run is MARKED — `VF_SMOKE_RUN`, the profile's name, in Electron's
  environment, inherited by every process the smoke starts (fieldd, field-native, its terminal cells, fieldd's workers). The
  smoke's teardown (`packages/electron-shell/src/testing/smoke-daemons.ts`) finds the run's processes by the mark after the
  supervisor's stop, asks the ones whose parent is gone, and WAITS for every one (`SMOKE_TEARDOWN`): the supervisor never waits
  for the field-native it signals (its drain of a live session took 4.1 s), and never signals one a restarted fieldd adopted.
  **The row**: once Electron has exited, the launcher lists what still carries the mark — anything but Electron's own Chromium
  children is LEFT, said (`SMOKE_DAEMONS`), reaped, and the run red (`apps/desktop/packaging/smoke-daemons.mjs`).
- **Its home**: the `vf-smoke-*` VibeField root under `/tmp` (the daemons' unix sockets need the short path) is removed whole
  when the run is green; a red run keeps it — its logs — and `SMOKE_HOME` names it. Nobody sweeps homes by birth time again.
- **Its windows kept from the person's input** (plan (36)): the desk smokes' windows are click-through
  (`setIgnoreMouseEvents`) and shown inactive, and no row makes one the key window (`packages/electron-shell/src/testing/
  smoke-window.ts`; held in the source by `smoke-window.test.ts`). The smoke's own input goes in by `sendInputEvent`, which
  needs neither: KEYS witnesses the event-less focus path (plan (94)). `SMOKE_CANVAS_ISOLATION` says how often a window became
  key anyway — the OS activates the app when another app quits, and a person may click its Dock icon; said, never judged.
  The godview smoke keeps its focus (its typed rows need `document.hasFocus()`) and gets the pointer half.
- **smoke:studio on a fresh dev root** (plan (88)): the Studio acceptance runs the DEVELOPMENT runner, which kept all its state
  in the checkout's persistent `.vibefield/dev`. `VIBEFIELD_DEV_ROOT` moves that root whole (`tooling/dev-runner/src/paths.mjs`),
  and `apps/desktop/packaging/run-studio-smoke.mjs` mints one under `/tmp` per run, gives it one user already onboarded (the
  users package's own mint, as main mints a smoke's — the dev shell would otherwise hold its boot on the Setup Assistant), marks
  the run, takes the same daemon row once the runner has exited, and removes the root (kept and named when red).
- **The perf lab's profile** (plan (5)): `pnpm perf:terminal` mints ONE profile per run under the OS temp, hands it to every
  launch of the run, and removes it when the run ends (`TERMINAL_PERF_PROFILE`). "Warm" is a second launch within the run —
  the native control's VibeField arm reuses the run's profile — never a kept profile.
- **The cargo target**: the smokes run `target/debug/field-native`, and `target` is the machine's SHARED cargo target
  (`/Volumes/SamsungRed/rust/target`, main's checkout's too), so a smoke runs whichever checkout built it last — and cargo
  does NOT rebuild on switching checkouts: its dep-info paths are package-relative, so a crate is fresh when this checkout's
  sources are older than the other's last build. DK-18 met it: a control worktree of main built there (fieldd's global setup
  builds field-native), and this checkout's next `cargo test` linked MAIN's `field_native` (`layout_vector` red: two layout
  constants PJ-3 added on main) and its `field-native` binary stayed main's. Before gating after another checkout built into
  the target, `touch` the Rust sources that differ and `cargo build -p field-native` (its binary's mtime moves); a control
  worktree is better on a target of its own (`CARGO_TARGET_DIR`). The lane's field-native differs from main's tip only by
  those two constants (`packages/field-native/src/registries.rs`).

## The doors (plan (74))

Smoke-only doors. The product never loads these queries, never reads these variables, and its own code calls none of the hooks.

| Door | Opens |
|---|---|
| `?presenceRelay=1` | `__vfDesk.presenceTap()` / `presenceApply(payloads)` / `presenceFirst()`: the PEERS rows play the mesh between two windows of one shell, since two windows of one desktop share no presence room. |
| `?deskFaults=1` | `__vfDesk.gpuFault("lose" \| "error")`: the FAULT rows lose the layer's own device or raise one uncaptured validation error on it. |
| `?deskSeedExamples=1` | the first board lays the example plugin's clock beside the six (the CLOCK row). |
| `?deskRefuseFirstDevice=1` | the boot's first mount gets an adapter request that answers null, as a late GPU process's does (the RETRY row). |
| `?deskRefuseDevice=N` | the first N mounts get an adapter that refuses its device (the REFUSED row). |
| `?deskTry=<types>` | the try board lays one object of each named type, alone (`pnpm smoke:plugin`, `vibefield-plugin try`). |
| `?godviewMarkers=1` | the renderer prints Godview's markers (the godview smoke and the perf lab). |
| `__vfDesk.whenParked(ms)` | a gate hook: resolves at the frame gate's own park announcement (ICE I41, `frame.onParked`) — what the cover and freeze rows wait on, never a poll. |
| `__vfDesk.coverCaptures("nothing")` | the cover's own capture answers nothing, as a lost device's does (COVER LOST). |
| `__vfDesk.ambient(mode)` | the wind's policy: `live` makes the desk busy (FREEZE, the covers), `still` stills it (TAKE, REST). |
| `--smoke-no-webgpu` | the window's DevTools protocol takes `navigator.gpu` from every new document (the no-WebGPU card). |
| `VF_SMOKE_RUN` | the run's mark (run-smoke.mjs, run-studio-smoke.mjs): the teardown and the daemon row find the run's processes by it. |
| `VIBEFIELD_DEV_ROOT` | the dev runner's whole state root (smoke:studio's fresh one). |
| `VF_SMOKE_SHOT_DIR` | where a smoke keeps its stills (`dk-3-desk-light.png`, `dk-18-take-<type>.png`, …). |
| `VF_SMOKE_DEBUG` | the renderer's console passed through. |

## The product desk rig — the census

§5 Phase 5 named the rig: "an Electron harness that opens a fixture board, places each kind, drags one off the pegboard, holds
one, and compares stills — the K-H discipline for timing rows". The census mapped its five acts onto the rows already there
FIRST; the two with no row were built as smoke:canvas's TAKE rows (`packages/electron-shell/src/testing/smoke-desk-rig.ts`).

| Act | Witnessed by | Built at DK-18 |
|---|---|---|
| opens a fixture board | `SMOKE_CANVAS_SEED` (the first board's seed: the six kinds, one each), `_CLOCK` (the example plugin's kind on it, drawn and picked), `_BOOT`, `_PIXEL`, `_PAD_REOPEN` (the board reopened after a renderer replace, the pad's line back); smoke:plugin-restart's two windows; smoke:plugin's try board | — |
| places each kind | the seed lays six (nobody's hand); KEYS lays ONE by ⏎ (the tray's own `lay`) | **TAKE**: every kind the board hangs (eight: the comment pad, the note, the photo, the notebook, the calendar, the mini mat, the whiteboard, the example clock), placed by the pointer: one more, the one selection under the release, the board folded, the kind unfaulted, its face drawn there (the region's share it changed, its colours and contrast — never a hash), one undo step back |
| drags one off the pegboard | none (KEYS is the keyboard's path) | **TAKE**: the press on the specimen where the last frame drew it, the drag up off the board, the release where nothing picks — for every kind |
| holds one | `SMOKE_CANVAS_HAND_*` (each specimen picked up, its tools used, put down; the travel and the flight home timed), `_SEND_HAND` | — |
| compares stills | `SMOKE_CANVAS_QUARTER` (the explorer's quarter still is the desk, smaller), `_THUMB` (a thumbnail is the desk without the selection's marks), `_THEME` (the stills by day and night), `pnpm still` (the Dawn goldens) | TAKE's before/after region per kind |
| the K-H discipline for timing rows | COVER_BUDGET (240 ms), PEERS EXIT (one publish), IDLE (8 s) | **LANDED**: release → the object counted, the budget (250 ms) on the MINIMUM over the kinds, the median and the load beside it, a red minimum measured again once (D-KH.3) |

## The two-desktop check — James's steps (plans (20), (78), (95))

**Why not on one Mac.** Presence crosses DESKTOPS: fieldd's `PresenceRoomRouter` fans a desktop's presence out to the OTHER
desktops on the mesh, and the writer lock refuses a second local writer of a board, so two windows of one shell can never meet
(smoke:canvas plays the mesh between its two windows by `?presenceRelay=1` instead). Two SHELLS on one Mac — two temp
profiles, two fieldd daemons, two VibeField roots — would each need its own tailnet node, and the floor cannot join a tailnet
headlessly: field-native's mesh service builds its node only through `build_with_auth_handler`, an INTERACTIVE browser login,
with no auth-key path (`packages/field-native/src/services/mesh.rs`, the E-F1 seam's own note; only the `#[ignore]`d probes
build nodes from an auth key, outside the floor). fieldd's own two-desktop tests (DS-3's `mesh-board.e2e.test.ts`: two REAL
daemons on one Mac) join them IN PROCESS — a mock management server names each the other's peer, and injected WebSocket
constructors route each one's tailnet coordinate to the other's loopback door — a seam no shell can reach. Giving the floor
an auth-key path, or the shell a loopback mesh, is a product change, out of this slice. So the check is a person's, on two
Macs, and **the enable stamp's wait (plan (20)) stays** until it has run.

**Before:** both Macs on the cutover's SHA (DK-19 upgrades them together — an older build beside a desk.6+ one draws its peer as
if on the root and never away, until 8 s idle; plan (93)), both linked to the SAME tailscale account in Settings (one local user
per account on each Mac), both on the same tailnet, the desktop app on each. Call them A and B.

1. **Open the same board on both.** On A open a board; on B open the same board from the fields explorer. Each desk draws the
   other's objects; an edit on one appears on the other within a second.
2. **B's pointer in A.** Move the pointer over B's desk. On A, B's arrow follows it, its chip the face then the name, in the
   chrome's ink; it sits where B's pointer is on the board (same object under both pointers).
3. **Idle.** Leave B's pointer still. On A, B's arrow hides about 8 s after B's last move — not before 7.5 s.
4. **Away by the desk.** Move B's pointer off its window from a point on the desk. On A, B's arrow hides at once.
5. **Away by the chrome (I44).** Move B's pointer onto B's line (the composer), then out of the window. On A, B hides at once
   (not after 8 s). Repeat through a head control, and through the window's drag strip at the top.
6. **The drag strip, a REAL pointer (plan (95)).** With B's pointer on B's desk, move it straight up INTO the `.app-drag` strip
   (the bare strip at the window's top, no control under it) and stop there, inside the window. Watch A: if B hides at once,
   a real pointer entering a drag region makes Chromium send the page a leave (the smoke's injected input cannot say); if B
   stays drawn until 8 s idle, it does not. Write down which.
7. **Covered.** On B open Godview (⌘2). On A, B hides (B's own view is covered). Back to Canvas on B (⌘1): B shows again when
   it moves.
8. **Another canvas.** On B enter the mini mat (double-click it). On A, B hides unless A is inside the same mini mat; enter it
   on A too, and B's arrow shows there.
9. **The board.** On A raise the pegboard (⊕ or B). B's arrow hides under it; fold it, and B shows again.
10. **A plugin's pack while another desktop holds the board — (20)'s stamp wait.** With the board open on BOTH, on A enable in
    Settings a plugin with an object kind this board has never held, and try to place one from A's pegboard. Today A draws the
    kind at once but its pack waits to be stamped on the board while B holds it open (A's log:
    `renderer.board.capabilities_waiting` — "Another desktop holds this board open: its new packs wait for the board's next
    open"), so the placing waits too. Then: does B learn the pack live — its board reopening on its own with the kind drawn,
    not the missing face — or only when a person reopens it? Close the board on B: A's pack is stamped at the next open. Write
    down (a) whether A's placing waited while B held the board, and (b) whether B learned the pack without a person. If (b)
    holds, every desktop learns packs live and the wait can go (its own commit); if not, it stays.
11. **The pointer isolation, for the smokes (plan (36)).** While `pnpm smoke:canvas` runs on either Mac, move the real pointer
    across its window: the pointer passes through to what is beneath (the smoke's window takes no click), and the smoke's
    `SMOKE_CANVAS_PRESENCE_REST` says `wakes: {}`.

Report each step's result beside its number.

## Edges said, not gated

- **The remount edge** (ICE I44's builder; DK-17b mapped it). A freshly mounted desk's pointer adapter has heard no mouse fact,
  so a pointer that leaves the window off the CHROME (never crossing the remounted desk) says nothing — VibeField remounts on a
  live engine at the degraded banner's and the card's Reload, at the desk's retry, and when a plugin's kinds go off and on, and
  in each the pointer is on the chrome (the line's Reload, the card's button, the Settings sheet). Today a peer in that state
  hides by IDLE (8 s), not at once. A candidate ICE ask — a `leave` with no point — not filed.
- **The desk's long wake after an act** (plan (24)) — measured and held by smoke:canvas's REST rows: the desk stays awake 20 s
  after the last TOUCH (a pointer move, a camera move or gesture, a nav, a re-dress) and eases out over 2 s — ICE's ambient wind
  in its `idle` mode (design-015 D-D9), the canon's (DESIGN.md §6 M5). With the wind stilled the desk rests 0.3 s after a move;
  a cover lowered over a still wind rests at once; a cover lowered INSIDE the wind rests by the touch's 22 s (2,277 frames
  after the lowering — DK-9's ≈ 2,370). The explorer's owed still waits for that rest (DK-4's policy), so a thumbnail follows
  an edit by ≈ 22 s: James's call whether it should.
- **Timing rows met under load** (each re-run at a quiet moment, said where it happened): SEND_BAR's 40 ms step-aside bound
  read +40.x ms once (load 23–44); THUMB's undo still (30 s for a still the wind delays to ≈ 22 s after the last touch) once;
  fieldd's `service-drain-deadline` (PRC-2) "expected 209 to be less than 175" in the final run's test stage (load 94) —
  alone, twice, green.
- **A hang met once** (fixed): DK-16's PEERS GONE destroyed window B under the presence relay; an `executeJavaScript` in
  flight when its window is destroyed never settles (Electron 43.1.1), so smoke:canvas could wait for ever after
  `SMOKE_CANVAS_PEERS_COUNTERS`. GONE stops the relay first now; and a gate that hangs anyway is stopped at `--timeout-min`.
