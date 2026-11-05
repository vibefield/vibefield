// CP-4a2a — a run's flow host, bundled for source runs, as transcript-host-bundle.ts bundles the transcript worker:
// vitest does not bundle, so the rows that start a REAL host build it ONCE per file into a directory under the run's
// root (`fielddRunRoot`, which global-setup.ts removes at the run's end), with fieldd's own build definition
// (scripts/flows-host-build.mjs), and hand the run a launch naming it. Test-local — not shipped.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { inject } from "vitest";
import type { FlowsHostLaunch } from "../src/flows/launch";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

let built: Promise<string> | null = null;

/** The built bundle's path. */
export function flowsHostBundle(): Promise<string> {
  built ??= (async () => {
    const definition = (await import(join(PACKAGE_ROOT, "scripts", "flows-host-build.mjs"))) as {
      flowsHostBuildOptions: (opts: { outfile: string }) => Parameters<typeof build>[0];
    };
    const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-"));
    const outfile = join(dir, "flows-host.cjs");
    await build(definition.flowsHostBuildOptions({ outfile }));
    return outfile;
  })();
  return built;
}

/** A launch of the built bundle under this runtime: the development rule (launch.ts). */
export async function flowsHostLaunch(): Promise<FlowsHostLaunch> {
  return { command: process.execPath, args: [await flowsHostBundle()] };
}
