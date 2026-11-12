import { createConnection } from "node:net";
import { homedir } from "node:os";
import { delimiter, posix, win32 } from "node:path";
import {
  pipeEndpointFor,
  SOCKET_ALIAS_PARENT_ENV,
  SOCKETS,
  socketAliasParentFrom,
  unixEndpointFor,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { ensureSocketDirOutcome } from "@vibefield/users";

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

/** WIN-D1 — where field-native binds ONE of the `SOCKETS` names under
 * `dataRoot`: a name derived from the root in the flat pipe namespace on win32
 * (nothing appears on disk), the joined LAYOUT path everywhere else. The root
 * handed here MUST be the string field-native receives as FIELD_NATIVE_DATA_DIR
 * — the scope is a hash of it. The supervisor's twin of this law is
 * fieldd-supervisor/src/paths.ts.
 *
 * Every channel resolves through THIS function. It generalized from a
 * mgmt-only helper on 2026-08-11 because the mesh's byte lane never did: the
 * meshdata dial was still `join(dataDir, ...LAYOUT.MESHDATA_SOCKET)` — a
 * filesystem path for an endpoint field-native binds as a pipe, so on win32 it
 * could only ever ENOENT, silently, inside a best-effort catch. A per-channel
 * copy of one law is how that happens; there is now one copy. */
export function nativeEndpoint(
  dataRoot: string,
  socketFile: string,
  platform = process.platform,
  uid = process.getuid?.() ?? 0,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Item 345: the unix arm is the endpoint law itself (contracts' `unixEndpointFor`, field-native's
  // `unix_endpoint_for` its twin): the run-dir path for a root whose worst socket path fits sun_path, the short
  // alias `<parent>/vf-<uid>/<scope>/<file>` for a root over the line, under the SAME parent the keeper uses. It
  // joins with "/" alone, so a Windows test host never backslashes the unix arm. This derives; every dial runs
  // `ensureNativeSocketDir` first.
  return platform === "win32"
    ? pipeEndpointFor(dataRoot, socketFile)
    : unixEndpointFor(uid, dataRoot, socketFile, socketAliasParent(env));
}

/** Item 345, the seam slice — the alias's parent for this process: contracts' `socketAliasParentFrom` over
 * `SOCKET_ALIAS_PARENT_ENV`. Unset is the product's `/tmp`; a harness (tests, smokes, lab runs) sets a short folder
 * of its own run's. Both the derivation above and the keeper below read it here, so they can never name two
 * parents. A relative or empty value throws. */
export function socketAliasParent(env: NodeJS.ProcessEnv = process.env): string {
  return socketAliasParentFrom(env[SOCKET_ALIAS_PARENT_ENV]);
}

/** Item 345 — fieldd's boot reads the parent ONCE before anything dials: a relative or empty value throws and ends
 * the boot, and a set value is said in one log line with no path, so a product launch handed the harness seam is
 * visible in its log. */
export function noteSocketAliasParent(
  logger: Pick<Logger, "info">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  socketAliasParent(env);
  if (env[SOCKET_ALIAS_PARENT_ENV] !== undefined) {
    logger.info(
      "fieldd.socket_alias.parent_overridden",
      "The socket alias's parent is a harness's own, not the product's",
    );
  }
}

/** The management channel — the endpoint fieldd's NativeLink dials. */
export function nativeMgmtEndpoint(dataRoot: string, platform = process.platform): string {
  return nativeEndpoint(dataRoot, SOCKETS.MGMT, platform);
}

/** Item 345 — run before EVERY dial of a field-native socket: the alias's keeper (users' `ensureSocketDirOutcome`)
 * for this root. A root that fits touches nothing, and win32's pipes have nothing to keep. A refusal throws the
 * keeper's UsersError (its words name the alias and its mode, never the data root), and the dial fails with it. A
 * link pointing elsewhere was replaced: one warning line, naming the alias alone. */
export function ensureNativeSocketDir(
  dataRoot: string,
  logger: Pick<Logger, "warn">,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (platform === "win32") return;
  const outcome = ensureSocketDirOutcome(dataRoot, { parent: socketAliasParent(env) });
  if (outcome.replaced) {
    logger.warn(
      "fieldd.socket_alias.replaced",
      "A socket alias pointed elsewhere and was replaced by a rename inside its own folder",
      { alias: outcome.dir },
    );
  }
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

/** AL-1 — fieldd outlives the shell that spawned it (EL1), and that shell's stdio pipes do not: the supervisor reads
 * fieldd's stdout and stderr as pipes, and once it is gone a DIRECT write to either fails with EPIPE, asynchronously.
 * An unhandled stream `'error'` ends the process (measured 2026-10-26 on Node 26: exit 1), so a shell-less fieldd died
 * the first time its log writer failed — the logging emergency path (`emitEmergency`) writes stderr directly, and its
 * try/catch cannot catch an asynchronous error. With a listener the failure is that write's own: the bytes had no
 * reader, and the structured log stays the record. `console.*` already ignores stream errors; this covers the writes
 * that bypass it. */
export function outliveStdioReaders(
  streams: readonly NodeJS.WritableStream[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) stream.on("error", ignoreStdioError);
}

function ignoreStdioError(): void {}
