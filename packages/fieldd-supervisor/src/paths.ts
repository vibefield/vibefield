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
// never does, fieldd times out generic — slice-0 finding 4). Guard with margin.
const SUN_PATH_SAFE_BYTES = 100;

export function assertDataRootUsable(dataRoot: string): void {
  const sock = nativeSocketPath(dataRoot);
  if (Buffer.byteLength(sock, "utf8") > SUN_PATH_SAFE_BYTES) {
    throw new SupervisorError(
      "data-root-too-long",
      `data root makes the native socket path ${Buffer.byteLength(sock, "utf8")} bytes ` +
        `(> ${SUN_PATH_SAFE_BYTES} safe under the OS sun_path limit): ${sock}`,
    );
  }
}
