#!/usr/bin/env node

// SNAP-0 — the screenshot helper's own unit gate. On macOS it compiles the
// hand-rolled Swift harness (every source but the two entry points, plus the
// tests) and runs it with the contract fixtures in its environment, so the same
// files zod parses in `packages/contracts` are decoded by the helper's own
// reader (EL9). On Windows it is `cargo test` over the crate.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");

for (const argument of process.argv.slice(2)) {
  throw new Error(`unknown screenshot helper test option: ${argument}`);
}

if (process.platform === "darwin") {
  process.exit(testMacOS());
} else if (process.platform === "win32") {
  process.exit(testWindows());
} else {
  const reason = `no native helper for ${process.platform}`;
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason })}\n`);
  process.exit(0);
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`${label} was killed by ${result.signal}`);
  return result.status;
}

function capture(label, command, args) {
  const result = spawnSync(command, args, { cwd: desktopRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}

function testMacOS() {
  const targets = { arm64: "arm64-apple-macos14.0", x64: "x86_64-apple-macos14.0" };
  const target = targets[process.arch];
  if (target === undefined) {
    throw new Error(`unsupported macOS screenshot helper architecture: ${process.arch}`);
  }

  const sourceRoot = join(desktopRoot, "native", "macos", "screenshot-helper");
  const sourceDirectory = join(sourceRoot, "Sources");
  const harness = join(sourceRoot, "Tests", "ScreenshotHelperTests.swift");
  if (!existsSync(harness)) throw new Error(`screenshot helper test harness missing: ${harness}`);
  // The harness owns `@main`, so the app's own entry points stay out of it.
  const excluded = new Set(["main.swift", "AppDelegate.swift"]);
  const sources = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".swift") && !excluded.has(entry))
    .sort()
    .map((entry) => join(sourceDirectory, entry));
  if (sources.length === 0) throw new Error(`no screenshot helper sources in ${sourceDirectory}`);

  const outputRoot = join(desktopRoot, "build", "native", "macos");
  mkdirSync(outputRoot, { recursive: true });
  const binary = join(outputRoot, "field-screenshot-helper-tests");
  const sdk = capture("macOS SDK lookup", "xcrun", ["--sdk", "macosx", "--show-sdk-path"]);

  const compiled = run("screenshot helper test compilation", "xcrun", [
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
    binary,
    ...sources,
    harness,
  ]);
  if (compiled !== 0) return compiled;

  return run("screenshot helper tests", binary, [], {
    env: {
      ...process.env,
      VF_CONTRACT_FIXTURES: join(repoRoot, "packages", "contracts", "fixtures"),
    },
  });
}

function testWindows() {
  const manifest = join(desktopRoot, "native", "windows", "screenshot-helper", "Cargo.toml");
  if (!existsSync(manifest)) throw new Error(`screenshot helper manifest missing: ${manifest}`);
  return run("screenshot helper cargo test", "cargo", ["test", "--manifest-path", manifest]);
}
