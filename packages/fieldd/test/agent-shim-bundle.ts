// AR-7b — the spawn-through shim, bundled for source runs. vitest does not
// bundle, so nothing stands beside the daemon's source where `dist/agent-shim.cjs`
// stands beside `dist/bin.cjs`; the rows that run a launcher build the kit's shim
// ONCE, into a directory of the test's own, and hand its path to the gateway
// service (`FielddConfig.agentGateway.shimScript`). Test-local — not shipped.
//
// The options are the build script's own third step (packages/fieldd/package.json:
// platform node, format cjs, target node22), spelled again here because a test
// cannot run a package script; the entry is the kit's, resolved from fieldd's
// own dependencies, so the bundle and the gateway under test come from the same
// pinned kit.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "../..");

/** The kit's shim entry: importing it runs it, so it is only ever bundled. */
export const AGENT_SHIM_ENTRY = "@vibefield/puppeteer-runtime/spawn-through/shim";

/** Bundle the shim into `directory` and answer the file's path. */
export async function bundleAgentShim(directory: string): Promise<string> {
  const outfile = join(directory, "agent-shim.cjs");
  await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: [AGENT_SHIM_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
  });
  return outfile;
}
