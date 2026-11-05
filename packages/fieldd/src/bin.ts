// fieldd standalone entry (Track A): ensure the native plane, then bootstrap.
// Spawned by the Electron shell (adopt-or-spawn) or run by hand:
//   FIELDD_DATA_DIR=… FIELDD_NATIVE_BIN=…/field-native node dist/bin.cjs
//
// THE SAME ENTRY RUNS EVERY ROLE (roles.ts): a packaged fieldd is a single
// executable, so its files worker and its agents' launcher runtime are this
// executable again with a role as its first argument. So NOTHING but builtins
// and roles.ts is imported at this file's top: the daemon's whole module graph —
// the contracts, logging, the users root, the boot environment and the daemon —
// is imported inside `main()`, and esbuild's bundle (package.json's first step,
// cjs) leaves a module reached only by `import()` unevaluated until it is
// called. A role pays for builtins and its own bundle, and an agent typed in a
// pane waits for nothing of the daemon's.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  AGENT_SHIM_BUNDLE,
  AGENT_SHIM_EXIT_UNAVAILABLE,
  agentShimArgv,
  agentShimUnavailable,
  FILES_HOST_BUNDLE,
  roleOf,
  TRANSCRIPT_HOST_BUNDLE,
  unknownRoleLine,
} from "./roles";

async function main(): Promise<void> {
  // Imported in the order the file's top once imported them; none of them writes.
  const { FIELDD_TRUST_ROOT_ENV, FIELDD_TRUST_ROOT_KEYS_ENV } = await import(
    "@vibefield/contracts"
  );
  const { pairLogRoot, resolvePlatformLogRoot } = await import("@vibefield/logging");
  const { ensureUsersRoot, rootAboveUserRoot } = await import("@vibefield/users");
  const { defaultDataRoot, nativeAlive, nativeMgmtEndpoint, outliveStdioReaders, splitPathList } =
    await import("./boot-env");
  // AL-1 — before anything writes: this process outlives the shell that reads its stdio (boot-env.ts).
  outliveStdioReaders();
  // FS-1a — the daemon's module graph loads HERE, never at the bundle's top:
  // the same bundle runs as the files worker and the agent shim (below), which
  // must not carry it
  const { bootstrap } = await import("./daemon");
  // UA-1 — a supervisor-spawned fieldd receives the resolved USER root
  // explicitly; a standalone/headless run receives the VibeField ROOT (or the
  // platform default, mirroring config.rs default_data_dir() exactly — UA-0)
  // and is its own supervisor: migrate-or-mint under the §3.3 lock, then run
  // out of the attached user's root.
  const explicitUserRoot = process.env["FIELDD_USER_ROOT"];
  let userId = process.env["FIELDD_USER_ID"];
  let dataDir: string;
  // AR-2 — the machine scope hangs off the VibeField ROOT. A supervised fieldd
  // is handed its USER root only, so the root comes from the layout it sits in
  // (`<root>/users/<fuid>`, users spec UA-1); an injected root of any other
  // shape has no machine scope, and the distribution doors say so.
  let vibefieldRoot: string | undefined;
  if (explicitUserRoot !== undefined) {
    dataDir = explicitUserRoot;
    vibefieldRoot = rootAboveUserRoot(explicitUserRoot);
  } else {
    const ensured = await ensureUsersRoot(process.env["FIELDD_DATA_DIR"] ?? defaultDataRoot());
    dataDir = ensured.userRoot;
    userId ??= ensured.user.userId;
    vibefieldRoot = ensured.rootReal;
  }
  const portEnv = process.env["FIELDD_CONTROL_PORT"];
  // the data lane binds the registered port by default (the daemon's own default
  // is ephemeral, for test isolation) — FIELDD_DATA_PORT overrides, 0 = ephemeral.
  const dataPortEnv = process.env["FIELDD_DATA_PORT"];
  const nativeBin = process.env["FIELDD_NATIVE_BIN"];
  // AR-0 — the agent-index daemon (rosettad) this fieldd supervises for its
  // user. Unset ⇒ nothing is spawned and health says "unconfigured" honestly;
  // the dev runner sets it when `pnpm siblings:build` has produced the binary.
  // Empty means unset (a runner that resolved no binary exports ""): the
  // honest "unconfigured", never a spawn of "" that fails as ENOENT.
  const rosettadBin = process.env["FIELDD_ROSETTAD_BIN"] || undefined;
  // AR-7 — a harness's seam, never the product's: the PATH the agents' install
  // inventory searches (`FielddConfig.agentSearchPath`; unset = this process's
  // PATH). The godview smoke points it at its stub's own directory, so no
  // install of the machine owner's is found, inspected or run by its daemon.
  const agentSearchPath = process.env["FIELDD_AGENT_SEARCH_PATH"];
  const allowedOrigins = [
    "file://",
    ...(process.env["FIELDD_ALLOWED_ORIGINS"]?.split(",").filter(Boolean) ?? []),
  ];
  // PLUG-P2 — plugin discovery roots, PATH-style lists. The spawner (shell in
  // dev, packaged app later) decides them; unset ⇒ an empty registry, honestly.
  const pluginRoots = {
    bundled: splitPathList(process.env["FIELDD_PLUGIN_ROOTS"]),
    devLinked: splitPathList(process.env["FIELDD_PLUGIN_DEV_ROOTS"]),
  };
  // WP8c — the trust anchor for bundled roots, handed over by the shell (the packaged layout reads it from
  // Resources/identity; a smoke sets it in the launching shell). Both or neither: a trust-root without the root
  // keys it must be signed by is an anchor that verifies nothing, so it keys the roots with no keys — every
  // bundled root then refuses, honestly, rather than walking unverified.
  const trustRootPath = process.env[FIELDD_TRUST_ROOT_ENV];
  const bundledTrust =
    trustRootPath === undefined || trustRootPath === ""
      ? undefined
      : {
          trustRootPath,
          rootKeys: (process.env[FIELDD_TRUST_ROOT_KEYS_ENV] ?? "").split(",").filter(Boolean),
        };
  // P4 — the bundled daemon ships the worker harness beside bin.cjs; source
  // runs resolve it in-package. Explicit env always wins.
  const serviceHarnessPath =
    process.env["FIELDD_SERVICE_HARNESS"] ?? join(__dirname, "service-harness.mjs");
  // Item 78 (UA-D16 reversed 2026-10-27; LOG §6.5, §7.1) — this USER's pair logs under its own root, derived from the
  // user root it runs out of (`<root>/users/<fuid>` → `<log root>/users/<fuid>`). The launcher hands the PLATFORM
  // root (the shell does, under its own mode policy); every user's fieldd used to write the platform root itself, so a
  // second user's was refused as `writer-conflict` and logged nothing. field-native is handed the derived root below.
  const logRoot = pairLogRoot(
    resolvePlatformLogRoot({
      allowOverride: process.env["FIELDD_ALLOW_LOG_DIR_OVERRIDE"] === "1",
    }),
    dataDir,
  );

  let nativePid: number | undefined;
  const mgmtEndpoint = nativeMgmtEndpoint(dataDir);
  // TC-D1 — ONE spawn serves the boot ensure AND every supervisor respawn:
  // two derivations of this env composition would be the drift class wearing
  // its usual hat. The supervisor re-runs it only after failed redials plus a
  // fresh endpoint probe confirming no listener (the double-spawn guard).
  const spawnNative =
    nativeBin === undefined
      ? undefined
      : (): number | undefined => {
          // The native plane outlives this fieldd (OS plane; launchd owns it
          // later). field-native unlinks a stale socket itself before binding.
          const child = spawn(nativeBin, [], {
            env: {
              ...process.env,
              // fieldd passes the PAIR's root it already derived (item 78: users/<fuid>
              // under the platform root the trusted shell mode decision resolved).
              // field-native never trusts an ambient override alone.
              // WIN-D1 — and it is the SAME string the probe above resolved its
              // endpoint from: on win32 both planes derive the pipe name from a hash of
              // this root, so re-spelling it here (a resolve, a realpath, a trailing
              // separator) is a pair that binds one name and dials another.
              FIELD_NATIVE_DATA_DIR: dataDir,
              FIELD_LOG_DIR: logRoot,
              FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
              // TP-S3a — the SAME renderer origins fieldd's own door admits
              // reach the cells' T1 doors (terminal-pipeline-v3 §8 door
              // hygiene): one allow-list, one authority, passed down at spawn.
              FIELD_NATIVE_ALLOWED_ORIGINS: allowedOrigins.join(","),
              // Level overrides remain development/test-only even though fieldd
              // inherits a broad shell environment.
              FIELD_NATIVE_LOG_FILTER:
                process.env["FIELDD_ALLOW_LOG_DIR_OVERRIDE"] === "1"
                  ? process.env["FIELD_NATIVE_LOG_FILTER"]
                  : undefined,
              FIELD_NATIVE_ALLOW_LOG_FILTER:
                process.env["FIELDD_ALLOW_LOG_DIR_OVERRIDE"] === "1" &&
                process.env["FIELD_NATIVE_ALLOW_LOG_FILTER"] === "1"
                  ? "1"
                  : undefined,
            },
            detached: true,
            // Routine evidence is process-owned NDJSON now. stdout has no logging
            // protocol; stderr is only the one-shot emergency fallback and inherits
            // the launch chain without making fieldd its collector.
            stdio: ["ignore", "ignore", "inherit"],
          });
          child.unref();
          return child.pid;
        };
  if (spawnNative !== undefined && !(await nativeAlive(mgmtEndpoint))) {
    nativePid = spawnNative();
  }

  const daemon = await bootstrap({
    dataDir,
    ...(vibefieldRoot !== undefined ? { vibefieldRoot } : {}),
    logRoot,
    // UA-D12 — ephemeral by default; env pins a port only when a harness
    // explicitly asks. product.json records the ACTUAL bound ports either way.
    controlPort: portEnv !== undefined ? Number(portEnv) : 0,
    dataPort: dataPortEnv !== undefined ? Number(dataPortEnv) : 0,
    allowedOrigins,
    pluginRoots,
    ...(bundledTrust !== undefined ? { bundledTrust } : {}),
    serviceHarnessPath,
    ...(nativePid !== undefined ? { nativePid } : {}),
    ...(spawnNative !== undefined ? { nativeSpawner: spawnNative } : {}),
    ...(rosettadBin !== undefined ? { rosettadBin } : {}),
    ...(agentSearchPath !== undefined ? { agentSearchPath } : {}),
    // AR-S1c — this is the product's daemon: read the agents' installs at boot.
    agentInventoryWarm: true,
    ...(process.env["FIELDD_BUILD_ID"] ? { buildId: process.env["FIELDD_BUILD_ID"] } : {}),
    ...(userId !== undefined ? { userId } : {}),
    onFatal: (reason) => {
      process.stderr.write(`fieldd fatal: ${reason}\n`);
      process.exit(1);
    },
  });
  process.stdout.write(
    `${JSON.stringify({ ready: true, port: daemon.controlPort, bootId: daemon.bootId })}\n`,
  );

  const shutdown = () => {
    void daemon.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // WIN-D5 — the same graceful path, reachable as a VERB: SIGTERM never fires
  // on win32, so the supervisor asks over the authenticated channel instead.
  daemon.onShutdownRequest(shutdown);
}

/** Whether this process is fieldd's single executable (a packaged build). */
function isSea(): boolean {
  try {
    const builtin = process.getBuiltinModule?.("node:sea") as { isSea?: () => boolean } | undefined;
    return builtin?.isSea?.() === true;
  } catch {
    // a Node with no such module is no single executable
    return false;
  }
}

/** Where a role's sealed bundle stands: beside the executable when fieldd is a
 * single executable (F-11: a SEA's `__dirname` is that directory too, said
 * here by the executable's own path rather than leaned on), beside this bundle
 * otherwise — `dist/` in development. */
function sealedDirectory(): string {
  return isSea() ? dirname(process.execPath) : __dirname;
}

/** AR-7j (electron-security-packaging.md §9.3) — a packaged process of fieldd's
 * that STAYS (the daemon, the files worker) opens no inspector by a signal. On
 * Node, SIGUSR1 opens one on 127.0.0.1, and a same-uid process may send it. A
 * listener of our own takes the signal from Node's inspector (measured on a plain
 * Node 26.5.0: SIGUSR1 then opens nothing and the process runs on; the SEA's own
 * reading is build-fieldd-sea --verify's and desk-gates row 34's), from this
 * statement on; the executable's own start, before its first statement runs, is
 * the window that remains.
 *
 * Not the blob's `--disable-sigusr1`: that flag leaves SIGUSR1 BLOCKED for the
 * whole process (Node blocks it at start and only the inspector's handler
 * unblocks it), and the agent-shim role execs the agent in place, which keeps
 * the mask — every agent typed in a packaged pane, and whatever it starts that
 * does not reset its mask, would be born deaf to SIGUSR1, unlike under
 * `pnpm dev` (measured on a plain Node 26.5.0: `kill -USR1 $$` after the flag's execve
 * leaves sh running; without it sh dies 158). So the agent-shim role leaves
 * SIGUSR1 to Node, as a plain Node would: it holds nothing a process of the
 * same uid lacks, and lives only until the exec. Development (no single
 * executable) is left as it was. */
function refuseInspectorSignal(): void {
  if (!isSea()) return;
  process.on("SIGUSR1", () => {
    // taken from the inspector, and nothing more: the process runs on
  });
}

/** A start that failed, in words a log may keep: the logging library's own
 * sanitizer, and — should that library itself not load — the error's message
 * with the home directory said as `~`. */
async function startFailure(error: unknown): Promise<string> {
  try {
    const { serializeError } = await import("@vibefield/logging");
    return serializeError(error, { aliases: { home: homedir() } }).message;
  } catch {
    const message = error instanceof Error ? error.message : String(error);
    const home = homedir();
    return home === "" ? message : message.split(home).join("~");
  }
}

const role = roleOf(process.argv);
if (role === "files-host") {
  // FS-1a (L1) — the files worker's ROLE. A packaged fieldd is a single
  // executable that runs only its own blob, so fieldd starts its worker as
  // ITSELF with this argument (workspace/launch.ts), and the role loads the
  // worker's bundle staged beside the executable — the service harness's
  // precedent. The worker speaks only on its IPC pipe; started without one it
  // says so and leaves (host/main.ts).
  refuseInspectorSignal();
  const script = join(sealedDirectory(), FILES_HOST_BUNDLE);
  createRequire(script)(script);
} else if (role === "transcript-host") {
  // TH-1 (TH0-Q5 (b)) — the transcript worker's ROLE, the files worker's pattern: fieldd starts it as ITSELF with this
  // argument (transcripts/launch.ts), and the role loads its bundle staged beside the executable. It speaks only on
  // its IPC pipe, and the folder's key reaches it there, never in its environment (EL7).
  refuseInspectorSignal();
  const script = join(sealedDirectory(), TRANSCRIPT_HOST_BUNDLE);
  createRequire(script)(script);
} else if (role === "agent-shim") {
  // AR-7j — the agents' launcher runtime in a packaged build: every launcher
  // execs `<this executable> --vibefield-role=agent-shim <home>/lib/agent-shim.cjs
  // "$@"` (agent-gateway.ts `chooseLauncherRuntime`; the kit writes the line).
  // The role runs puppeteer's shim SEALED beside the executable, as if `node
  // <sealed> "$@"` had started it — never the home's copy at argv[3]
  // (`agentShimArgv` drops it unread; what that does and does not close is said
  // there). It runs no daemon, reads no FIELDD_* variable and writes no
  // readiness line: the shim is the whole of it, and it execs the agent in place
  // (one pid from the prompt to the agent, as under a real Node). SIGUSR1 is
  // left to Node (`refuseInspectorSignal` says why), so the agent is born with
  // it as under a plain Node.
  const sealed = join(sealedDirectory(), AGENT_SHIM_BUNDLE);
  process.argv = agentShimArgv(process.argv, process.execPath, sealed);
  try {
    createRequire(sealed)(sealed);
  } catch {
    // the sealed file is gone or broken (a damaged install): one line in the
    // person's terminal and the kit's "cannot run" status — never a stack trace
    process.stderr.write(`${agentShimUnavailable(process.env["PUPPETEER_SHIM_NAME"])}\n`);
    process.exit(AGENT_SHIM_EXIT_UNAVAILABLE);
  }
} else if (role === "unknown") {
  // A role this build does not have — a launcher another build of VibeField
  // wrote, still standing in a pane that outlived it (field-native outlives
  // fieldd). One line and the kit's cannot-run status, never the daemon: a
  // daemon booted from a pane would take the person's real root (its FIELDD_*
  // variables are stripped there) and print its readiness line into their
  // terminal. This build's fieldd rewrites the launchers at its next start.
  process.stderr.write(`${unknownRoleLine(process.env["PUPPETEER_SHIM_NAME"])}\n`);
  process.exit(AGENT_SHIM_EXIT_UNAVAILABLE);
} else {
  refuseInspectorSignal();
  main().catch(async (e: unknown) => {
    process.stderr.write(`fieldd failed to start: ${await startFailure(e)}\n`);
    process.exit(1);
  });
}
