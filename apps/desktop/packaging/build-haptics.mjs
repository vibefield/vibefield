#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);
if (!["arm64", "x64"].includes(process.arch))
  throw new Error(`unsupported haptic architecture: ${process.arch}`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const headers = resolve(dirname(process.execPath), "..", "include", "node");
if (!existsSync(join(headers, "node_api.h")))
  throw new Error(`Node-API headers missing: ${headers}`);
const output = join(root, "build/native/macos/desktop-haptics.node");
const temporary = `${output}.building`;
const scratch = mkdtempSync(join(tmpdir(), "vf-haptics-"));
const identifier = "com.jamesyong.vibefield.desktop-haptics";
const plist = join(scratch, "Info.plist");
mkdirSync(dirname(output), { recursive: true });
// Keep the identity when electron-builder re-signs the nested Mach-O.
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`,
);
function run(args) {
  const result = spawnSync("xcrun", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`haptic build failed: ${args[0]} (${result.status})`);
}
// Item 249 (2026-11-08): the SDK is named, as build-screenshot-helper.mjs names it: one
// lookup, handed to the compiler. A bare `xcrun clang++` builds against xcrun's DEFAULT SDK,
// which need not be the selected Xcode's. On vf-m2 (Xcode 26.3 selected, Command Line Tools
// 27.2 installed) it was the CLT's 27.2, whose `.tbd` stubs Xcode 26.3's ld cannot read, and
// verify went red at this build (run 220).
function capture(label, command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}
try {
  const sdk = capture("macOS SDK lookup", "xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
  run([
    "clang++",
    "-isysroot",
    sdk,
    "-std=c++20",
    "-fobjc-arc",
    "-O2",
    "-arch",
    process.arch === "arm64" ? "arm64" : "x86_64",
    "-mmacosx-version-min=12.3",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fPIC",
    "-fvisibility=hidden",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-DNAPI_VERSION=8",
    `-I${headers}`,
    join(root, "native/macos/haptics/adapter.mm"),
    "-framework",
    "AppKit",
    `-Wl,-sectcreate,__TEXT,__info_plist,${plist}`,
    "-o",
    temporary,
  ]);
  // Deliberately omit --identifier, just as the release signer does: the
  // embedded identity must survive both the local and packaged signatures.
  run(["codesign", "--force", "--sign", "-", temporary]);
  const signature = spawnSync("xcrun", ["codesign", "--display", "--verbose=2", temporary], {
    encoding: "utf8",
  });
  if (
    signature.status !== 0 ||
    !`${signature.stdout}\n${signature.stderr}`.includes(`Identifier=${identifier}\n`)
  ) {
    throw new Error("haptic adapter lost its embedded signing identity");
  }
  renameSync(temporary, output);
} finally {
  rmSync(temporary, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`Desktop haptics built for ${process.arch}: ${output}`);
