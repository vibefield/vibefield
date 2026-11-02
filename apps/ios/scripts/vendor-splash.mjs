#!/usr/bin/env node
// Vendors the iPhone splash into the kit (FieldSplash; DESIGN.md §8 "The phone's splash"): the
// Metal bake of vibefield-splash's iPhone look — splash/bake-metal.mjs, which writes the look's two
// appearances (Wormhole · Obsidian by night, Wormhole · Obsidian Light by day) as Metal shaders,
// the numbers its runtime reads, and that runtime — with the runtime's goldens for the kit's tests.
// Each file is pinned by its sha256 in SOURCE below: a new bake reaches the app only as a
// deliberate move of its pins, never by a copy.
//
//   node apps/ios/scripts/vendor-splash.mjs [--from <vibefield-splash>]   bakes there, checks the pins, writes the kit's copies
//   node apps/ios/scripts/vendor-splash.mjs --check                       the kit's copies against the pins (no checkout needed)
//   node apps/ios/scripts/vendor-splash.mjs --pin [--from <…>]            prints the pins a fresh bake there would need
//
// `--from` defaults to $VIBEFIELD_SPLASH, then ../vibefield-splash beside this checkout. The bake
// runs in a temporary directory (node only: the splash's bake has no dependencies), so vendoring
// needs nothing built there first. The copies are the bake's bytes, unedited: the generated files
// name their own look and its hash, and the runtime is the splash project's own source. Its parity
// with the look as tuned is the splash project's to witness (npm run check:splash:metal: the Metal
// runtime against the lab's window, both appearances, iPhone sizes).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..", "VibeFieldKit");
const ROOT = join(HERE, "..", "..", "..");

// The bake of splash/look-iphone.json at vibefield-splash 6f770f9 (branch iphone-splash, 2026-11-01): the
// iPhone look as tuned that day (Rows 400, Spacing 1: the dust on the screen's edges and corners), with the
// Metal bake that commit adds.
const SOURCE = {
  revision: "6f770f9",
  looks: { dark: "8f52f9ad8acb", light: "727a3dc38ddb" },
  files: [
    {
      from: "SplashShaders.metal",
      to: "Sources/FieldSplash/Splash/SplashShaders.metal",
      sha256: "d895e1e9855809a12eb19a30aa5ddad857198f28a4cf26dc12140a42da52abfd",
    },
    {
      from: "SplashBake.swift",
      to: "Sources/FieldSplash/Splash/SplashBake.swift",
      sha256: "338f7992c021c9b8654249c591e9256528ca6eb2d112f5060211f272ecde22a0",
    },
    {
      from: "SplashRuntime.swift",
      to: "Sources/FieldSplash/Splash/SplashRuntime.swift",
      sha256: "9368526d245c29a5c30644441ba1a9d09f4ee18bc604bfc11d90743cca995e41",
    },
    {
      from: "clock.json",
      to: "Tests/FieldSplashTests/Fixtures/splash-clock.json",
      sha256: "c8b1b538883df0f35fa62847e77f0651bd7f99d0a31efb5a59c5dc230857bdb6",
    },
  ],
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
const check = args.includes("--check");
const pin = args.includes("--pin");
const fromAt = args.indexOf("--from");
const from = resolve(fromAt >= 0 ? args[fromAt + 1] : (process.env.VIBEFIELD_SPLASH ?? join(ROOT, "..", "vibefield-splash")));

if (check) {
  const wrong = [];
  for (const f of SOURCE.files) {
    const path = join(KIT, f.to);
    if (!existsSync(path)) wrong.push(`${f.to} is missing`);
    else if (sha256(readFileSync(path)) !== f.sha256) wrong.push(`${f.to} is not its pin (${f.from} ${f.sha256.slice(0, 12)})`);
  }
  if (wrong.length) {
    console.error(`the vendored splash differs from its pins:\n  ${wrong.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`the vendored splash is its pins (${SOURCE.files.length} files; looks ${SOURCE.looks.dark} · ${SOURCE.looks.light})`);
  process.exit(0);
}

const bake = join(from, "splash", "bake-metal.mjs");
if (!existsSync(bake)) throw new Error(`${bake} is missing — pass --from <vibefield-splash>`);
const out = mkdtempSync(join(tmpdir(), "vf-splash-metal-"));
try {
  const report = JSON.parse(execFileSync(process.execPath, [bake, `--out=${out}`], { cwd: from, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  const revision = execFileSync("git", ["-C", from, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", from, "status", "--porcelain", "--", "splash", "src"], { encoding: "utf8" }).trim() !== "";
  const looks = { dark: report.looks.dark.hash, light: report.looks.light.hash };
  if (pin) {
    const files = SOURCE.files.map((f) => ({ ...f, sha256: sha256(readFileSync(join(out, f.from))) }));
    console.log(JSON.stringify({ revision: `${revision}${dirty ? " + uncommitted changes" : ""}`, looks, files }, null, 2));
    process.exit(0);
  }
  if (looks.dark !== SOURCE.looks.dark || looks.light !== SOURCE.looks.light) {
    throw new Error(`the bake at ${from} is of looks ${looks.dark} · ${looks.light}, not the pinned ${SOURCE.looks.dark} · ${SOURCE.looks.light}: a new look is a deliberate move of SOURCE's pins (--pin prints them)`);
  }
  for (const f of SOURCE.files) {
    const bytes = readFileSync(join(out, f.from));
    const got = sha256(bytes);
    if (got !== f.sha256) throw new Error(`${f.from} baked at ${from} is ${got}, not its pin ${f.sha256}: a new bake is a deliberate move of SOURCE's pins (--pin prints them)`);
    const to = join(KIT, f.to);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    console.log(`${relative(ROOT, to)} ← ${f.from} (${got.slice(0, 12)})`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
