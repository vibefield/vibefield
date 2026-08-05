import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
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

export function nativeSocketPath(dataRoot: string): string {
  return join(dataRoot, ...LAYOUT.MGMT_SOCKET);
}

// sun_path is 104 bytes on macOS (108 on Linux); a longer socket path makes
// field-native's bind fail SILENTLY downstream (pairing file appears, socket
// never does, fieldd times out generic — slice-0 finding 4). The check walks
// EVERY socket-bearing LAYOUT row — the 2026-08-05 dev-root regression got
// through because the old guard measured only mgmt.sock, the SHORTEST name,
// while terminal-control.sock (12 bytes longer) blew the ceiling unchecked.
// 103 = 104 - NUL, the exact macOS strlen limit libuv and std enforce.
const SUN_PATH_MAX_BYTES = 103;

export function assertDataRootUsable(dataRoot: string): void {
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
