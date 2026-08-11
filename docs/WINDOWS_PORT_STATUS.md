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

## Where the port stands (all landed, on `main`, UNPUSHED)

The Windows commit stack, oldest first — a fresh clone from origin will be MISSING these
until main is pushed:

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
2. **`doc.list timed out after 8000ms` → renderer docs session degraded — OPEN.** The fieldd
   handler (`daemon.ts:903`) is trivial and synchronous (`docs.list()` returns at once), and it is
   NOT onboarding state (doc.list returns empty fast with no user). So an 8s *timeout* (not an
   error) means the request never reached fieldd or the reply never returned — a transport/attach
   issue, not the handler. The renderer↔fieldd control URL is explicit `ws://127.0.0.1:…` (IPv4, so
   not the localhost→::1 trap on the control channel). **Hunch:** the renderer's docs manager opens
   its OWN channel to fieldd (distinct from the control WS the rest of the app rode in on), and that
   attach is what wedges on Windows. **Next step:** capture the FULL boot console (the connection
   lines before the timeout) and trace how the renderer docs manager dials fieldd vs. the control WS
   — check for a `localhost`/`::1` or a data-lane (`ws://127.0.0.1:${dataPort}`) attach that differs
   from the working control path.

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
  green when the pin consuming it lands.

## How to build / run / test ON Windows

- **Boot gate (headless-safe):** `pnpm smoke` — exit 0 = the app boots (shell + pipe-joined daemon
  pair + renderer + units). Smoke-like modes disable the GPU (`isSmokeLike` → `disableHardwareAcceleration`),
  so it runs with no window station (CI/ssh). `pnpm smoke:godview` = build:all + the deck harness.
- **Real app (visible window, needs an interactive session with a GPU):**
  `cd apps\desktop && pnpm start` (= `build:all && electron .`), or `pnpm exec electron .` if already built.
- **THE gate before any commit:** `pnpm verify` (verbatim) — it does NOT run smoke; run smoke
  separately for boot proof.
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
