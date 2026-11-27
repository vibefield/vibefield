# BU-14's patched pin, built (2026-10-31)

On the owner's yes ("Yes, go ahead", 2026-10-31; the source builds of SITTINGS rule 3, 17:20Z), under §8's source-build
row. This pays the build half of S1-W 15's patched case. The patched binary has **not been run**; see "Not done".

**Revision 2 (2026-10-31, 17:50Z–17:59Z), after a review of revision 1.** Revision 1's binary
(`8380c5156183428f9f468f0c9e159c5ba751633fc70c2fc92919a67727cbcb1f`) and diff
(`641bacd545f15a43b0d75f07d39e44083b5bf44f8bdd6f0ba9d5a10dce61fd54`) are **superseded**; do not put either in a
sitting. Each finding was checked against the source before it was fixed; all seven were real (see "Review round").
Two of revision 1's claims were false, and they are corrected below at their place:
- *"no TCP listener: … no dashboard"*. The standalone dashboard (`dashboard start`, the MCP
  `agent_browser_dashboard_start` tool, or `AGENT_BROWSER_DASHBOARD` set) still bound `127.0.0.1:4848` and
  `[::1]:4848`. The `inspect` server still bound `127.0.0.1:0` too.
- *"the uid half of part 2 is always on"* was recorded as a departure. It is now behind a switch, so with every switch
  unset the binary behaves as stock.

## Source

- Pristine tree: `‹build-root›/src-1453dd3` (tag `1453dd3`, agent-browser v0.41.0, commit
  `1453dd37a40c730fe00f592bc32198a896ff8747`, unpacked from `‹build-root›/dl/ab-1453dd3.tar.gz`,
  SHA-256 `1be659615e1f10670257dcbdd6f0366803f06fa371fa0af80082492c1c613948`). It stays read-only and is never built.
- Build tree: `‹build-root›/build-patched`, a copy made with
  `cp -R src-1453dd3 build-patched && chmod -R u+w build-patched` (run in `‹build-root›`).
- Crate: `agent-browser` 0.41.0 (`cli/Cargo.toml`). Its `build.rs` wrote the dashboard placeholder
  `packages/dashboard/out/index.html` into the build tree, outside `cli/`. That file is generated, so it is not in the
  diff.

## The patch

`bu14-patch-1453dd3.diff` (this folder) was made with
`/usr/bin/diff -ruN src-1453dd3/cli build-patched/cli`. It touches only `cli/`, and `cli/target` does not exist because
the target directory lives elsewhere.
- SHA-256: `08274e8604452e6cfe1c167d98e6c3d63988e353a6c9cbe462d014140c7810f7` (903 lines).
- It changes four files: `cli/src/main.rs`, `cli/src/connection.rs`, `cli/src/native/daemon.rs` and
  `cli/src/native/actions.rs`. It adds 713 lines and removes 25, and most of the added lines are tests.
- `patch -p1 --dry-run` applies it cleanly to a fresh copy of the pristine `cli/`.
- `rustfmt --edition 2021 --check` is clean across the crate. The formatting was applied before the build, so the
  binary matches the diff.

**Switch values.** A switch is on for any value except unset, empty, `0`, `false` or `no`. The test ignores case and
surrounding spaces. This is upstream's own `env_var_is_truthy` convention (`flags.rs:261`, `providers.rs:244`), so
`TRUE`, `yes` and `on` all turn a switch on. Revision 1 accepted only `1` and `true`, so any other spelling left the
switch off without a warning.

Each switch is read in the process that acts on it. The daemon inherits the CLI's environment when it is spawned (it
has no `env_clear`). Since revision 2, the CLI also counts the switches when it decides whether to reuse a live daemon;
see "Daemon reuse".

| Part | Switch | What changes (lines at the tag) |
|---|---|---|
| 1 · stream off | `AGENT_BROWSER_NO_STREAM` | `run_daemon` skips `StreamServer::start_without_client` (`daemon.rs:104-126`), so the daemon binds no stream server: no WebSocket input and no `/api/command` relay. No `<session>.stream` file is written. The tag already deletes a stale one at daemon start, on every start (`daemon.rs:88`), so no new code was needed for that. `handle_stream_enable` (`actions.rs:9664`) refuses with PR #1591's own message; the MCP `agent_browser_stream_enable` tool runs `stream enable` through the CLI, so it gets the same refusal. **Revision 2:** `handle_inspect` (`actions.rs:5922`) refuses with `inspect is disabled: this daemon was started with AGENT_BROWSER_NO_STREAM`. Its server bound `127.0.0.1:0` and proxied full CDP for the active page to any local client, of any uid, that sent no Origin header (`inspect_server.rs:41`, `:316`). `execute_command` treats `inspect` as skip-launch under the switch, and the CLI sends no pre-launch for it, so the refusal launches nothing. The CLI's `dashboard start` (`main.rs:1535`) and the standalone `AGENT_BROWSER_DASHBOARD` branch (`main.rs:1438`) refuse and exit 1, so the dashboard's `127.0.0.1`/`[::1]` listener and its `/api/exec` command relay are never bound. The MCP `agent_browser_dashboard_start` tool runs through the CLI, so it is refused too. This follows PR #1591's code shape (`stream_opt_out()` in daemon.rs, the refusal at the top of `handle_stream_enable`, and the PR's test, renamed `test_bu14_…`). It leaves out the PR's docs and help-text changes. |
| 2 · peer check | `AGENT_BROWSER_PEER_PIDS=<pid,pid,…>`, `AGENT_BROWSER_PEER_UID_CHECK` | **Revision 2: the check is off unless a switch is set, so with both unset the accept loop is stock's.** It turns on when `PEER_PIDS` is present or `PEER_UID_CHECK` is on. It then runs in the Unix accept loop (`daemon.rs:252`, which discarded the peer) before the connection is handled. The uid comes from tokio's `UnixStream::peer_cred()`, which calls `getpeereid` on macOS and `SO_PEERCRED` on Linux. The pid comes from `getsockopt(SOL_LOCAL, LOCAL_PEERPID)` through `libc` on macOS, and from `SO_PEERCRED` on Linux. No dependency was added: `libc 0.2.180` and `tokio 1.49.0` were already in the lockfile. With the check on, a peer is dropped if its uid differs from the daemon's `geteuid()` or its credentials cannot be read. With `PEER_PIDS` present, a peer whose pid is not listed, or cannot be read, is dropped too. A present value that names no valid pid admits no one. **Revision 2: that includes a blank value.** Revision 1 read a blank value as unset, so the check failed open. The policy is read once, when the daemon starts. Each drop writes one line to the daemon's stderr: `Peer refused: <reason>`. |
| 3 · `get cdp-url` silent | `AGENT_BROWSER_HIDE_CDP_URL` | Daemon side: `handle_cdp_url` (`actions.rs:5917`) refuses when `active_provider_connection` or `active_provider_session` is set: `The CDP URL is withheld for a provider session (AGENT_BROWSER_HIDE_CDP_URL)`. **Revision 2:** it also refuses when the session's CDP URL has a query string or userinfo, or does not parse: `The CDP URL is withheld: it carries a query string or userinfo (AGENT_BROWSER_HIDE_CDP_URL)`. That covers a `connect`/`--cdp wss://…?token=…` attach, which is not a provider session. Under the switch, `inspect` refuses on any session where `get cdp-url` would, because its 302 `Location` is built from `chrome_host_port()`. That function keeps a path-less URL's query string, so `wss://host?token=…` became `http://host?token=…/devtools/…`, sent to the default browser and to anyone who GETs `/`. `execute_command` treats `cdp_url` as skip-launch (`actions.rs:2981`), so the daemon's own auto-launch, including an `AGENT_BROWSER_PROVIDER` launch, never runs to answer it. CLI side: `main.rs` sends none of its pre-launches for `cdp_url`: auto-connect, `--cdp`, `-p/--provider` and the local launch config. The `prelaunch_allowed` helper decides this. **Revision 2:** it also sends none for a `batch` whose every command is `get cdp-url`, whether the batch comes as arguments, on stdin or through the MCP `agent_browser_batch` tool. It reads the batch the way `command_is_browserless` does. A mixed batch still launches; its `get cdp-url` step is refused by the daemon wherever the URL is withheld. The MCP `agent_browser_get_cdp_url` tool runs `get cdp-url` through the CLI, so it gets both halves. A session that already has a browser, is not a provider session and has a credential-free URL still answers its URL. |

### Daemon reuse (revision 2, `connection.rs:633`)

Revision 1 read every switch only in the daemon, and none of them was part of the CLI's reuse decision.
`ensure_daemon` reuses any live daemon whose `daemon_config_fingerprint` matches, and that hashed only `debug`,
`action_policy`, `confirm_actions`, `idle_timeout`, `default_timeout` and `no_auto_dialog`. So a stock-started daemon,
with a stream port, was silently reused by a later run with `NO_STREAM`, `PEER_PIDS` or `HIDE_CDP_URL` set. The port
stayed open, `stream enable` worked, and the daemon's half of HIDE was off. The switches failed open.

Now the fingerprint also hashes the four switches, normalised by the daemon's own parsers (`Bu14Switches::from_env`). It
hashes them only when one is on, so with every switch unset (or explicitly off) the fingerprint is stock's byte for
byte. A test proves this against the stock formula. A live daemon whose switches differ is stopped and respawned.

What this costs, for the product (EY-5):
- **A caller without the switches restarts a switched daemon back to stock**, and the browser session goes with it. So
  every caller on that socket folder must set the same switches. The CLI half of HIDE already required that. The
  cleaner way is for the product to keep its own `AGENT_BROWSER_SOCKET_DIR`, which no stock caller shares.
- **`PEER_PIDS` must be one value for the daemon's whole life.** A different list restarts the daemon. A list that
  names per-call CLI pids would restart it on every call.
- The restart's stop is the tag's own: a graceful shutdown over the socket, then a kill by the pid file. A refused peer
  of the same uid can therefore still restart the daemon, as any same-uid process can at the tag.

## Review round (revision 2)

Each finding was confirmed in the source before it was fixed. None was skipped.

1. **`inspect` opened a TCP listener under `NO_STREAM`, and its redirect could carry the URL's query.** Confirmed:
   `handle_inspect` → `InspectServer::start` binds `127.0.0.1:0`, `inspect_origin_allowed(None, …)` is `true`, and
   `chrome_host_port()` splits on `/` only. Fixed in parts 1 and 3. Tests:
   `test_bu14_inspect_refuses_under_no_stream_opt_out` and
   `test_bu14_inspect_refuses_for_provider_session_under_hide`.
2. **The dashboard bound `:4848` under `NO_STREAM`.** Confirmed: `run_dashboard_server` binds both loopbacks, and
   `access_token_matches` admits a loopback `Host` without a token (`dashboard.rs:279-293`). Fixed in part 1, in
   `main.rs`'s two entry points. No unit test, because both refusals `exit(1)` in `main`. A dashboard that was already
   running before the switch is not stopped (see "Not done").
3. **A daemon without the switches was reused silently.** Confirmed (`connection.rs:633-642`, `:705-720`). Fixed; see
   "Daemon reuse". Test: `test_bu14_fingerprint_tracks_switches`.
4. **The switch parser failed open on `TRUE`, `yes` and similar.** Confirmed against `flags.rs:261`. Fixed; see
   "Switch values". `test_bu14_env_flag_is_set` now expects `yes`, `TRUE`, `True` and `on` to be on.
5. **A batch of only `get cdp-url` still launched.** Confirmed: `prelaunch_allowed` saw the action `batch`, and the
   pre-launches (`main.rs:1849-2060` at the tag) run before `run_batch`. Fixed in part 3. Test:
   `test_bu14_prelaunch_allowed_batch`.
6. **The uid check ran with every switch unset, and a blank `PEER_PIDS` failed open.** Confirmed. Fixed in part 2
   with a gate (`PEER_PIDS` present or `PEER_UID_CHECK` on), and a blank value now admits no one. Tests:
   `test_bu14_peer_policy_is_off_by_default`, `test_bu14_parse_peer_pids` and `test_bu14_switches_from_env`.
7. **Listeners and URLs outside the three parts.** Confirmed: (a) `chrome.rs:466` passes `--remote-debugging-port=0`;
   (b) `launch_safari` binds `127.0.0.1:0` to pick a port, and safaridriver then listens on TCP; (c) the Windows daemon's
   IPC is TCP with no peer check (`daemon.rs:400`); (d) `handle_cdp_url` checked only provider state. (d) is fixed in
   part 3. Test: `test_bu14_cdp_url_may_carry_credential`. (a), (b) and (c) are in "Not done". For (a), the tag's CDP
   client has no pipe transport, so `--remote-debugging-pipe` is a new transport, not a switch.

## Toolchain

- `rustc 1.97.1 (8bab26f4f 2026-07-14)`
- `cargo 1.97.1 (c980f4866 2026-06-30)`
- `rustup 1.29.1`; the active toolchain is `stable-aarch64-apple-darwin`, the default. The tag has no `rust-toolchain`
  file.
- Host: macOS (Darwin 25.5.0), arm64. The load average was about 12–39 during revision 1's build, and about 8–18 during
  revision 2's.

## Commands (run in `‹build-root›/build-patched/cli`)

Before each build, `ps -axo pid=,command= | awk -f ‹guard-script›` printed nothing.

```sh
CARGO_TARGET_DIR=‹build-root›/target-patched nice -n 19 \
  cargo build --release --locked -p agent-browser
CARGO_TARGET_DIR=‹build-root›/target-patched nice -n 19 \
  cargo test --locked -p agent-browser --bin agent-browser -- \
  bu14 native::daemon:: native::actions::tests::test_stream cdp_url \
  connection::tests::test_daemon_config connection::tests::test_spawn \
  connection::tests::test_ready_existing browserless --skip e2e
```

The profile is the tag's own `release`: `lto = true`, `codegen-units = 1`, `strip = true`. `--locked` held
`Cargo.lock` as shipped, and cargo downloaded the crates it was missing from crates.io (revision 1; revision 2 needed
no new crate).

## Build time

- **Revision 1:** the first build ran 17:28:14Z → 17:33:55Z (`Finished … in 5m 41s`). It was rebuilt once (3m 47s)
  after `rustfmt` rewrapped two lines. The binary is superseded.
- **Revision 2 (the recorded binary):** 17:55:06Z → 17:58:26Z. Cargo compiled the crate only: `Finished release …
  in 3m 19s` (`real 200.00`, `user 186.93`, `sys 6.58`). The log has no warnings. A second `cargo build` reported
  `Finished … in 0.67s` with nothing compiled, and no `.rs` file under `cli/src` is newer than the binary, so the binary
  is fresh.

Target directory size after the build and the tests: 3.3 GB.

## The binary

- Path: `‹build-root›/target-patched/release/agent-browser`
- Mach-O 64-bit arm64 executable, 13,904,528 bytes. Its mtime is 2026-10-31 10:58:26 local time (17:58:26Z).
- SHA-256 (hex): `f3a53cbce43fe30875d7d785a6f67647af4e96d987b8ea889fee8f0e68213dea`
- SHA-256 (base64): `86U8vOQ/4wh119eFpvZ2R69OltmHuOqIn+6PDmghPeo=` (SRI form
  `sha256-86U8vOQ/4wh119eFpvZ2R69OltmHuOqIn+6PDmghPeo=`)
- `agent-browser --version` prints `agent-browser 0.41.0`.
  - npm 0.41.0 prints the same string, and so did revision 1. Only the SHA-256 tells the three apart. This is rule 6's
    case: give each phase its own socket folder and session names.
  - The binary embeds the dashboard placeholder that `build.rs` wrote, not the real dashboard. Under
    `AGENT_BROWSER_NO_STREAM` no dashboard is served at all: the stream server is off and `dashboard start` refuses.

## Tests

The test run went from 17:53:58Z to 17:54:54Z (`real 56.92`; the crate's debug build was most of it). The compile had
no warnings.

`test result: ok. 42 passed; 0 failed; 0 ignored; 0 measured; 1672 filtered out`

The BU-14 tests, all passing:
- `native::daemon::tests::test_bu14_env_flag_is_set`: upstream's convention, including `yes`, `TRUE`, `on`, `FALSE`
  and ` No `.
- `test_bu14_stream_opt_out_reads_env`, now also checking `TRUE`.
- `test_bu14_parse_peer_pids`: a blank value is now an empty list.
- `test_bu14_peer_policy_is_off_by_default` (new): no check with both peer switches unset or off.
- `test_bu14_switches_from_env` (new).
- `test_bu14_peer_refusal_rules`.
- `test_bu14_check_unix_peer_on_a_real_socket`: a real `UnixListener`/`UnixStream` pair in a tempdir. It reads this
  process's own pid through `LOCAL_PEERPID` and checks that a list holding it admits, a list without it refuses, and an
  empty list refuses.
- `connection::tests::test_bu14_fingerprint_tracks_switches` (new): with every switch unset, the fingerprint equals
  the stock formula. Each switch moves it. Spellings that parse alike (`1`/`TRUE`, `12,34`/` 12 , 34 `) do not.
- `native::actions::tests::test_bu14_stream_enable_refuses_under_no_stream_opt_out`.
- `test_bu14_inspect_refuses_under_no_stream_opt_out` (new): it refuses directly and through `execute_command` with a
  nonexistent `AGENT_BROWSER_PROVIDER`, with no browser and no provider state afterwards. With the switch unset it gives
  stock's `Browser not launched`.
- `test_bu14_inspect_refuses_for_provider_session_under_hide` (new).
- `test_bu14_cdp_url_may_carry_credential` (new).
- `test_bu14_cdp_url_withheld_for_provider_session`: refused with the switch on, and stock's answer with it unset or
  `0`.
- `test_bu14_cdp_url_switch_ignores_non_provider_session`.
- `test_bu14_cdp_url_hidden_never_launches`: `execute_command` with `cdp_url` on a fresh state, with
  `AGENT_BROWSER_PROVIDER` naming a provider that does not exist. It answers `Browser not launched`, with no browser and
  no provider state; a launch attempt would have surfaced as a provider error instead.
- `tests::test_bu14_prelaunch_allowed` (main.rs; now also `inspect` under `NO_STREAM`).
- `tests::test_bu14_prelaunch_allowed_batch` (new): only `get cdp-url`, from argv and from argument strings, launches
  nothing under HIDE. A mixed batch, a `get url` batch and an empty batch launch as stock.

The existing tests in the run also pass: every test in `native::daemon`, the four existing `test_stream_*` tests in
actions, `commands::tests::test_get_cdp_url`, and the five `connection` config tests
(`test_daemon_config_fingerprint_tracks_daemon_owned_options`, which now holds the env lock, `test_spawn_race_*` ×2,
`test_spawn_owner_writes_config` and `test_ready_existing_daemon_waits_for_startup_config`). The `browserless` filter
matched no test.

## Not done

1. **The binary has not been run.** These are S1-W 15's patched half and belong to the sitting:
   - under `NO_STREAM`, `lsof -nP -iTCP -sTCP:LISTEN -p <daemon pid>` shows no stream port. It will still show Chrome's
     own DevTools port; see item 5(a).
   - no `.stream` file appears;
   - `stream enable`, `inspect` and `dashboard start` refuse, through the CLI and through MCP;
   - the localhost attacker page is refused;
   - a peer that is not on `PEER_PIDS` is dropped;
   - `get cdp-url` refuses on a provider session and on a `--cdp wss://…?token=…` attach;
   - a stock-started daemon on the same session is restarted, not reused, when the switches are set.

   Checking the binary's SHA-256 against this record comes before any of it (rule 3).
2. **The daemon-start path has no unit test.** Nothing tests `run_daemon` skipping the stream server, because that
   needs a whole daemon; the `lsof` case covers it live. Nothing tests the accept loop's drop end to end either; the
   decision function and a real socket's credentials are tested. The two dashboard refusals have no test, because both
   `exit(1)` in `main`.
3. **The drop line is invisible by default.** The daemon sends stderr to `/dev/null` unless `AGENT_BROWSER_DEBUG` is
   set; with it set, the line goes to `<session>.log`. So the "single line on drop" can only be seen in debug mode.
4. **Windows is unpatched:** its daemon IPC is TCP (`daemon.rs:400`) with no peer check. A different-uid peer test
   (`sudo -u nobody`) was not run either.
5. **TCP listeners and URLs left under the switches, outside the three parts:**
   - (a) **Chrome's own DevTools port.** Every local Chrome launches with `--remote-debugging-port=0` (`chrome.rs:466`).
     That is an unauthenticated CDP listener on loopback, open to any uid, and the largest listener left under
     `NO_STREAM`. The fix is `--remote-debugging-pipe`, but the tag's CDP client has no pipe transport, so it is a new
     transport. The sitting's `lsof` will see this port.
   - (b) **Safari.** `launch_safari` briefly binds `127.0.0.1:0` to pick a port, and safaridriver then listens on TCP.
   - (c) **The Windows daemon's TCP IPC** (item 4).
   - (d) **A dashboard already running** from before the switch was set is not stopped. `NO_STREAM` only refuses to
     start one.
   - (e) **A plugin provider's own URL**, if it attaches without setting provider state and with a credential in the
     path rather than in the query or userinfo, is not recognised. Revision 2 withholds only query and userinfo.
   - The `0700` socket folder (Issue 2's other ask), and the help text, README and docs that PR #1591 also changes.
6. **Under `HIDE_CDP_URL`, every CLI pre-launch is skipped for `get cdp-url`,** not only the provider's: `--cdp` and
   auto-connect too. So `get cdp-url --cdp <url>` on a fresh session answers `Browser not launched`. The same holds for
   a batch of only `get cdp-url`.
7. **Not run:** `cargo clippy`, and the crate's full test suite (1714 tests). Only the touched modules' tests ran.
8. **Not installed or copied anywhere.** The binary was not put into `ey/`, and nothing under `draft/` holds it.
9. **The pin is not a sibling yet.** BU-14 makes agent-browser a sibling: a `siblings.lock.json` entry and a dedicated
   checkout. That is the product's step at EY-5, not this build's. That step also decides how the product meets
   "Daemon reuse"'s cost: its own `AGENT_BROWSER_SOCKET_DIR`, or the same switches on every caller.
