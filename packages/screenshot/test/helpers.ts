import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScreenshotToolChild, ScreenshotToolSpawn } from "../src/tool";

// The scripted fake helper: a real child process (process.execPath running a
// fixture .mjs) that speaks — or breaks — the SNAP-D2 line protocol on demand.
// Real pipes, real exit codes, real signals; nothing mocked at the module
// level, so the tool is exercised the way Electron main will drive it.

export interface FakeHelperHarness {
  readonly dir: string;
  readonly script: string;
  /** A spawn that runs the fixture through node with the tool's own args
   * appended, so the tool's `--once` is visible to the script. */
  spawnFor(mode: string, extraEnv?: Record<string, string>): ScreenshotToolSpawn;
  /** Every pid the harness spawned, for the SIGKILL sweep in cleanup. */
  readonly pids: Set<number>;
  cleanup(): void;
}

/** What the fixture does per FAKE_HELPER_MODE. Every `ok` line names a PNG the
 * fixture really wrote, so the tool's unlink ring has something to unlink. */
export const FAKE_HELPER = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const mode = process.env.FAKE_HELPER_MODE ?? "ok";
const dir = process.env.FAKE_HELPER_DIR;
const args = process.argv.slice(2);
const out = (line) => process.stdout.write(line + (process.env.FAKE_HELPER_CRLF ? "\\r\\n" : "\\n"));
const still = () => {
  const path = join(dir, "vibefield-screenshot-" + Date.now() + "-" + process.pid + ".png");
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return path;
};
const okLine = (extra = {}) => JSON.stringify({
  v: 1, status: "ok", path: still(), width: 640, height: 480, scale: 2, displayId: 1,
  bounds: { x: 10, y: 20, width: 320, height: 240 }, ...extra,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.stderr.write("fake helper args=" + JSON.stringify(args) + "\\n");
if (mode.startsWith("service")) {
  if (mode === "service-hang-boot") {
    setInterval(() => {}, 1e6);
  } else if (mode === "service-premature") {
    out(okLine());
    setInterval(() => {}, 1e6);
  } else {
    await sleep(Number(process.env.FAKE_HELPER_BOOT_DELAY ?? 10));
    out(JSON.stringify({ v: 1, status: "idle" }));
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("data", async (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\\n")) >= 0) {
        const command = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (command.v !== 1 || command.action !== "capture") process.exit(8);
        if (mode === "service-die") process.exit(3);
        if (mode === "service-hang-capture") continue;
        out(JSON.stringify({ v: 1, status: "ready", timings: { permissionMs: 1, windowListMs: 2, captureMs: 3, overlayMs: 4, totalMs: 10 } }));
        await sleep(20);
        out(okLine());
        if (mode === "service-duplicate") out(okLine());
        if (mode !== "service-linger") out(JSON.stringify({ v: 1, status: "idle" }));
      }
    });
  }
} else switch (mode) {
  case "ok": out(JSON.stringify({ v: 1, status: "ready" })); await sleep(20); out(okLine()); process.exit(0);
  case "unknown-field": out(JSON.stringify({ v: 1, status: "ready" })); out(okLine({ pinned: false, futureField: { carried: true } })); process.exit(0);
  case "cancel": out(JSON.stringify({ v: 1, status: "ready" })); await sleep(10); out(JSON.stringify({ v: 1, status: "cancel" })); process.exit(0);
  case "error": out(JSON.stringify({ v: 1, status: "error", code: "permission-denied", message: "Screen Recording permission is required" })); process.exit(1);
  case "hang": setInterval(() => {}, 1e6); break;
  case "exit-silent": process.stderr.write("boom: capture chain refused\\n"); await sleep(10); process.exit(3);
  case "garbage": out("wrote /tmp/a.png 10x10"); await sleep(10); out(okLine()); process.exit(0);
  case "bad-shape": out(JSON.stringify({ v: 1, status: "maybe" })); process.exit(0);
  case "oversize": process.stdout.write("x".repeat(70 * 1024)); setInterval(() => {}, 1e6); break;
  case "linger": out(JSON.stringify({ v: 1, status: "ready" })); out(okLine()); setInterval(() => {}, 1e6); break;
  case "ready-twice": out(JSON.stringify({ v: 1, status: "ready" })); out(JSON.stringify({ v: 1, status: "ready" })); out(JSON.stringify({ v: 1, status: "cancel" })); process.exit(0);
  case "stderr-then-cancel": process.stderr.write("monitor 1 DISPLAY1 1920x1080\\nusing wgc\\n"); out(JSON.stringify({ v: 1, status: "ready" })); out(JSON.stringify({ v: 1, status: "cancel" })); process.exit(0);
  default: process.stderr.write("unknown mode " + mode + "\\n"); process.exit(9);
}
`;

export function createFakeHelper(): FakeHelperHarness {
  const dir = mkdtempSync(join(tmpdir(), "vfshot-"));
  const script = join(dir, "fake-helper.mjs");
  writeFileSync(script, FAKE_HELPER);
  const pids = new Set<number>();
  return {
    dir,
    script,
    pids,
    spawnFor(mode, extraEnv = {}) {
      return (_helperPath, args) => {
        const child = spawn(process.execPath, [script, ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, FAKE_HELPER_MODE: mode, FAKE_HELPER_DIR: dir, ...extraEnv },
        });
        if (child.pid !== undefined) pids.add(child.pid);
        return child as unknown as ScreenshotToolChild;
      };
    },
    cleanup() {
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A real executable fixture (a shell script) for the DEFAULT spawn/access
 * path — unix only, where a shebang makes a file spawnable. */
export function writeExecutableHelper(dir: string, body: string): string {
  const path = join(dir, "field-screenshot-helper");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Poll (bounded) until `pid` is gone — signal delivery is asynchronous. */
export async function waitDead(pid: number, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
