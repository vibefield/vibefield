#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const env = { ...process.env };
if (process.platform === "darwin") {
  env.DEVELOPER_DIR = await resolveFullXcodeDeveloperDir();
}

const child = spawn("electron-builder", process.argv.slice(2), {
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(`could not launch electron-builder: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal !== null) {
    console.error(`electron-builder terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

async function resolveFullXcodeDeveloperDir() {
  const explicit = process.env["DEVELOPER_DIR"];
  if (explicit !== undefined && explicit.length > 0) {
    if (await isFullXcodeDeveloperDir(explicit)) return explicit;
    throw new Error(`DEVELOPER_DIR does not identify Xcode 26 with Icon Composer: ${explicit}`);
  }

  const candidates = [];
  try {
    const { stdout } = await execFileAsync("xcode-select", ["-p"]);
    const selected = stdout.trim();
    if (selected.length > 0) candidates.push(selected);
  } catch {
    // The standard Xcode location below remains a valid fallback.
  }
  candidates.push("/Applications/Xcode.app/Contents/Developer");

  for (const candidate of new Set(candidates)) {
    if (await isFullXcodeDeveloperDir(candidate)) return candidate;
  }
  throw new Error(
    "macOS packaging requires full Xcode 26 with Icon Composer; install Xcode or set DEVELOPER_DIR to its Contents/Developer directory",
  );
}

async function isFullXcodeDeveloperDir(developerDir) {
  const required = [
    join(developerDir, "usr", "bin", "actool"),
    join(
      developerDir,
      "..",
      "Applications",
      "Icon Composer.app",
      "Contents",
      "Executables",
      "ictool",
    ),
  ];
  try {
    await Promise.all(required.map((path) => access(path, fsConstants.X_OK)));
    return true;
  } catch {
    return false;
  }
}
