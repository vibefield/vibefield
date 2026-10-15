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

// WP12 L3a: electron-builder NEVER publishes. Given no `--publish`, it publishes implicitly when it sees a git tag
// (`onTag`) or CI (`onTagOrDraft`) — app-builder-lib 26.15.7 `out/publish/PublishManager.js:46-60` — which in the release
// workflow would upload an unsigned feed or fail on a missing token. The workflow uploads the SIGNED feed itself, after
// TD-3's sign step; so every build passes `--publish never`, and any other `--publish` is refused here.
const argv = process.argv.slice(2);
const publishAt = argv.findIndex(
  (arg) => arg === "--publish" || arg === "-p" || arg.startsWith("--publish="),
);
if (publishAt !== -1) {
  const value = argv[publishAt].startsWith("--publish=")
    ? argv[publishAt].slice(10)
    : argv[publishAt + 1];
  if (value !== "never") {
    console.error(
      `electron-builder never publishes here (WP12e uploads the signed feed); refusing --publish ${value}`,
    );
    process.exit(1);
  }
} else {
  argv.push("--publish", "never");
}

const child = spawn("electron-builder", argv, {
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
