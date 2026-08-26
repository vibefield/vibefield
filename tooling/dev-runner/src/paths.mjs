import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const devRoot = join(repoRoot, ".vibefield", "dev");
const nativeName = process.platform === "win32" ? "field-native.exe" : "field-native";

export const workspacePaths = Object.freeze({
  repoRoot,
  devRoot,
  dataRoot: join(devRoot, "data"),
  logRoot: join(devRoot, "logs"),
  electronUserData: join(devRoot, "electron-user-data"),
  lockDir: join(devRoot, "runner.lock"),
  runtimeRoot: join(devRoot, "runtime"),
  desktopRoot: join(repoRoot, "apps", "desktop"),
  viteConfig: join(repoRoot, "packages", "electron-shell", "vite.config.ts"),
  mainEntry: join(repoRoot, "packages", "electron-shell", "src", "main", "index.ts"),
  studioMainEntry: join(repoRoot, "packages", "electron-shell", "src", "studio", "main.ts"),
  mainOutput: join(repoRoot, "packages", "electron-shell", "dist", "main", "index.cjs"),
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
  preloadOutput: join(repoRoot, "packages", "electron-shell", "dist", "preload", "index.cjs"),
  studioPreloadOutput: join(
    repoRoot,
    "packages",
    "electron-shell",
    "dist",
    "preload",
    "studio.cjs",
  ),
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
