import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// DK-18 (plan (88)) — `VIBEFIELD_DEV_ROOT` moves the runner's whole state (its daemon data, logs, Electron
// profile, lock, command socket, builds and runtime snapshots) out of the checkout: `pnpm smoke:studio` runs
// on a fresh one under /tmp (apps/desktop/packaging/run-studio-smoke.mjs), never the persistent `.vibefield/dev`.
export function devRootFor(root, env = process.env) {
  const given = env["VIBEFIELD_DEV_ROOT"];
  return given !== undefined && given !== "" ? given : join(root, ".vibefield", "dev");
}

/**
 * BP-1c (BP-D9 (a), `draft/thinking-browser-profile.md` §3·8) — where a dev run's two roots lie: Electron's userData IS
 * the dev root, and the daemon data root is `data/` under it. The desk browser's profiles live under the data root
 * (`<data root>/users/<fuid>/browser/profiles`, PT-4), and Chromium writes a `session.fromPath` profile's cookie
 * database only inside userData (four Electron 43.1.1 probes, 2026-10-26): with the two roots siblings, the dev desk
 * forgot every sign-in at each restart. The data root stays where it was, so a developer's boards, users and agents are
 * untouched; only Electron's own files move, from `electron-user-data/` (`legacyElectronUserData`, left in place: the
 * runner carries the desk's own state out of it once, `electron-user-data.mjs`) to the dev root itself. The data root
 * cannot go deeper either: the sockets under it are held to macOS's sun_path budget (fieldd-supervisor `paths.ts`).
 */
export function devLayoutFor(developmentRoot) {
  return Object.freeze({
    dataRoot: join(developmentRoot, "data"),
    electronUserData: developmentRoot,
    legacyElectronUserData: join(developmentRoot, "electron-user-data"),
  });
}

const devRoot = devRootFor(repoRoot);
const devLayout = devLayoutFor(devRoot);
const devBuildRoot = join(devRoot, "build");
const nativeName = process.platform === "win32" ? "field-native.exe" : "field-native";
const cellName = process.platform === "win32" ? "field-terminal-host.exe" : "field-terminal-host";
const freewayName = process.platform === "win32" ? "field-freeway-host.exe" : "field-freeway-host";

export function commandEndpointFor(root, developmentRoot, platform = process.platform) {
  return platform === "win32"
    ? `\\\\.\\pipe\\vibefield-dev-${createHash("sha256").update(root).digest("hex").slice(0, 20)}`
    : join(developmentRoot, "runner.sock");
}

const commandEndpoint = commandEndpointFor(repoRoot, devRoot);

export const workspacePaths = Object.freeze({
  repoRoot,
  devRoot,
  dataRoot: devLayout.dataRoot,
  logRoot: join(devRoot, "logs"),
  electronUserData: devLayout.electronUserData,
  legacyElectronUserData: devLayout.legacyElectronUserData,
  lockDir: join(devRoot, "runner.lock"),
  commandEndpoint,
  runtimeRoot: join(devRoot, "runtime"),
  devBuildRoot,
  desktopRoot: join(repoRoot, "apps", "desktop"),
  viteConfig: join(repoRoot, "packages", "electron-shell", "vite.config.ts"),
  mainEntry: join(repoRoot, "packages", "electron-shell", "src", "main", "index.ts"),
  studioMainEntry: join(repoRoot, "packages", "electron-shell", "src", "studio", "main.ts"),
  mainOutput: join(devBuildRoot, "electron-shell", "main", "index.cjs"),
  // SD-2 — the sound renders' thread, which main starts from beside its own bundle
  soundWorkerEntry: join(
    repoRoot,
    "packages",
    "electron-shell",
    "src",
    "main",
    "sound-worker-thread.ts",
  ),
  soundWorkerOutput: join(devBuildRoot, "electron-shell", "main", "sound-worker.cjs"),
  preloadEntry: join(repoRoot, "packages", "electron-shell", "src", "preload", "index.ts"),
  studioProductPreloadEntry: join(
    repoRoot,
    "packages",
    "electron-shell",
    "src",
    "studio",
    "product-preload.ts",
  ),
  studioPreloadEntry: join(
    repoRoot,
    "packages",
    "electron-shell",
    "src",
    "studio",
    "studio-preload.ts",
  ),
  preloadOutput: join(devBuildRoot, "electron-shell", "preload", "index.cjs"),
  studioPreloadOutput: join(devBuildRoot, "electron-shell", "preload", "studio.cjs"),
  fielddEntry: join(repoRoot, "packages", "fieldd", "src", "bin.ts"),
  fielddOutput: join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"),
  serviceHarnessEntry: join(repoRoot, "packages", "fieldd", "src", "service-worker-harness.mjs"),
  serviceHarnessOutput: join(repoRoot, "packages", "fieldd", "dist", "service-harness.mjs"),
  fielddWasm: join(repoRoot, "packages", "fieldd", "dist", "loro_wasm_bg.wasm"),
  agentShimOutput: join(repoRoot, "packages", "fieldd", "dist", "agent-shim.cjs"),
  // FS-1a (L1) — the files worker's bundle and mille's native engine, beside
  // the daemon's bundle (fieldd resolves both against its own directory)
  filesHostOutput: join(repoRoot, "packages", "fieldd", "dist", "files-host.cjs"),
  milleNativeOutput: join(
    repoRoot,
    "packages",
    "fieldd",
    "dist",
    `mille.${milleTriple(process.platform, process.arch)}.node`,
  ),
  nativeOutput: join(repoRoot, "target", "debug", nativeName),
  // TC-S2 — the floor's terminal cell, built by the same `cargo build -p field-native`. The floor
  // finds it as a SIBLING of its own executable (field-native `config.rs` `cell_binary()`), so the
  // snapshot stages it beside the floor, as packaging does (`scripts/stage-package.mjs`).
  cellOutput: join(repoRoot, "target", "debug", cellName),
  // F1 — the floor's freeway host, from the same build, found the same way (`config.rs`
  // `freeway_binary()`): without it beside the floor, the floor's freeway unit is disabled.
  freewayOutput: join(repoRoot, "target", "debug", freewayName),
  contractsSource: join(repoRoot, "packages", "contracts", "src"),
  nativeSource: join(repoRoot, "packages", "field-native", "src"),
});

/** mille's napi triple (fieldd's workspace/launch.ts `milleTriple`, musl
 * read the way mille's own loader reads it). */
function milleTriple(platform, arch) {
  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "win32") return `win32-${arch}-msvc`;
  let musl = false;
  try {
    musl = !process.report?.getReport()?.header?.glibcVersionRuntime;
  } catch {
    musl = false;
  }
  return `linux-${arch}-${musl ? "musl" : "gnu"}`;
}

export function toRepoRelative(path) {
  return relative(repoRoot, path).split("\\").join("/");
}
