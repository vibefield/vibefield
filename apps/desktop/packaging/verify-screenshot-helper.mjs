#!/usr/bin/env node

// SNAP-0 — the live witness. Runs the BUILT helper's `--capture-test` (no
// overlay: a PNG per display, `ok` names the first) and grades the line it
// prints against the contract by hand: this script cannot import the zod
// schema, so the limits below mirror `SCREENSHOT_LIMITS` deliberately. A line
// the contract would refuse fails here too.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableName = "field-screenshot-helper";
const PROTOCOL_VERSION = 1;
const MAX_DIMENSION = 16_384;
const MAX_SCALE = 8;
const MAX_PATH_CHARS = 4_096;
const MAX_DISPLAY_ID = 0xffff_ffff;
const RUN_TIMEOUT_MS = 30_000;
const PNG_MAGIC = "89504e47";

for (const argument of process.argv.slice(2)) {
  throw new Error(`unknown screenshot helper verification option: ${argument}`);
}

if (process.platform !== "darwin" && process.platform !== "win32") {
  const reason = `no native helper for ${process.platform}`;
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason })}\n`);
  process.exit(0);
}

const helperPath =
  process.platform === "win32"
    ? join(desktopRoot, "build", "native", "windows", `${executableName}.exe`)
    : join(
        desktopRoot,
        "build",
        "native",
        "macos",
        `${executableName}.app`,
        "Contents",
        "MacOS",
        executableName,
      );

let stderrText = "";

function fail(message) {
  throw new Error(message);
}

/** The contract's own test, spelled the same way: by code point, not a regex. */
function hasControlCharacters(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function requirePixelDimension(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_DIMENSION) {
    fail(`${label} is not a pixel dimension the contract admits: ${JSON.stringify(value)}`);
  }
}

function requireBounds(bounds) {
  if (typeof bounds !== "object" || bounds === null || Array.isArray(bounds)) {
    fail(`bounds is not an object: ${JSON.stringify(bounds)}`);
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(bounds[key])) {
      fail(`bounds.${key} is not a finite number: ${JSON.stringify(bounds[key])}`);
    }
  }
  if (bounds.width < 0 || bounds.height < 0) fail("bounds has a negative extent");
}

try {
  if (!existsSync(helperPath)) {
    fail(`screenshot helper is not built at ${helperPath} — run build:screenshot-helper first`);
  }

  const child = spawn(helperPath, ["--capture-test"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdoutText = "";
  let timedOut = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutText += chunk;
  });
  child.stderr.on("data", (chunk) => {
    if (stderrText.length < 4096) stderrText += chunk.slice(0, 4096 - stderrText.length);
  });

  const exit = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, RUN_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
  if (timedOut) fail(`screenshot helper did not answer within ${RUN_TIMEOUT_MS} ms`);

  const line = stdoutText.split(/\r?\n/).find((entry) => entry.trimStart().startsWith("{"));
  if (line === undefined) fail("screenshot helper printed no JSON line on stdout");
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    fail(`screenshot helper printed invalid JSON: ${String(error)}`);
  }

  if (event.v !== PROTOCOL_VERSION) fail(`unexpected protocol version: ${JSON.stringify(event.v)}`);
  if (event.status !== "ok") fail(`helper answered ${JSON.stringify(event.status)}: ${line}`);
  if (typeof event.path !== "string" || event.path.length === 0) fail("helper named no still");
  if (event.path.length > MAX_PATH_CHARS) fail("still path is longer than the contract admits");
  if (hasControlCharacters(event.path)) fail("still path carries control characters");
  requirePixelDimension(event.width, "width");
  requirePixelDimension(event.height, "height");
  if (!Number.isFinite(event.scale) || event.scale <= 0 || event.scale > MAX_SCALE) {
    fail(`scale is not a backing scale the contract admits: ${JSON.stringify(event.scale)}`);
  }
  if (
    !Number.isInteger(event.displayId) ||
    event.displayId < 0 ||
    event.displayId > MAX_DISPLAY_ID
  ) {
    fail(`displayId is not a display identifier: ${JSON.stringify(event.displayId)}`);
  }
  requireBounds(event.bounds);

  if (!existsSync(event.path)) fail(`the still the helper named does not exist: ${event.path}`);
  const bytes = readFileSync(event.path);
  if (bytes.subarray(0, 4).toString("hex") !== PNG_MAGIC) {
    fail(`the still the helper named is not a PNG: ${event.path}`);
  }
  if (exit.code !== 0) fail(`screenshot helper exited ${exit.code ?? exit.signal} after ok`);

  // The capture-test writes one full-screen PNG PER DISPLAY (~10 MB each here)
  // and names only the first; they are a witness, not a deliverable, so this
  // run removes every one it can see beside the named still. Best-effort: a
  // leftover is a nuisance, never a failed verification.
  const stillDir = dirname(event.path);
  const removed = readdirSync(stillDir)
    .filter((name) => /^vibefield-capture-test-\d+\.png$/.test(name))
    .filter((name) => {
      try {
        rmSync(join(stillDir, name), { force: true });
        return true;
      } catch {
        return false;
      }
    });
  if (!removed.includes(basename(event.path))) {
    process.stderr.write(`screenshot helper verification could not remove ${event.path}\n`);
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      path: event.path,
      width: event.width,
      height: event.height,
      scale: event.scale,
      displayId: event.displayId,
      bytes: bytes.length,
      removed: removed.length,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      helperDiagnostic: stderrText.trim() || undefined,
    })}\n`,
  );
  process.exitCode = 1;
}
