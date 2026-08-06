#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(packageRoot, "dist", "renderer");
const BENCH_MARKER = "vibefield-ui-bench-only";
const BENCH_PATH = /(^|\/)(design-system|ui-bench)([-./]|$)/i;

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
  if (BENCH_PATH.test(path)) leaks.push(`${path} has a UI Bench path`);
  if (/\.(?:css|html|js|json)$/i.test(path)) {
    const contents = readFileSync(absolute, "utf8");
    if (contents.includes(BENCH_MARKER)) leaks.push(`${path} contains the UI Bench marker`);
  }
}

const extraDocuments = files
  .map((absolute) => relative(rendererRoot, absolute).split("\\").join("/"))
  .filter((path) => path.endsWith(".html") && path !== "index.html");
for (const path of extraDocuments) leaks.push(`${path} is an unexpected production document`);

if (leaks.length > 0) {
  throw new Error(`production renderer contains development UI:\n  ${leaks.join("\n  ")}`);
}

const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
process.stdout.write(
  `production UI boundary OK — ${files.length} files, ${bytes.toLocaleString("en-US")} bytes; UI Bench absent\n`,
);
