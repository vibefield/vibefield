/**
 * DK-3 — the status line, minimal (DESIGN.md §8 "The status line", §10; R12, R16, R18): the frame's
 * one line for the desk's notices under the head. One notice at a time, each said ONCE — an id
 * already standing is not said again, never per frame; a plain notice stands 2.4s and goes; one
 * with an act (the degraded desk's Reload) HOLDS until it is withdrawn, and a passing notice is
 * the latest word over it. The view carries the act as a text button at the notice's end.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusLine } from "../src/frame/StatusLine";
import {
  getStatusNotice,
  resetStatusLineForTest,
  STATUS_STAND_MS,
  sayStatus,
  withdrawStatus,
} from "../src/frame/status-line";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusLineForTest();
});

afterEach(() => {
  resetStatusLineForTest();
  vi.useRealTimers();
});

describe("the status line", () => {
  it("says a plain notice once, for 2.4s, then it goes", () => {
    sayStatus({ id: "remount", text: "Note · remount to draw it" });
    expect(getStatusNotice()?.text).toBe("Note · remount to draw it");
    vi.advanceTimersByTime(STATUS_STAND_MS - 1);
    sayStatus({ id: "remount", text: "Note · remount to draw it" }); // said again: nothing
    vi.advanceTimersByTime(1);
    expect(getStatusNotice()).toBeNull();
    expect(STATUS_STAND_MS).toBe(2400);
  });

  it("holds a notice with an act until it is withdrawn; a passing notice stands over it", () => {
    const run = vi.fn();
    sayStatus({
      id: "desk-degraded",
      text: "an uncaptured GPU error",
      act: { label: "Reload", run },
    });
    vi.advanceTimersByTime(STATUS_STAND_MS * 3);
    expect(getStatusNotice()?.id).toBe("desk-degraded"); // held
    sayStatus({ id: "capture", text: "The desk lost its graphics device" });
    expect(getStatusNotice()?.id).toBe("capture");
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()?.id).toBe("desk-degraded"); // back to the held one
    withdrawStatus("desk-degraded");
    expect(getStatusNotice()).toBeNull();
  });

  it("draws the notice under the head with its act at the end", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<StatusLine />));
    expect(host.querySelector(".vf-status-line")).toBeNull();
    const run = vi.fn();
    act(() =>
      sayStatus({ id: "desk-degraded", text: "a GPU error", act: { label: "Reload", run } }),
    );
    const line = host.querySelector(".vf-status-line");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.querySelector(".vf-status-line__text")?.textContent).toBe("a GPU error");
    const reload = line?.querySelector("button");
    if (reload == null) throw new Error("no act on the line");
    act(() => reload.click());
    expect(run).toHaveBeenCalledTimes(1);
    act(() => withdrawStatus("desk-degraded"));
    expect(host.querySelector(".vf-status-line")).toBeNull();
    act(() => root.unmount());
  });
});
