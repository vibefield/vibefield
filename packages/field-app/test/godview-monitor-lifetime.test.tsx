// @vitest-environment happy-dom
/**
 * PF6 at the COMPOSITION level (GT-3m).
 *
 * The stage's own fixture proves that unmounting disposes; this proves that
 * CLOSING is what unmounts it. Those are different claims, and only the second
 * one is about the product: the whole PF6 story would be a comment if the
 * overlay kept the stage mounted while hidden the way it deliberately keeps the
 * deck mounted.
 *
 * The deck is stubbed to nothing — it is the neighbour here, not the subject,
 * and its own mount behaviour has a fixture of its own (godview-deck.test.tsx).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/godview/GodviewDeck", () => ({ GodviewDeck: () => null }));

const { GodviewOverlay } = await import("../src/godview/GodviewOverlay");
const { resetGodviewOpenForTest } = await import("../src/godview/overlay-state");

let root: Root | null = null;
let container: HTMLElement | null = null;
let publishOpen: ((state: { open: boolean }) => void) | null = null;
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];

beforeEach(() => {
  openedIntervals = [];
  clearedIntervals = [];
  localStorage.clear();
  resetGodviewOpenForTest();
  setHost({
    platform: "darwin",
    // Present, so the overlay renders its deck branch rather than the
    // no-terminal-bridge face — the monitor must be there either way, but the
    // realistic tree is the one worth asserting on.
    terminal: { connect: () => Promise.resolve({}), onStatus: () => () => undefined },
    godview: {
      set: () => Promise.resolve({ open: false }),
      onState: (handler: (state: { open: boolean }) => void) => {
        publishOpen = handler;
        return () => {
          publishOpen = null;
        };
      },
    },
  } as unknown as FieldHost);

  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args) as unknown as number;
    openedIntervals.push(id);
    return id;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
    if (id !== undefined) clearedIntervals.push(id);
    realClearInterval(id);
  }) as typeof window.clearInterval);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  publishOpen = null;
  vi.restoreAllMocks();
});

function mountOverlay(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<GodviewOverlay />);
  });
  return container;
}

const stage = (host: HTMLElement): Element | null =>
  host.querySelector(".vf-godview-monitor-stage");

describe("the monitor's lifetime inside the overlay (PF6)", () => {
  it("does not exist until the Godview has been opened once", () => {
    const host = mountOverlay();
    // The overlay itself is not in the tree before a first open, so nothing
    // below it can be either — a user who never presses ⌘⎋ runs no monitor.
    expect(host.querySelector(".vf-godview")).toBeNull();
    expect(openedIntervals, "a closed Godview started a timer").toHaveLength(0);
  });

  it("mounts the stage on open and REMOVES it on close, clearing its timers", () => {
    const host = mountOverlay();

    act(() => publishOpen?.({ open: true }));
    expect(stage(host), "the stage never mounted").not.toBeNull();
    expect(host.querySelector(".vf-monitor-mock-chip")?.textContent).toContain("mock");
    const started = [...openedIntervals];
    expect(started.length).toBeGreaterThan(0);

    act(() => publishOpen?.({ open: false }));

    // THE PF6 CLAIM, at the level it actually matters. The overlay stays in the
    // tree — the deck below is expensive to build and instant to reveal, so it
    // is kept and silenced — but the monitor is GONE, not hidden, and every
    // interval it opened went with it.
    expect(host.querySelector(".vf-godview"), "the overlay unmounted too").not.toBeNull();
    expect(stage(host), "the stage survived the close").toBeNull();
    for (const id of started) {
      expect(clearedIntervals, `interval ${id} outlived the close`).toContain(id);
    }
  });

  it("comes back on reopen, from the mock's own first frame", () => {
    // The cost of the strict treatment, stated rather than hidden: a reopened
    // stage restarts the timeline at tick 0. That is acceptable precisely
    // because the source is deterministic — the same seed replays the same
    // opening frame — and it is why the deck, whose layout is NOT reproducible,
    // gets the other treatment.
    const host = mountOverlay();
    act(() => publishOpen?.({ open: true }));
    act(() => publishOpen?.({ open: false }));
    act(() => publishOpen?.({ open: true }));
    expect(stage(host)).not.toBeNull();
    expect(host.querySelector(".vf-monitor-mock-chip")).not.toBeNull();
  });

  it("keeps the chosen view across a close, because the choice lives above the stage", () => {
    const host = mountOverlay();
    act(() => publishOpen?.({ open: true }));
    const switcher = host.querySelector<HTMLSelectElement>(".vf-godview-view-switch");
    expect(switcher?.value).toBe("swarm");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(switcher, "list");
      switcher?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector(".vf-monitor-list")).not.toBeNull();

    act(() => publishOpen?.({ open: false }));
    act(() => publishOpen?.({ open: true }));

    // The reason `useMonitorTuning` lives in the overlay and not in the stage:
    // state inside a component that unmounts on every close is state that
    // resets on every close.
    expect(host.querySelector<HTMLSelectElement>(".vf-godview-view-switch")?.value).toBe("list");
    expect(host.querySelector(".vf-monitor-list")).not.toBeNull();
  });
});
