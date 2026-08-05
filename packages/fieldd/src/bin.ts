// fieldd standalone entry (Track A): ensure the native plane, then bootstrap.
// Spawned by the Electron shell (adopt-or-spawn) or run by hand:
//   FIELDD_DATA_DIR=… FIELDD_NATIVE_BIN=…/field-native node dist/bin.cjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { resolvePlatformLogRoot, serializeError } from "@vibefield/logging";
import { ensureUsersRoot } from "@vibefield/users";
import { bootstrap } from "./daemon";

function nativeAlive(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const s = createConnection(socketPath);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

async function main(): Promise<void> {
  // UA-1 — a supervisor-spawned fieldd receives the resolved USER root
  // explicitly; a standalone/headless run receives the VibeField ROOT (or the
  // platform default, mirroring config.rs default_data_dir() exactly — UA-0)
  // and is its own supervisor: migrate-or-mint under the §3.3 lock, then run
  // out of the attached user's root.
  const explicitUserRoot = process.env["FIELDD_USER_ROOT"];
  let userId = process.env["FIELDD_USER_ID"];
  let dataDir: string;
  if (explicitUserRoot !== undefined) {
    dataDir = explicitUserRoot;
  } else {
    const ensured = await ensureUsersRoot(
      process.env["FIELDD_DATA_DIR"] ??
        (process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support", "VibeField")
          : join(homedir(), ".local", "share", "VibeField")),
    );
    dataDir = ensured.userRoot;
    userId ??= ensured.user.userId;
  }
  const portEnv = process.env["FIELDD_CONTROL_PORT"];
  // the data lane binds the registered port by default (the daemon's own default
  // is ephemeral, for test isolation) — FIELDD_DATA_PORT overrides, 0 = ephemeral.
  const dataPortEnv = process.env["FIELDD_DATA_PORT"];
  const nativeBin = process.env["FIELDD_NATIVE_BIN"];
  const allowedOrigins = [
    "file://",
    ...(process.env["FIELDD_ALLOWED_ORIGINS"]?.split(",").filter(Boolean) ?? []),
  ];
  // PLUG-P2 — plugin discovery roots, PATH-style lists. The spawner (shell in
  // dev, packaged app later) decides them; unset ⇒ an empty registry, honestly.
  const splitRoots = (v: string | undefined): string[] => v?.split(":").filter(Boolean) ?? [];
  const pluginRoots = {
    bundled: splitRoots(process.env["FIELDD_PLUGIN_ROOTS"]),
    devLinked: splitRoots(process.env["FIELDD_PLUGIN_DEV_ROOTS"]),
  };
  // P4 — the bundled daemon ships the worker harness beside bin.cjs; source
  // runs resolve it in-package. Explicit env always wins.
  const serviceHarnessPath =
    process.env["FIELDD_SERVICE_HARNESS"] ?? join(__dirname, "service-harness.mjs");
  const logRoot = resolvePlatformLogRoot({
    allowOverride: process.env["FIELDD_ALLOW_LOG_DIR_OVERRIDE"] === "1",
  });

  let nativePid: number | undefined;
  const socketPath = join(dataDir, ...LAYOUT.MGMT_SOCKET);
  if (nativeBin && !(await nativeAlive(socketPath))) {
    // The native plane outlives this fieldd (OS plane; launchd owns it later).
    // field-native unlinks a stale socket itself before binding.
    const child = spawn(nativeBin, [], {
      env: {
        ...process.env,
        FIELD_NATIVE_DATA_DIR: dataDir,
        // fieldd passes the root it already resolved under the trusted shell
        // mode decision. field-native never trusts an ambient override alone.
        FIELD_LOG_DIR: logRoot,
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
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
    nativePid = child.pid;
  }

  const daemon = await bootstrap({
    dataDir,
    logRoot,
    // UA-D12 — ephemeral by default; env pins a port only when a harness
    // explicitly asks. product.json records the ACTUAL bound ports either way.
    controlPort: portEnv !== undefined ? Number(portEnv) : 0,
    dataPort: dataPortEnv !== undefined ? Number(dataPortEnv) : 0,
    allowedOrigins,
    pluginRoots,
    serviceHarnessPath,
    ...(nativePid !== undefined ? { nativePid } : {}),
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
}

main().catch((e: unknown) => {
  const error = serializeError(e, { aliases: { home: homedir() } });
  process.stderr.write(`fieldd failed to start: ${error.message}\n`);
  process.exit(1);
});
