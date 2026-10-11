/**
 * THE GODVIEW LAB'S WAIT FOR ITS DECK (MV lab debts) — `waitForLabDeck` over a
 * real `MarkerTail`, fed the console lines a page would print: a wait that
 * fails says the deck's last state and what that state still lacked. A launch
 * was lost on 2026-10-10 to a bare "timed out" with no reason to read. And the
 * heap reading's order and its refusals (`collectedHeap`): collect, then read;
 * nothing, never a throw, when either does not answer. The window, CDP and the
 * page are the lab run's own proof; this holds the wait and the order.
 */
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));
vi.mock("../src/main/windows", () => ({ createMainWindow: vi.fn(), loadRenderer: vi.fn() }));

import type { LabDeckState } from "../src/testing/godview-lab-readiness";
import {
  collectedHeap,
  type LabWindow,
  MarkerTail,
  waitForLabDeck,
} from "../src/testing/godview-lab-window";

const WAITING =
  "timed out after 60000ms waiting for the terminal deck to open a pane with an observed roster and WebGPU";
const healthy = {
  active: true,
  panes: 1,
  sessions: 1,
  poolPhase: "open",
  rosterState: "observed",
  rendererBackend: "webgpu",
};
const opening = { ...healthy, panes: 0, sessions: 0, poolPhase: "opening", rosterState: "unread" };

/** A lab window as far as the wait reads it: a deck tail over a page's console. */
function lab(): { lab: LabWindow; say(facts: Record<string, unknown>): void } {
  const webContents = new EventEmitter();
  const deck = new MarkerTail<LabDeckState>({ webContents } as never, "GODVIEW_DECK ");
  return {
    lab: { deck } as unknown as LabWindow,
    // Electron hands the listener an event whose `message` is the console line
    say: (facts) =>
      void webContents.emit("console-message", {
        message: `GODVIEW_DECK ${JSON.stringify(facts)}`,
      }),
  };
}

/** Run the wait to its end on fake timers; its error's text, or null when it resolved. */
async function waited(wait: Promise<void>): Promise<string | null> {
  const settled = wait.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  await vi.advanceTimersByTimeAsync(61_000);
  return settled;
}

describe("the lab's wait for its deck", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves once the deck says it is ready, however it got there", async () => {
    const { lab: window, say } = lab();
    const wait = waitForLabDeck(window);
    say(opening);
    await vi.advanceTimersByTimeAsync(5_000);
    say({ ...healthy, sessionIds: ["s-1"] });
    expect(await waited(wait)).toBeNull();
  });

  it("times out saying the deck's last state and what that state still lacked", async () => {
    const { lab: window, say } = lab();
    say({ ...healthy, panes: 0, sessions: 0, poolPhase: "warming", rosterState: "unread" });
    say({ sessionIds: [], ...opening });
    expect(await waited(waitForLabDeck(window))).toBe(
      `${WAITING} — the deck last said {"active":true,"panes":0,"sessions":0,"poolPhase":"opening",` +
        '"rosterState":"unread","rendererBackend":"webgpu","sessionIds":[]}; still missing: ' +
        'a pane (panes 0), a session (sessions 0), an open pool (poolPhase "opening"), ' +
        'an observed roster (rosterState "unread")',
    );
  });

  it("times out saying so when no deck marker ever came", async () => {
    const { lab: window } = lab();
    expect(await waited(waitForLabDeck(window))).toBe(
      `${WAITING} — the deck last said no GODVIEW_DECK marker; still missing: a GODVIEW_DECK marker (none was read)`,
    );
  });

  it("fails at once on a deck's own error, with the state that carried it", async () => {
    const { lab: window, say } = lab();
    say({ ...opening, poolPhase: "failed", error: "the terminal cell could not start" });
    const message = await waited(waitForLabDeck(window));
    expect(message).toMatch(/^Terminal deck: the terminal cell could not start — the deck said \{/);
    expect(message).toContain('"poolPhase":"failed"');
    expect(message).toContain('"error":"the terminal cell could not start"');
  });

  it("leaves every other wait's timeout as it was", async () => {
    const { lab: window } = lab();
    const message = await waited(
      window.deck.until(() => false, "a thing that never comes", 1_000).then(() => undefined),
    );
    expect(message).toBe("timed out after 1000ms waiting for a thing that never comes");
  });
});

describe("the lab's heap reading after a forced collection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const after = { usedJSHeapSize: 74_000_000, totalJSHeapSize: 120_000_000 };

  /** A window as far as the reading drives it: its debugger and its page. */
  function window(options: { collect?: () => Promise<unknown>; read?: () => Promise<unknown> }): {
    win: BrowserWindow;
    calls: string[];
  } {
    const calls: string[] = [];
    const win = {
      webContents: {
        debugger: {
          isAttached: () => true,
          attach: vi.fn(),
          sendCommand: (method: string) => {
            calls.push(method);
            return (options.collect ?? (async () => ({})))();
          },
        },
        executeJavaScript: (expression: string) => {
          calls.push(expression.includes("performance.memory") ? "performance.memory" : expression);
          return (options.read ?? (async () => after))();
        },
      },
    } as unknown as BrowserWindow;
    return { win, calls };
  }

  /** Run the reading to its end on fake timers. */
  async function read(win: BrowserWindow): Promise<unknown> {
    const reading = collectedHeap(win);
    await vi.advanceTimersByTimeAsync(21_000);
    return reading;
  }

  it("collects first, then reads the page's heap", async () => {
    const { win, calls } = window({});
    expect(await read(win)).toEqual(after);
    expect(calls).toEqual(["HeapProfiler.collectGarbage", "performance.memory"]);
  });

  it("reads nothing, and never throws, when the collection is refused", async () => {
    const { win, calls } = window({ collect: () => Promise.reject(new Error("no debugger")) });
    expect(await read(win)).toBeNull();
    // the page is not asked: an uncollected reading would pass for a collected one
    expect(calls).toEqual(["HeapProfiler.collectGarbage"]);
  });

  it("reads nothing when the collection never answers within its bound", async () => {
    const { win, calls } = window({ collect: () => new Promise(() => undefined) });
    expect(await read(win)).toBeNull();
    expect(calls).toEqual(["HeapProfiler.collectGarbage"]);
  });

  it("reads nothing when the page does not answer after the collection", async () => {
    const { win } = window({ read: () => Promise.reject(new Error("the window is gone")) });
    expect(await read(win)).toBeNull();
  });
});
