import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface LabProfile {
  kind: "isolated-chromium-v1";
  id: string;
}

/** Check Electron's effective paths, not just the launcher's intent. The first
 * check precedes window creation; the second includes that window's session. */
export function labProfileProof(
  requested: string,
  paths: { userData: string; sessionData: string; storagePath?: string | null },
): LabProfile {
  if (!isAbsolute(requested)) {
    throw new Error("Godview lab requires an absolute --user-data-dir from its launcher");
  }
  const expected = realpathSync(requested);
  if (!statSync(expected).isDirectory()) throw new Error("Godview lab profile is not a directory");
  for (const [name, path] of Object.entries(paths)) {
    if (typeof path !== "string" || !isAbsolute(path) || realpathSync(path) !== expected) {
      throw new Error(`Godview lab ${name} does not use the isolated Chromium profile`);
    }
  }
  // Opaque identity permits pairing and reuse checks without publishing paths.
  return { kind: "isolated-chromium-v1", id: createHash("sha256").update(expected).digest("hex") };
}
