// FS-1a — the files worker, bundled for source runs. vitest does not bundle,
// so nothing stands beside the daemon's source where `dist/files-host.cjs`
// stands beside `dist/bin.cjs`; the rows that start a REAL worker build it
// ONCE per file into a directory of the test's own, with fieldd's own build
// definition (scripts/files-host-build.mjs — the plugin that loads mille's
// engine by an explicit path), and hand the daemon a launch naming it and the
// installed engine (`FielddConfig.filesHost`). Test-local — not shipped.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import type { FilesHostLaunch } from "../src/workspace/launch";
import { installedMilleNative } from "../src/workspace/launch";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

let built: Promise<FilesHostLaunch> | null = null;

/** The worker's launch for this test file: node, the bundle, the engine. */
export function filesHostLaunch(): Promise<FilesHostLaunch> {
  built ??= (async () => {
    const definition = (await import(join(PACKAGE_ROOT, "scripts", "files-host-build.mjs"))) as {
      filesHostBuildOptions: (opts: { outfile: string }) => Parameters<typeof build>[0];
    };
    const dir = mkdtempSync(join(tmpdir(), "vf-fh-"));
    const outfile = join(dir, "files-host.cjs");
    await build(definition.filesHostBuildOptions({ outfile }));
    const milleNative = installedMilleNative(PACKAGE_ROOT);
    if (milleNative === null) throw new Error("mille ships no native engine for this platform");
    return { command: process.execPath, args: [outfile], milleNative };
  })();
  return built;
}
