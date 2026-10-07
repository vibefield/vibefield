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
import { StatusLine, StatusLineView } from "../src/frame/StatusLine";
import {
  getStatusNotice,
  resetStatusLineForTest,
  STATUS_STAND_MS,
  sayStatus,
  statusLineSaid,
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

  it("DK-11: says two plain notices said together one after the other, each for its 2.4s — one at a time, neither lost", () => {
    sayStatus({ id: "missing:a", text: "Clock · plugin off" });
    sayStatus({ id: "missing:b", text: "Dial · plugin gone" });
    sayStatus({ id: "missing:b", text: "Dial · plugin gone" }); // waiting its turn: not said twice
    expect(getStatusNotice()?.text).toBe("Clock · plugin off");
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()?.text).toBe("Dial · plugin gone");
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()).toBeNull();
    // the log says what was said, in order, each once
    expect(statusLineSaid()).toEqual([
      { id: "missing:a", text: "Clock · plugin off" },
      { id: "missing:b", text: "Dial · plugin gone" },
    ]);
  });

  it("DK-11: a waiting notice withdrawn before its turn is never said", () => {
    sayStatus({ id: "a", text: "first" });
    sayStatus({ id: "b", text: "second" });
    withdrawStatus("b");
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()).toBeNull();
    expect(statusLineSaid().map((n) => n.id)).toEqual(["a"]);
  });

  it("DK-17: carries a detail on a row of its own under the words — the degraded desk's ICE message, verbatim", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const detail = "an uncaptured GPU error — GPUValidationError: Buffer usages must not be 0.";
    act(() =>
      root.render(
        <StatusLineView
          notice={{
            id: "desk-degraded",
            text: "The graphics device reported an error. The desk is still drawing — Reload restarts it.",
            detail,
            act: { label: "Reload", run: () => undefined },
          }}
        />,
      ),
    );
    const line = host.querySelector(".vf-status-line");
    expect(line?.hasAttribute("data-detail")).toBe(true);
    // the words, then the act, then the detail — VibeField's sentence first, the renderer's after it
    expect(Array.from(line?.children ?? []).map((el) => el.className)).toEqual([
      "vf-status-line__text",
      "vf-status-line__act",
      "vf-status-line__detail",
    ]);
    expect(line?.querySelector(".vf-status-line__detail")?.textContent).toBe(detail);
    // a notice with no detail draws no detail row
    act(() =>
      root.render(<StatusLineView notice={{ id: "missing", text: "Clock · plugin off" }} />),
    );
    expect(host.querySelector(".vf-status-line")?.hasAttribute("data-detail")).toBe(false);
    expect(host.querySelector(".vf-status-line__detail")).toBeNull();
    act(() => root.unmount());
  });

  it("DK-11: stands under the tools in hand (y 112) while an object is held, under the head otherwise (R12)", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const notice = { id: "n", text: "Clock · plugin off" };
    act(() => root.render(<StatusLineView notice={notice} />));
    expect(host.querySelector(".vf-status-line")?.hasAttribute("data-held")).toBe(false);
    act(() => root.render(<StatusLineView notice={notice} held />));
    expect(host.querySelector(".vf-status-line")?.hasAttribute("data-held")).toBe(true);
    act(() => root.unmount());
  });
});
