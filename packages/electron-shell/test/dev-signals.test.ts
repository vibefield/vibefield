import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installDevSignalQuit } from "../src/main/dev-signals";

describe("development shutdown signals", () => {
  it("routes SIGINT and SIGTERM through one normal Electron quit", () => {
    const source = new EventEmitter();
    const quit = vi.fn();
    installDevSignalQuit(source, quit);

    source.emit("SIGTERM");
    source.emit("SIGINT");

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit listener cleanup", () => {
    const source = new EventEmitter();
    const quit = vi.fn();
    const dispose = installDevSignalQuit(source, quit);

    dispose();
    source.emit("SIGTERM");

    expect(quit).not.toHaveBeenCalled();
  });
});
