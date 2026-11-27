# The pages engine's source build: its note and its patch

Item 658, 2026-11-26. This folder holds what the pages room's record (`../pages-record.ts`) names for the engine that
Electron main starts: `sourceBuild`, agent-browser 0.41.0 built from its tag with one patch laid on it.

| File | What it is | SHA-256 |
|---|---|---|
| `bu14-build.md` | The build note, revision 2: the tag, the patch, the toolchain, the commands, the tests run and the built binary's SHA-256. A **redacted copy** (below). | `54496b61c93eeb201941cd47e676995187d615b9fb90b015adb539a73867a623` |
| (the original) | The draft original of that note, which the record's converter read. It is not in the tree. | `8fcb9077ba97fd477c16fbe280b23bbf8fa5d6a2e4d990891a77c9f923c1f385` |
| `bu14-patch-1453dd3.diff` | The patch, **byte for byte**. Its SHA-256 is the record's `sourceBuild.patchSha256`. | `08274e8604452e6cfe1c167d98e6c3d63988e353a6c9cbe462d014140c7810f7` |
| `LICENSE-agent-browser` | agent-browser's own licence, the Apache License 2.0, copied byte for byte from the package at the pin. | |

## The note is a redacted copy

The copy differs from the original in these replacements alone. No line was reworded or re-wrapped, and every sum and
every other line is the original's byte for byte. A holder of the original makes the copy again by applying them and
checking the copy's SHA-256 above.

| In the original | In the copy |
|---|---|
| the absolute path of the build's root folder (the folder that holds `src-1453dd3`, `dl`, `build-patched` and `target-patched`), wherever it appears, sub-paths included | `‹build-root›` |
| the absolute path of the guard script that `awk -f` reads before each build | `‹guard-script›` |
| `On <a person's name>'s yes` (line 3; the sentence's date stays) | `On the owner's yes` |

## The patch

The patch holds changed lines and context lines of agent-browser 0.41.0 at its tag commit
`1453dd37a40c730fe00f592bc32198a896ff8747`. Those lines are its authors' work under the Apache License 2.0, whose text
is `LICENSE-agent-browser` beside it. It touches four files under `cli/`: `src/main.rs`, `src/connection.rs`,
`src/native/daemon.rs` and `src/native/actions.rs`.

The VibeField changes in it are three switches, each off unless set, so with all of them unset the engine behaves as
the tag does (the note's table has the detail):

1. **Stream off** (`AGENT_BROWSER_NO_STREAM`): the engine binds no stream server, writes no `.stream` file, and refuses
   `stream enable`, `inspect` and `dashboard start`, so it opens none of their loopback listeners.
2. **The peer check** (`AGENT_BROWSER_PEER_PIDS`, `AGENT_BROWSER_PEER_UID_CHECK`): the engine drops a socket peer whose
   uid is not its own and, when it was started with a pid list, one whose pid is not on it.
3. **The hidden CDP address** (`AGENT_BROWSER_HIDE_CDP_URL`): `get cdp-url` and `inspect` refuse for a provider session
   or a CDP URL that carries a query string or userinfo, and `get cdp-url` launches no browser to answer.

## What holds these files

`packages/contracts/test/pages-entry.test.ts` holds them to the record: the copy's SHA-256 is the one the record's
header names; the note states the record's tag, patch sum and darwin-arm64 binary sum under its revision 2, never
revision 1's superseded sums; the patch's bytes hash to `sourceBuild.patchSha256`; the licence is here.

Nothing in the tree builds the engine. That the recorded binary is this patch applied to this tag is the note's word.
