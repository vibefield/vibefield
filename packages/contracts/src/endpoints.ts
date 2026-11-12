// WIN-D1 (thinking-windows-port §4.4) — the endpoint-resolution law. A local
// IPC endpoint is: on unix, the LAYOUT path joined under the data root by the
// consumer (node:path.join — byte-for-byte the pre-Windows behavior, which is
// why no unix join lives here); on win32, a named pipe in the flat machine-wide
// \\.\pipe\ namespace, so the name itself must carry what the run directory's
// 0700 boundary carried on unix: a scope. The scope is a hash of the data root,
// which keeps two users' pairs (UA-D10) and two data roots from ever sharing a
// pipe, without leaking the path into a namespace every local process can list.
//
// Both planes must derive the SAME name from the SAME data root, so the
// derivation is deliberately dependency-free and dumb: ASCII-only case fold +
// separator/trailing-slash normalization (Windows paths are case-insensitive
// and arrive via env with whatever casing the spawner had; non-ASCII is left
// untouched because JS and Rust Unicode case folds are not bit-identical and a
// missed fold only costs a redundant scope, never a collision), then FNV-1a
// 64-bit over the UTF-8 bytes. The Rust twin is hand-written in
// field-native/src/endpoints.rs and pinned to this one by
// fixtures/endpoint.vector.json — the layout.vector.json pattern (EL9).

import { APP_ID, LAYOUT, SOCKETS } from "./registries";

// APP_ID doubles as the pipe-name brand — one authority, and a change to it is
// a deliberate event the endpoint vector catches (it would orphan every running
// pair's discovery, exactly like moving the data root).
const PIPE_PREFIX = "\\\\.\\pipe\\";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `input`, as 16 lowercase hex chars.
 * Exported for the fixture test only; callers want `pipeEndpointFor`. */
export function fnv1a64Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Canonical form of a data root FOR SCOPE HASHING ONLY (never for the
 * filesystem): `\` → `/`, trailing slashes stripped, ASCII letters folded to
 * lowercase. Two spellings of one Windows directory hash alike; nothing else
 * is promised. */
export function canonicalDataRootForScope(dataRoot: string): string {
  let out = dataRoot.replaceAll("\\", "/");
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  let folded = "";
  for (const ch of out) {
    const code = ch.charCodeAt(0);
    folded += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : ch;
  }
  return folded;
}

/** The scope tag a data root contributes to its pipe names. */
export function pipeScope(dataRoot: string): string {
  return fnv1a64Hex(canonicalDataRootForScope(dataRoot));
}

/** The win32 endpoint for one of the SOCKETS names under `dataRoot`:
 * `\\.\pipe\vibefield-<scope>-<base>`, where `<base>` is the socket file name
 * minus its `.sock` suffix (`mgmt.sock` → `mgmt`). Unix callers never call
 * this — they join the LAYOUT path as always. */
export function pipeEndpointFor(dataRoot: string, socketFile: string): string {
  if (!socketFile.endsWith(".sock")) {
    throw new Error(`pipeEndpointFor wants a SOCKETS name (*.sock), got: ${socketFile}`);
  }
  const base = socketFile.slice(0, -".sock".length);
  return `${PIPE_PREFIX}${APP_ID}-${pipeScope(dataRoot)}-${base}`;
}

/** True for strings in the named-pipe namespace — the tolerant-reader check
 * for code that logs or validates an endpoint it was handed. */
export function isPipeEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(PIPE_PREFIX);
}

/** TC-S2 — the per-instance socket FILE name for a terminal-host cell:
 * `termctl.sock` + 2 → `termctl.2.sock`. The instance suffix is what makes a
 * cell restart NEVER a rebind — fresh names sidestep the stale-unlink hazard
 * (ADOPT-1's never-unlink-a-live-listener law) on unix and the
 * first-pipe-instance hold on win32 (a name stays held until its holder's
 * PROCESS exits). The derived name then flows through the SAME resolution law
 * as any SOCKETS name (`pipeEndpointFor` on win32, the LAYOUT join on unix);
 * the Rust twin is `cell_socket_file` in field-native/src/endpoints.rs, pinned
 * by the instance rows in fixtures/endpoint.vector.json. */
export function cellSocketFile(socketFile: string, instance: number): string {
  if (!socketFile.endsWith(".sock")) {
    throw new Error(`cellSocketFile wants a SOCKETS name (*.sock), got: ${socketFile}`);
  }
  if (!Number.isInteger(instance) || instance < 1) {
    throw new Error(`cellSocketFile wants a 1-based instance ordinal, got: ${instance}`);
  }
  return `${socketFile.slice(0, -".sock".length)}.${instance}.sock`;
}

/** Every socket name resolvable through this law — the fixture walks these. */
export const PIPE_SOCKET_NAMES: readonly string[] = Object.values(SOCKETS);

// Item 345 (PLAN-345-r2) — the unix endpoint law. A root whose WORST real socket path fits macOS's sun_path keeps
// today's path byte for byte; a root over the line takes ALL of its sockets through one short alias,
// `/tmp/vf-<uid>/<unixAliasScope(root)>` → `<root>/native/run`, the same for every plane because it is derived from
// (uid, root) alone, as the win32 arm's pipe names are. The Rust twin is field-native/src/endpoints.rs, pinned to
// this one by fixtures/endpoint.vector.json's `unixVectors`.

/** macOS's `sun_path` is 104 bytes, and a path must leave room for its NUL. */
export const SUN_PATH_MAX_BYTES = 103;

/** The largest cell ordinal field-native can allocate (an `AtomicU32`), so a budget taken at it holds for every N. */
export const CELL_INSTANCE_MAX = 4_294_967_295;

/** Where the aliases of roots over the line live: one 0700 folder per uid. */
export const SOCKET_ALIAS_PARENT = "/tmp";

/** The bytes a socket path costs `sun_path` (UTF-8, as the kernel counts them). */
export function socketPathBytes(path: string): number {
  return new TextEncoder().encode(path).length;
}

/** A root's run directory on unix: the root, trailing slashes dropped, joined with LAYOUT's run dir. */
export function nativeRunDirFor(dataRoot: string): string {
  let root = dataRoot;
  while (root.length > 1 && root.endsWith("/")) root = root.slice(0, -1);
  return [root, ...LAYOUT.NATIVE_RUN_DIR].join("/");
}

/** The longest socket FILE any plane binds in a run dir: every LAYOUT `.sock` row's name, and the cells' two names
 * taken at `CELL_INSTANCE_MAX`. Derived from the LAYOUT, never typed (VF-PM 10:37:17Z, bound 1). */
export function longestSocketFile(): string {
  const names: string[] = [];
  for (const segments of Object.values(LAYOUT)) {
    const last = segments[segments.length - 1];
    if (typeof last !== "string" || !last.endsWith(".sock")) continue;
    names.push(last);
    if (last === SOCKETS.TERMINAL_CONTROL || last === SOCKETS.TERMINAL_FRAME) {
      names.push(cellSocketFile(last, CELL_INSTANCE_MAX));
    }
  }
  return names.reduce((longest, name) =>
    socketPathBytes(name) > socketPathBytes(longest) ? name : longest,
  );
}

/** The alias's scope: FNV-1a 64 over the root's bytes, trailing slashes dropped, NO case fold, unlike `pipeScope`
 * (VF-PM 10:54:44Z, kept). On a case-insensitive volume, two spellings of one root make two links to the same run
 * dir, which is harmless: both reach the same socket. A fold could make two DIFFERENT roots on a case-sensitive volume
 * share one link and fight over it, which is not harmless. */
export function unixAliasScope(dataRoot: string): string {
  let root = dataRoot;
  while (root.length > 1 && root.endsWith("/")) root = root.slice(0, -1);
  return fnv1a64Hex(root);
}

/** The short alias of a root's run dir. `parent` is a test seam; the product passes nothing. */
export function socketAliasFor(
  uid: number,
  dataRoot: string,
  parent = SOCKET_ALIAS_PARENT,
): string {
  return `${parent}/vf-${uid}/${unixAliasScope(dataRoot)}`;
}

/** Item 345's ONE decision (both twins): the directory every socket of `dataRoot` is bound and dialed in. */
export function unixSocketDir(uid: number, dataRoot: string, parent = SOCKET_ALIAS_PARENT): string {
  const real = nativeRunDirFor(dataRoot);
  // S1 holds today's law. S2: return socketPathBytes(`${real}/${longestSocketFile()}`) <= SUN_PATH_MAX_BYTES
  //   ? real : socketAliasFor(uid, dataRoot, parent);
  void uid;
  void parent;
  return real;
}

/** One socket's endpoint on unix. */
export function unixEndpointFor(
  uid: number,
  dataRoot: string,
  socketFile: string,
  parent = SOCKET_ALIAS_PARENT,
): string {
  return `${unixSocketDir(uid, dataRoot, parent)}/${socketFile}`;
}

/** The longest endpoint a root can ever bind: what every guard measures. */
export function worstUnixEndpoint(
  uid: number,
  dataRoot: string,
  parent = SOCKET_ALIAS_PARENT,
): string {
  return unixEndpointFor(uid, dataRoot, longestSocketFile(), parent);
}
