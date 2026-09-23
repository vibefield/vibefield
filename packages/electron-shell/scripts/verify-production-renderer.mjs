#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(packageRoot, "dist", "renderer");
const CATALOG_MARKERS = ["vibefield-design-catalog-only", "vibefield-ui-bench-only"];
const CATALOG_PATH = /(^|\/)(design-system|ui-bench)([-./]|$)/i;
const STUDIO_MARKER = "vibefield-studio-only";
const STUDIO_PATH = /(^|\/)studio([-./]|$)/i;
// TP-S0c: the perf lab's renderer bridge carries this marker in its header. The
// production build folds `__VIBEFIELD_TERMINAL_PERF_LAB__` to `false` and rollup
// drops the module, so finding the marker here means the fold stopped working —
// which is the only way lab instrumentation could reach a packaged renderer.
const PERF_LAB_MARKER = "vibefield-terminal-perf-lab-only";

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

if (!existsSync(join(rendererRoot, "index.html"))) {
  throw new Error("production renderer verification requires dist/renderer/index.html");
}

const files = walk(rendererRoot);
const leaks = [];
for (const absolute of files) {
  const path = relative(rendererRoot, absolute).split("\\").join("/");
  if (CATALOG_PATH.test(path)) leaks.push(`${path} has a Design System catalog path`);
  if (STUDIO_PATH.test(path)) leaks.push(`${path} has a Studio path`);
  if (/\.(?:css|html|js|json)$/i.test(path)) {
    const contents = readFileSync(absolute, "utf8");
    for (const marker of CATALOG_MARKERS) {
      if (contents.includes(marker)) {
        leaks.push(`${path} contains a Design System catalog marker`);
      }
    }
    if (contents.includes(STUDIO_MARKER)) leaks.push(`${path} contains the Studio marker`);
    if (contents.includes(PERF_LAB_MARKER)) leaks.push(`${path} contains the perf-lab marker`);
  }
}

const extraDocuments = files
  .map((absolute) => relative(rendererRoot, absolute).split("\\").join("/"))
  .filter((path) => path.endsWith(".html") && path !== "index.html");
for (const path of extraDocuments) leaks.push(`${path} is an unexpected production document`);

if (leaks.length > 0) {
  throw new Error(`production renderer contains development UI:\n  ${leaks.join("\n  ")}`);
}

// DESIGN.md §8 "The switch": a packaged reload shows the new page's bare
// ground unless its entry is render-blocking (render-blocking-entry.ts).
const entryTags = readFileSync(join(rendererRoot, "index.html"), "utf8").match(
  /<script type="module"[^>]*>/g,
);
if (entryTags?.length !== 1 || !entryTags[0].includes('blocking="render"')) {
  throw new Error(
    `production renderer entry must be one render-blocking module script, found: ${entryTags?.join(" ") ?? "none"}`,
  );
}

const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
process.stdout.write(
  `production UI boundary OK — ${files.length} files, ${bytes.toLocaleString("en-US")} bytes; Studio, Design System catalog, and perf lab absent\n`,
);
