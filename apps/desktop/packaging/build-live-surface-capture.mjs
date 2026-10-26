#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(desktopRoot, "native", "macos", "live-surface-capture");
const outputRoot = join(desktopRoot, "build", "native", "macos");
const allowedArguments = new Set(["--with-fixture"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error(`unknown native capture build option: ${argument}`);
  }
}
const withFixture = process.argv.includes("--with-fixture");

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
for (const source of [
  "protocol.h",
  "helper.mm",
  "adapter.mm",
  ...(withFixture ? ["fixture.mm"] : []),
]) {
  if (!existsSync(join(sourceRoot, source)))
    throw new Error(`native capture source missing: ${source}`);
}

mkdirSync(outputRoot, { recursive: true });
const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
const helper = join(outputRoot, "live-surface-capture-helper");
const adapter = join(outputRoot, "live-surface-adapter.node");
const fixture = join(outputRoot, "live-surface-capture-fixture");
const helperTemporary = `${helper}.building`;
const adapterTemporary = `${adapter}.building`;
const fixtureTemporary = `${fixture}.building`;
const signingIdentifiers = {
  helper: "com.jamesyong.vibefield.live-surface-capture-helper",
  adapter: "com.jamesyong.vibefield.live-surface-adapter",
  fixture: "com.jamesyong.vibefield.live-surface-capture-fixture",
};

// LSF-4 (2026-10-26; the first signed nightly, run 40272843651): a nested Mach-O with no Info.plist signs as its FILE
// NAME under any signer that does not name it, and electron-builder's re-sign of nested code names none. The release
// gate then read `live-surface-capture-helper` where its policy wants the reverse-DNS id. So each artifact carries its
// identity IN ITS OWN BINARY: an embedded `__TEXT,__info_plist` whose CFBundleIdentifier codesign takes as the default
// identifier, measured on this Mac for an executable and a `-bundle` alike.
const plistRoot = mkdtempSync(join(tmpdir(), "vf-live-surface-plists-"));
function embeddedIdentity(name, identifier) {
  const path = join(plistRoot, `${name}.plist`);
  writeFileSync(
    path,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string>` +
      `<key>CFBundleName</key><string>${name}</string></dict></plist>\n`,
  );
  return [`-Wl,-sectcreate,__TEXT,__info_plist,${path}`];
}

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

function applyStableAdHocSignature(label, path, identifier) {
  const result = spawnSync(
    "xcrun",
    ["codesign", "--force", "--sign", "-", "--identifier", identifier, path],
    { cwd: desktopRoot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${label} ad-hoc signing failed with status ${result.status}`);
}

function assertEmbeddedIdentity(label, path, identifier) {
  const copy = join(plistRoot, `${label.replaceAll(" ", "-")}.resign`);
  copyFileSync(path, copy);
  const sign = spawnSync("xcrun", ["codesign", "--force", "--sign", "-", copy], {
    encoding: "utf8",
  });
  if (sign.status !== 0)
    throw new Error(`${label}: the identity check's re-sign failed: ${sign.stderr}`);
  const shown = spawnSync("xcrun", ["codesign", "--display", "--verbose=2", copy], {
    encoding: "utf8",
  });
  const said = /^Identifier=(.+)$/mu.exec(`${shown.stdout}\n${shown.stderr}`)?.[1];
  if (said !== identifier)
    throw new Error(
      `${label}: a re-sign with no identifier names it ${said ?? "nothing"}, not ${identifier} — its embedded __info_plist is missing or wrong`,
    );
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
      ...embeddedIdentity("live-surface-capture-helper", signingIdentifiers.helper),
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
      "ApplicationServices",
      "-framework",
      "IOSurface",
      "-framework",
      "CoreVideo",
      ...embeddedIdentity("live-surface-adapter", signingIdentifiers.adapter),
      "-o",
      adapterTemporary,
    ],
    adapterTemporary,
  );
  if (withFixture) {
    compile(
      "ScreenCaptureKit pixel fixture",
      [
        ...common,
        join(sourceRoot, "fixture.mm"),
        "-framework",
        "AppKit",
        "-framework",
        "Foundation",
        "-framework",
        "CoreGraphics",
        ...embeddedIdentity("live-surface-capture-fixture", signingIdentifiers.fixture),
        "-o",
        fixtureTemporary,
      ],
      fixtureTemporary,
    );
  }
  renameSync(helperTemporary, helper);
  renameSync(adapterTemporary, adapter);
  if (withFixture) renameSync(fixtureTemporary, fixture);
  else rmSync(fixture, { force: true });

  // Apple Silicon's linker emits an ad-hoc signature before these atomic
  // renames, so the implicit code identifier otherwise ends in `.building`.
  // Give every artifact a stable identifier now; the release signer preserves
  // the identity while replacing this local signature with Developer ID.
  // *(Corrected 2026-10-26, LSF-4: FALSE as written — the release signer re-signed these WITHOUT an identifier and
  // they shipped as their file names (the first signed nightly). The identity lives in each binary's embedded
  // __info_plist now, which every signer reads; this ad-hoc signature only names it for the local build.)*
  applyStableAdHocSignature("ScreenCaptureKit helper", helper, signingIdentifiers.helper);
  applyStableAdHocSignature("IOSurface Node-API adapter", adapter, signingIdentifiers.adapter);
  if (withFixture) {
    applyStableAdHocSignature(
      "ScreenCaptureKit pixel fixture",
      fixture,
      signingIdentifiers.fixture,
    );
  }
  // The build proves it every time: a COPY re-signed with no identifier, as the release signer does, must take the
  // reverse-DNS id from the binary itself.
  assertEmbeddedIdentity("ScreenCaptureKit helper", helper, signingIdentifiers.helper);
  assertEmbeddedIdentity("IOSurface Node-API adapter", adapter, signingIdentifiers.adapter);
  if (withFixture)
    assertEmbeddedIdentity("ScreenCaptureKit pixel fixture", fixture, signingIdentifiers.fixture);
} finally {
  rmSync(plistRoot, { recursive: true, force: true });
  rmSync(helperTemporary, { force: true });
  rmSync(adapterTemporary, { force: true });
  rmSync(fixtureTemporary, { force: true });
}

process.stdout.write(
  `ScreenCaptureKit native boundary built for ${process.arch}:\n${helper}\n${adapter}` +
    `${withFixture ? `\n${fixture}` : ""}\n`,
);
