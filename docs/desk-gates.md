# The desk landing's gates

DK-18, the desk migration's Phase 5 (`draft/thinking-desk-migration.md` §5, "the gates on the final SHA"): every gate the
cutover of `desk/landing` needs, what each proves, where it runs, and its verdict at the landing SHA. Two commands run them.

- **`pnpm verify`** — THE gate (CLAUDE.md, "Commands"), CI's: the stages below in one `&&` chain. It stops at its first red,
  and `preflight` is red in a worktree whose sibling checkouts (`../rosetta-pin`, `../mille-pin`) are off their pins
  *(corrected 2026-10-28, the housekeeping pass: this named ghosttea's, released on every plane since the EL8 to 0.13.1)*, so a worktree's grade
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
  it is called (the K-H rule). `VF_PERF_LOCKS=<path>[:<path>…]` names lock files a perf measurement holds while it owns the
  host: before EACH gate the run waits while any of them exists, and says so (`GATE_WAIT <gate> waits: …` and `… waited
  <n>s`); a lock that appears mid-gate is met at the next gate's start. The paths are this host's and the caller's, never the
  script's; unset, the run is as it was (DEBTS, 2026-10-14).

## The list

Verdicts at `c60f6448` (2026-10-08 08:43–08:59Z, `pnpm gate:landing --with-stages`, one run; load 7 at the start, 94 under
the test stage). The commit after it adds this document and CLAUDE.md's lines for it — no code. Every smoke's `SMOKE_DAEMONS`
said `"left": []`.

| # | Gate | Command | What it proves | Where | Verdict |
|---|---|---|---|---|---|
| 1 | preflight | `pnpm preflight` | tool versions (cargo-typify, rustc per `rust-toolchain.toml`), the EL8 pins (ICE, truffle, ghosttea, loro — the numbers are the manifests'), the sibling checkouts at `siblings.lock.json`'s pins, the import walls, the agent catalog (R23) | CI · every checkout | red — MAIN's (exit 1): ghosttea at `10d0b17bbc14`, the lock pins `8a0930e86fc7`; the same row alone on main's tip |
| 2 | check:walls | `pnpm check:walls` | the import-boundary walls ON THEIR OWN (R1–R30, `--self-test` then `--enforce`; the range refreshed from R1–R25 on 2026-10-31) — a red preflight never hides them again (plan (85)) | CI | ok — self-test passed, clean |
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
| 17 | smoke:canvas | `pnpm smoke:canvas` | THE DESK in the product, GPU on — boot, pixels, theme, the freeze, idle, presence at rest, the bar, tools in hand, the pegboard, the TAKE rows (below), Copy (the Copy rows, `smoke-desk-copy.ts`, since HN-3), the picture Copy rows (CLOCK, TWO, HAND, MISSING: each PNG judged taken by main's picture door, since HN-5) and DROP (a card let go on the desk's clear ground, LC-17), the thumbnails, the REST rows, the covers (RIM's strip in the head band since HN-8; the bar 16 from the sides), peers across two windows, the device's faults, the pad, the retry, the refusal | landing *(corrected 2026-10-30, FG-1's landing: run on the Mac mini's M4 over ssh, the gate host, its console unlocked and nobody at it)* | ok (292 s): TAKE 8/8; LANDED min 5.1 ms (250); REST still 318 ms, wind 22,041 ms, cover 102 ms; PEERS IDLE hid at 8,038 ms; COVER_BUDGET 34 / 25 / 25 ms (240); ISOLATION: neither window ever the key window · *HN B1, B2 and B3 (2026-10-31): not run at their landings (runs 22, 26 and 28, the console locked); run 30b (M30 `c8e4c55eb`) ran their rows green but for the four HAND rows (item 123); run 35b (M35 `733f24ed5`, 2026-10-31 05:51:07Z, exit 2) read all four HAND rows right — item 123 ✓ ×4 — with ONE problem, HAND_WHITEBOARD's bar back at 251 ms (item 117's class, the fixer's); run 38b (M38 `5321b12ac`, 06:43:33–06:58:51Z, exit 2) held item 123 again, Copy's tips `Copy  ⌘C` ×5, its only reds item 117's HAND_BACK (whiteboard 250.2 ms, notebook 233.6, calendar 233.5, clock 217.0, against 200) and the 10-26 IDLE class, neither HN's* · *item 116 (2026-10-31): run 38b is the census's first live run — ONE census, which asked field-native and rosettad, killed none and left none (`SMOKE_DAEMONS {left:[], reaped:[], helpersSettledMs:0}`; LANDED "item 116")* |
| 18 | smoke:canvas:no-gpu | `pnpm smoke:canvas:no-gpu` | `--disable-gpu`: the heal's three retries, then the no-adapter card in the canon's words, a cover over a desk that never drew (plan (77); reuses smoke:canvas's build) | landing | ok |
| 19 | smoke:canvas:no-webgpu | `pnpm smoke:canvas:no-webgpu` | `--smoke-no-webgpu` (the page given no `navigator.gpu` — Electron 43 hides WebGPU by no switch): the no-WebGPU card, said once, no retry (plan (77); reuses smoke:canvas's build) | landing *(corrected 2026-10-30, FG-1's landing: run on the Mac mini's M4 over ssh, the gate host, its console unlocked and nobody at it)* | ok |
| 20 | smoke:kind-faults | `pnpm smoke:kind-faults` | a plugin's broken kind refused at create and a faulty one struck at 3 of 3 — the desk drawing on (DK-9) | landing | ok |
| 21 | smoke:plugin-restart | `pnpm smoke:plugin-restart` | a plugin with kinds enabled, disabled, updated and regressed, the desk remounting; fieldd restarted under two windows, the soak (DK-9) | landing | ok |
| 22 | smoke:plugin | `pnpm plugin try examples/plugins/desk-clock` | the try board as an author runs it (DK-10): the kit stages the example clock ALONE in a dev root of its own and runs `pnpm smoke:plugin` on a fresh profile — its kind laid on a fresh board, made on the host's device (its WGSL compiled), picked on the drawn frame. A bare `pnpm smoke:plugin` stages nothing and says so | landing | ok — "DRAWN … picked across 144 × 144 CSS px" |
| 23 | smoke:godview | `pnpm smoke:godview` | Godview against the real pair: panes born, split, closed through the workspace's doors; the typed agent in a pane; a card played into a real pane (11h, re-aimed from the line's send at HN-4: pasted, no marker before the harness's Return, the nonce after); a program's OSC 52 printed in a pane reaching main's copy door from the marked run, with no card (11j, HN-5); *(corrected 2026-10-31, run 38b: this cell also named "the Hub in the head: the package circle grows the pill's sheet on Artifacts (HN-8)", from HN B3's records `623dbded2`; no rung of this row does that, nor ever did, and the rung is owed — ROADMAP §5)*; the line's keys (B on the canvas raises Objects and puts it away — GPU-less here, so the frame's Objects surface: DK-18 re-aimed the row off the tray island DK-13 deleted) | landing | ok · *HN B1, B2 and B3 (2026-10-31): not run at their landings (runs 22, 26 and 28, the console locked); run 35b (M35 `733f24ed5`) went red at 05:52:34Z at QL-2's launch rung — item 124, fixed 2026-10-31 by `5321b12ac` (LANDED "Item 124") — before 11h and 11j; run 38b (M38 `5321b12ac`, exit 0 at 07:00:52Z, the console unlocked for the whole row) ran them green: 11h ✓ on all four rungs (B: the pane typed it, the line took nothing; the card: pasted into work, not run until the pane's own Return, then the shell ran it, 1 card cleared; ⌘T: the line asked the deck, a new shell in the focused pane, which never heard it; B on the canvas: Objects rose behind the line, B again put it away) and 11j ✓ (OSC 52 in a pane → writeClipboard → main's copy door, kept, not written; no card); the Hub in the head has no rung here (the correction above), so its witness is owed (ROADMAP §5)* · *item 124 (2026-10-31): run 38b's launch rung PASSED — `SMOKE_GODVIEW_LAUNCH` "Claude Code" is-home at 132 ms (35b: is-refused at 130 ms), landed 556 ms, fieldd's runtime_error 0 and no UNSUPPORTED_LAUNCH; the births walked the door path (the stub now declares the four flags), so the relaunch without the door is witnessed by fieldd's unit rows only (`agent-door-launch.test.ts`), not by this row* · *run 39b (M39 `30d610136`, smoke:godview alone, green at 07:11:21Z): 11g viewKeys ✓ ("4" godview → assistant, moved, the pane never hearing it: SP-1b's ⌘4 → Chat; "1" canvas moved; "2" stayed; "3" history moved), and again 11h ×4 ✓, 11j ✓ and 124's launch (is-home 128 ms, landed 544 ms)* |
| 24 | smoke:terminal-door | `pnpm smoke:terminal-door` | the cell's T1 doors admit the packaged renderer's Origin from the document and a worker (TP-S3a) | landing | ok |
| 25 | smoke:terminal-direct | `pnpm smoke:terminal-direct` | Godview's direct terminal proof | landing | ok |
| 26 | smoke:studio | `pnpm smoke:studio` | the Studio's physical acceptance — product and Studio sessions and preloads apart, a real appearance edit applied, replayed across a reload, restored when Studio closes — on a FRESH dev root (plan (88), below) | landing | ok — `STUDIO_PHYSICAL` ok, the fresh root removed |
| 27 | the product desk rig | rows of smoke:canvas (TAKE, LANDED) and the census below | each kind taken off the pegboard by the pointer and drawn where it lands; the take's landing timed by the K-H discipline | landing | with #17 |
| 28 | the two-desktop check | James's steps, below | presence across two DESKTOPS over a real mesh; (20)'s stamp-wait drop; a real pointer in the `.app-drag` strip | two Macs | not runnable on one Mac (below) |
| 29 | smoke:bundled | `pnpm smoke:bundled` | a bundled plugin loads through the staged path under a verified index; a corrupted copy is refused on its row; a forged index refuses the root (WP8d, W7). `apps/desktop/packaging/stage-bundled-fixture.mjs` stages the app's own plugins as a package carries them (the stage's producer, DEV keys minted in memory, nothing secret written) and launches smoke:canvas `--bundled --disable-gpu` THREE times, each on its own copy keyed to that root alone (`FIELDD_PLUGIN_ROOTS` the copy, `FIELDD_PLUGIN_DEV_ROOTS` empty, `FIELDD_TRUST_ROOT`/`_KEYS`): **loads** — every bundled row `enabled` with its provenance block, `stagedPlugins` = the renderer-bearing plugins, no root problem; **corrupt** — one byte of `vibefield.browser`'s `dist/renderer.js` flipped: that row `invalid` `PLUGIN_ARTIFACT_MISMATCH` naming the file, the others (the browser pane, the pad) enabled and staged; **forged** — the same flip, its hash written into the index and the index re-signed by a stranger's key: 0 bundled rows, 1 root problem naming the signature, 0 staged. One `SMOKE_BUNDLED {…}` line a run; `BUNDLED_FIXTURE_DONE` the three exits | landing | not yet run |
| 30 | smoke:update | `pnpm smoke:update` | WP12f (W9; `draft/specs/build-wp12-updater.md` §14): a DEV-keyed PACKAGED app — the zip a person downloads, staged on the run's own trust-root (`--dev-trust-root`; keys minted in memory, nothing secret written), unzipped per run — against the loopback fixture update origin (`apps/desktop/packaging/update-fixture.mjs`), five runs judged from OUTSIDE the process (a package hosts no smoke harness): **staged** (`desktop.update.staged` names N and the signed feed's sha512, the updater's cache repeats it, the zip asked for once; Squirrel's first touch at download completion said, R6) · **feed-unverified** · **policy-rollback** · **killed** · **channel-unresolved** — no payload asked for on runs 2–5. **quit** (AU-5, 2026-10-30, `a4688b7c9`) is OPT-IN, named only in `--runs` (`--runs quit`) and never in the default five (LC-29): the good chain staged with no confirmation lever, then a person's quit (a quit Apple Event to the run's pid, `NSRunningApplication terminate`, never a signal), judged from outside by `judgeQuit`: the census gate ran, a pair stopped, and only then Squirrel took the run's random bytes and refused them; `state.json`'s lastApply exited · squirrel-refused · quit; exit 0 and no relaunch in 10 s. Its trigger is unverified unattended (macOS may ask to allow the Apple Event, Automation), so it stays opt-in, and the install itself is a W row between two signed nightlies. **Every run:** the floor's freeway host runs from the app's own `Contents/Resources/bin` (`field-freeway-host --listener-fd 3`, F1 — staged in the floor's set, executable, found as the floor's sibling and spawned on fieldd's first declaration). Each run inside its temp root (`HOME`, `FIELDD_DATA_DIR`, `--user-data-dir`); the product's two DEV-gated doors it opens are `--allow-dev-trust` and `VIBEFIELD_UPDATE_ORIGIN` (D9: honored only for `keyClass: dev`). `SMOKE_UPDATE_FOOTPRINT` says what still landed outside the root. The physical apply is W11's (no input injection here; the silent path's display clause reads the live display; EDP §13.5) | landing-only, once per WP12 landing (~10 min: the zip build ~4, five runs ~5). It needs full Xcode 26: `run-electron-builder.mjs` requires `actool` and Icon Composer's `ictool`, so a Command Line Tools host cannot run it, and James's Mac mini is one (2026-10-23). With a person at the Mac the row raises a "keychain not found" dialog per run: Chromium's os_crypt looks for the login keychain under the run's own HOME (R5). Cancel it; no verdict depends on it, and the 10-17 run most likely raised the same on an unattended screen (2026-10-23) | green 2026-10-17 (WP12 L4 `18aa2a25`, five runs, James's Mac); green 2026-10-23 (the wedge and inventory train, `5fb2ca5ff`, five runs, James's Mac) (corrected 2026-10-23: this cell read "not yet run" after the 10-17 run); the quit run not yet run (its node rows green in `pnpm verify`, AU B3's run 11, 2026-10-30) |
| 31 | smoke:profile | `pnpm --filter @vibefield/desktop smoke:profile --app <VibeField.app or the nightly's .zip>` (no root script; corrected 2026-10-28, the housekeeping pass: this cell read `pnpm smoke:profile`) | BP-D7 (`draft/thinking-browser-profile.md` §3·6; ESP-11's witness; VF-PM 2026-10-26 01:32Z, the two-phase row): a cookie a PAGE set in the PACKAGED app is encrypted at rest. **A** the harness, unpackaged (`run-smoke.mjs --smoke-canvas --profile-seed=<url>`, `testing/smoke-profile-seed.ts`) lays one browser pane, points it at the row's loopback fixture (its response sets the witness cookie), waits for it live and saved, and LEAVES it; its root is kept (`VF_SMOKE_KEEP_ROOT`). This run writes the UNPACKAGED profile directory with the fuse off: the plaintext control (BP-D6). **B** the packaged app on that data root, its `HOME` the run's own with a login keychain created for the run (never the person's, never `--use-mock-keychain`), `--user-data-dir` its own. Every `security` call runs under the run `HOME`, the run keychain is made that `HOME`'s default, and the person's search list is digested before and after: the run STOPS before any app starts if it moved. Measured 2026-10-26 on this Mac: under a fresh `HOME` the user search list is empty and no default keychain exists, and a create plus `default-keychain -s` there left the person's list digest unchanged (`security create-keychain` adds to the CURRENT `HOME`'s list, so run under the real one it would have written the person's). The board it reopens is the only driver: no smoke trigger is in the asar (EDP §13.5), and no input reaches it. **The judge**, after its graceful quit: the packaged directory's `Cookies` holds the witness with an empty `value` and a `v10` `encrypted_value`, and its bytes appear nowhere in the file; the unpackaged directory holds it in plaintext; "VibeField Safe Storage" is in the RUN keychain; the shell's own profile holds no cookie of the fixture's. A DEV-keyed package (a local `package:dir`) launches with `--allow-dev-trust`, said so: the cookie fact holds, and the release-keyed reading is the signed nightly's (VF-PM 2026-10-26 01:49Z: the unknowns are measured first on a dev-keyed `package:dir`, then the row runs on the first signed nightly's zip; a package release-signed locally is refused) | landing-only, beside the gate: the INTERACTION class — phase A's synthetic input in its own window and phase B's real window on the live display. It runs on the mini at James's unlock (HID idle ≥ 120 s); on this Mac only by the PM's word while he is away, never while he works. Its green row needs a SIGNED package (J4's nightly) and `pnpm build:all`'s harness, on the same host as the package (phase B opens phase A's data root). *(2026-10-28, the housekeeping pass: J4 is met — the nightly signed and notarized on 2026-10-26, LANDED "LSF-4", and W11 applied `nightly-20261026` → `nightly-20261027` on the mini — so the row no longer waits on it; R4 on the signed zip stays owed, DECISIONS BP.)* | RED, and says why (2026-10-26 03:18Z, the mini, a dev-keyed package): U1 the pane live unaided, U2 os_crypt's key in the RUN keychain, U3 phase A's board reopened, all YES; U4 the mini. Neither desk profile holds a cookie database: a `session.fromPath` profile outside Electron's userData keeps its cookies in memory (`draft/thinking-browser-profile.md` §3·8, BP-D9 open). The package's field-native linked Homebrew harfbuzz (`HARFBUZZ_SYS_NO_PKG_CONFIG=1` built the measured one; the fix lane is TD/WP's) |
| 32 | smoke:first-run | `pnpm smoke:first-run` (`node apps/desktop/packaging/run-first-run.mjs night` runs one walk alone) | Track FG, FG-6's row (VF-PM 2026-10-31 07:39Z, the lane; board `fg-first-run-row`): the Setup Assistant walked by its own controls to the desk, from a user minted NOT onboarded. UA-3w as amended 2026-10-31: `answersSetup` names this one mode, and `modes.test.ts` pins every other smoke-like mode to a user minted onboarded. Three launches (`run-first-run.mjs`), each on a fresh profile with its theme written into it before the boot (main/theme.ts's `vibefield-theme.json`, never a call into main): **day** and **night** on the live field, and **no-webgpu** over the field's still. Its person is `stageFirstRun`'s: a throwaway HOME, the typed agent's one conversation, and one stub as every launchable row's active install. The adapters decide which rows take it (AR-L1); at puppeteer 0.3.x two do. A press is `sendInputEvent` at a control the page hit-tests to, and nothing is OS input. GT-8b's opener has nothing to record: the walk presses no link, so one recorded is red. **The logo**, at the welcome's title card: `data-logo`, its box the field's mark at the window's centre (`FIRST_RUN_MARK`, held equal to `field-mark.ts` by a unit row). On the live field the field draws it (`data-glass="field"`, the page's own hidden); over the still the page draws it. In the pixels the mark's ink is centred, inverted on milk by day and white by night. **The holds**: every load that began to show stood 800 ms from its fade in, with the logo, and a line hold said one line. **The frame**: on Agents with More open, the list outgrows its body and scrolls within itself under its fade, while the head, the foot and Continue stand inside the frame, unmoved. On Profiles a login runs the stub at a terminal (one line, then it waits): its terminal is 190 tall, Cancel is in view above the fade, and a press reaches Cancel. **The band**: Setting up's segment advances with the boot's progress and stands full. **The end**: Setting up's welcome is said (Start now is said if it shows, never pressed), the wizard goes, users.json reads `onboarded: true`, and nothing is refused by the CSP. Its stills (about 14 a walk) go to `FIRST_RUN_SHOTS/<walk>/`, outside every smoke's own folder, so a green teardown cannot take them. **Not this row's:** Agents with nine installed (448), History with six rows, and Profiles' five cards (336) are James's eye. The ways out at 6 s and Start now at 8 s are their unit rows; no fault seam opens them | landing, in the console window's list behind smoke:canvas and smoke:godview. It keeps the GPU and shows its window (inactive and click-through), so it runs on the mini at James's unlock. Budget about 8 min: `build:all` about 3, three walks about 90 s each, and a walk past 240 s is stopped and red | not yet run |
| 33 | smoke:phone | `pnpm smoke:phone` (L2, the devices); `pnpm smoke:phone:none` (L1, no simctl); `pnpm smoke:phone:cost` (L3). Each is `node ../../scripts/stage-simulator-fixture.mjs <mode> -- node packaging/run-smoke.mjs --smoke-canvas --phone`, and builds NOTHING: the build (`pnpm --filter @vibefield/desktop build:all --skip-nx-cache` — past nx's cache, since a cache-served build keeps the outputs' old mtimes and the preflight refuses them after a `gen` or a checkout; then `bundle-report --assert`) and `build:live-surfaces-native` come first, and the stage's preflight (`--preflight-only`) refuses an unbuilt helper, plugin or shell, or a smoke bundle without the literal `--phone` | PT-S3 (`draft/portals-maps/briefs/PT-S3-the-gates.md` §4): the phone's live rows. **The stage** fences CoreSimulator: a running Simulator.app or any booted device is NOT ARMED (exit 75), never shared. It picks ONE iOS runtime and hands it over as `VF_PHONE_RUNTIME` (RM4.1: no judge holds a literal). It makes the run's own devices `pts3-<runId>-1..3` (a fourth type gets none), serves a loopback door whose token rides in a header, and gives the host back (HOST-RESTORED; under `VF_PHONE_DELETE_DEVICES=1` it deletes the run's own devices and nothing else, RM2). **`--phone`** runs ONLY the phone's rows after the boot's (`testing/smoke-phone.ts`). It prints `PHONE_ROWS_BEGIN mode=<m>` first and `PHONE_ROWS_END n=<k>` last. k must equal the rows the door served AND the mode's exact count (L1 2, L2 20, L3 1): either miss reds the run. The smoke holds each row it runs to its own table (`PHONE_ROWS`), in order and by class, and the table run out before END, so a runner that drifts from the table reds at its first wrong row. **The rows:** L1 is SIM-NONE and SIM-NO-UDID. L2 is twenty rows: sixteen MUST, SIM-STAGED through SIM-GONE, then SIM-RATE (an OBSERVATION), SIM-SHARE and SIM-REBIND (NICE), and SIM-NO-UDID, the seventeenth MUST, last. L3 is SIM-COST (an OBSERVATION). **Every "live" read is LIVE-PROVEN:** the face reads `streaming`, presented +3 and main's helper frames +3 within the row's bound, and it still reads `streaming` 2 s on (`streaming` alone is no proof). **A face's act** is pressed only in hand, by `sendInputEvent` (never CDP's `Input.synthesize*`), after THE PRESS GATE: the device's name is `pts3-<runId>-n`, its type is the row's, and the door said go. `create` is never pressed. Each row opens and closes with its own `/row` HID pair, and a hand at the Mac stops the run. No UUID shape appears in what the renderer saw: each row's `PHONE_WORDS` line is swept. The rows' pure judges are unit-held (`packages/electron-shell/test/smoke-phone.test.ts`; the stage's own in `stage-simulator-fixture.test.mjs`) | landing-only, beside the gate, never inside `gate:landing`. It is the INTERACTION class: Electron on the live display, devices booted, Simulator.app launched or activated (`open -a` takes the display's focus), capture by ScreenCaptureKit. It runs on James's unlock only (armed: the console unlocked, HID idle ≥ 120 s), launched by James from the terminal he names (RM1 Q7). L0–L2 run on this Mac with his dev app off. SIM-RATE's numbers and L3 run on the mini on his word, or are skipped (Q12). **Its grants:** Screen Recording is NOT assumed. VibeField's code only checks it, but macOS may prompt when the helper first asks ScreenCaptureKit for its sources, and the grant that counts is the LAUNCHING app's (node → run-smoke → Electron → helper, with no LaunchServices hop). So ENUM (`stage-simulator-fixture.mjs enum`) runs first with James at the screen, again after any grant, until `ok:true`. A `no-permission` read presses Open Settings once, then the run STOPS ("TCC dialog suspected"). Accessibility is NOT assumed: SIM-LIVE records `degraded`, its cause unattributed. Automation is not needed (no osascript). **What its exit asks** (RM7.3): **0**, every row as judged and HOST-RESTORED green. **75**, NOT ARMED, a transient STOP (a hand at a begin, a locked console, the fence, a Simulator.app not proven the run's) over a restored own side, or another's change to the host during a run otherwise green (`PHONE_HOST_UNPROVEN` names the change, as `PHONE_OBSERVATION` does: HOST-RESTORED is unprovable; RM7.1): relaunch later, on a quiet host. **1 with `PHONE_STOP_FINAL <why>`**, a deterministic stop (the own-input reset; the press gate refusing an act, or a device not the run's): do NOT relaunch, it is a finding. **1 with `PHONE_STOP_UNRESTORED`**: restore the run's OWN devices, app or lock by hand before any relaunch, never another's. **1 otherwise**: a red row or the deadline. **128+n**: a signal. No exit is 0 while HOST-RESTORED is red. Each launch keeps `<run>-stage.log` (the stage's STOP, HOST_RESTORED, HOST_UNPROVEN and HID lines, redacted) beside `<run>-hid.log`, in `<logs>/<run>/` | not yet run: written in PT-S3's code-only window (2026-10-31); its console run waits on James's unlock |

`pnpm verify`'s chain is rows 1–14 in that order. `pnpm gate:landing` is rows 15–23, then 32 (behind Godview), then 24–26 and 29; `--with-stages` puts 1–14 first. Row 30 is landing-only: `pnpm smoke:update` runs once per WP12 landing, beside the gate, never inside `gate:landing` (WP12 L4, the PM's ruling 2026-10-15 21:41Z: ten minutes is the zip build and five packaged launches). Row 31 is landing-only too: `pnpm --filter @vibefield/desktop smoke:profile` runs on a SIGNED package, beside the gate, never inside `gate:landing` (BP-D7, VF-PM 2026-10-26). So is row 33: `pnpm smoke:phone` (with `:none` and `:cost`) runs on James's unlock, beside the gate, never inside `gate:landing` (PT-S3, VF-PM 2026-10-31).

**Re-run at DK-19, on main merged in** (`695ff9d1`; `pnpm gate:landing --with-stages`, 2026-10-08 09:32→09:47Z, load 3, 124
under the test stage, 5 at the end; `field-native` rebuilt from the merge first). The same 26 gates, red only by preflight
(MAIN's ghosttea row), check:deps (MAIN's three mille rows) and test — fieldd `2 failed | 2106 passed`: AR-7b row 1 (MAIN's)
and `agent-session.test.ts`'s MF-1f/MF-1g resume row, "poll timed out after 15000ms" at load 124, which passed ALONE twice
(36 passed | 2 skipped). Alone after the run: fieldd `1 failed | 2107 passed | 23 skipped`, AR-7b row 1 alone; field-app
`1890 passed | 1 skipped` (Nx printed 64 KiB of it in the stage). Every other stage ok — typecheck 25 projects, lint 2,035
files, bundle:assert initial 769.3 KB raw / 193.1 KB gz (764.1 / 191.6 at DK-18: main's code, the lane's did not move),
test:rust, gen:check — and every landing gate ok, `SMOKE_DAEMONS` `left: []` in each: still; smoke; smoke:canvas (291 s —
TAKE 8/8, LANDED min 4.5 ms against 250, REST still 314 / wind 22,033 / cover 101 ms, PEERS IDLE 8,086 ms, PEERS EXIT
line / head / drag strip 46 / 22 / 67 ms, COVER_BUDGET 34 / 26 / 26 ms against 240, ISOLATION 0, PRESENCE_REST `wakes {}`);
both GPU-less modes; kind-faults; plugin-restart; plugin; godview; terminal-door; terminal-direct; studio. Main's three rows
were proven ON MAIN at `1adde1a6` (a throwaway worktree on a cargo target of its own, removed): the same preflight row, the
same three check:deps rows, AR-7b row 1's same assertion ("1 failed | 91 passed (92)").
**And on the ledger's tip** (`bba0279f`, the merge plus the DK-19 ledger's docs; 10:10→10:25Z, load 11–82): the same
verdicts — test red by AR-7b row 1 and, at load 82, `doc-sync-service.test.ts`'s DS-5c row, whose `afterEach` met ENOTEMPTY
removing its temp directory (alone twice: 44 passed); smoke:canvas 291 s — TAKE 8/8, LANDED min 3.4 ms, REST still 316 /
wind 22,046 / cover 102 ms, PEERS IDLE 8,046 ms, PEERS EXIT 45 / 23 / 22 ms, COVER_BUDGET 37 / 29 / 27 ms; every other
landing gate ok, no smoke's daemon left.
**And on main merged again** (`ef5d5ad8` — MV, Godview's five views as SDK modules over one backend, and the ghosttea pin —
with its merge fix `ed9706db`; 2026-10-08 20:33→20:58Z, load 60–445). **Preflight is GREEN now**: main moved ghosttea's pin
to `10d0b17`, where the sibling sits. check:deps stays red by MAIN's mille row. Walls, retired, iOS fixtures, icons, lint (2,112
files), fmt, lint:rust, test:rust and gen:check are ok. Typecheck, bundle:assert, test and every smoke that builds are RED, and
RED ON MAIN `8ae3da5c` the same way (a throwaway, removed): the puppeteer sibling sits at MV's pin `594d222` without its own
install for the new `packages/view-sdk` (the cutover's 1.5). The evidence, side by side:
- typecheck: the identical 165 error lines;
- bundle:assert: the same Rolldown "failed to resolve `@vibecook/puppeteer-view-sdk/toolkit`";
- fieldd's build, the smokes' first step (smoke:plugin's too, inside its `try` run's app: `.vibefield-try/try.log`): the
  same esbuild "Could not resolve `@vibecook/puppeteer-view-sdk/model`";
- the suites run alone, failing files per project: field-app 30, fieldd-client 4, fieldd-supervisor 6 and electron-shell 1,
  all collection failures on the same imports, plus fieldd's `workspace-worker` packaged-role row, which runs the bundle the
  build cannot make. Each set is identical on main.

The lane-only `peers-two-tabs.test.tsx` fails its collection on the same import: it reaches fieldd, which MV now wires to the
monitor backend. fieldd's `agent-session` row was load (it passed alone twice). smoke:studio's dev runner rebuilt neither
fieldd nor the renderer's dependencies (the same imports) and waited; the gate's own stop (a SIGTERM to the gate script) ended
it at 1,092 s, its daemon row `left: []` (its root, kept as a red run's is, held no logs and was removed). The two GPU-less
modes passed, but on the previous build (they reuse smoke:canvas's), so they prove nothing here. `pnpm still` went red once, by
vitest's worker channel closing at exit (`ERR_IPC_CHANNEL_CLOSED`) after its ten tests had passed. Alone after, 4 of 5 green
(the fifth the same error); in one window, 3/3 on the merge and 3/3 on the lane's pre-merge tip. Main changes nothing `still`
runs, and the same tinypool channel error ended a field-app run at DK-13 (2026-10-06): a teardown flake, not the merge's. AR-7b
passed: MV made its test assert what AR-7b guards. Until the sibling was prepared this merge had no green run.

**Re-run whole on `fab71fa0`, the sibling prepared** (its own frozen install, 21:28Z — the cutover's 1.5; field-native rebuilt
from the lane first; 2026-10-08 21:32→21:51Z, load 34–402): 24 of the 26 gates ok — typecheck (the 165 lines gone),
bundle:assert, `still` and all eleven smokes, each smoke's daemon row `left: []` (smoke:godview's and smoke:terminal-direct's
through MV's runner — the merge fix's row; smoke:plugin's in its `try.log`; the two GPU-less modes on this run's own build) —
red only by check:deps (MAIN's mille row) and the test stage. The test stage went red three times, each by a different row
under load:
- the whole run (load 35→195): fieldd's `agent-gateway` AR-7b row "the stop verb reaches a typed run unchanged", its
  `agent-session` AR-4 re-attach row, and field-app, whose failing row the log cannot show — when field-app finishes last, nx
  prints only the first 64 KiB of its output (so in every whole DK-19 run; the gate takes its exit from nx's failed list);
- the stage alone (load 103→181): logging's 512-seed sanitizer fuzz timed out at 5 s (556 ms alone);
- the stage again (load 49→234): fieldd's `terminal-kill-matrix` rows 3+6 ("the terminal floor is not available").

Each named row passed alone twice, and field-app alone (179 files, 1,915 tests). Across the two stage runs every project's
whole suite passed at least once — field-app 1,915 tests, fieldd 2,139 (AR-7b's rows among them), logging 50 — and the lane
changes none of those four test files, nor logging.

**And on main merged a fourth time** (`4853e9d6` — AR-8's History gaps, 5 commits, 28 files; one conflict, `docs/LANDED.md`,
both kept; three exact unions; no `.rs`, lock or sibling move), by the orchestrator's policy for a merge of main (the cutover's
1.2): the cheap stages each alone — preflight, walls, retired, typecheck, lint, fmt and gen:check ok, check:deps MAIN's — and
the suites of the projects it touches, alone and green: contracts 886, field-app 1,922, fieldd 2,147 (on the lane's own
field-native: gen:check rewrites the generated `.rs` files unchanged, and fieldd's setup rebuilt it). The full gate runs once,
on the final merge.

**And on main merged a fifth time, the final** (`1fa5d8f7` — 15 commits: AR-8's packaged History, EL8's rosetta `eab2f57` and
mille `c8160d5` pins, the DS, AR-7, MV, PJ-2 and FS test fixes, the design prototypes' removal; 102 files; five conflicts, each
both intents — LANDED, design-kit's manifest, electron-shell's vite config, the design-system test, the lock; nine unions; the
lock regenerated offline, one copy each; no `.rs`). The siblings first, read-only against main's lock: all five at their pins
and clean, rosettad built and mille installed and built after their pins moved; `siblings.mjs status` agrees from the lane.
Then the cheap stages each alone — preflight, walls, retired, typecheck, lint, fmt and gen:check ok, check:deps MAIN's — and
the suites the merge touches, alone and green: contracts 890, electron-shell 1,138, field-app 1,900, fieldd 2,158 (on the
lane's field-native, rebuilt after gen:check), the dev runner's 131. The orchestrator's full gate on it is the grade.

## The hygiene every smoke keeps

- **Its own profile** (DK-5): `apps/desktop/packaging/run-smoke.mjs` mints an Electron profile under the OS temp, hands it as
  `--user-data-dir`, removes it once Electron has exited (`SMOKE_PROFILE_REMOVED`). The app's shared profile is never touched.
  smoke:godview and smoke:terminal-direct run through MV's `scripts/smoke-godview.mjs` since DK-19's merge of MV: an isolated
  lab profile whose proof the runner checks, Electron spawned with no shell, the two occlusion switches — and, from DK-19's
  merge fix (`ed9706db`), the same run mark and daemon row as `run-smoke.mjs`.
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
  worktree is better on a target of its own (`CARGO_TARGET_DIR`). DK-19 met the other half: the target is set GLOBALLY
  (`~/.cargo/config.toml`, `[build] target-dir`), which a checkout's own `target` link does not override, so a throwaway
  worktree whose `target` linked elsewhere still built its `field-native` into the shared one — give it `CARGO_TARGET_DIR`,
  and link its `target` to the same place (the suites look for `<checkout>/target/debug/field-native`). Since DK-19's merge
  (`695ff9d1`) the lane's Rust sources equal main's: PJ-3's two constants are no longer a difference.
- **TMPDIR when the internal disk is full** (RD-3, 2026-10-15; the PM's house rule): **kit builds and verify keep
  `TMPDIR=/tmp`; derived data and cargo targets go on the SSD.** With TMPDIR moved to the SSD the kit compile was red,
  rc 65 — `metal: error: unable to make temporary file: Operation not permitted` in GhostteaKit's "Compile Ghosttea
  Metal shaders" task: SwiftPM's build-tool plugin sandbox lets `xcrun metal` write only under the system temp, even
  with `-skipPackagePluginValidation`. verify and the smokes keep `/tmp` for their short unix-socket paths (the
  `vf-smoke-*` homes above). An SSD TMPDIR is fine for cargo, `-resolvePackageDependencies` and plain scripts; put
  `-derivedDataPath` and `CARGO_TARGET_DIR` on the SSD, which is where the bulk goes.
- **Generated files before verify** (WP12 L2b-i, 2026-10-15; the PM's house rule): **a lane that changes generated
  files stages or commits them before verify, or gen:check reds by construction (it diffs the index).** `gen:check`
  is `pnpm gen && git diff --exit-code -- <the generated paths>`, so an uncommitted `bundle.json`, `contracts.rs`,
  `registries.rs` or `gen/layout.json` is a diff even when it is fresh. To settle freshness without a window, stage
  and run `pnpm gen:check` alone: gen and fmt need no PM-WINDOW; `cargo build`/`check`/`test` always do.
- ~~**OWED — a red test stage must name its row**~~ *CLOSED 2026-10-25 by `c2c113788` (DK-18, tooling (5)): a landing
  gate's stdout and stderr are its log file, which Nx writes whole, so no row is cut at a pipe's 64 KiB (noted 2026-10-28,
  the housekeeping pass).* (2026-10-15, the PM's item): Nx caps a task's printed output, so a gate's red fieldd stage can end mid-line with no failing row named (seen 10-15 on two gates); the gate's test stage should write vitest's own report file per project so the row is always on disk. Until it does, read a capped fieldd red by running the suite alone (vitest directly, its full output to a file), then each failing file alone (the lottery rule: `fieldd-test-graph-lottery-rows`).
- ~~**OWED — a gate waits for a quiet host**~~ *DROPPED 2026-10-28 (James, 2026-10-28, the housekeeping page (Q11)): the
  desk rows run on the Mac mini; a flag for the mini would be a fresh tooling item.* (2026-10-15, the PM's item): `gate:landing` gains a `--wait-load N` that waits for load < N before the first gate, since three gates armed at load ≥ 10 each hit a fieldd lottery at load ~100. WP12 L3a's gate (`3eb90abf`) armed at load 10, L3b-i's (`9ec6bf48`) at 14 and L3b-ii's (`421e6355`) at 30 — each straight after a verify — and each met a fieldd red in its test stage at load ~100 whose solo read was green. The prod-builder's own guard waits for a one-minute load under 10, bounded at 10 minutes (the PM, 18:11Z). *Widened 2026-10-17 (WP12 L4 `18aa2a25`): the wait belongs before EACH desk row, not only the first gate. L4's gate armed at load 9.95, yet smoke:canvas armed at 40 and smoke:kind-faults at 17, straight out of the test stage's 309 (the one-minute average lags), and both met presence-timing reds there; alone, smoke:canvas (armed at 9.44) was red only on DK-14, main's own, and smoke:kind-faults (armed past the guard's 10-minute bound at 11.28, on ambient desktop load, no build running) was green.*

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
| `--smoke-no-webgpu` | the window's DevTools protocol takes `navigator.gpu` from every new document (the no-WebGPU card; smoke:first-run's no-webgpu walk, the glass over the field's still). |
| `--smoke-first-run` | the first-run smoke (row 32): its user minted NOT onboarded (`answersSetup`, UA-3w as amended), its person staged before the pair boots (`stageFirstRun`), the walk (`packages/electron-shell/src/testing/smoke-first-run.ts`). |
| `VF_FIRST_RUN_WALK` | which walk a first-run launch is (`day`, `night`, `no-webgpu`), set by `run-first-run.mjs`. |
| `VF_SMOKE_RUN` | the run's mark (run-smoke.mjs, run-studio-smoke.mjs): the teardown and the daemon row find the run's processes by it. |
| `VIBEFIELD_DEV_ROOT` | the dev runner's whole state root (smoke:studio's fresh one). |
| `VF_SMOKE_SHOT_DIR` | where a smoke keeps its stills (`dk-3-desk-light.png`, `dk-18-take-<type>.png`, …). smoke:first-run's launcher takes it as the folder for all three walks (`FIRST_RUN_SHOTS`, a sub-folder a walk). A walk refuses a folder under a smoke's own `vf-smoke-…` folder, which a green run removes. |
| `VF_SMOKE_DEBUG` | the renderer's console passed through. |
| `--bundled` (after `--smoke-canvas`) | the bundled rows instead of the canvas witnesses: the product's first board, `CANVAS_READY.stagedPlugins` and `plugins.list` judged against the run (smoke:bundled; `packages/electron-shell/src/testing/smoke-bundled.ts`). |
| `VF_BUNDLED_FIXTURE` | the bundled run's fixture, JSON, set by `stage-bundled-fixture.mjs`: which run (`loads`, `corrupt`, `forged`), the staged root, the index's ids, the renderer-bearing ones, the file it corrupted. |
| `--dev-trust-root <file>` (stage-package → bundled-plugins `stage`) | smoke:update's trust-root for a DEV stage: the root-signed document (public); refused when `VIBEFIELD_BUNDLED_INDEX_SECRET` is set — a release stage stages only James's trust-root. The stage report reads "KEY CLASS: DEV, smoke trust-root". |
| `VIBEFIELD_SMOKE_BUNDLED_SECRET` | the smoke trust-root's bundled key, in the STAGER's environment only, for that stage (never written, never the app's); read only beside `--dev-trust-root`. |

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

## The cutover (DK-19) — executed

*This heading was "The cutover — the fast-forward, the fleet, the two Macs" (DK-19; plan addenda (73), (93), (95)).*

The desk's cutover — verify, the fast-forward of `desk/landing` onto main, the fleet upgraded together (DK-D16) — ran at DK-19
(its fifth merge of main, `1fa5d8f7`, is dated 2026-10-09); LANDED §DK holds it, and its full procedure is this file at `a7498883f`
(`git show a7498883f:docs/desk-gates.md`). Two of its laws still bind every landing: merge main into a lane, never rebase it
((73): a rebase orphans every graded SHA), and a fast-forward never runs over another session's uncommitted files. What it
left open is the two-desktop check below: step 10 decides plan (20) (if B learns a plugin's pack live, the enable's stamp wait
can go, in its own commit), step 6 answers plan (95)'s drag strip, and step 11 is the smokes' pointer isolation by hand
(plan (36)). *(Cut 2026-10-28, the housekeeping pass: the section was the five-step procedure for a cutover already run.)*

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
*Corrected 2026-10-28 (the housekeeping pass): TS-1 (`029af0e6f`, 2026-10-27) gave the floor its auth-key path — a capture
signs the node in with an untagged Tailscale auth key and no browser (`user.link.begin {authKey}`; mesh.rs passes it to the
builder before `build_with_auth_handler`). A one-Mac, two-profile run is therefore possible in principle; re-judge it before
the next two-desktop check.*

**Before:** both Macs on the same current main (an older build beside a desk.6+ one draws its peer as if on the root and
never away, until 8 s idle; plan (93)), both connected to the same tailnet in Settings → Devices (TS-D3; one local user per
account on each Mac), the desktop app on each. Call them A and B. *(Corrected 2026-10-28, the housekeeping pass: this said
"on the cutover's SHA" and "linked to the SAME tailscale account in Settings"; the cutover ran at DK-19, and TS-3a moved the
link to Settings → Devices.)*

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
  an edit by ≈ 22 s: James's call whether it should. *(Ruled 2026-10-28 — James, the housekeeping page (Q4): shorten the
  wait, `deskLayer({ ambientIdleMs })`; an owed code item.)*
- **Timing rows met under load** (each re-run at a quiet moment, said where it happened): SEND_BAR's 40 ms step-aside bound
  read +40.x ms once (load 23–44); THUMB's undo still (30 s for a still the wind delays to ≈ 22 s after the last touch) once;
  fieldd's `service-drain-deadline` (PRC-2) "expected 209 to be less than 175" in the final run's test stage (load 94) —
  alone, twice, green.
- **A hang met once** (fixed): DK-16's PEERS GONE destroyed window B under the presence relay; an `executeJavaScript` in
  flight when its window is destroyed never settles (Electron 43.1.1), so smoke:canvas could wait for ever after
  `SMOKE_CANVAS_PEERS_COUNTERS`. GONE stops the relay first now; and a gate that hangs anyway is stopped at `--timeout-min`.
