#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mainBundle = join(packageRoot, "dist", "main", "index.cjs");
const BENCH_MARKERS = ["VibeField UI Bench", "VIBEFIELD_UI_BENCH_URL", "vibefield-ui-bench-only"];
// TP-S0c: the perf lab RUNNER lives in the separate testing bundle
// (dist/testing/smoke.cjs) that main reaches by a runtime-external import, the
// same way every smoke does — so its marker must never appear in main either.
const LAB_MARKERS = ["vibefield-terminal-perf-lab-only", "vibefield-terminal-door-probe-only"];

if (!existsSync(mainBundle)) {
  throw new Error("production main verification requires dist/main/index.cjs");
}

const contents = readFileSync(mainBundle, "utf8");
const leaked = [...BENCH_MARKERS, ...LAB_MARKERS].filter((marker) => contents.includes(marker));
if (leaked.length > 0) {
  throw new Error(`production main contains development markers: ${leaked.join(", ")}`);
}

process.stdout.write(
  `production main boundary OK — ${statSync(mainBundle).size.toLocaleString("en-US")} bytes; UI Bench and perf lab absent\n`,
);
