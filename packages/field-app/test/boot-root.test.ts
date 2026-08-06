// @vitest-environment happy-dom
/**
 * BootRoot's click-safety contract (field report 2026-07-22: "all the ui at
 * the top edge are not clickable"): the settle transform must be TEMPORARY.
 * A persistent transform creates a stacking context that flattens the app
 * below the z-40 .app-drag strip, so the pill's no-drag hole stops punching
 * through and the top 52px goes dead. After the settle the wrapper must carry
 * no inline transform, and the splash must be unmounted. createElement (not
 * JSX) keeps this a `.ts` file, panels.test's pattern.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootRoot } from "../src/boot/BootRoot";
import type { BootMachine, BootReady, BootView } from "../src/boot/machine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeMachine() {
  let view: BootView = {
    phase: "requesting-bootstrap",
    unavailable: null,
    stage: "waking the daemon",
    progress: null,
    degradedReveal: false,
  };
  const listeners = new Set<() => void>();
  const ready = {
    client: {},
    manager: {},
    mod: {
      FielddProvider: ({ children }: { children?: unknown }) => children,
      FieldView: () => null,
      DocManager: class {},
    },
  } as unknown as BootReady;
  const machine: BootMachine = {
    view: () => view,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get ready() {
      return ready;
    },
    get client() {
      return null;
    },
    // UA-3w: this suite is about the reveal, so the wizard never opens here.
    // The layer swap it drives has its own coverage in onboarding-wizard.test.
    get onboarding() {
      return null;
    },
    start: () => {},
    retry: () => {},
    completeOnboarding: () => {},
  };
  const set = (patch: Partial<BootView>): void => {
    view = { ...view, ...patch };
    for (const fn of [...listeners]) fn();
  };
  return { machine, set };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function workspaceWrapper(): HTMLElement | null {
  return (host as HTMLElement).querySelector("div.absolute.inset-0:not(.vf-splash)");
}

describe("BootRoot reveal (the top-edge click contract)", () => {
  it("mounts the dev tweak toggle on the synchronous first face", () => {
    const { machine } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    const toggle = document.querySelector<HTMLButtonElement>("[data-dev-tweak-toggle]");
    expect(toggle).not.toBeNull();
    expect(host.querySelector(".vf-splash")).not.toBeNull();
    act(() => toggle?.click());
    expect(document.body.textContent).toContain("World grid");
    expect(host.querySelector(".vf-splash")).not.toBeNull();
  });

  it("carries the settle transform only until settled, then goes inert", () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    act(() => set({ phase: "warming" }));
    expect(workspaceWrapper()?.style.transform).toBe("scale(0.99)"); // composing under the splash

    act(() => set({ phase: "interactive" }));
    expect(workspaceWrapper()?.style.transform).toBe("scale(1)"); // the settle plays

    act(() => {
      vi.advanceTimersByTime(700); // past the 600ms settle hold
    });
    // inert: no inline transform → no stacking context → the app stacks at
    // body level again and no-drag holes beat the z-40 drag strip
    expect(workspaceWrapper()?.style.transform).toBe("");
    expect(workspaceWrapper()?.getAttribute("style") ?? "").toBe("");
  });

  it("unmounts the splash after the reveal fade", () => {
    vi.useFakeTimers();
    const { machine, set } = fakeMachine();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(BootRoot, { machine })));

    expect(host.querySelector(".vf-splash")).not.toBeNull();
    act(() => set({ phase: "interactive" }));
    act(() => {
      vi.advanceTimersByTime(500); // past the 400ms fade hold
    });
    expect(host.querySelector(".vf-splash")).toBeNull(); // nothing left to eat clicks
  });
});
