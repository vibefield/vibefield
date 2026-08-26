#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(packageRoot, "dist");
const mainBundle = join(packageRoot, "dist", "main", "index.cjs");
const preloadBundle = join(packageRoot, "dist", "preload", "index.cjs");
const CATALOG_MARKERS = [
  "vibefield-design-catalog-only",
  // Legacy tripwires stay guarded even after the standalone shell is removed.
  "VibeField UI Bench",
  "VIBEFIELD_UI_BENCH_URL",
  "vibefield-ui-bench-only",
];
const STUDIO_MARKERS = [
  "VibeField Studio",
  "VIBEFIELD_STUDIO_OPEN",
  "vibefield-studio-only",
  "vibefield-studio-product-only",
  "vibefieldStudio",
  "vibefield:studio:",
];
// TP-S0c: the perf lab RUNNER lives in the separate testing bundle
// (dist/testing/smoke.cjs) that main reaches by a runtime-external import, the
// same way every smoke does — so its marker must never appear in main either.
const LAB_MARKERS = ["vibefield-terminal-perf-lab-only", "vibefield-terminal-door-probe-only"];

for (const bundle of [mainBundle, preloadBundle]) {
  if (!existsSync(bundle)) {
    throw new Error(`production shell verification requires ${relative(packageRoot, bundle)}`);
  }
}

const shellFiles = [
  ...filesBelow(join(distRoot, "main")),
  ...filesBelow(join(distRoot, "preload")),
];
const expectedShellFiles = new Set([mainBundle, preloadBundle]);
const unexpected = shellFiles.filter((file) => !expectedShellFiles.has(file));
if (unexpected.length > 0) {
  throw new Error(
    `production shell contains unexpected artifacts: ${unexpected
      .map((file) => relative(distRoot, file))
      .join(", ")}`,
  );
}

const contents = shellFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const leaked = [...CATALOG_MARKERS, ...STUDIO_MARKERS, ...LAB_MARKERS].filter((marker) =>
  contents.includes(marker),
);
if (leaked.length > 0) {
  throw new Error(`production shell contains development markers: ${leaked.join(", ")}`);
}

process.stdout.write(
  `production shell boundary OK — main ${statSync(mainBundle).size.toLocaleString("en-US")} bytes, preload ${statSync(preloadBundle).size.toLocaleString("en-US")} bytes; exact artifact set, Studio, Design System catalog, and perf lab absent\n`,
);

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
