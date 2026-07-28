import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  archCompatible,
  EXECUTABLE_HEADER_BYTES,
  type ExecutableArch,
  hostArch,
  identifyExecutable,
} from "./executable-arch";

// The packaged/development resource contract (distribution spec §4.3). The
// shell receives a small layout object chosen by `app.isPackaged`; it never
// parses builder configuration and never reasons about where it was installed.
//
// The whole point is that PRODUCTION MUST NOT: walk upward looking for a
// repository, use `target/debug`, assume a pnpm workspace, infer architecture
// from a filename, or silently fall back from a missing packaged binary to a
// development path. Each of those turns a packaging bug into a mystery at a
// user's machine instead of a failure at ours, so the two constructors below
// are deliberately separate — there is no shared "find it somehow" helper for a
// packaged build to fall into.

export type TrayImageKind = "base" | "attention" | "offline";

export interface TrayImageSet {
  readonly macTemplate1x: string;
  readonly macTemplate2x: string;
  readonly windowsIco: string;
  readonly linuxPng: string;
}

export interface DesktopResources {
  readonly packaged: boolean;
  /** the program to exec: the standalone fieldd executable when packaged
   * (EDP-14), Electron-as-node from the repo bundle in development */
  readonly fielddCommand: string;
  readonly fielddArgs: readonly string[];
  /** Whether `fielddCommand` is an Electron binary that must be told to behave
   * as node. TRUE only in development now: a packaged build ships a real fieldd
   * executable, so ELECTRON_RUN_AS_NODE is neither set nor honoured — the
   * RunAsNode fuse is off (ESP §9.3), and setting it would be a lie either way.
   * Kept as data rather than inferred from `packaged` so the two ideas can
   * separate again if a launcher ever changes. */
  readonly fielddNeedsNodeMode: boolean;
  readonly fieldNativePath: string;
  /** plugin discovery roots — absolute, never derived by the daemon itself */
  readonly pluginRoots: {
    readonly bundled: readonly string[];
    readonly devLinked: readonly string[];
  };
  readonly tray: Readonly<Record<TrayImageKind, TrayImageSet>>;
}

const TRAY_KINDS: readonly TrayImageKind[] = ["base", "attention", "offline"];

/** Tray asset basenames are a release constant (icons:check pins them); the
 * `Template` suffix is load-bearing on macOS and must survive bundler hashing. */
const TRAY_BASENAMES: Readonly<Record<TrayImageKind, TrayImageSet>> = {
  base: {
    macTemplate1x: "fieldTemplate.png",
    macTemplate2x: "fieldTemplate@2x.png",
    windowsIco: "field-ready.ico",
    linuxPng: "field-linux.png",
  },
  attention: {
    macTemplate1x: "fieldAttentionTemplate.png",
    macTemplate2x: "fieldAttentionTemplate@2x.png",
    windowsIco: "field-attention.ico",
    linuxPng: "field-linux-attention.png",
  },
  offline: {
    macTemplate1x: "fieldOfflineTemplate.png",
    macTemplate2x: "fieldOfflineTemplate@2x.png",
    windowsIco: "field-offline.ico",
    linuxPng: "field-linux-offline.png",
  },
};

function trayLayout(dir: string): Readonly<Record<TrayImageKind, TrayImageSet>> {
  const out = {} as Record<TrayImageKind, TrayImageSet>;
  for (const kind of TRAY_KINDS) {
    const names = TRAY_BASENAMES[kind];
    out[kind] = {
      macTemplate1x: join(dir, names.macTemplate1x),
      macTemplate2x: join(dir, names.macTemplate2x),
      windowsIco: join(dir, names.windowsIco),
      linuxPng: join(dir, names.linuxPng),
    };
  }
  return out;
}

const exe = (name: string, platform: string): string =>
  platform === "win32" ? `${name}.exe` : name;

export function resolveDevelopmentRepoRoot(appPath: string, injected?: string): string {
  if (injected === undefined) return resolve(appPath, "..", "..");
  if (!isAbsolute(injected)) {
    throw new Error("VIBEFIELD_DEV_REPO_ROOT must be an absolute path");
  }
  return resolve(injected);
}

/** Development: the repo IS the layout. Electron runs the fieldd bundle in node
 * mode, and field-native comes from the cargo debug profile — both explicitly
 * forbidden in a package, which is why they live only on this side. */
export function resolveDevelopmentResources(opts: {
  repoRoot: string;
  electronExecPath: string;
  platform?: string;
}): DesktopResources {
  const platform = opts.platform ?? process.platform;
  return {
    packaged: false,
    fielddCommand: opts.electronExecPath,
    fielddArgs: [join(opts.repoRoot, "packages", "fieldd", "dist", "bin.cjs")],
    // Development runs the bundle through Electron's own node — building a
    // 145 MB SEA on every edit would be an absurd inner loop.
    fielddNeedsNodeMode: true,
    fieldNativePath: join(opts.repoRoot, "target", "debug", exe("field-native", platform)),
    pluginRoots: {
      bundled: [join(opts.repoRoot, "plugins")],
      devLinked: [join(opts.repoRoot, "examples", "plugins")],
    },
    tray: trayLayout(join(opts.repoRoot, "apps", "desktop", "packaging", "tray")),
  };
}

/** Packaged: everything hangs off `process.resourcesPath`, which Electron gives
 * us directly. Nothing here is discovered, and nothing reaches outside it.
 *
 * fieldd stays Electron-as-node while ESP-2 holds — the transitional
 * `RunAsNode` state — so the command is the app's own executable and the arg is
 * the staged bundle. `service-harness.mjs` and `loro_wasm_bg.wasm` are staged
 * BESIDE that bundle deliberately: fieldd resolves both against its own
 * `__dirname`, which probe P-A verified is the containing directory in every
 * container we ship (node, Electron-as-node, and a future SEA), independent of
 * cwd. So they need no path passed to them — only correct placement. */
export function resolvePackagedResources(opts: {
  resourcesPath: string;
  electronExecPath: string;
  platform?: string;
}): DesktopResources {
  const platform = opts.platform ?? process.platform;
  const bin = join(opts.resourcesPath, "bin");
  return {
    packaged: true,
    // A REAL executable, not Electron wearing a hat (EDP-14). Its two sidecars —
    // service-harness.mjs and loro_wasm_bg.wasm — are staged beside it because
    // fieldd resolves both against its own __dirname, which probe P-A verified
    // is the executable's directory inside a SEA, independent of cwd.
    fielddCommand: join(bin, exe("fieldd", platform)),
    fielddArgs: [],
    fielddNeedsNodeMode: false,
    fieldNativePath: join(bin, exe("field-native", platform)),
    pluginRoots: {
      bundled: [join(opts.resourcesPath, "plugins", "bundled")],
      devLinked: [],
    },
    tray: trayLayout(join(opts.resourcesPath, "tray")),
  };
}

export type ResourceProblemCode =
  | "fieldd-bundle-missing"
  | "fieldd-arch-mismatch"
  | "field-native-missing"
  | "field-native-arch-mismatch";

/** A packaged resource failure is fatal and TYPED — distribution spec §4.3 and
 * §14 both require a doctor code rather than a stack trace, because the user
 * facing it cannot read ours. */
export class ResourceError extends Error {
  constructor(
    readonly code: ResourceProblemCode,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ResourceError";
  }
}

function headOf(path: string): Uint8Array | null {
  try {
    const buf = readFileSync(path);
    return new Uint8Array(buf.subarray(0, EXECUTABLE_HEADER_BYTES));
  } catch {
    return null;
  }
}

/** Validate a resolved layout before anything tries to spawn from it. Runs for
 * packaged builds only: a development tree legitimately lacks a release
 * field-native until someone builds one, and failing boot over that would make
 * the dev loop hostage to a cargo profile. */
export function assertPackagedResources(
  resources: DesktopResources,
  opts?: { nodeArch?: string; readHead?: (path: string) => Uint8Array | null },
): void {
  if (!resources.packaged) return;
  const readHead = opts?.readHead ?? headOf;

  const host: ExecutableArch = hostArch(opts?.nodeArch ?? process.arch);

  // fieldd is now an EXECUTABLE, so it gets the same two questions as
  // field-native: is it there, and is it for this machine? Before EDP-14 it was
  // a .cjs argument to Electron, where only existence was meaningful.
  const fielddHead = readHead(resources.fielddCommand);
  if (fielddHead === null) {
    throw new ResourceError(
      "fieldd-bundle-missing",
      "The packaged fieldd executable is missing from this installation.",
      resources.fielddCommand,
    );
  }
  const fielddArch = identifyExecutable(fielddHead).arch;
  if (!archCompatible(fielddArch, host)) {
    throw new ResourceError(
      "fieldd-arch-mismatch",
      `The packaged fieldd executable is ${fielddArch}, but this machine is ${host}.`,
      resources.fielddCommand,
    );
  }

  const head = readHead(resources.fieldNativePath);
  if (head === null) {
    throw new ResourceError(
      "field-native-missing",
      "The packaged field-native executable is missing from this installation.",
      resources.fieldNativePath,
    );
  }
  const { arch } = identifyExecutable(head);
  if (!archCompatible(arch, host)) {
    throw new ResourceError(
      "field-native-arch-mismatch",
      `The packaged field-native executable is ${arch}, but this machine is ${host}.`,
      resources.fieldNativePath,
    );
  }
}
