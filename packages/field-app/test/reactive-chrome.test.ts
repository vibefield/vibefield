// @vitest-environment happy-dom
/**
 * The reactive-chrome contract (3b amendment): chrome reads are EVENT-DRIVEN
 * engine subscriptions — strata's observeResource fires at notify(), which
 * ICE's engine.step() calls once per frame. The proof that matters: a world
 * write WITHOUT a notify renders nothing (no timer is watching), and the
 * notify delivers it. Runs against a REAL canvas engine, no widgets needed.
 */
import { ActiveTool, type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useReactiveResource } from "../src/hud/use-reactive";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toolId = (t: { id: string | null } | undefined): string => t?.id ?? "select";

function Probe({ ce }: { ce: CanvasEngine }) {
  return createElement("div", { "data-tool": useReactiveResource(ce, ActiveTool, toolId) });
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

describe("useReactiveResource", () => {
  it("renders on notify — and ONLY on notify (no timer is watching)", () => {
    ce = createCanvasEngine({ widgets: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const engine = ce;
    act(() => root?.render(createElement(Probe, { ce: engine })));
    const probe = () => (host as HTMLElement).querySelector("div")?.getAttribute("data-tool");
    expect(probe()).toBe("select");

    // a write + notify (what engine.step does every frame) delivers
    act(() => {
      engine.ops.setTool("pan");
      engine.world.reactive.notify();
    });
    expect(probe()).toBe("pan");

    // a write WITHOUT notify renders NOTHING — the read is subscription-driven
    act(() => {
      engine.ops.setTool("connect");
    });
    expect(probe()).toBe("pan");

    act(() => {
      engine.world.reactive.notify();
    });
    expect(probe()).toBe("connect");
  });

  it("an unrelated notify does not re-render (the primitive snapshot gates)", () => {
    ce = createCanvasEngine({ widgets: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const engine = ce;
    let renders = 0;
    function Counting({ ce: e }: { ce: CanvasEngine }) {
      renders += 1;
      return createElement("div", { "data-tool": useReactiveResource(e, ActiveTool, toolId) });
    }
    act(() => root?.render(createElement(Counting, { ce: engine })));
    const after = renders;
    act(() => {
      engine.world.reactive.notify(); // nothing changed
      engine.world.reactive.notify();
    });
    expect(renders).toBe(after); // observers are stamp-gated; no idle churn
  });
});
