# Windows Port — Live Status & Handoff

> A working handoff for an agent continuing the Windows (WIN) track — especially one
> running **directly on Windows** without this repo's `dev-local` branch or the
> orchestrating agent's memories. The design law lives elsewhere; this is the
> "where we are, what's next, what will bite you" snapshot. Last updated 2026-08-11
> after WIN-0…7 + the first real-app launch on the box.
>
> **Authoritative docs:** history → `LANDED.md` · now/next → `ROADMAP.md` (the WIN
> row) · decisions → `DECISIONS.md` (WIN-D…). The FULL plan is
> `draft/thinking-windows-port.md` — **on the `dev-local` branch only** (draft/ is
> gitignored on main). To read it: `git show dev-local:draft/thinking-windows-port.md`
> (or `git checkout dev-local` — but **NEVER push dev-local**, a pre-push hook enforces it).

## Where the port stands

> **Errata 2026-08-11:** this section used to say the stack was "all landed, on `main`, UNPUSHED"
> and step 1 of the handoff below was "push `main`". Both are **stale** — the WIN commits are on
> `origin/main` and reached this box through the `e333d9c` merge. A debt row is a claim with a
> shelf life.

The Windows commit stack, oldest first:

- `5ffd30b` WIN-0/DEV — gate + dev-runner portable
- `85cce04` WIN-1/2 — the endpoint law in two languages (named pipes, WIN-D1); native plane on pipes
- `f982d27` WIN-3/3b/4 — the pair boots; `system.shutdown` verb (WIN-D5); harness port
- `5830b9b` WIN-0…4 bookkeeping
- `03cc648` WIN-6 — ConPTY terminal hosting; kill matrix on the box (WIN-D2 adopted)
- `4fe4d6e` WIN-6 bookkeeping
- `51aa3ab` WIN-5 — **the whole app BOOTS on Windows**; headless smoke gate
- `edd5882` WIN-7 opens — the truffle sidecar resolves on Windows (`.exe` + `%LOCALAPPDATA%`)
- `4ad859d` WIN-5/7 bookkeeping
- (+ a tray fix commit landed alongside this doc — see below)

**The milestone:** the entire app runs end-to-end on Windows. `pnpm smoke` →
`{ok:true, nativeConnected:true, units:[mgmt, mesh-gateway, terminal, mesh-bridge, process]}`;
`--smoke-godview` boots the deck (renderer canvas2d, swarm monitor, a live cmd.exe terminal
that echoes). The daemon/pipe/terminal layer is proven; what's left is polish + the
resource-gated rungs.

## ACTIVE debugging (the eyeball session, first real launch)

The first non-smoke launch (`cd apps\desktop && pnpm exec electron .`) surfaced two things:

1. **Tray "Invalid GUID format - GUID must be a string" — FIXED** (this commit). `tray-native.ts`
   did `new Tray(image, guid ?? undefined)`; on Windows `guid` is intentionally `null` (EDP §5.6
   — don't claim the frozen tray GUID until the binary is signed), so it passed `undefined`, which
   Electron validates as a GUID. Fix: call the one-arg `new Tray(image)` when there is no GUID.
   **Runtime-confirm on the next launch** (the error should be gone; a tray icon should appear).
2. ~~**`doc.list timed out after 8000ms` → renderer docs session degraded — OPEN.**~~
   **ROOT-CAUSED AND FIXED 2026-08-11 — and it was never a Windows bug.** The production CSP
   (`security-policy.ts`) enumerated `PORTS.FIELDD_WS_CONTROL`/`_DATA` (9410/9411) while **UA-D12/UA-5
   made every pair bind an EPHEMERAL port** (`main/fieldd.ts` passes `controlPort: 0, dataPort: 0`;
   `registries.ts` calls 9410/9411 a legacy documentation default). Chromium refused the renderer's
   own WebSocket, `FielddClient` reconnect-looped without ever rejecting `ready()` — the client has
   no terminal state for a refused dial — and `doc.list`, the first renderer→fieldd request, timed
   out at 8 s. Dev returns a null CSP and every smoke mode already used the loopback WILDCARD, so
   only `electron .` took the pinned branch: **this reproduces on macOS production mode at the same
   commit.** The box was merely the first place production mode was eyeballed after UA-5c landed.
   Fixed by admitting the loopback host with the port left open, because the policy is installed
   before the first window exists (ESP §6.2) while the window deliberately does not wait for the
   daemon (design-03 §4.3) — at CSP-build time there is no port to name.
   **Two corrections to this entry's own reasoning, recorded because both misdirected the hunt:**
   the docs manager does NOT open its own channel — `doc.list` rides the shared control client, and
   the separate `DocLaneClient` is only dialled after a successful `doc.open`, which was never
   reached; and "the control WS rode in fine" was never established — only the URL *string* was
   IPv4. The connections that did work were main-process **Node** WebSockets (the supervisor probe
   and shell-main), which bypass both the CSP and the Origin gate. **A green supervisor probe proves
   nothing about renderer reachability** — that asymmetry is the reusable lesson here.

## The remaining ladder — and what each needs (NOT autonomous)

- **WIN-5 visual polish** — Windows titlebar/chrome (**WIN-D9 is James's decision**: keep the
  default frame or go custom/WCO), tray `.ico` (may be placeholder), forced-colors block, the
  "Shift" glyph label. Needs a **UI Bench eyeball**, not more porting. `pnpm dev:design` is the Bench.
- **WIN-7 live mesh witness** — the tsnet-vs-host-Tailscale coexistence spike + the Mac↔Windows
  two-device proof (docs sync, remote attach). Needs a **tailnet auth key** (`TRUFFLE_TEST_AUTHKEY`
  for the `#[ignore]`d probes). The box runs host Tailscale, so coexistence is the exact
  predesign-03 risk to check — cheap once keyed. The sidecar now resolves (`edd5882`).
- **WIN-8 packaging** — NSIS + `.ico` family + Azure signing (EDP-39). Needs the **cert/ops**.
  Signing also unblocks the frozen tray GUID (WIN-5 note above).
- **G13** (upstream petition, drafted on dev-local `draft/petitions/G13-*.md`) — a case-variant
  private-env key leaks past ghosttea's case-sensitive strip on Windows (defense-in-depth). File to
  electron-ghostty when ready; `terminal-kill-matrix` row 6b is an `it.fails` witness that flips
  green when the pin consuming it lands. **Note for whoever files it:** the petition file is not in
  this clone (dev-local only), so from a Windows checkout row 6b is the only in-tree artifact of it.

## Windows process-tree termination — what is closed and what is not (2026-08-11)

`process.kill(-pid, sig)` **throws ESRCH** on Windows (measured on the box, not inferred), so the
old ladder fell through to `child.kill()` — one process. That reached the `cmd.exe` shim
`spawn-shim` creates for every `.cmd`/`.bat` target and left the real MCP server running past its
plugin's kill, its disable, and fieldd's own shutdown. `killPlan` now issues `taskkill /PID <pid>
/T /F` there. Two measured facts worth keeping, because both can mislead the next person:

- **A Node intermediate hides the bug.** libuv assigns every process a Node parent spawns to a job
  object that dies with the parent, so a node-in-the-middle fixture tears its own grandchild down
  for free on Windows. The first version of the regression test did exactly that and **passed with
  the fix reverted**. The witness must put a non-libuv process (cmd.exe) in the middle, which is
  also the real MCP shape.
- **`taskkill /T` walks LIVING parents.** A grandchild already orphaned before the kill is out of
  its reach; a Job Object with `KILL_ON_JOB_CLOSE` would close that, and Node has no API for one
  without a native addon. The ROADMAP's "group-kill → Job Objects" booking therefore **stays open**
  — narrowed, not paid.

## How to build / run / test ON Windows

- **Boot gate (headless-safe):** `pnpm smoke` — exit 0 = the app boots (shell + pipe-joined daemon
  pair + renderer + units). Smoke-like modes disable the GPU (`isSmokeLike` → `disableHardwareAcceleration`),
  so it runs with no window station (CI/ssh). `pnpm smoke:godview` = build:all + the deck harness.
- **Real app (visible window, needs an interactive session with a GPU):**
  `cd apps\desktop && pnpm start` (= `build:all && electron .`), or `pnpm exec electron .` if already built.
- **THE gate before any commit:** `pnpm verify` (verbatim) — it does NOT run smoke; run smoke
  separately for boot proof.
  > **Errata 2026-08-11 — the ledger's "`pnpm verify` VERBATIM exit 0" needs a footnote.** Two
  > things were true of that claim and neither was written down. (a) `bundle:assert` asserted the
  > presence of `dist/main/index.cjs` + `dist/preload/index.cjs` but only built the RENDERER, and
  > nothing earlier in the chain builds the shell (`typecheck`/`test` carry no `dependsOn: build`),
  > so the gate passed only on trees with a warm `dist/` and was **red on every clean checkout,
  > including CI on `origin/main`** — pre-existing since `fc78b84` moved bundle:assert into verify,
  > platform-independent. `bundle:assert` now builds the shell bundles it grades. (b) On Windows
  > the TS phase then failed in **five packages whose suites were never ported** (mac-shaped path
  > literals, unix mode-bit assertions, sun_path rows run without an explicit platform, symlink
  > fixtures needing Developer Mode). Those are fixed; the gate is green on the box.
- **The kill matrix / native tests:** `cargo test -p field-native` (terminal_unit 14/14 windows,
  terminal_mesh 7/7, mesh unit 3/3). `cargo test --workspace` for the lot.

## Gotchas that WILL bite (carried from the orchestrator's memories)

- **Windows named-pipe rebind needs a PROCESS exit.** A `first_pipe_instance` name stays held until
  the holder's process exits; an in-process shutdown+rebind of the same pipe scope reads
  ACCESS_DENIED indefinitely. Don't write in-process rebind tests on win32 (see
  `terminal_unit.rs::stale_endpoints_are_rebound`, cfg(unix)-gated for this reason). WIN-7/8 restart
  paths rely on process exit closing handles.
- **A `#[cfg(unix)]` / `skipIf(win32)` test makes the OTHER platform's gate its sole witness.** A port
  change to SHARED prod code can silently regress the gated path — run BOTH the mac `pnpm verify`
  AND the box tests, verbatim. (This is how the mgmt full-close EPIPE was caught.)
- **Green mac `pnpm verify` ≠ win32-correct.** The box cargo/clippy/TS suites are the real Windows
  gate. Before a slice, grep `tests/` for `/tmp`, `/bin`, `UnixStream`, `is_absolute`,
  `.parent().unwrap()`, and shell `$0`/`env`/`HOME` unix-isms.
- **Electron over a non-interactive session (ssh) has no window station** — GPU init fails; pass
  `--disable-gpu` or rely on the smoke `isSmokeLike` disable. A real visible window needs the user's
  interactive session (physically at the box or RDP), not an ssh-launched process.
- **Watch `localhost` → `::1`.** Windows may resolve `localhost` to IPv6 first; if a server binds
  only IPv4, a `localhost` client can hang. Prefer explicit `127.0.0.1`. (A prime suspect for the
  open doc.list timeout above.)
- **The box's default ssh shell is cmd.exe; interactive logins may use Git Bash (MINGW64).** cmd
  needs `%VAR%` + backslashes; bash needs `$VAR`/`~` + forward slashes. Compound remote commands
  over cmd often need `powershell -EncodedCommand`.

## Handoff to a Windows agent — what James must do

1. **Push `main`** so the Windows clone has the ~15 WIN commits + this doc (they are all unpushed).
   Do NOT push `dev-local`.
2. To give the agent the FULL plan + the G13 petition, either push nothing and have it read
   `git show dev-local:draft/thinking-windows-port.md`, or copy that file into the working tree for it.
3. The immediate next task is the **doc.list timeout** (above) — that's what blocks a clean real-app
   session. Then WIN-5 visual polish (with your eyeball) and/or WIN-7 (with a tailnet key).
