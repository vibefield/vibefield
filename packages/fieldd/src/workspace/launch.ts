import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

// FS-1a (L1) — HOW fieldd starts its files worker, decided once per boot.
//
// The worker is fieldd's OWN executable re-run in the `files-host` role,
// never Electron-as-Node by name and never the `node` on PATH:
//
//   development  fieldd is `dist/bin.cjs` run by the runtime the shell
//                launched it under (`process.execPath`, Electron in node mode,
//                its environment inherited); the worker is the second bundle
//                beside it, `dist/files-host.cjs`, run by that same runtime.
//   packaged     fieldd is a single-executable application (EDP-14), which
//                runs nothing but its own blob; the worker is that executable
//                with `--vibefield-role=files-host` — bin.ts loads the
//                `files-host.cjs` sidecar staged beside it (the service
//                harness's precedent: a real file next to the executable).
//
// mille's native addon is resolved HERE, by an explicit path, and handed to
// the worker (`{t: "init", milleNative}`): the per-platform file beside the
// bundle — `dist/` in development (scripts/stage-runtime-assets.mjs stages it
// from the installed `@vibecook/mille-<platform>` package), the executable's
// own directory when packaged. A worker never searches for it.
//
// A source run (vitest, an embedded daemon) has no bundle beside it: the
// worker is then UNCONFIGURED, honestly, and a test that exercises files
// passes a launch of its own (FielddConfig.filesHost).

/** The argument that makes the packaged executable a files worker. */
export const FILES_HOST_ROLE_ARG = "--vibefield-role=files-host";
/** The worker's bundle, beside fieldd's. */
export const FILES_HOST_BUNDLE = "files-host.cjs";

export interface FilesHostLaunch {
  command: string;
  args: readonly string[];
  /** mille's native addon, absolute */
  milleNative: string;
}

export type FilesHostLaunchChoice =
  | { kind: "launch"; launch: FilesHostLaunch }
  | { kind: "unconfigured"; reason: string };

/** The napi triple mille names its per-platform package and binary by
 * (mille's own loader: darwin-arm64, linux-x64-gnu, win32-x64-msvc, …), or
 * null on a platform mille ships no binary for. */
export function milleTriple(platform: string, arch: string, musl: boolean): string | null {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `darwin-${arch}`;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) return `win32-${arch}-msvc`;
  if (platform === "linux" && (arch === "x64" || arch === "arm64"))
    return `linux-${arch}-${musl ? "musl" : "gnu"}`;
  return null;
}

/** The addon's file name as staged beside a bundle or an executable. */
export function milleNativeFileName(triple: string): string {
  return `mille.${triple}.node`;
}

/** Is this Node linked against musl? (mille's own heuristic: a glibc Node
 * reports `glibcVersionRuntime`.) */
export function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: unknown } }
      | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

export interface FilesHostFacts {
  /** this process is a single-executable application (a packaged fieldd) */
  sea: boolean;
  execPath: string;
  /** the directory fieldd's bundle runs from (`__dirname` of bin.cjs), or
   * undefined for a source run */
  bundleDir: string | undefined;
  platform: string;
  arch: string;
  musl: boolean;
  exists: (path: string) => boolean;
}

/** The rule above, over facts a test can state. */
export function chooseFilesHostLaunch(facts: FilesHostFacts): FilesHostLaunchChoice {
  const triple = milleTriple(facts.platform, facts.arch, facts.musl);
  if (triple === null)
    return {
      kind: "unconfigured",
      reason: `mille ships no native engine for ${facts.platform}-${facts.arch}`,
    };
  const native = milleNativeFileName(triple);
  if (facts.sea) {
    const dir = dirname(facts.execPath);
    const milleNative = join(dir, native);
    const bundle = join(dir, FILES_HOST_BUNDLE);
    for (const [path, what] of [
      [milleNative, "mille's native engine"],
      [bundle, "the files worker's bundle"],
    ] as const) {
      if (!facts.exists(path))
        return { kind: "unconfigured", reason: `${what} is not beside the executable (${path})` };
    }
    return {
      kind: "launch",
      launch: { command: facts.execPath, args: [FILES_HOST_ROLE_ARG], milleNative },
    };
  }
  if (facts.bundleDir === undefined)
    return {
      kind: "unconfigured",
      reason:
        "a source run has no files worker bundle beside it (FielddConfig.filesHost names one)",
    };
  const bundle = join(facts.bundleDir, FILES_HOST_BUNDLE);
  const milleNative = join(facts.bundleDir, native);
  for (const [path, what] of [
    [bundle, "the files worker's bundle"],
    [milleNative, "mille's native engine"],
  ] as const) {
    if (!facts.exists(path))
      return { kind: "unconfigured", reason: `${what} is not beside fieldd's bundle (${path})` };
  }
  return { kind: "launch", launch: { command: facts.execPath, args: [bundle], milleNative } };
}

/** This process's facts. */
export function ownFilesHostFacts(bundleDir: string | undefined): FilesHostFacts {
  let sea = false;
  try {
    const builtin = process.getBuiltinModule?.("node:sea") as { isSea?: () => boolean } | undefined;
    sea = builtin?.isSea?.() === true;
  } catch {
    // a Node with no such module is no single executable
  }
  return {
    sea,
    execPath: process.execPath,
    bundleDir,
    platform: process.platform,
    arch: process.arch,
    musl: isMusl(),
    exists: existsSync,
  };
}

/** The INSTALLED per-platform addon, resolved from a package directory that
 * depends on `@vibecook/mille` (fieldd's): mille's real directory, then its
 * sibling `@vibecook/mille-<triple>` (pnpm's layout puts a package's own
 * dependencies beside it), then that package's `main`. For the build's
 * staging step and for tests — never at run time. */
export function installedMilleNative(
  packageDir: string,
  facts: { platform: string; arch: string; musl: boolean } = {
    platform: process.platform,
    arch: process.arch,
    musl: isMusl(),
  },
): string | null {
  const triple = milleTriple(facts.platform, facts.arch, facts.musl);
  if (triple === null) return null;
  let mille: string;
  try {
    mille = realpathSync(join(packageDir, "node_modules", "@vibecook", "mille"));
  } catch {
    return null;
  }
  const local = join(mille, milleNativeFileName(triple));
  if (existsSync(local)) return local;
  const platformPackage = join(dirname(mille), `mille-${triple}`);
  try {
    const manifest = JSON.parse(readFileSync(join(platformPackage, "package.json"), "utf8")) as {
      main?: unknown;
    };
    const main = typeof manifest.main === "string" ? manifest.main : milleNativeFileName(triple);
    const file = join(platformPackage, main);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}
