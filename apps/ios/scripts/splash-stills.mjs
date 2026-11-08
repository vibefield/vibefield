#!/usr/bin/env node
// The splash's launch still (DESIGN.md §8 "The phone's splash"): the mark of the splash's first
// frame, in each appearance at 2× and 3×, drawn by the kit's vendored Metal runtime itself
// (splash-stills.swift) into the app's `SplashMark` image set. The launch screen shows it over the
// field's ground (Info.plist's UILaunchScreen), and the splash shows the same asset over the same
// ground until its field is up, so launch to splash to live field is one picture.
//
//   node apps/ios/scripts/splash-stills.mjs    after vendor-splash.mjs, on a Mac with Xcode's Metal toolchain
//
// The stills are a derivative of the vendored files: run it whenever vendor-splash.mjs moves a pin.
// A GPU's rounding can move a pixel by a level between Macs, so they are not pinned themselves.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IOS = join(HERE, "..");
const SPLASH = join(IOS, "VibeFieldKit", "Sources", "FieldSplash", "Splash");
const SET = join(IOS, "App", "Assets.xcassets", "SplashMark.imageset");

const work = mkdtempSync(join(tmpdir(), "vf-splash-stills-"));
try {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  run("xcrun", ["-sdk", "macosx", "metal", "-c", join(SPLASH, "SplashShaders.metal"), "-o", join(work, "splash.air")]);
  run("xcrun", ["-sdk", "macosx", "metallib", join(work, "splash.air"), "-o", join(work, "splash.metallib")]);
  // Item 249 (2026-11-08, 249b): swiftc's SDK is named, as build-screenshot-helper.mjs names it: one lookup, handed
  // to swiftc as `-sdk`. A bare `xcrun swiftc` builds against xcrun's DEFAULT SDK, which need not be the selected
  // Xcode's (vf-m2, run 220: the Command Line Tools' 27.2 under Xcode 26.3). The two Metal lines above name theirs.
  const sdk = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
  run("xcrun", ["swiftc", "-sdk", sdk, "-O", "-parse-as-library", join(HERE, "splash-stills.swift"), join(SPLASH, "SplashRuntime.swift"), join(SPLASH, "SplashBake.swift"), "-o", join(work, "splash-stills")]);
  process.stdout.write(run(join(work, "splash-stills"), [join(work, "splash.metallib"), join(work, "stills")]));

  mkdirSync(SET, { recursive: true });
  const dark = [{ appearance: "luminosity", value: "dark" }];
  const images = [];
  for (const [look, appearances] of [["light", null], ["dark", dark]]) {
    images.push({ ...(appearances ? { appearances } : {}), idiom: "universal", scale: "1x" });
    for (const scale of [2, 3]) {
      const file = `mark-${look}@${scale}x.png`;
      copyFileSync(join(work, "stills", file), join(SET, file));
      images.push({ ...(appearances ? { appearances } : {}), filename: file, idiom: "universal", scale: `${scale}x` });
    }
  }
  // Xcode's own style: keys in order, a space either side of every colon
  const json = JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2).replace(/": /g, '" : ');
  writeFileSync(join(SET, "Contents.json"), `${json}\n`);
  console.log(`${relative(join(IOS, "..", ".."), SET)}: ${images.filter((i) => i.filename).length} stills`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
