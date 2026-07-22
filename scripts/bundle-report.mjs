#!/usr/bin/env node
// Bundle report (electron-shell refactor, spec §10.3): sizes + the initial module
// graph of the built renderer. Report-only — slice 4 adds enforcing assertions.
// Usage: node scripts/bundle-report.mjs [--dist <dir>] [--json <path>]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const distDir = resolve(argValue("--dist") ?? "apps/desktop/dist");
const rendererDir = join(distDir, "renderer");
const assetsDir = join(rendererDir, "assets");

let indexHtml;
try {
  indexHtml = readFileSync(join(rendererDir, "index.html"), "utf8");
} catch {
  console.error(`no built renderer at ${rendererDir} — run \`pnpm build\` first`);
  process.exit(1);
}

// ---- index.html: entry scripts, modulepreloads, stylesheets ----------------
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1];
const basename = (p) => p.split("/").at(-1) ?? p;
const entries = [...indexHtml.matchAll(/<script[^>]+type="module"[^>]*>/g)]
  .map((m) => attr(m[0], "src"))
  .filter(Boolean)
  .map(basename);
const preloads = [...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]*>/g)]
  .map((m) => attr(m[0], "href"))
  .filter(Boolean)
  .map(basename);
const styles = [...indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
  .map((m) => attr(m[0], "href"))
  .filter(Boolean)
  .map(basename);

// ---- chunk contents: static-vs-dynamic imports + heavy-module markers ------
const chunks = new Map(); // name -> { raw, gzip, staticImports, dynamicImports, markers }
const MARKERS = [
  ["three", /REVISION\s*[:=]/],
  ["wasm-base64", /application\/wasm|[A-Za-z0-9+/]{65536}/],
  ["react-dom", /createRoot/],
];
for (const name of readdirSync(assetsDir)) {
  const path = join(assetsDir, name);
  if (!statSync(path).isFile()) continue;
  const buf = readFileSync(path);
  const text = name.endsWith(".js") ? buf.toString("utf8") : "";
  // built ESM: static = `import{..}from"./x.js"` / `import"./x.js"`; dynamic = `import("./x.js")`
  const staticImports = [...text.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
  const dynamicImports = [...text.matchAll(/import\(\s*"\.\/([^"]+\.js)"\s*\)/g)].map((m) => m[1]);
  const markers = MARKERS.filter(([, re]) => re.test(text)).map(([label]) => label);
  chunks.set(name, {
    raw: buf.length,
    gzip: gzipSync(buf).length,
    staticImports: staticImports.filter((s) => !dynamicImports.includes(s)),
    dynamicImports,
    markers,
  });
}

// ---- the initial graph: entries + modulepreloads + transitive statics ------
const initial = new Set();
const walk = (name) => {
  if (initial.has(name) || !chunks.has(name)) return;
  initial.add(name);
  for (const dep of chunks.get(name).staticImports) walk(dep);
};
for (const e of [...entries, ...preloads, ...styles]) walk(e);

// ---- shell bundles ---------------------------------------------------------
const shellFiles = {};
for (const f of ["main.cjs", "preload.cjs"]) {
  try {
    const buf = readFileSync(join(distDir, f));
    shellFiles[f] = { raw: buf.length, gzip: gzipSync(buf).length };
  } catch {
    /* not built */
  }
}

// ---- report ----------------------------------------------------------------
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const row = (name, c, tags) =>
  `  ${name.padEnd(36)} ${kb(c.raw).padStart(10)} ${kb(c.gzip).padStart(10)}  ${tags}`;
console.log(`renderer initial graph (entry + modulepreload + static imports):`);
let initRaw = 0;
let initGzip = 0;
for (const name of initial) {
  const c = chunks.get(name);
  if (!c) continue;
  initRaw += c.raw;
  initGzip += c.gzip;
  console.log(row(name, c, c.markers.join(" ")));
}
console.log(`  ${"TOTAL".padEnd(36)} ${kb(initRaw).padStart(10)} ${kb(initGzip).padStart(10)}`);
console.log(`\nnot in the initial graph:`);
let lazyCount = 0;
for (const [name, c] of chunks) {
  if (initial.has(name)) continue;
  lazyCount += 1;
  console.log(row(name, c, c.markers.join(" ")));
}
if (lazyCount === 0) console.log("  (nothing — every chunk is initial)");
console.log(`\nshell bundles:`);
for (const [name, c] of Object.entries(shellFiles)) {
  console.log(row(name, c, ""));
}

// --assert (slice 4, spec §10.2): the initial graph must exclude the heavy
// world; a lazy chunk must actually carry it; no spike artifacts in prod.
if (args.includes("--assert")) {
  const problems = [];
  for (const name of initial) {
    const c = chunks.get(name);
    if (!c) continue;
    if (c.markers.includes("three")) problems.push(`${name}: three in the initial graph`);
    if (c.markers.includes("wasm-base64")) problems.push(`${name}: loro wasm in the initial graph`);
  }
  for (const name of chunks.keys()) {
    if (name.startsWith("spike-")) problems.push(`${name}: spike artifact in production output`);
  }
  const lazyCarriesWorld = [...chunks].some(
    ([name, c]) =>
      !initial.has(name) && (c.markers.includes("three") || c.markers.includes("wasm-base64")),
  );
  if (!lazyCarriesWorld) {
    problems.push("no lazy chunk carries the workspace (three/loro) — the split did not happen");
  }
  if (problems.length > 0) {
    console.error(`\nbundle assert FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nbundle assert OK — initial ${kb(initRaw)} raw / ${kb(initGzip)} gz, world lazy`);
}

const report = {
  generatedFor: "electron-shell-refactor baseline",
  entries,
  preloads,
  styles,
  initialGraph: [...initial],
  initialRaw: initRaw,
  initialGzip: initGzip,
  chunks: Object.fromEntries(chunks),
  shell: shellFiles,
};
const jsonPath = argValue("--json");
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${jsonPath}`);
}
