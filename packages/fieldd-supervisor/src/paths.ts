import { join, posix } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { SupervisorError } from "./types";

/** Run-file layout under the data root (design-02 §3.6) — LAYOUT segments only
 * (UA-D10): this file used to be an independent copy of the tree and is now a
 * consumer like everyone else. */
export function runDir(dataRoot: string): string {
  return join(dataRoot, ...LAYOUT.FIELDD_RUN_DIR);
}

export function productPath(dataRoot: string): string {
  return join(dataRoot, ...LAYOUT.PRODUCT_JSON);
}

export function tokenPath(dataRoot: string): string {
  return join(dataRoot, ...LAYOUT.SHELL_TOKEN);
}

/** WIN-D1 — where field-native's management channel lives under `dataRoot`: a
 * name derived from the root in the flat pipe namespace on win32 (nothing
 * appears on disk, which is why the old name lied), the joined LAYOUT path
 * everywhere else. fieldd's own twin of this law is fieldd/src/boot-env.ts —
 * both planes must derive from the SAME root string or they miss each other. */
export function nativeMgmtEndpoint(dataRoot: string, platform = process.platform): string {
  // posix.join, not the host join — the same correction fieldd's twin already
  // carries. `platform` must FULLY determine the output, separators included:
  // this unix arm is reachable from a win32 test host, where the host join would
  // hand back `\data\vf\native\run\mgmt.sock` and quietly pass a byte-for-byte
  // claim it had broken. On a real unix host the two joins are identical.
  return platform === "win32"
    ? pipeEndpointFor(dataRoot, SOCKETS.MGMT)
    : posix.join(dataRoot, ...LAYOUT.MGMT_SOCKET);
}

/** @deprecated the name predates named pipes — call `nativeMgmtEndpoint`. */
export const nativeSocketPath = nativeMgmtEndpoint;

// sun_path is 104 bytes on macOS (108 on Linux); a longer socket path makes
// field-native's bind fail SILENTLY downstream (pairing file appears, socket
// never does, fieldd times out generic — slice-0 finding 4). The check walks
// EVERY socket-bearing LAYOUT row — the 2026-08-05 dev-root regression got
// through because the old guard measured only mgmt.sock, the SHORTEST name,
// while terminal-control.sock (12 bytes longer) blew the ceiling unchecked.
// 103 = 104 - NUL, the exact macOS strlen limit libuv and std enforce.
const SUN_PATH_MAX_BYTES = 103;

export function assertDataRootUsable(dataRoot: string, platform = process.platform): void {
  // WIN-D1: on win32 the endpoints are named pipes, not socket files — there is
  // no sun_path and this byte budget would refuse perfectly valid data roots
  // (a stock profile path already clears 103 bytes). The guard is a unix law.
  if (platform === "win32") return;
  for (const segments of Object.values(LAYOUT)) {
    const last = segments[segments.length - 1];
    if (typeof last !== "string" || !last.endsWith(".sock")) continue;
    const sock = join(dataRoot, ...segments);
    const bytes = Buffer.byteLength(sock, "utf8");
    if (bytes > SUN_PATH_MAX_BYTES) {
      throw new SupervisorError(
        "data-root-too-long",
        `data root makes ${last} ${bytes} bytes ` +
          `(> ${SUN_PATH_MAX_BYTES}, the OS sun_path limit): ${sock}`,
      );
    }
  }
}
