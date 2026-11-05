// AR-7j — fieldd's OWN bundle, built for the rows that run the executable's
// roles (roles.ts) under a real Node. vitest does not bundle, and a role is
// the bundle's entry run with a first argument: `node bin.cjs <role> …` hands
// its arguments at the indices a single executable does, so the role a
// packaged build runs is run here from source.
//
// The options are the build script's own first step (packages/fieldd/package.json:
// platform node, format cjs, `import.meta.url` defined away, the two optional
// natives of `ws` external), spelled again here because a test cannot run a
// package script — `BIN_BUILD_STEP` is that step as the manifest spells it,
// and a row holds the two equal. The metafile is kept: it is what says which
// modules the entry imports at its top (evaluated at once) and which only by
// `import()` (evaluated when called). Test-local — not shipped.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "../..");

/** packages/fieldd/package.json's first build step, as it must read. */
export const BIN_BUILD_STEP =
  "esbuild src/bin.ts --bundle --platform=node --format=cjs --define:import.meta.url=undefined --outfile=dist/bin.cjs --external:bufferutil --external:utf-8-validate";

/** Bundle `src/bin.ts` into `directory` as `bin.cjs`: its path, and esbuild's
 * account of what went into it. */
export async function bundleFielddBin(
  directory: string,
): Promise<{ bin: string; metafile: Metafile }> {
  const bin = join(directory, "bin.cjs");
  const result = await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: ["src/bin.ts"],
    outfile: bin,
    bundle: true,
    platform: "node",
    format: "cjs",
    define: { "import.meta.url": "undefined" },
    external: ["bufferutil", "utf-8-validate"],
    metafile: true,
    logLevel: "silent",
  });
  return { bin, metafile: result.metafile };
}
