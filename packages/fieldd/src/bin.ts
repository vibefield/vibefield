// fieldd standalone entry (Track A): ensure the native plane, then bootstrap.
// Spawned by the Electron shell (adopt-or-spawn) or run by hand:
//   FIELDD_DATA_DIR=… FIELDD_NATIVE_BIN=…/field-native node dist/bin.cjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { FIELDD_TRUST_ROOT_ENV, FIELDD_TRUST_ROOT_KEYS_ENV } from "@vibefield/contracts";
import { pairLogRoot, resolvePlatformLogRoot, serializeError } from "@vibefield/logging";
import { ensureUsersRoot, rootAboveUserRoot } from "@vibefield/users";
import {
  defaultDataRoot,
  nativeAlive,
  nativeMgmtEndpoint,
  outliveStdioReaders,
  splitPathList,
} from "./boot-env";
import { FILES_HOST_BUNDLE, FILES_HOST_ROLE_ARG } from "./workspace/launch";

async function main(): Promise<void> {
  // AL-1 — before anything writes: this process outlives the shell that reads its stdio (boot-env.ts).
  outliveStdioReaders();
  // FS-1a — the daemon's module graph loads HERE, never at the bundle's top:
  // the same bundle runs as the files worker (below), which must not carry it
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

if (process.argv.includes(FILES_HOST_ROLE_ARG)) {
  // FS-1a (L1) — the files worker's ROLE. A packaged fieldd is a single
  // executable that runs only its own blob, so fieldd starts its worker as
  // ITSELF with this argument (workspace/launch.ts), and the role loads the
  // worker's bundle staged beside the executable — the service harness's
  // precedent. The worker speaks only on its IPC pipe; started without one it
  // says so and leaves (host/main.ts).
  const script = join(__dirname, FILES_HOST_BUNDLE);
  createRequire(script)(script);
} else {
  main().catch((e: unknown) => {
    const error = serializeError(e, { aliases: { home: homedir() } });
    process.stderr.write(`fieldd failed to start: ${error.message}\n`);
    process.exit(1);
  });
}
