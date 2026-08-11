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

import { APP_ID, SOCKETS } from "./registries";

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

/** Every socket name resolvable through this law — the fixture walks these. */
export const PIPE_SOCKET_NAMES: readonly string[] = Object.values(SOCKETS);
