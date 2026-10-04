// @vitest-environment happy-dom
/**
 * History's room chunk — the loader, the boundary and the prefetch
 * (`history/room-chunk.tsx`, 2026-10-04; DESIGN.md §8 "History"). The rows:
 * one import shared by every caller, a refusal never kept; the prefetch waits
 * for the window's next idle moment (GT-D14's ceiling) and an environment with
 * no idle moment gets none; a room that cannot open says so in the view's
 * place, in what failed's own words, and Retry opens it; ChromeLayer schedules
 * the prefetch once the chrome has mounted. (The shipping path's first ⌘3:
 * `history-chunk.test.tsx`.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyFixturePorts } from "../src/design-system/history-fixtures";
import { HistoryRoomMount, historyRoomLoader } from "../src/history/room-chunk";
import { type RendererLogger, setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RoomModule = typeof import("../src/history/HistoryRoomView");

/** A stand-in module for the rows that never draw the room. */
const STAND_IN = { HistoryRoomView: () => null } as unknown as RoomModule;

let root: Root | null = null;
let host: HTMLElement | null = null;
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  const logger = {
    child: () => logger,
    info: () => undefined,
    error: (event: string) => {
      logged.push(event);
    },
  } as unknown as RendererLogger;
  setRendererLogger(logger);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function until<T>(read: () => T | null | undefined, label: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** The window's idle callbacks, held for the row to run. */
function idleWindow() {
  const tasks: Array<{ task: () => void; options: { timeout: number } | undefined }> = [];
  const cancelled: number[] = [];
  vi.stubGlobal("requestIdleCallback", (task: () => void, options?: { timeout: number }) => {
    tasks.push({ task, options });
    return 40 + tasks.length;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => {
    cancelled.push(handle);
  });
  return { tasks, cancelled };
}

describe("History's room chunk — the loader and the prefetch", () => {
  it("shares one import among every caller, and never keeps a refusal: the next load asks again", async () => {
    let calls = 0;
    const loader = historyRoomLoader(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch dynamically imported module");
      return STAND_IN;
    });
    await expect(loader.load()).rejects.toThrow("Failed to fetch dynamically imported module");
    const [first, second] = await Promise.all([loader.load(), loader.load()]);
    expect(first).toBe(STAND_IN);
    expect(second).toBe(STAND_IN);
    expect(calls).toBe(2);
    await loader.load();
    expect(calls).toBe(2);
  });

  it("fetches the room at the window's next idle moment — never before — and the first open shares that import", async () => {
    const idle = idleWindow();
    const importRoom = vi.fn(async () => STAND_IN);
    const loader = historyRoomLoader(importRoom);
    loader.prefetchWhenIdle();
    expect(idle.tasks).toHaveLength(1);
    expect(idle.tasks[0]?.options).toEqual({ timeout: 2_000 });
    await Promise.resolve();
    expect(importRoom).not.toHaveBeenCalled();
    idle.tasks[0]?.task();
    expect(importRoom).toHaveBeenCalledTimes(1);
    expect(await loader.load()).toBe(STAND_IN);
    expect(importRoom).toHaveBeenCalledTimes(1);
  });

  it("prefetches nothing where no idle moment can be observed — no timer stands in for one", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const importRoom = vi.fn(async () => STAND_IN);
    const cancel = historyRoomLoader(importRoom).prefetchWhenIdle();
    vi.advanceTimersByTime(60_000);
    expect(importRoom).not.toHaveBeenCalled();
    expect(() => cancel()).not.toThrow();
  });

  it("withdraws the idle callback when the prefetch is cancelled", () => {
    const idle = idleWindow();
    const cancel = historyRoomLoader(async () => STAND_IN).prefetchWhenIdle();
    cancel();
    expect(idle.cancelled).toEqual([41]);
  });

  it("is scheduled by ChromeLayer once the chrome has mounted, and cancelled with it", () => {
    const chrome = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "field", "ChromeLayer.tsx"),
      "utf8",
    );
    expect(chrome).toContain("useEffect(() => prefetchHistoryRoomWhenIdle(), []);");
  });
});

describe("History's room chunk — a room that cannot open", () => {
  it("says so in the view's place, in what failed's own words, and Retry opens the room", async () => {
    const refusal =
      "Failed to fetch dynamically imported module: vibefield-app://shell/assets/HistoryRoomView-B3aXq9Lk.js";
    let calls = 0;
    const loader = historyRoomLoader(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError(refusal);
      return import("../src/history/HistoryRoomView");
    });
    // React reports an error its boundary caught; the row holds that report
    // rather than printing a refusal's stack into the gate's log.
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ports = historyFixturePorts("room");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<HistoryRoomMount loader={loader} ports={ports} storage={null} />));

    const failed = await until(
      () => host?.querySelector<HTMLElement>('.vf-history[data-face="failed"]'),
      "the could-not-open face",
    );
    expect(failed.style.getPropertyValue("--vf-history-reserve")).toBe("88px");
    const words = failed.querySelector<HTMLElement>(".vf-history-room > .vf-history-face");
    expect(words?.getAttribute("role")).toBe("alert");
    expect(words?.hasAttribute("data-late")).toBe(false);
    expect(words?.querySelector(".vf-ui-empty-state__title")?.textContent).toBe(
      "History could not open",
    );
    expect(words?.querySelector(".vf-ui-empty-state__description")?.textContent).toBe(refusal);
    expect(host?.querySelector(".ah-frame")).toBeNull();
    expect(logged).toContain("renderer.history.room_failed");
    expect(
      reported.mock.calls.some((call) => call.some((arg) => String(arg).includes(refusal))),
    ).toBe(true);
    reported.mockRestore();

    const retry = words?.querySelector<HTMLButtonElement>("button");
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    const frame = await until(
      () => host?.querySelector<HTMLElement>(".vf-history .ah-frame"),
      "the room after Retry",
      30_000,
    );
    expect(frame.getAttribute("data-ah-surface")).toBe("host");
    expect(host?.querySelector("[data-face]")).toBeNull();
    expect(calls).toBe(2);
  }, 60_000);
});
