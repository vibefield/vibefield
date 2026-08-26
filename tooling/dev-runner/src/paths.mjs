import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const devRoot = join(repoRoot, ".vibefield", "dev");
const devBuildRoot = join(devRoot, "build");
const nativeName = process.platform === "win32" ? "field-native.exe" : "field-native";
const commandEndpoint =
  process.platform === "win32"
    ? `\\\\.\\pipe\\vibefield-dev-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 20)}`
    : join(devRoot, "runner.sock");

export const workspacePaths = Object.freeze({
  repoRoot,
  devRoot,
  dataRoot: join(devRoot, "data"),
  logRoot: join(devRoot, "logs"),
  electronUserData: join(devRoot, "electron-user-data"),
  lockDir: join(devRoot, "runner.lock"),
  commandEndpoint,
  runtimeRoot: join(devRoot, "runtime"),
  devBuildRoot,
  desktopRoot: join(repoRoot, "apps", "desktop"),
  viteConfig: join(repoRoot, "packages", "electron-shell", "vite.config.ts"),
  mainEntry: join(repoRoot, "packages", "electron-shell", "src", "main", "index.ts"),
  studioMainEntry: join(repoRoot, "packages", "electron-shell", "src", "studio", "main.ts"),
  mainOutput: join(devBuildRoot, "electron-shell", "main", "index.cjs"),
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
  nativeOutput: join(repoRoot, "target", "debug", nativeName),
  contractsSource: join(repoRoot, "packages", "contracts", "src"),
  nativeSource: join(repoRoot, "packages", "field-native", "src"),
});

export function toRepoRelative(path) {
  return relative(repoRoot, path).split("\\").join("/");
}
