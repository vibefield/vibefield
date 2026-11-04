// Item 153 (2026-11-02) — every directory a row makes under the OS temp dir is removed when that row finishes,
// pass or fail. Before this, each run of the package left ~40 roots behind; across the lanes' verify runs on the
// gate host they were thousands. A row that needs its root after the row (none here) would make it in a hook of its
// own and remove it there.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** Remove `path` (recursively) when the running test finishes. Only callable inside a test. */
export function removeWhenTestEnds(path: string): void {
  onTestFinished(() => rmSync(path, { recursive: true, force: true, maxRetries: 3 }));
}

/** A fresh empty directory under the OS temp dir, removed when the test that made it finishes. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  removeWhenTestEnds(dir);
  return dir;
}
