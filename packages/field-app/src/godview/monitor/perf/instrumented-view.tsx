import type { AgentMonitorProps } from "@vibecook/puppeteer-views";
import { type ComponentType, createElement, type ReactElement, useLayoutEffect } from "react";
import type { AgentMonitorView } from "../types";
import { activeProbe } from "./godview-perf-probe";

// THE COUNTING WRAPPER (MV-0, step 6). React's production build never calls
// `Profiler.onRender`, so renders and commits of the mounted view are counted by
// a component the stage mounts AROUND the view — only while the probe is on.
// With no probe this returns the view's own component: the tree the product
// renders is the tree it rendered before (`godview-instrumented-view.test.tsx`
// holds that by identity).
//
// Why the wrapper's count IS the view's: the views have no memo
// (`design-mv.md` §2), so the view renders exactly when its parent renders it,
// which is exactly when this wrapper renders. The layout effect without deps
// runs once per commit of this component — one per render that reached the DOM.

const wrappers = new WeakMap<ComponentType<AgentMonitorProps>, ComponentType<AgentMonitorProps>>();

export function instrumentedMonitorView(
  view: Pick<AgentMonitorView, "id" | "Component">,
): ComponentType<AgentMonitorProps> {
  if (activeProbe() === null) return view.Component;
  const held = wrappers.get(view.Component);
  if (held !== undefined) return held;
  const Component = view.Component;
  const id = view.id;
  function CountedMonitorView(props: AgentMonitorProps): ReactElement {
    const renderedAt = performance.now();
    activeProbe()?.viewRender(id, renderedAt);
    useLayoutEffect(() => {
      activeProbe()?.viewCommit(id, performance.now());
    });
    return createElement(Component, props);
  }
  CountedMonitorView.displayName = `Counted(${id})`;
  wrappers.set(Component, CountedMonitorView);
  return CountedMonitorView;
}
