// @vitest-environment happy-dom
/**
 * THE NARROW TIER, WITNESSED (GT-6 review).
 *
 * The package's portal measures a pane and marks it `data-vf-narrow` under
 * `NARROW_PANE_WIDTH`; the record's rules — the readout hides, the stop verb
 * keeps only its square, the sides tighten — hang off that attribute, and so
 * does the smoke's row 1c, which asserts NO pane took the tier at the smoke's
 * width.
 *
 * That smoke row cannot fail on its own: the only producer of the attribute is
 * the package, so an upstream rename would leave the selector matching nothing
 * and the row green over a claim about nothing. This file is the missing half —
 * VibeField's own witness that the name the smoke selects on is the name the
 * package sets, and that it is set by MEASUREMENT rather than by a fixture
 * writing it by hand (which is what the catalog's narrow specimen used to do).
 *
 * The observer is stubbed because happy-dom lays nothing out: every element
 * measures zero, so a real ResizeObserver here would say "narrow" about every
 * pane in existence and prove nothing. The stub supplies the width; the
 * package's own rule decides what it means.
 */

import { PANE_NARROW_ATTRIBUTE, PaneFrame, type PaneFrameVerbs } from "@vibecook/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The package's own name for the attribute (exported since PU-14b), used
 * everywhere below so an upstream rename moves these rows with it. */
const NARROW_ATTRIBUTE = PANE_NARROW_ATTRIBUTE;
/** And the literal the SMOKE selects on, in `electron-shell`'s harness, which
 * cannot import a browser package to ask. This is the bridge: a rename upstream
 * reds the row below instead of quietly emptying that selector and leaving the
 * smoke green over a claim about nothing. */
const SMOKE_NARROW_SELECTOR = "data-vf-narrow";
/** The record's threshold, restated for the same reason. */
const NARROW_WIDTH = 220;

const VERBS: PaneFrameVerbs = { stop: () => ({ accepted: true }), zoom: () => undefined };

let root: Root | null = null;
let container: HTMLElement | null = null;
let pane: HTMLElement | null = null;
/** The observer callbacks the portal registered, by the element they watch. */
let observers: Array<{ element: Element; fire: (width: number) => void }> = [];

/** The width `getBoundingClientRect` answers with — the portal's mount-time
 * measurement, before any observation has happened. */
let measuredWidth = 0;

class StubResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(element: Element): void {
    observers.push({
      element,
      fire: (width: number) => {
        this.#callback(
          [
            {
              borderBoxSize: [{ inlineSize: width, blockSize: 100 }],
              target: element,
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      },
    });
  }
  unobserve(): void {
    /* the portal disconnects rather than unobserving */
  }
  disconnect(): void {
    observers = observers.filter((entry) => entry.element !== pane);
  }
}

function mountFrame(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  pane = document.createElement("div");
  pane.className = "ghostty-pane is-active";
  pane.dataset["paneId"] = "pane-1";
  container.appendChild(pane);
  // The measurement the portal takes at mount: happy-dom lays nothing out, so
  // the width is supplied here rather than pretended.
  pane.getBoundingClientRect = () =>
    ({ width: measuredWidth, height: 132, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect;
  root = createRoot(container);
  act(() => {
    root?.render(
      <PaneFrame
        pane={pane as HTMLElement}
        session={{ id: "pty-1", exited: false, cwd: "/home/tester/vibe-field" }}
        zoomed={false}
        nowMs={Date.parse("2026-09-13T21:00:00.000Z")}
        verbs={VERBS}
      />,
    );
  });
}

beforeEach(() => {
  observers = [];
  measuredWidth = 640;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  pane = null;
  vi.unstubAllGlobals();
});

describe("the pane frame's narrow tier", () => {
  it("is the attribute the smoke's row selects on", () => {
    expect(PANE_NARROW_ATTRIBUTE).toBe(SMOKE_NARROW_SELECTOR);
  });

  it("marks the pane the package's own way when it is measured under the threshold", () => {
    mountFrame();
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(false);
    expect(observers).toHaveLength(1);

    act(() => observers[0]?.fire(NARROW_WIDTH - 20));
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(true);

    act(() => observers[0]?.fire(NARROW_WIDTH + 1));
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(false);

    // The record's own boundary: AT the threshold the pane is narrow.
    act(() => observers[0]?.fire(NARROW_WIDTH));
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(true);
  });

  it("measures once at mount, because an occluded window delivers no resizes", () => {
    measuredWidth = 180;
    mountFrame();
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(true);
  });

  it("gives the pane back unmarked when the frame goes", () => {
    measuredWidth = 180;
    mountFrame();
    expect(pane?.hasAttribute(NARROW_ATTRIBUTE)).toBe(true);
    const element = pane as HTMLElement;
    act(() => root?.unmount());
    root = null;
    // A deck that stopped framing must not leave the record's narrow rules
    // clamped onto a pane ghosttea still owns.
    expect(element.hasAttribute(NARROW_ATTRIBUTE)).toBe(false);
  });
});
