// RV #1 (item 203) — puppeteer's builtin forwarder entry, bundled for source runs, as
// agent-shim-bundle.ts bundles the shim. vitest does not bundle, so nothing stands beside
// the daemon's source where `dist/agent-forwarder.cjs` stands beside `dist/bin.cjs`; the
// rows that run the executable's forwarder role build the kit's entry ONCE, into a
// directory of the test's own, beside a bundle of fieldd's own entry. Test-local — not
// shipped.
//
// The options are the build script's own step (packages/fieldd/package.json: platform
// node, format cjs, target node22), spelled again here because a test cannot run a
// package script — `AGENT_FORWARDER_BUILD_STEP` is that step as the manifest spells it,
// and a row holds the two equal. The entry is the kit's, resolved from fieldd's own
// dependencies, so the bundle and the role under test come from the same pinned kit.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "../..");

/** The kit's forwarder entry: importing it runs it, so it is only ever bundled. */
export const AGENT_FORWARDER_ENTRY = "@vibefield/puppeteer-builtin-providers/forwarder";

/** packages/fieldd/package.json's forwarder step, as it must read. */
export const AGENT_FORWARDER_BUILD_STEP =
  "esbuild @vibefield/puppeteer-builtin-providers/forwarder --bundle --platform=node --format=cjs --target=node22 --outfile=dist/agent-forwarder.cjs";

/** Bundle the forwarder entry into `directory` and answer the file's path. */
export async function bundleAgentForwarder(directory: string): Promise<string> {
  const outfile = join(directory, "agent-forwarder.cjs");
  await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: [AGENT_FORWARDER_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
  });
  return outfile;
}
