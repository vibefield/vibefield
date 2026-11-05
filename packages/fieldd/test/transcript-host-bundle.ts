// TH-1 — the transcript worker, bundled for source runs, as files-host-bundle.ts bundles the files worker: vitest does
// not bundle, so the rows that start a REAL worker build it ONCE per file into a directory under the run's root
// (`fielddRunRoot`, which global-setup.ts removes at the run's end), with fieldd's own build definition
// (scripts/transcript-host-build.mjs), and hand the daemon a launch naming it (`FielddConfig.transcriptHost`).
// Test-local — not shipped.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { inject } from "vitest";
import type { TranscriptHostLaunch } from "../src/transcripts/launch";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

let built: Promise<TranscriptHostLaunch> | null = null;

export function transcriptHostLaunch(): Promise<TranscriptHostLaunch> {
  built ??= (async () => {
    const definition = (await import(
      join(PACKAGE_ROOT, "scripts", "transcript-host-build.mjs")
    )) as {
      transcriptHostBuildOptions: (opts: { outfile: string }) => Parameters<typeof build>[0];
    };
    const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-th-"));
    const outfile = join(dir, "transcript-host.cjs");
    await build(definition.transcriptHostBuildOptions({ outfile }));
    return { command: process.execPath, args: [outfile] };
  })();
  return built;
}
