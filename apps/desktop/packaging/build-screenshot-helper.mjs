#!/usr/bin/env node

// SNAP-0 — build the native screenshot helper for THIS host: a `swiftc`'d,
// ad-hoc signed `.app` on macOS (the TCC keys ride the bundle), the Rust crate's
// `.exe` on Windows. The helper is optional in the stage (SNAP-D5), so a host
// with no helper of its own skips instead of failing.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableName = "field-screenshot-helper";
const bundleIdentifier = "com.jamesyong.vibefield.screenshot-helper";

for (const argument of process.argv.slice(2)) {
  throw new Error(`unknown screenshot helper build option: ${argument}`);
}

if (process.platform === "darwin") {
  process.stdout.write(`${buildMacOS()}\n`);
} else if (process.platform === "win32") {
  process.stdout.write(`${buildWindows()}\n`);
} else {
  process.stdout.write(
    `screenshot helper build skipped — no native helper for ${process.platform}\n`,
  );
  process.exit(0);
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}`);
  return result;
}

function capture(label, command, args) {
  const result = spawnSync(command, args, { cwd: desktopRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}

function buildMacOS() {
  const targets = { arm64: "arm64-apple-macos14.0", x64: "x86_64-apple-macos14.0" };
  const target = targets[process.arch];
  if (target === undefined) {
    throw new Error(`unsupported macOS screenshot helper architecture: ${process.arch}`);
  }

  const sourceRoot = join(desktopRoot, "native", "macos", "screenshot-helper");
  const sourceDirectory = join(sourceRoot, "Sources");
  const infoPlist = join(sourceRoot, "Info.plist");
  if (!existsSync(infoPlist)) throw new Error(`screenshot helper Info.plist missing: ${infoPlist}`);
  const sources = existsSync(sourceDirectory)
    ? readdirSync(sourceDirectory)
        .filter((entry) => entry.endsWith(".swift"))
        .sort()
        .map((entry) => join(sourceDirectory, entry))
    : [];
  if (sources.length === 0) throw new Error(`no screenshot helper sources in ${sourceDirectory}`);

  const outputRoot = join(desktopRoot, "build", "native", "macos");
  const app = join(outputRoot, `${executableName}.app`);
  const building = `${app}.building`;
  const sdk = capture("macOS SDK lookup", "xcrun", ["--sdk", "macosx", "--show-sdk-path"]);

  try {
    rmSync(building, { recursive: true, force: true });
    mkdirSync(join(building, "Contents", "MacOS"), { recursive: true });
    // No `-parse-as-library`: main.swift is a script-style entry point.
    run("screenshot helper compilation", "xcrun", [
      "swiftc",
      "-sdk",
      sdk,
      "-O",
      "-target",
      target,
      "-framework",
      "AppKit",
      "-framework",
      "ScreenCaptureKit",
      "-framework",
      "CoreGraphics",
      "-framework",
      "Carbon",
      "-framework",
      "UniformTypeIdentifiers",
      "-o",
      join(building, "Contents", "MacOS", executableName),
      ...sources,
    ]);
    copyFileSync(infoPlist, join(building, "Contents", "Info.plist"));
    writeFileSync(join(building, "Contents", "PkgInfo"), "APPL????");
    // A stable ad-hoc identifier: the linker's implicit one would end in
    // `.building`, and Screen Recording consent is keyed to the identity. The
    // release signer replaces this signature while preserving the identifier.
    run("screenshot helper ad-hoc signing", "xcrun", [
      "codesign",
      "--force",
      "--deep",
      "--sign",
      "-",
      "--identifier",
      bundleIdentifier,
      building,
    ]);
    rmSync(app, { recursive: true, force: true });
    renameSync(building, app);
  } finally {
    rmSync(building, { recursive: true, force: true });
  }

  return `screenshot helper built for ${process.arch}:\n${app}`;
}

function buildWindows() {
  const manifest = join(desktopRoot, "native", "windows", "screenshot-helper", "Cargo.toml");
  if (!existsSync(manifest)) throw new Error(`screenshot helper manifest missing: ${manifest}`);
  run("screenshot helper cargo build", "cargo", [
    "build",
    "--release",
    "--manifest-path",
    manifest,
  ]);
  const metadata = JSON.parse(
    capture("screenshot helper cargo metadata", "cargo", [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      manifest,
    ]),
  );
  const targetDirectory = metadata.target_directory;
  if (typeof targetDirectory !== "string" || targetDirectory.length === 0) {
    throw new Error("cargo metadata did not name a target directory");
  }
  const built = join(targetDirectory, "release", `${executableName}.exe`);
  if (!existsSync(built)) throw new Error(`screenshot helper executable missing: ${built}`);
  const outputRoot = join(desktopRoot, "build", "native", "windows");
  mkdirSync(outputRoot, { recursive: true });
  const destination = join(outputRoot, `${executableName}.exe`);
  copyFileSync(built, destination);
  return `screenshot helper built for ${process.arch}:\n${destination}`;
}
