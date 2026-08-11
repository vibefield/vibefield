import { createConnection } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, posix, win32 } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";

// The environment fieldd's entry point is born into (bin.ts is a thin caller):
// the platform-shaped data-root default, the PATH-style list reader, and the
// native plane's mgmt endpoint plus its liveness probe. Every one of them takes
// its platform explicitly, so both shapes are provable from one machine — and
// none of them may drift from field-native's copy of the same decision.

/** UA-0 — the default VibeField ROOT when neither FIELDD_DATA_DIR nor
 * FIELDD_USER_ROOT was passed. Mirrors field-native's `config.rs
 * default_data_dir()` ARM FOR ARM, and on win32 lands where the shell's own
 * resolver lands (Electron's `appData` IS `%APPDATA%`). WIN-D1 makes that
 * lockstep load-bearing rather than tidy: both planes hash this string into the
 * pipe scope, so two spellings of the root are a pair that cannot find itself.
 * Separators need not match — the scope canonicalizes them — but the path SHAPE
 * must. */
export function defaultDataRoot(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  // posix.join / win32.join, never the host `join`: each arm is reachable from
  // the OTHER platform's test run, and a platform argument must fully determine
  // the output — separators included (the Rust twin is host-native per arm).
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "VibeField");
  if (platform === "win32") {
    return win32.join(env["APPDATA"] ?? win32.join(home, "AppData", "Roaming"), "VibeField");
  }
  return posix.join(home, ".local", "share", "VibeField");
}

/** PLUG-P2 — one PATH-style env list. WIN-3: the separator is `path.delimiter`,
 * never a hardcoded `":"`, which shreds every `C:\…` root into two nonexistent
 * ones. This is the READER half of a pair: the writer is electron-shell's
 * `main/fieldd.ts`, which joins with the same delimiter. Flipping one side alone
 * does not restore correctness — it mints a new silent break. */
export function splitPathList(value: string | undefined, listDelimiter = delimiter): string[] {
  return value?.split(listDelimiter).filter(Boolean) ?? [];
}

/** WIN-D1 — where field-native's management channel lives for `dataRoot`: a
 * name derived from the root in the flat pipe namespace on win32 (nothing
 * appears on disk), the joined LAYOUT path everywhere else. The root handed here
 * MUST be the string field-native receives as FIELD_NATIVE_DATA_DIR — the scope
 * is a hash of it. The supervisor's twin of this law is
 * fieldd-supervisor/src/paths.ts. */
export function nativeMgmtEndpoint(dataRoot: string, platform = process.platform): string {
  // posix.join, not host join: on a Windows test host the unix arm would
  // otherwise backslash the path (the win32 arm returns a pipe name). On the
  // real host this equals the joined LAYOUT path field-native binds.
  return platform === "win32"
    ? pipeEndpointFor(dataRoot, SOCKETS.MGMT)
    : posix.join(dataRoot, ...LAYOUT.MGMT_SOCKET);
}

/** Is the native plane already listening? The CONNECT ATTEMPT is the probe, on
 * both platforms. WIN-3 removed an `existsSync` pre-check that a named pipe can
 * never satisfy — no filesystem entry exists — so on win32 it read "dead"
 * forever and every fieldd boot spawned a SECOND field-native. Nothing is lost
 * on unix: a stale or absent socket fails the dial immediately, which is the
 * same answer the stat gave, one mechanism later. */
export function nativeAlive(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      // EBUSY means a win32 pipe NAME is published with every instance in use —
      // only a live server publishes one, so that is alive. Reading it as dead
      // would spawn the second native this probe exists to prevent.
      resolve(error.code === "EBUSY");
    });
  });
}
