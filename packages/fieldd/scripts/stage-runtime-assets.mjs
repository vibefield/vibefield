#!/usr/bin/env node
// Stage the runtime assets that CANNOT be bundled, beside dist/bin.cjs.
//
// loro-crdt's node entry does `readFileSync(join(__dirname, "loro_wasm_bg.wasm"))`,
// so the 3.1 MB wasm resolves against whatever directory the BUNDLE sits in —
// bundling the JS carries none of it. Probe P-A (2026-07-25) proved the failure
// concretely: a fully bundled fieldd run from a tree without node_modules dies
// with a bare ENOENT on that path until the file is placed alongside.
//
// Copying it into dist/ makes source runs, the transitional packaged daemon
// (Electron-as-node executing dist/bin.cjs from resources/bin), and a future SEA
// all resolve it the same way — `__dirname` is the executable's directory in a
// SEA too, verified from an unrelated cwd. One rule, three containers.
//
// The wasm is resolved through require.resolve rather than a hardcoded pnpm
// path: the store layout is an implementation detail of the package manager,
// and EL8 pins the loro VERSION, not its location on disk.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("loro-crdt/package.json"));
const dist = join(import.meta.dirname, "..", "dist");

// The nodejs/ build is the one a Node bundle pulls in (the bundler picks it via
// the package's node condition); its sibling wasm is what readFileSync wants.
const WASM = "loro_wasm_bg.wasm";
const from = join(pkg, "nodejs", WASM);

mkdirSync(dist, { recursive: true });
copyFileSync(from, join(dist, WASM));
console.log(`staged ${WASM} -> dist/`);
