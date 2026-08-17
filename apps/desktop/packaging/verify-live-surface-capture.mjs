#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "darwin only" })}\n`);
  process.exit(0);
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const nativeRoot = options.nativeRoot ?? join(desktopRoot, "build", "native", "macos");
const helperPath = join(nativeRoot, "live-surface-capture-helper");
const adapterPath = join(nativeRoot, "live-surface-adapter.node");
const token = randomBytes(32).toString("hex");
const serviceName = `com.jamesyong.vibefield.capture.${process.pid}.${randomBytes(16).toString("hex")}`;
const sessionKey = randomBytes(16).toString("hex");
const { match, matchApp, matchTitle } = options;
const pending = new Map();
let requestSequence = 0;
let stdoutBuffer = "";
let stderr = "";
let finished = false;
let adapterStarted = false;
let terminalError;
let child;
let adapter;

function parseArguments(args) {
  const parsed = {
    enumerateOnly: false,
    match: undefined,
    matchApp: undefined,
    matchTitle: undefined,
    nativeRoot: undefined,
  };
  const valueOptions = new Map([
    ["--match", "match"],
    ["--match-app", "matchApp"],
    ["--match-title", "matchTitle"],
    ["--native-root", "nativeRoot"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--enumerate-only") {
      if (parsed.enumerateOnly) throw new Error("duplicate --enumerate-only option");
      parsed.enumerateOnly = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (key === undefined) throw new Error(`unknown capture verification option: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (parsed[key] !== undefined) throw new Error(`duplicate ${argument} option`);
    parsed[key] = value;
    index += 1;
  }

  if (
    parsed.match !== undefined &&
    (parsed.matchApp !== undefined || parsed.matchTitle !== undefined)
  ) {
    throw new Error("--match cannot be combined with --match-app or --match-title");
  }
  if (
    parsed.enumerateOnly &&
    (parsed.match !== undefined || parsed.matchApp !== undefined || parsed.matchTitle !== undefined)
  ) {
    throw new Error("capture match options cannot be combined with --enumerate-only");
  }
  if (parsed.nativeRoot !== undefined) parsed.nativeRoot = resolve(parsed.nativeRoot);
  return parsed;
}

function fail(message) {
  throw new Error(message);
}

function write(command) {
  if (child === undefined) throw new Error("capture helper is not running");
  child.stdin.write(`${JSON.stringify({ v: 1, token, ...command })}\n`);
}

function abort(error) {
  if (terminalError !== undefined) return;
  terminalError = error instanceof Error ? error : new Error(String(error));
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.rejectRequest(terminalError);
  }
  pending.clear();
}

function request(type, expectedEvent, fields = {}) {
  if (terminalError !== undefined) return Promise.reject(terminalError);
  requestSequence += 1;
  const requestId = `request_${requestSequence}`;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      rejectRequest(new Error(`${type} timed out`));
    }, 10_000);
    pending.set(requestId, { expectedEvent, resolveRequest, rejectRequest, timer });
    write({ type, requestId, ...fields });
  });
}

function onMessage(message) {
  if (message.event === "helper-fault" || message.event === "session-fault") {
    abort(new Error(message.error?.message ?? "capture helper faulted"));
    return;
  }
  const waiter = pending.get(message.requestId);
  if (waiter === undefined) {
    abort(new Error("capture helper replied to an unknown request"));
    return;
  }
  pending.delete(message.requestId);
  clearTimeout(waiter.timer);
  if (message.event === "error") {
    waiter.rejectRequest(new Error(`${message.error?.code ?? "error"}: ${message.error?.message}`));
  } else if (message.event !== waiter.expectedEvent) {
    waiter.rejectRequest(new Error(`expected ${waiter.expectedEvent}, received ${message.event}`));
  } else {
    waiter.resolveRequest(message);
  }
}

async function waitForFrame(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (terminalError !== undefined) throw terminalError;
    const frames = adapter.drain(32);
    if (frames.length > 0) return frames[0];
    await new Promise((resolveWait) => setTimeout(resolveWait, 8));
  }
  throw new Error("capture helper produced no complete IOSurface frame");
}

async function cleanup() {
  if (finished) return;
  finished = true;
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.rejectRequest(new Error("capture verification ended"));
  }
  pending.clear();
  if (child !== undefined) {
    try {
      write({ type: "shutdown" });
      child.stdin.end();
    } catch {
      // Child pipe already closed.
    }
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else {
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolveExit();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveExit();
        });
      }
    });
  }
  if (adapterStarted) adapter.stop();
}

try {
  adapter = createRequire(import.meta.url)(adapterPath);
  adapter.start(serviceName, token);
  adapterStarted = true;
  child = spawn(helperPath, ["--mach-service", serviceName], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!Number.isInteger(child.pid)) fail("capture helper did not receive a PID");
  adapter.setExpectedPeerPid(child.pid);
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4096) stderr += String(chunk).slice(0, 4096 - stderr.length);
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          abort(new Error(`capture helper emitted invalid JSON: ${String(error)}`));
        }
      }
    }
  });
  child.once("error", (error) => {
    abort(error);
  });
  child.once("exit", (code, signal) => {
    if (finished) return;
    abort(new Error(`capture helper exited before verification (${code ?? signal})`));
  });

  const ready = await request("hello", "ready", { expectedParentPid: process.pid });
  if (ready.pid !== child.pid || ready.protocolVersion !== 1)
    fail("capture helper identity mismatch");
  const listed = await request("enumerate", "sources", { allSpaces: true });
  if (!Array.isArray(listed.sources)) fail("capture helper returned invalid sources");
  if (options.enumerateOnly) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, handshake: true, sourceCount: listed.sources.length })}\n`,
    );
  } else {
    const source =
      (typeof matchApp === "string" && matchApp.length > 0) ||
      (typeof matchTitle === "string" && matchTitle.length > 0)
        ? listed.sources.find(
            (candidate) =>
              (typeof matchApp !== "string" ||
                candidate.applicationName
                  .toLocaleLowerCase()
                  .includes(matchApp.toLocaleLowerCase())) &&
              (typeof matchTitle !== "string" ||
                candidate.title.toLocaleLowerCase().includes(matchTitle.toLocaleLowerCase())),
          )
        : typeof match === "string" && match.length > 0
          ? listed.sources.find((candidate) =>
              `${candidate.applicationName}\n${candidate.title}`
                .toLocaleLowerCase()
                .includes(match.toLocaleLowerCase()),
            )
          : listed.sources.find(
              (candidate) =>
                candidate.onScreen === true &&
                candidate.applicationName !== "Dock" &&
                candidate.applicationName !== "Wallpaper",
            );
    if (source === undefined) fail("no capturable application window is available");
    await request("start", "started", {
      sessionKey,
      producerEpoch: 1,
      sourceRef: source.sourceRef,
      crop: { mode: "none" },
      captureCursor: false,
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 5,
        targetRasterSize: { width: 320, height: 180 },
      },
    });
    const frame = await waitForFrame();
    const localReleased = adapter.release(frame.frameId);
    write({
      type: "release",
      sessionKey,
      producerEpoch: 1,
      sequence: frame.sequence,
      slot: frame.slot,
      disposition: "released",
    });
    await request("stop", "stopped", { sessionKey, producerEpoch: 1 });
    const nativeStats = adapter.stats();
    const ok =
      frame.sessionKey === sessionKey &&
      frame.producerEpoch === 1 &&
      frame.width > 0 &&
      frame.height > 0 &&
      Buffer.isBuffer(frame.ioSurface) &&
      frame.ioSurface.byteLength === 8 &&
      localReleased === true &&
      nativeStats.accepted >= 1 &&
      nativeStats.outstanding === 0 &&
      nativeStats.rejectedIdentity === 0 &&
      nativeStats.rejectedCapability === 0 &&
      nativeStats.rejectedProtocol === 0;
    process.stdout.write(
      `${JSON.stringify({
        ok,
        handshake: true,
        sourceCount: listed.sources.length,
        captured: {
          applicationName: source.applicationName,
          width: frame.width,
          height: frame.height,
          logicalWidth: frame.logicalWidth,
          logicalHeight: frame.logicalHeight,
        },
        native: nativeStats,
      })}\n`,
    );
    if (!ok) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      helperDiagnostic: stderr.trim() || undefined,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
