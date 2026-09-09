import type { ScreenshotCaptureResult } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { createScreenshotDoor } from "../src/main/screenshot-door";

// SNAP-D3 — the door's three promises: a registered sender only, a request the
// contract admits, and an answer validated before it crosses to the page.

const OK: ScreenshotCaptureResult = {
  status: "ok",
  path: "/tmp/vibefield-screenshot-1.png",
  width: 640,
  height: 480,
  scale: 2,
  displayId: 1,
  bounds: { x: 0, y: 0, width: 320, height: 240 },
};
const registered = { id: 7 };
const stranger = { id: 99 };

describe("createScreenshotDoor", () => {
  it("refuses an unregistered sender before touching the tool", async () => {
    const capture = vi.fn(async () => OK);
    const onRefused = vi.fn();
    const door = createScreenshotDoor({ owns: (s) => s.id === 7, capture, onRefused });
    await expect(door(stranger, {})).rejects.toThrow(/unregistered sender/);
    expect(capture).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledWith(stranger);
  });

  it("checks the request at the seam and tolerates a future field", async () => {
    const capture = vi.fn(async () => OK);
    const door = createScreenshotDoor({ owns: () => true, capture });
    await expect(door(registered, 42)).rejects.toThrow();
    await expect(door(registered, null)).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
    await expect(door(registered, { mode: "later" })).resolves.toMatchObject({ status: "ok" });
  });

  it("passes every contract answer through and reports it", async () => {
    const onFinished = vi.fn();
    const answers: ScreenshotCaptureResult[] = [
      OK,
      { status: "cancel" },
      { status: "error", code: "helper-missing", message: "no helper" },
    ];
    for (const answer of answers) {
      const door = createScreenshotDoor({
        owns: () => true,
        capture: async () => answer,
        onFinished,
      });
      await expect(door(registered, {})).resolves.toEqual(answer);
    }
    expect(onFinished).toHaveBeenCalledTimes(3);
    expect(onFinished).toHaveBeenLastCalledWith(answers[2], registered);
  });

  it("never lets a shape the contract refuses reach the page", async () => {
    const onFinished = vi.fn();
    const door = createScreenshotDoor({
      owns: () => true,
      capture: async () => ({ status: "ok", path: "" }) as unknown as ScreenshotCaptureResult,
      onFinished,
    });
    await expect(door(registered, {})).rejects.toThrow();
    expect(onFinished).not.toHaveBeenCalled();
  });
});
