#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mainBundle = join(packageRoot, "dist", "main", "index.cjs");
const BENCH_MARKERS = ["VibeField UI Bench", "VIBEFIELD_UI_BENCH_URL", "vibefield-ui-bench-only"];

if (!existsSync(mainBundle)) {
  throw new Error("production main verification requires dist/main/index.cjs");
}

const contents = readFileSync(mainBundle, "utf8");
const leaked = BENCH_MARKERS.filter((marker) => contents.includes(marker));
if (leaked.length > 0) {
  throw new Error(`production main contains UI Bench markers: ${leaked.join(", ")}`);
}

process.stdout.write(
  `production main boundary OK — ${statSync(mainBundle).size.toLocaleString("en-US")} bytes; UI Bench absent\n`,
);
