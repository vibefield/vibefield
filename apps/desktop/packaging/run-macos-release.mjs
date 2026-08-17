#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedTeamId = "9F79X9D26S";

if (process.argv.length !== 2) fail("package:mac:release accepts no arguments");
if (process.platform !== "darwin") fail("macOS release packaging must run on darwin");
if (process.arch !== "arm64" && process.arch !== "x64") {
  fail(`unsupported macOS release architecture: ${process.arch}`);
}

const signing = signingPreflight();
const notarization = notarizationPreflight();
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: "macOS-release-preflight",
    architecture: process.arch,
    signing,
    notarization,
  })}\n`,
);

await run("pnpm", ["run", "package:stage"]);
await run(process.execPath, ["../../scripts/stage-package.mjs", "--verify", "--require-complete"]);
await run(process.execPath, [
  "packaging/run-electron-builder.mjs",
  "--mac",
  `--${process.arch}`,
  "--config",
  "packaging/electron-builder.release.yml",
]);

const outputDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
await run(process.execPath, [
  "packaging/verify-live-surface-release.mjs",
  "--app",
  join("release", outputDirectory, "VibeField.app"),
  "--enumerate-only",
]);

function signingPreflight() {
  const linkedCertificate = nonempty("CSC_LINK");
  const linkedPassword = nonempty("CSC_KEY_PASSWORD");
  if (linkedCertificate !== linkedPassword) {
    fail("CSC_LINK and CSC_KEY_PASSWORD must be supplied together");
  }

  let localIdentity = false;
  try {
    const identities = execFileSync(
      "/usr/bin/security",
      ["find-identity", "-v", "-p", "codesigning"],
      { encoding: "utf8" },
    );
    localIdentity = identities
      .split(/\r?\n/u)
      .some(
        (line) =>
          line.includes("Developer ID Application:") && line.includes(`(${expectedTeamId})`),
      );
  } catch {
    // A CSC_LINK certificate is imported by electron-builder after this check.
  }

  if (!localIdentity && !linkedCertificate) {
    fail(`no Developer ID Application identity for team ${expectedTeamId} or CSC_LINK input`);
  }
  return { localTeamIdentity: localIdentity, protectedCertificateInput: linkedCertificate };
}

function notarizationPreflight() {
  const apiValues = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  const appleIdValues = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"];
  const apiPresent = apiValues.filter(nonempty).length;
  const appleIdPresent = appleIdValues.filter(nonempty).length;
  const profilePresent = nonempty("APPLE_KEYCHAIN_PROFILE");

  if (apiPresent > 0 && apiPresent !== apiValues.length) {
    fail("APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER must be supplied together");
  }
  if (appleIdPresent > 0 && appleIdPresent !== appleIdValues.length) {
    fail("APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD must be supplied together");
  }

  const modes = [
    apiPresent === apiValues.length ? "app-store-connect-api-key" : undefined,
    appleIdPresent === appleIdValues.length ? "apple-id" : undefined,
    profilePresent ? "keychain-profile" : undefined,
  ].filter(Boolean);
  if (modes.length !== 1) {
    fail("configure exactly one complete notarization credential mode");
  }
  if (modes[0] === "apple-id") {
    if (!nonempty("APPLE_TEAM_ID")) fail("APPLE_TEAM_ID is required with Apple ID notarization");
    if (process.env.APPLE_TEAM_ID !== expectedTeamId) {
      fail(`APPLE_TEAM_ID must match frozen team ${expectedTeamId}`);
    }
  } else if (nonempty("APPLE_TEAM_ID") && process.env.APPLE_TEAM_ID !== expectedTeamId) {
    fail(`APPLE_TEAM_ID must match frozen team ${expectedTeamId}`);
  }
  return { mode: modes[0] };
}

function nonempty(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

async function run(executable, args) {
  const code = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(executable, args, { cwd: desktopRoot, stdio: "inherit" });
    child.once("error", rejectExit);
    child.once("exit", (exitCode, signal) => {
      if (signal !== null) rejectExit(new Error(`${executable} terminated by ${signal}`));
      else resolveExit(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${executable} failed with status ${code}`);
}

function fail(message) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, gate: "macOS-release-preflight", error: message })}\n`,
  );
  process.exit(1);
}
