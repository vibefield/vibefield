import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  IDENTITY_DIR,
  type KeyClass,
  RELEASE_IDENTITY_FILE,
  SIGNATURE_SUFFIX,
  StagedReleaseIdentity,
  TRUST_ROOT_FILE,
} from "@vibefield/contracts";
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
  /** The raw Electron.app used by development cannot inherit electron-builder's
   * bundle icon. macOS applies this Apple-compiled, safe-area-correct raster
   * after app.whenReady(); a packaged app keeps bundle-owned icon selection and
   * therefore carries null. */
  readonly developmentDockIconPath: string | null;
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
  /** macOS-only SCK helper plus the purpose-built IOSurface Mach-right adapter. */
  readonly macosLiveSurfaceCapture: {
    readonly helperPath: string;
    readonly adapterPath: string;
  } | null;
  /** SNAP-D5 — the native screenshot helper's executable (inside its bundle on
   * macOS, a bare .exe on Windows), or null on a platform with no helper.
   * Deliberately NOT asserted by `assertPackagedResources`, unlike the SCK
   * helper: a screenshot is a peripheral, so an absent helper is an honest
   * `helper-missing` at capture time — never a refusal to boot. */
  readonly screenshotHelperPath: string | null;
  /** AR-8 (L3) — History's index daemon, handed to fieldd as FIELDD_ROSETTAD_BIN
   * when nothing in the environment names one. Packaged: beside fieldd, where
   * the stager puts it when `pnpm siblings:build` produced one. Development:
   * null — the dev runner resolves the lock's build and exports the variable
   * itself. Optional like the screenshot helper: an absent one boots, and
   * fieldd's index says in a person's words that this copy has no agent
   * history; only a PRESENT one is asserted, for its architecture. */
  readonly rosettadPath: string | null;
  /** plugin discovery roots — absolute, never derived by the daemon itself */
  readonly pluginRoots: {
    readonly bundled: readonly string[];
    readonly devLinked: readonly string[];
  };
  /** WP8c / TD-2 — the staged public identity (`Resources/identity/`): the trust-root document and
   * release-identity.json (the root keys and the key class). Packaged only; the development layout has none,
   * and a smoke that keys a bundled root sets FIELDD_TRUST_ROOT(_KEYS) in its launching shell instead. */
  readonly identity: { readonly identityPath: string; readonly trustRootPath: string } | null;
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

/** The screenshot helper is a BUNDLE on macOS — TCC and LaunchServices key on
 * the bundle, so the executable lives inside it — and a bare .exe on Windows.
 * `dir` is wherever the platform keeps it: the per-platform build directory in
 * development, the flat `bin/` when packaged. */
function screenshotHelperPath(dir: string, platform: string): string | null {
  if (platform === "darwin") {
    return join(dir, "field-screenshot-helper.app", "Contents", "MacOS", "field-screenshot-helper");
  }
  if (platform === "win32") return join(dir, "field-screenshot-helper.exe");
  return null;
}

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
    developmentDockIconPath: join(
      opts.repoRoot,
      "apps",
      "desktop",
      "packaging",
      "icons",
      "app-macos-dock.png",
    ),
    fielddCommand: opts.electronExecPath,
    fielddArgs: [join(opts.repoRoot, "packages", "fieldd", "dist", "bin.cjs")],
    // Development runs the bundle through Electron's own node — building a
    // 145 MB SEA on every edit would be an absurd inner loop.
    fielddNeedsNodeMode: true,
    fieldNativePath: join(opts.repoRoot, "target", "debug", exe("field-native", platform)),
    macosLiveSurfaceCapture:
      platform === "darwin"
        ? {
            helperPath: join(
              opts.repoRoot,
              "apps",
              "desktop",
              "build",
              "native",
              "macos",
              "live-surface-capture-helper",
            ),
            adapterPath: join(
              opts.repoRoot,
              "apps",
              "desktop",
              "build",
              "native",
              "macos",
              "live-surface-adapter.node",
            ),
          }
        : null,
    screenshotHelperPath: screenshotHelperPath(
      join(
        opts.repoRoot,
        "apps",
        "desktop",
        "build",
        "native",
        platform === "darwin" ? "macos" : "windows",
      ),
      platform,
    ),
    rosettadPath: null,
    pluginRoots: {
      bundled: [join(opts.repoRoot, "plugins")],
      devLinked: [join(opts.repoRoot, "examples", "plugins")],
    },
    identity: null,
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
    developmentDockIconPath: null,
    // A REAL executable, not Electron wearing a hat (EDP-14). Its sidecars —
    // service-harness.mjs and loro_wasm_bg.wasm, and since FS-1a the files
    // worker's files-host.cjs and mille's native engine — are staged beside it
    // because fieldd resolves them against its own __dirname, which probe P-A
    // verified is the executable's directory inside a SEA, independent of cwd.
    fielddCommand: join(bin, exe("fieldd", platform)),
    fielddArgs: [],
    fielddNeedsNodeMode: false,
    fieldNativePath: join(bin, exe("field-native", platform)),
    macosLiveSurfaceCapture:
      platform === "darwin"
        ? {
            helperPath: join(bin, "live-surface-capture-helper"),
            adapterPath: join(bin, "live-surface-adapter.node"),
          }
        : null,
    screenshotHelperPath: screenshotHelperPath(bin, platform),
    rosettadPath: join(bin, exe("rosettad", platform)),
    pluginRoots: {
      bundled: [join(opts.resourcesPath, "plugins", "bundled")],
      devLinked: [],
    },
    identity: {
      identityPath: join(opts.resourcesPath, IDENTITY_DIR, RELEASE_IDENTITY_FILE),
      trustRootPath: join(opts.resourcesPath, IDENTITY_DIR, TRUST_ROOT_FILE),
    },
    tray: trayLayout(join(opts.resourcesPath, "tray")),
  };
}

export type ResourceProblemCode =
  | "fieldd-bundle-missing"
  | "fieldd-arch-mismatch"
  | "field-native-missing"
  | "field-native-arch-mismatch"
  | "live-surface-capture-helper-missing"
  | "live-surface-capture-helper-arch-mismatch"
  | "live-surface-adapter-missing"
  | "live-surface-adapter-arch-mismatch"
  | "rosettad-arch-mismatch"
  | "bundled-identity-missing"
  | "bundled-root-missing"
  | "bundled-dev-trust";

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

/** The bundled trust anchor fieldd is handed (WP8c): the staged trust-root's path and the root keys it must be
 * signed by, read from the staged identity. Null in the development layout. Throws a typed ResourceError when a
 * packaged identity is missing or malformed — a package must never fall back to an unverified walk. */
export function readBundledTrust(
  resources: DesktopResources,
  readText: (path: string) => string | null = textOf,
): {
  trustRootPath: string;
  rootKeys: readonly string[];
  keyClass: KeyClass;
  /** WP12 D10 — this build's identity, when the stage recorded one */
  buildId?: string;
} | null {
  const identity = resources.identity;
  if (!resources.packaged || identity === null) return null;
  const raw = readText(identity.identityPath);
  let parsed: ReturnType<typeof StagedReleaseIdentity.safeParse> | null = null;
  try {
    parsed = raw === null ? null : StagedReleaseIdentity.safeParse(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (parsed === null || !parsed.success) {
    throw new ResourceError(
      "bundled-identity-missing",
      "This installation's identity file is missing or damaged, so its own plugins cannot be verified.",
      identity.identityPath,
    );
  }
  for (const path of [identity.trustRootPath, `${identity.trustRootPath}${SIGNATURE_SUFFIX}`]) {
    if (readText(path) === null) {
      throw new ResourceError(
        "bundled-identity-missing",
        "This installation's trust-root is missing, so its own plugins cannot be verified.",
        path,
      );
    }
  }
  return {
    trustRootPath: identity.trustRootPath,
    rootKeys: parsed.data.trustRootKeys,
    keyClass: parsed.data.keyClass,
    ...(parsed.data.buildId !== undefined ? { buildId: parsed.data.buildId } : {}),
  };
}

function textOf(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
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
  opts?: {
    nodeArch?: string;
    readHead?: (path: string) => Uint8Array | null;
    readText?: (path: string) => string | null;
    /** TD §5 / WP8-D4: a packaged app refuses a DEV-keyed stage unless launched with `--allow-dev-trust`
     * (never set by a release); `package:dir` previews pass it to launch a dev stage on purpose. */
    allowDevTrust?: boolean;
  },
): void {
  if (!resources.packaged) return;
  const readHead = opts?.readHead ?? headOf;
  const readText = opts?.readText ?? textOf;

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

  // AR-8 (L3): rosettad is optional — absent is History's honest "no agent
  // history" — but one that IS staged must be for this machine: the wrong
  // architecture would read as an index that fails to start, not a packaging bug.
  const rosettadPath = resources.rosettadPath;
  const rosettadHead = rosettadPath === null ? null : readHead(rosettadPath);
  if (rosettadPath !== null && rosettadHead !== null) {
    const rosettadArch = identifyExecutable(rosettadHead).arch;
    if (!archCompatible(rosettadArch, host)) {
      throw new ResourceError(
        "rosettad-arch-mismatch",
        `The packaged rosettad executable is ${rosettadArch}, but this machine is ${host}.`,
        rosettadPath,
      );
    }
  }

  const capture = resources.macosLiveSurfaceCapture;
  if (capture !== null) assertCapture(capture, readHead, host);

  // WP8c: the app's own plugins verify against the staged identity, so a package without it — or without the
  // signed index it vouches for — is refused here, typed, rather than booting into an empty or unverified root.
  const trust = readBundledTrust(resources, readText);
  const bundledRoot = resources.pluginRoots.bundled[0];
  if (trust !== null && bundledRoot !== undefined) {
    if (readText(join(bundledRoot, BUNDLED_PLUGIN_INDEX_FILE)) === null) {
      throw new ResourceError(
        "bundled-root-missing",
        "This installation's own plugins are missing.",
        join(bundledRoot, BUNDLED_PLUGIN_INDEX_FILE),
      );
    }
    if (trust.keyClass === "dev" && opts?.allowDevTrust !== true) {
      throw new ResourceError(
        "bundled-dev-trust",
        "This installation was signed with development keys, not VibeField's release keys.",
        trust.trustRootPath,
      );
    }
  }
}

/** The macOS SCK helper and its IOSurface adapter: present, and built for this machine. */
function assertCapture(
  capture: NonNullable<DesktopResources["macosLiveSurfaceCapture"]>,
  readHead: (path: string) => Uint8Array | null,
  host: ExecutableArch,
): void {
  const helperHead = readHead(capture.helperPath);
  if (helperHead === null) {
    throw new ResourceError(
      "live-surface-capture-helper-missing",
      "The packaged ScreenCaptureKit helper is missing from this installation.",
      capture.helperPath,
    );
  }
  const helperArch = identifyExecutable(helperHead).arch;
  if (!archCompatible(helperArch, host)) {
    throw new ResourceError(
      "live-surface-capture-helper-arch-mismatch",
      `The packaged ScreenCaptureKit helper is ${helperArch}, but this machine is ${host}.`,
      capture.helperPath,
    );
  }
  const adapterHead = readHead(capture.adapterPath);
  if (adapterHead === null) {
    throw new ResourceError(
      "live-surface-adapter-missing",
      "The packaged IOSurface adapter is missing from this installation.",
      capture.adapterPath,
    );
  }
  const adapterArch = identifyExecutable(adapterHead).arch;
  if (!archCompatible(adapterArch, host)) {
    throw new ResourceError(
      "live-surface-adapter-arch-mismatch",
      `The packaged IOSurface adapter is ${adapterArch}, but this machine is ${host}.`,
      capture.adapterPath,
    );
  }
}
