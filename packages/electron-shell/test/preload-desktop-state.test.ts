import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PreloadDesktopStateBridge } from "../src/preload/desktop-state";

const available = {
  tray: {
    availability: "available",
    placement: "visible",
    backgroundShellEffective: true,
    issue: null,
  },
} as const;

/** contracts' EL9 fixture for the field service (item 212, RV #29), read as main sends it */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../contracts/fixtures", name), "utf8"));

describe("PreloadDesktopStateBridge", () => {
  it("retains validated latest state until the renderer subscribes", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    bridge.accept(available);
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledWith(available);
    expect(rejected).not.toHaveBeenCalled();
  });

  it("rejects malformed state without replacing the last valid snapshot", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    bridge.accept(available);
    bridge.accept({
      tray: {
        availability: "imaginary",
        placement: "visible",
        backgroundShellEffective: true,
        issue: null,
      },
    });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(rejected).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(available);
  });

  // Item 212 (RV #29) — the field service rides the desktop state typed: a state main has no name for is no state of
  // the field service, and the window keeps the last one it could read.
  it("delivers the field service's state typed, and keeps the last valid snapshot over a malformed one", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    const crashLoop = { ...available, fieldd: fixture("fieldd-link-unavailable.crash-loop.json") };
    bridge.accept(crashLoop);
    bridge.accept({ ...available, fieldd: { service: "fieldd", state: "imaginary" } });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(crashLoop);
  });

  it("delivers a recovering field service, and a shell older than item 212 that names none", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    const handler = vi.fn();
    bridge.subscribe(handler);
    const recovering = { ...available, fieldd: fixture("fieldd-link-unavailable.recovering.json") };
    bridge.accept(recovering);
    bridge.accept(available);
    expect(rejected).not.toHaveBeenCalled();
    expect(handler.mock.calls.map(([state]) => state)).toEqual([recovering, available]);
    expect(handler.mock.calls[1]?.[0]).not.toHaveProperty("fieldd");
  });
});

// Item 315 — the desktop state has two readers in the window: the field's chrome (ChromeLayer) and the switch's layer,
// which reads `quitting` to ignore a press while VibeField quits. So the bridge fans out instead of keeping one handler.
describe("PreloadDesktopStateBridge, many readers (item 315)", () => {
  it("fans out: each subscriber gets the latest state on subscribe and every state after, and one leaving keeps the other", () => {
    const bridge = new PreloadDesktopStateBridge(vi.fn());
    bridge.accept(available);
    const chrome = vi.fn();
    const quit = vi.fn();
    bridge.subscribe(chrome);
    const leave = bridge.subscribe(quit);
    expect(chrome).toHaveBeenCalledWith(available);
    expect(quit).toHaveBeenCalledWith(available);
    const quitting = { ...available, quitting: true };
    bridge.accept(quitting);
    expect(chrome).toHaveBeenLastCalledWith(quitting);
    expect(quit).toHaveBeenLastCalledWith(quitting);
    leave();
    bridge.accept(available);
    expect(chrome).toHaveBeenLastCalledWith(available);
    expect(quit).toHaveBeenLastCalledWith(quitting);
  });

  it("keeps calling the others when one reader throws, and reports the throw", () => {
    const failed = vi.fn();
    const bridge = new PreloadDesktopStateBridge(vi.fn(), failed);
    const broken = new Error("a reader broke");
    const first = vi.fn(() => {
      throw broken;
    });
    const second = vi.fn();
    bridge.subscribe(first);
    bridge.subscribe(second);
    bridge.accept(available);
    expect(first).toHaveBeenCalledWith(available);
    expect(second).toHaveBeenCalledWith(available);
    expect(failed).toHaveBeenCalledWith(broken);
  });

  it("holds one entry for a reader subscribed twice", () => {
    const bridge = new PreloadDesktopStateBridge(vi.fn());
    const reader = vi.fn();
    bridge.subscribe(reader);
    bridge.subscribe(reader);
    bridge.accept(available);
    expect(reader).toHaveBeenCalledTimes(1);
  });
});
