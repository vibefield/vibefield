#!/usr/bin/env node

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(desktopRoot, "native", "macos", "live-surface-capture");
const outputRoot = join(desktopRoot, "build", "native", "macos");

if (process.platform !== "darwin") {
  process.stdout.write("ScreenCaptureKit native build skipped — darwin only\n");
  process.exit(0);
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(`unsupported macOS native capture architecture: ${process.arch}`);
}

const nodeInclude = resolve(dirname(process.execPath), "..", "include", "node");
if (!existsSync(join(nodeInclude, "node_api.h"))) {
  throw new Error(`Node-API headers are missing at ${nodeInclude}`);
}
for (const source of ["protocol.h", "helper.mm", "adapter.mm"]) {
  if (!existsSync(join(sourceRoot, source)))
    throw new Error(`native capture source missing: ${source}`);
}

mkdirSync(outputRoot, { recursive: true });
const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
const helper = join(outputRoot, "live-surface-capture-helper");
const adapter = join(outputRoot, "live-surface-adapter.node");
const helperTemporary = `${helper}.building`;
const adapterTemporary = `${adapter}.building`;

const common = [
  "clang++",
  "-std=c++20",
  "-fobjc-arc",
  "-fblocks",
  "-O2",
  "-DNDEBUG",
  "-arch",
  architecture,
  "-mmacosx-version-min=12.3",
  "-Werror",
  "-Wall",
  "-Wextra",
  "-Wno-deprecated-declarations",
  `-I${sourceRoot}`,
];

function compile(label, args, output) {
  rmSync(output, { force: true });
  const result = spawnSync("xcrun", args, { cwd: desktopRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${label} compilation failed with status ${result.status}`);
}

try {
  compile(
    "ScreenCaptureKit helper",
    [
      ...common,
      join(sourceRoot, "helper.mm"),
      "-framework",
      "AppKit",
      "-framework",
      "Foundation",
      "-framework",
      "ScreenCaptureKit",
      "-framework",
      "CoreMedia",
      "-framework",
      "CoreVideo",
      "-framework",
      "IOSurface",
      "-framework",
      "CoreGraphics",
      "-o",
      helperTemporary,
    ],
    helperTemporary,
  );
  compile(
    "IOSurface Node-API adapter",
    [
      ...common,
      "-fPIC",
      "-fvisibility=hidden",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-DNAPI_VERSION=8",
      `-I${nodeInclude}`,
      join(sourceRoot, "adapter.mm"),
      "-framework",
      "Foundation",
      "-framework",
      "IOSurface",
      "-framework",
      "CoreVideo",
      "-o",
      adapterTemporary,
    ],
    adapterTemporary,
  );
  renameSync(helperTemporary, helper);
  renameSync(adapterTemporary, adapter);
} finally {
  rmSync(helperTemporary, { force: true });
  rmSync(adapterTemporary, { force: true });
}

process.stdout.write(
  `ScreenCaptureKit native boundary built for ${process.arch}:\n${helper}\n${adapter}\n`,
);
