// @vitest-environment happy-dom
/**
 * GT-3f — which gate each surface takes, pinned against a REAL canvas engine
 * (the reactive-chrome grain: no widgets, no deck, no GPU).
 *
 * The distinction is easy to lose and expensive to lose: a stage hold is
 * presentation policy over a world that KEEPS STEPPING, so it is right for the
 * sheets, which recede a canvas that stays visible behind them. Godview covers
 * the window outright, so it takes the stricter gate — a freeze parks the loop
 * itself. Before ice 0.3.0 Godview used a hold, and the engine ticked at
 * display rate for pixels nobody could see.
 */
import { type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import { useFrameFreeze, useStageHold } from "@vibecook/ice/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The ChromeLayer wiring, at the grain that matters: which gate, which name. */
function Chrome({ ce, godview, sheet }: { ce: CanvasEngine; godview: boolean; sheet: boolean }) {
  useFrameFreeze(ce, godview, "godview");
  useStageHold(ce, sheet, "settings-panel");
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let ce: CanvasEngine | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  ce?.dispose();
  root = null;
  host = null;
  ce = null;
});

function render(godview: boolean, sheet: boolean): void {
  act(() => {
    root?.render(createElement(Chrome, { ce: ce as CanvasEngine, godview, sheet }));
  });
}

function boot(): CanvasEngine {
  ce = createCanvasEngine();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return ce;
}

describe("Godview freezes the engine; sheets only background it", () => {
  it("an open Godview freezes, and closing it thaws", () => {
    const engine = boot();
    render(false, false);
    expect(engine.frame.isFrozen()).toBe(false);

    render(true, false);
    expect(engine.frame.isFrozen()).toBe(true);
    expect(engine.frame.holds()).toEqual(["godview"]);
    // The stage is untouched: the deck draws its own pixels, and nothing here
    // asked the compositor for anything.
    expect(engine.stage.isBackgrounded()).toBe(false);

    render(false, false);
    expect(engine.frame.isFrozen()).toBe(false);
  });

  it("a sheet takes a stage hold and leaves the loop running", () => {
    const engine = boot();
    render(false, true);
    expect(engine.stage.isBackgrounded()).toBe(true);
    expect(engine.stage.holds()).toEqual(["settings-panel"]);
    // The world must stay live behind a partial overlay — undo and collab
    // land visibly there. That is the whole reason the sheets did NOT move to
    // a freeze.
    expect(engine.frame.isFrozen()).toBe(false);
  });

  it("unmounting mid-Godview thaws — a crashed overlay cannot wedge the engine", () => {
    const engine = boot();
    render(true, false);
    expect(engine.frame.isFrozen()).toBe(true);

    act(() => root?.unmount());
    root = null;
    expect(engine.frame.isFrozen()).toBe(false);
  });

  it("the two gates coexist: a sheet open under Godview holds and freezes independently", () => {
    const engine = boot();
    render(true, true);
    expect(engine.frame.isFrozen()).toBe(true);
    expect(engine.stage.isBackgrounded()).toBe(true);

    render(true, false); // sheet closes, Godview stays up
    expect(engine.frame.isFrozen()).toBe(true);
    expect(engine.stage.isBackgrounded()).toBe(false);
  });
});
