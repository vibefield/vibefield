// fieldd standalone entry (Track A): ensure the native plane, then bootstrap.
// Spawned by the Electron shell (adopt-or-spawn) or run by hand:
//   FIELDD_DATA_DIR=… FIELDD_NATIVE_BIN=…/field-native node dist/bin.cjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { PORTS } from "@vibefield/contracts";
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
  const dataDir =
    process.env["FIELDD_DATA_DIR"] ??
    join(homedir(), "Library", "Application Support", "VibeField");
  const portEnv = process.env["FIELDD_CONTROL_PORT"];
  // the data lane binds the registered port by default (the daemon's own default
  // is ephemeral, for test isolation) — FIELDD_DATA_PORT overrides, 0 = ephemeral.
  const dataPortEnv = process.env["FIELDD_DATA_PORT"];
  const nativeBin = process.env["FIELDD_NATIVE_BIN"];
  const allowedOrigins = [
    "file://",
    ...(process.env["FIELDD_ALLOWED_ORIGINS"]?.split(",").filter(Boolean) ?? []),
  ];

  let nativePid: number | undefined;
  const socketPath = join(dataDir, "native", "run", "mgmt.sock");
  if (nativeBin && !(await nativeAlive(socketPath))) {
    // The native plane outlives this fieldd (OS plane; launchd owns it later).
    // field-native unlinks a stale socket itself before binding.
    const child = spawn(nativeBin, [], {
      env: { ...process.env, FIELD_NATIVE_DATA_DIR: dataDir },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    nativePid = child.pid;
  }

  const daemon = await bootstrap({
    dataDir,
    ...(portEnv !== undefined ? { controlPort: Number(portEnv) } : {}),
    dataPort: dataPortEnv !== undefined ? Number(dataPortEnv) : PORTS.FIELDD_WS_DATA,
    allowedOrigins,
    ...(nativePid !== undefined ? { nativePid } : {}),
    onFatal: (reason) => {
      process.stderr.write(`fieldd fatal: ${reason}\n`);
      process.exit(1);
    },
  });
  process.stdout.write(
    JSON.stringify({ ready: true, port: daemon.controlPort, bootId: daemon.bootId }) + "\n",
  );

  const shutdown = () => {
    void daemon.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`fieldd failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
