#!/usr/bin/env node

import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  BIN_ROOT,
  ENTITLEMENT_ARGS,
  entitlementFailures,
  entitlementKeys,
  entitlementProfile,
  readBinEntries,
  unclassifiedBinEntries,
} from "./codesign-entitlements.mjs";
import { assertReleaseSigned } from "./release-signature.mjs";

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = {
  appId: "com.jamesyong.vibefield",
  teamId: "9F79X9D26S",
  helperId: "com.jamesyong.vibefield.live-surface-capture-helper",
  adapterId: "com.jamesyong.vibefield.live-surface-adapter",
};

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

  // LP-6: the app keeps V8's JIT; the helper and its adapter are native code signed with no entitlement at all
  // (entitlements.mac.native.plist, by packaging/sign-mac.mjs).
  const components = [
    { label: "app", path: appPath, identifier: expected.appId, profile: "jit" },
    { label: "capture-helper", path: helperPath, identifier: expected.helperId, profile: "none" },
    {
      label: "iosurface-adapter",
      path: adapterPath,
      identifier: expected.adapterId,
      profile: "none",
    },
  ];
  const evidence = [];
  const policyFailures = [];
  let appDeveloperId = false;

  for (const component of components) {
    await run(`${component.label} signature verification`, "/usr/bin/codesign", [
      "--verify",
      "--strict",
      component.path,
    ]);
    const metadata = await describeSignature(component.path);
    const entitlementKeys = await describeEntitlements(component.path);
    if (component.label === "app") {
      appDeveloperId = metadata.authorities[0]?.startsWith("Developer ID Application:") === true;
    }
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

  const entitlementCensus = await binEntitlementCensus(nativeRoot, appDeveloperId);
  policyFailures.push(...entitlementCensus.failures);

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
      binEntitlements: entitlementCensus.rows,
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

// LSF-4 (2026-10-26): the XML plist, never codesign's text form, which this gate once read as "no entitlement at all"
// (the first signed nightly's "V8 JIT entitlement is absent"; packaging/codesign-entitlements.mjs).
async function describeEntitlements(path) {
  const result = await run("entitlements description", "/usr/bin/codesign", [
    ...ENTITLEMENT_ARGS,
    path,
  ]);
  return entitlementKeys(`${result.stdout}\n${result.stderr}`);
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
  failures.push(...entitlementFailures(component.profile, entitlementKeys));
  return failures;
}

// LP-6 (2026-11-05): every signed entry of Contents/Resources/bin read back against the table the signer used
// (codesign-entitlements.mjs BIN_PROFILES; packaging/sign-mac.mjs): fieldd, the Node SEA, holds allow-jit and nothing
// else; every other executable, bundle and library holds no entitlement; an executable or bundle the table does not
// name is a failure. fieldd must be present, so the JIT it needs is proven on it rather than assumed. Data files
// (.mjs, .cjs, .wasm) carry no code signature of their own to read and are skipped.
//
// LP-6 review (prod-builder 2026-11-05 03:38Z; VF-PM 04:30Z, SD-2's finding): the same rows carry the RELEASE SIGNATURE
// too — release-signature.mjs's assertReleaseSigned on each (codesign --verify --strict, the frozen team, a Developer
// ID Application leaf, a secure timestamp, the hardened runtime), so field-native, its hosts, the sidecar, the .node
// addons and the screenshot helper no longer rest on notarization alone. Strict only when the app itself carries a
// Developer ID authority (L1's converge rule): an unsigned build's app is ad hoc, and its rows say "not checked".
async function binEntitlementCensus(nativeRoot, requireReleaseSignature) {
  const entries = readBinEntries(nativeRoot);
  const failures = unclassifiedBinEntries(entries).map(
    (name) => `bin/${name}: signed code no entitlement profile names (BIN_PROFILES)`,
  );
  if (!entries.some((entry) => entry.name === "fieldd" && entry.executable)) {
    failures.push("bin/fieldd: absent — its V8 JIT entitlement cannot be proven");
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.bundle && !entry.machO) continue;
    const profile = entitlementProfile([...BIN_ROOT, entry.name].join("/"));
    const keys = await describeEntitlements(join(nativeRoot, entry.name));
    failures.push(
      ...entitlementFailures(profile, keys).map((failure) => `bin/${entry.name}: ${failure}`),
    );
    let releaseSigned = "not checked (the app carries no Developer ID authority)";
    if (requireReleaseSignature) {
      try {
        await assertReleaseSigned(desktopRoot, [join(nativeRoot, entry.name)], `bin/${entry.name}`);
        releaseSigned = true;
      } catch (error) {
        releaseSigned = false;
        failures.push(
          `bin/${entry.name}: not release-signed (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    rows.push({ path: `bin/${entry.name}`, profile, entitlementKeys: keys, releaseSigned });
  }
  return { rows, failures };
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
