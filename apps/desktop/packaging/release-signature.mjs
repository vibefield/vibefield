// The release signature the packaged verifiers require of nested code under
// --require-signed (macOS): codesign's strict verify of the file itself, then
// the frozen Developer ID team, a secure timestamp and the hardened runtime as
// the code says them — never the enclosing app's seal, never the identity the
// builder was asked for. verify-files-package.mjs and verify-history-package.mjs
// both ask it.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Throws unless every file carries the release signature. `what` names the
 * code in the refusal ("Files", "History"). */
export async function assertReleaseSigned(desktopRoot, files, what) {
  if (process.platform !== "darwin")
    throw new Error("--require-signed currently verifies macOS only");
  const identity = JSON.parse(
    readFileSync(join(desktopRoot, "packaging/release-identity.json"), "utf8"),
  );
  const team = identity.fields.macTeamId;
  if (team.status !== "frozen" || typeof team.value !== "string") {
    throw new Error("the macOS signing team must be frozen before release verification");
  }
  for (const file of files) {
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
        `packaged ${what} code lacks the release team, timestamp or hardened runtime: ${file}`,
      );
    }
  }
}

export function capture(command, commandArgs) {
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
