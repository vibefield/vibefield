#!/usr/bin/env node

import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = {
  appId: "com.jamesyong.vibefield",
  teamId: "9F79X9D26S",
  helperId: "com.jamesyong.vibefield.live-surface-capture-helper",
  adapterId: "com.jamesyong.vibefield.live-surface-adapter",
};
const allowedEntitlements = new Set(["com.apple.security.cs.allow-jit"]);

if (process.platform !== "darwin") {
  process.stderr.write(
    `${JSON.stringify({ ok: false, gate: "LSF-4-release", error: "macOS verification must run on darwin" })}\n`,
  );
  process.exit(1);
}

let appPath;
try {
  const options = parseArguments(process.argv.slice(2));
  appPath = resolve(options.app);
  await assertDirectory(appPath, "application bundle");

  const nativeRoot = join(appPath, "Contents", "Resources", "bin");
  const helperPath = join(nativeRoot, "live-surface-capture-helper");
  const adapterPath = join(nativeRoot, "live-surface-adapter.node");
  await assertRegularFile(helperPath, "capture helper", true);
  await assertRegularFile(adapterPath, "IOSurface adapter", false);

  const components = [
    { label: "app", path: appPath, identifier: expected.appId, requireJit: true },
    { label: "capture-helper", path: helperPath, identifier: expected.helperId },
    { label: "iosurface-adapter", path: adapterPath, identifier: expected.adapterId },
  ];
  const evidence = [];
  const policyFailures = [];

  for (const component of components) {
    await run(`${component.label} signature verification`, "/usr/bin/codesign", [
      "--verify",
      "--strict",
      component.path,
    ]);
    const metadata = await describeSignature(component.path);
    const entitlementKeys = await describeEntitlements(component.path);
    policyFailures.push(
      ...checkSignaturePolicy(component, metadata, entitlementKeys).map(
        (failure) => `${component.label}: ${failure}`,
      ),
    );
    evidence.push({
      component: component.label,
      identifier: metadata.identifier,
      teamIdentifier: metadata.teamIdentifier,
      runtime: metadata.runtime,
      timestamped: metadata.timestamped,
      entitlementKeys,
      cdHash: metadata.cdHash,
    });
  }

  if (policyFailures.length > 0) {
    throw new Error(`signature policy failed: ${policyFailures.join("; ")}`);
  }

  await run("deep application signature verification", "/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    appPath,
  ]);
  await run("Gatekeeper assessment", "/usr/sbin/spctl", [
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    appPath,
  ]);
  await run("notarization staple validation", "/usr/bin/xcrun", ["stapler", "validate", appPath]);

  const runtime = await verifyPackagedRuntime(nativeRoot, options.captureArguments);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      gate: "LSF-4-release",
      artifact: "VibeField.app",
      architecture: process.arch,
      expectedTeamIdentifier: expected.teamId,
      exactNestedSignatures: evidence,
      deepSignature: true,
      gatekeeperAccepted: true,
      stapleValid: true,
      packagedRuntime: runtime,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      gate: "LSF-4-release",
      error: sanitize(error instanceof Error ? error.message : String(error)),
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(args) {
  let app;
  const captureArguments = [];
  const valueOptions = new Set(["--match", "--match-app", "--match-title"]);
  let enumerateOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--app") {
      if (app !== undefined) throw new Error("duplicate --app option");
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new Error("--app requires a path");
      }
      app = value;
      index += 1;
      continue;
    }
    if (argument === "--enumerate-only") {
      if (enumerateOnly) throw new Error("duplicate --enumerate-only option");
      enumerateOnly = true;
      captureArguments.push(argument);
      continue;
    }
    if (valueOptions.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      captureArguments.push(argument, value);
      index += 1;
      continue;
    }
    throw new Error(`unknown release verification option: ${argument}`);
  }

  if (app === undefined) throw new Error("--app is required");
  if (enumerateOnly && captureArguments.length > 1) {
    throw new Error("capture match options cannot be combined with --enumerate-only");
  }
  return { app, captureArguments };
}

async function assertDirectory(path, label) {
  const stats = await lstat(path).catch(() => undefined);
  if (stats === undefined || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory`);
  }
}

async function assertRegularFile(path, label, executable) {
  const stats = await lstat(path).catch(() => undefined);
  if (stats === undefined || !stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  if (executable && (stats.mode & 0o111) === 0) {
    throw new Error(`${label} is not executable`);
  }
}

async function describeSignature(path) {
  const result = await run("signature description", "/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    path,
  ]);
  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u);
  const value = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  const codeDirectory = lines.find((line) => line.startsWith("CodeDirectory ")) ?? "";
  return {
    identifier: value("Identifier"),
    teamIdentifier: value("TeamIdentifier"),
    authorities: lines
      .filter((line) => line.startsWith("Authority="))
      .map((line) => line.slice("Authority=".length)),
    adhoc: value("Signature") === "adhoc" || /\badhoc\b/u.test(codeDirectory),
    runtime: /\bruntime\b/u.test(codeDirectory),
    timestamped: value("Timestamp") !== undefined,
    cdHash: value("CDHash"),
  };
}

async function describeEntitlements(path) {
  const result = await run("entitlements description", "/usr/bin/codesign", [
    "--display",
    "--entitlements",
    "-",
    path,
  ]);
  const output = `${result.stdout}\n${result.stderr}`;
  return Array.from(output.matchAll(/<key>([^<]+)<\/key>/gu), (match) => match[1]).sort();
}

function checkSignaturePolicy(component, metadata, entitlementKeys) {
  const failures = [];
  if (metadata.identifier !== component.identifier) {
    failures.push(
      `identifier is ${metadata.identifier ?? "missing"}, expected ${component.identifier}`,
    );
  }
  if (metadata.teamIdentifier !== expected.teamId) {
    failures.push(
      `TeamIdentifier is ${metadata.teamIdentifier ?? "missing"}, expected ${expected.teamId}`,
    );
  }
  if (metadata.adhoc) failures.push("signature is ad-hoc");
  if (!metadata.authorities[0]?.startsWith("Developer ID Application:")) {
    failures.push("leaf authority is not Developer ID Application");
  }
  if (!metadata.runtime) failures.push("Hardened Runtime flag is absent");
  if (!metadata.timestamped) failures.push("secure timestamp is absent");
  const unexpected = entitlementKeys.filter((key) => !allowedEntitlements.has(key));
  if (unexpected.length > 0) failures.push(`unexpected entitlements: ${unexpected.join(", ")}`);
  if (component.requireJit && !entitlementKeys.includes("com.apple.security.cs.allow-jit")) {
    failures.push("V8 JIT entitlement is absent");
  }
  return failures;
}

async function verifyPackagedRuntime(nativeRoot, captureArguments) {
  const verifier = join(desktopRoot, "packaging", "verify-live-surface-capture.mjs");
  const result = await run(
    "packaged helper runtime verification",
    process.execPath,
    [verifier, "--native-root", nativeRoot, ...captureArguments],
    45_000,
  );
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const report = JSON.parse(lines.at(-1) ?? "null");
  if (report?.ok !== true || report.handshake !== true) {
    throw new Error("packaged helper runtime report was not green");
  }
  return {
    mode: captureArguments.includes("--enumerate-only") ? "enumerate" : "capture",
    handshake: true,
    sourceCount: report.sourceCount,
    captured: report.captured,
    native: report.native,
  };
}

async function run(label, executable, args, timeout = 30_000) {
  try {
    return await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout,
    });
  } catch (error) {
    const diagnostic = [error?.stderr, error?.stdout, error?.message]
      .find((value) => typeof value === "string" && value.trim().length > 0)
      ?.trim()
      .replace(/\s+/gu, " ")
      .slice(0, 800);
    throw new Error(`${label} failed${diagnostic === undefined ? "" : `: ${diagnostic}`}`);
  }
}

function sanitize(message) {
  let safe = message.replace(/[\r\n]+/gu, " ").slice(0, 2000);
  if (appPath !== undefined) safe = safe.replaceAll(appPath, "<VibeField.app>");
  return safe;
}
