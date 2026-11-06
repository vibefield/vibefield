// Item 195 (2026-11-06) — every directory a row makes under the OS temp dir is removed when that row finishes,
// pass or fail: item 153's helper (users' and electron-shell's `test/temp-dir.ts`), which this package's suites
// never took. Before this, each run of the package left 40 roots behind (build 11, emit 3, pack 19, registry-sign 7).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** A fresh empty directory under the OS temp dir, removed when the test that made it finishes. Only callable
 * inside a test: onTestFinished throws anywhere else, so a directory made at describe scope fails loudly instead
 * of leaking. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}
