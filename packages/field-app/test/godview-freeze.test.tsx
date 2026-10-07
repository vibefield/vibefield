// @vitest-environment happy-dom
/**
 * GT-3f — which gate each surface takes, pinned against a REAL canvas engine
 * (the reactive-chrome grain: no widgets, no deck, no GPU).
 *
 * The distinction is easy to lose and expensive to lose: a stage hold is
 * presentation policy over a world that KEEPS STEPPING, so it is right for the
 * sheets, which recede a canvas that stays visible behind them. A cover — since
 * One Frame FR-1 the one layer every view but the canvas lives in, Godview and
 * History alike — is over the field, so it takes the stricter gate: a freeze
 * parks the loop itself. Before ice 0.3.0 Godview used a hold, and the engine
 * ticked at display rate for pixels nobody could see.
 *
 * DK-15: the cover's freeze is taken by the still under the covers
 * (`field/desk/CoverStill.tsx`), after the still is swapped in — here no desk is
 * mounted, so the mat's ground stands under the cover and the freeze is taken at
 * once; the ruled order with a desk is `cover-still.test.ts`'s.
 */

import { type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import { useStageHold } from "@vibecook/ice/react";
import type { FrameViewState } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoverStill } from "../src/field/desk/CoverStill";
import { resetCoverRecordsForTest } from "../src/field/desk/cover-still";
import { resetActiveViewForTest, useActiveView } from "../src/frame/view-state";
import { type FieldHost, setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The field's wiring, at the grain that matters: which gate, which name —
 * reading the window's view through the same mirror FieldView reads, the cover
 * taken by the still under the covers, the sheet's hold by ChromeLayer's call. */
function Chrome({ ce, sheet }: { ce: CanvasEngine; sheet: boolean }) {
  const view = useActiveView();
  useStageHold(ce, sheet, "settings-panel");
  return createElement(CoverStill, { ce, covered: view !== "canvas", view, dark: false });
}

let publish: ((state: FrameViewState) => void) | null = null;

beforeEach(() => {
  resetActiveViewForTest();
  resetCoverRecordsForTest();
  publish = null;
  setHost({
    view: {
      set: (view: FrameViewState["view"]) => Promise.resolve({ view }),
      onState: (handler: (state: FrameViewState) => void) => {
        publish = handler;
        return () => undefined;
      },
    },
  } as unknown as FieldHost);
});

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

/** `covered` names the view the host publishes: Godview for true, the canvas
 * for false — so each case reads the way it always did. */
function render(covered: boolean | "history", sheet: boolean): void {
  act(() => {
    root?.render(createElement(Chrome, { ce: ce as CanvasEngine, sheet }));
  });
  // After the commit: the mirror subscribes to the host on its first reader.
  act(() => {
    publish?.({ view: covered === "history" ? "history" : covered ? "godview" : "canvas" });
  });
}

function boot(): CanvasEngine {
  ce = createCanvasEngine();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return ce;
}

describe("a cover freezes the engine; sheets only background it", () => {
  it("Godview's cover freezes, and back on the canvas it thaws", () => {
    const engine = boot();
    render(false, false);
    expect(engine.frame.isFrozen()).toBe(false);

    render(true, false);
    expect(engine.frame.isFrozen()).toBe(true);
    expect(engine.frame.holds()).toEqual(["cover"]);
    // The stage is untouched: the deck draws its own pixels, and nothing here
    // asked the compositor for anything.
    expect(engine.stage.isBackgrounded()).toBe(false);

    render(false, false);
    expect(engine.frame.isFrozen()).toBe(false);
  });

  it("History's cover freezes too — the cover, not Godview, is what covers (FR-1)", () => {
    const engine = boot();
    render(false, false);
    render("history", false);
    expect(engine.frame.isFrozen()).toBe(true);
    expect(engine.frame.holds()).toEqual(["cover"]);
    // Godview to History is one cover changing its content: still one freeze.
    render(true, false);
    expect(engine.frame.holds()).toEqual(["cover"]);
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
