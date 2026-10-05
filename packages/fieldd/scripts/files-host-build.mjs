#!/usr/bin/env node
// FS-1a (L1) — the files worker's bundle, `dist/files-host.cjs`, and the
// native engine staged beside it.
//
// ONE definition of the build, imported by everything that makes it: fieldd's
// own `pnpm build` (this file run as a script), the dev runner's watch
// (tooling/dev-runner/src/esbuild-watches.mjs) and the tests that start a real
// worker (test/files-host-bundle.ts). A second spelling would be the drift
// class the agent shim's flag-for-flag test exists for.
//
// The bundle REPLACES mille's per-platform loader (`@vibecook/mille`'s own
// `dist/native.js`) with the worker's shim (src/workspace/host/mille-native.ts),
// which loads the addon from the explicit path fieldd hands the worker. The
// original reads `import.meta.url` and `require`s an optional dependency —
// neither exists in a CJS bundle run from a single executable. A build where
// the replacement did not happen FAILS (a mille release that renames its
// loader must be noticed at the pin move, EL8 — never shipped as a worker that
// dies on its first import).
import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const FIELDD_ROOT = resolve(import.meta.dirname, "..");
export const FILES_HOST_ENTRY = join(FIELDD_ROOT, "src", "workspace", "host", "entry.ts");
export const FILES_HOST_OUTFILE = join(FIELDD_ROOT, "dist", "files-host.cjs");
const NATIVE_SHIM = join(FIELDD_ROOT, "src", "workspace", "host", "mille-native.ts");
const MILLE_DIST = /[\\/]@vibecook[\\/]mille[\\/]dist[\\/]/;

/** The installed mille's version (EL8: the bundle says which it carries). */
export function installedMilleVersion(fielddRoot = FIELDD_ROOT) {
  const dir = realpathSync(join(fielddRoot, "node_modules", "@vibecook", "mille"));
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

/** The plugin that swaps mille's loader for the worker's shim. `state.swapped`
 * counts the swaps; the build fails at its end when there were none. */
export function milleNativePlugin(state = { swapped: 0 }) {
  return {
    name: "vibefield-mille-native",
    setup(build) {
      build.onStart(() => {
        state.swapped = 0;
      });
      build.onResolve({ filter: /^\.\/native\.js$/ }, (args) => {
        if (!MILLE_DIST.test(args.importer)) return undefined;
        state.swapped += 1;
        return { path: NATIVE_SHIM };
      });
      build.onEnd((result) => {
        if (result.errors.length === 0 && state.swapped === 0) {
          result.errors.push({
            text: "files-host build: mille's native loader (dist/native.js) was not replaced by the worker's shim — mille's layout moved; re-read it at the pin",
          });
        }
      });
    },
  };
}

/** The esbuild options, as data plus the plugin. */
export function filesHostBuildOptions({
  fielddRoot = FIELDD_ROOT,
  outfile = FILES_HOST_OUTFILE,
} = {}) {
  return {
    absWorkingDir: fielddRoot,
    entryPoints: [join(fielddRoot, "src", "workspace", "host", "entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    define: {
      __MILLE_PACKAGE_VERSION__: JSON.stringify(installedMilleVersion(fielddRoot)),
    },
    logLevel: "silent",
    plugins: [milleNativePlugin()],
  };
}

/** The installed per-platform addon (pnpm puts it beside mille's own folder)
 * — the JS twin of launch.ts `installedMilleNative`, kept in step by
 * test/files-host-launch.test.ts. */
export function installedMilleNativeFile(fielddRoot = FIELDD_ROOT) {
  const triple = milleTriple(process.platform, process.arch, isMusl());
  if (triple === null) return null;
  const mille = realpathSync(join(fielddRoot, "node_modules", "@vibecook", "mille"));
  const pkg = join(dirname(mille), `mille-${triple}`);
  const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
  return { triple, file: join(pkg, manifest.main ?? `mille.${triple}.node`) };
}

function milleTriple(platform, arch, musl) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `darwin-${arch}`;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) return `win32-${arch}-msvc`;
  if (platform === "linux" && (arch === "x64" || arch === "arm64"))
    return `linux-${arch}-${musl ? "musl" : "gnu"}`;
  return null;
}

function isMusl() {
  if (process.platform !== "linux") return false;
  try {
    return !process.report?.getReport()?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/** Stage the addon beside a bundle as `mille.<triple>.node` (launch.ts reads
 * it there). Answers the staged path, or null where mille ships none. */
export function stageMilleNative(distDir = dirname(FILES_HOST_OUTFILE), fielddRoot = FIELDD_ROOT) {
  const found = installedMilleNativeFile(fielddRoot);
  if (found === null) return null;
  mkdirSync(distDir, { recursive: true });
  const target = join(distDir, `mille.${found.triple}.node`);
  copyFileSync(found.file, target);
  return target;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const { build } = await import("esbuild");
  await build(filesHostBuildOptions());
  const staged = stageMilleNative();
  console.log(
    `built dist/files-host.cjs${staged === null ? " (no mille engine for this platform)" : `; staged ${staged.slice(FIELDD_ROOT.length + 1)}`}`,
  );
}
