#!/usr/bin/env node
// FS packaging witness: reuse the real-worker suites with the executable and
// addon from the artifact. The test harness may use development dependencies;
// the worker must load only the files shipped beside the packaged fieldd SEA.
import { execFileSync, spawn } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const args = process.argv.slice(2);
const signed = args.includes("--require-signed");
const positional = args.filter((arg) => arg !== "--require-signed");
if (positional.length !== 2 || positional[0] !== "--native-root") {
  throw new Error(
    "usage: verify-files-package.mjs --native-root <Resources/bin> [--require-signed]",
  );
}
const nativeRoot = realpathSync(resolve(positional[1]));
const triple =
  process.platform === "darwin"
    ? `darwin-${process.arch}`
    : process.platform === "win32"
      ? `win32-${process.arch}-msvc`
      : `linux-${process.arch}-${process.report.getReport().header.glibcVersionRuntime ? "gnu" : "musl"}`;
const executable = join(nativeRoot, process.platform === "win32" ? "fieldd.exe" : "fieldd");
const addon = join(nativeRoot, `mille.${triple}.node`);
for (const file of [executable, addon, join(nativeRoot, "files-host.cjs")]) {
  if (!lstatSync(file).isFile())
    throw new Error(`packaged Files input is not a regular file: ${file}`);
}

if (signed) {
  if (process.platform !== "darwin")
    throw new Error("--require-signed currently verifies macOS only");
  const identity = JSON.parse(
    readFileSync(join(desktopRoot, "packaging/release-identity.json"), "utf8"),
  );
  const team = identity.fields.macTeamId;
  if (team.status !== "frozen" || typeof team.value !== "string") {
    throw new Error("the macOS signing team must be frozen before release verification");
  }
  for (const file of [executable, addon]) {
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", file], { stdio: "pipe" });
    // codesign writes its description to stderr. Check the actual nested code,
    // not merely the enclosing app seal or the builder's requested identity.
    const description = await capture("/usr/bin/codesign", ["--display", "--verbose=4", file]);
    const value = (key) =>
      description
        .split(/\r?\n/u)
        .find((line) => line.startsWith(`${key}=`))
        ?.slice(key.length + 1);
    if (
      value("TeamIdentifier") !== team.value ||
      !value("Authority")?.startsWith("Developer ID Application:") ||
      value("Timestamp") === undefined ||
      !/\bruntime\b/u.test(
        description.split(/\r?\n/u).find((line) => line.startsWith("CodeDirectory ")) ?? "",
      )
    ) {
      throw new Error(
        `packaged Files code lacks the release team, timestamp or hardened runtime: ${file}`,
      );
    }
  }
}

console.log(`Files package under test: ${nativeRoot}`);
await new Promise((resolveRun, reject) => {
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--filter",
      "@vibefield/fieldd",
      "exec",
      "vitest",
      "run",
      "test/workspace-worker.test.ts",
      "test/workspace-doors.test.ts",
      "test/workspace-attach.test.ts",
      "--maxWorkers=2",
      // Cold SEA/signature validation can outlast the source suites' 5 s default.
      // Their explicit 20 s worker-ready deadline remains the tighter check.
      "--testTimeout=30000",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, FIELDD_TEST_FILES_PACKAGE: nativeRoot },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolveRun();
    else reject(new Error(`packaged Files tests failed (${signal ?? code})`));
  });
});
console.log(
  `Files package verified (${signed ? "Developer ID signatures checked" : "runtime only; release signatures not checked"}).`,
);

function capture(command, commandArgs) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveCapture(output);
      else reject(new Error(`${command} failed (${signal ?? code}): ${output}`));
    });
  });
}
