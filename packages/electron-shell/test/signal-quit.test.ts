import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installSignalQuit } from "../src/main/signal-quit";

// AL-4, and AU-5a (LC-26's read, 2026-10-29): a signal is never a person's quit, in any build. Electron 43 turns
// SIGTERM, SIGINT and SIGHUP into an ordinary quit, so the handler that marks it the shell's own runs in every mode.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("shutdown signals", () => {
  it("routes SIGINT and SIGTERM through one normal Electron quit", () => {
    const source = new EventEmitter();
    const quit = vi.fn();
    installSignalQuit(source, quit);

    source.emit("SIGTERM");
    source.emit("SIGINT");

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("AU-5a — each of the three signals Electron turns into a quit reaches it on its own, SIGHUP too", () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const source = new EventEmitter();
      const quit = vi.fn();
      installSignalQuit(source, quit);
      source.emit(signal);
      expect(quit, signal).toHaveBeenCalledTimes(1);
    }
  });

  it("returns an explicit listener cleanup", () => {
    const source = new EventEmitter();
    const quit = vi.fn();
    const dispose = installSignalQuit(source, quit);

    dispose();
    source.emit("SIGTERM");
    source.emit("SIGHUP");

    expect(quit).not.toHaveBeenCalled();
  });

  // index.ts runs Electron as it loads, so its wiring is read as source (studio-composition-boundary's way): the handler
  // is installed beside the lifecycle with no mode check between them, and it leaves the pairs BEFORE it quits.
  it("AU-5a — the entry installs it in every mode, production too, and the quit it asks leaves the pairs", () => {
    const entry = readFileSync(join(PACKAGE_ROOT, "src", "main", "index.ts"), "utf8");
    const lifecycle = entry.indexOf("lifecycleFlow = flow;");
    const install = entry.indexOf("installSignalQuit(process,");
    expect(lifecycle).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(lifecycle);
    expect(entry.slice(lifecycle, install)).not.toMatch(/\bif\s*\(|MODE/u);
    const handler = entry.slice(install, entry.indexOf("});", install));
    const leave = handler.indexOf('flow.leavePairsOnQuit("signal");');
    expect(leave).toBeGreaterThan(-1);
    expect(handler.indexOf("app.quit();")).toBeGreaterThan(leave);
  });
});
