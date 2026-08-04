// @vitest-environment happy-dom
/**
 * The monitor stage, MOUNTED (GT-3m).
 *
 * The deck fixture beside this one stubs the bridge, the floor and the GPU
 * because the deck cannot have them here. This one stubs almost nothing, and
 * that is the point of GT-D13: a view is a pure function of its props and the
 * source behind the seam is already a mock, so the real registry, the real
 * projection, the real classifier and the real matter engine all run.
 *
 * What it holds:
 *   1. the stage mounts on the registry's default view with rows on it
 *   2. THE LABEL — the law of this slice, asserted in the DOM and in the marker
 *   3. PF6 — closing disposes: every interval cleared, every engine cleared
 *   4. the mock actions acknowledge visibly and mount nothing
 */

import Matter from "matter-js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor, MOCK_LABEL } from "../src/godview/GodviewMonitor";
import { monitorParameterDefaults } from "../src/godview/monitor/parameters";
import { DEFAULT_MONITOR_VIEW_ID, monitorViewFor } from "../src/godview/monitor/registry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** DESIGN.md §2.6 and §2.5, stamped onto the document — because the palette is
 * supposed to READ them, and a test with no tokens would prove only that the
 * fallbacks work. */
const TOKENS: Record<string, string> = {
  "--vf-accent-1": "#6366f1",
  "--vf-accent-2": "#ec4899",
  "--vf-accent-3": "#22c55e",
  "--vf-accent-4": "#f59e0b",
  "--vf-accent-5": "#06b6d4",
  "--vf-accent-6": "#8b5cf6",
  "--vf-accent-7": "#ef4444",
  "--vf-accent-8": "#3b82f6",
  "--vf-green": "#30d158",
  "--vf-orange": "#ff9f0a",
  "--vf-card-deep": "#000000",
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

/** Every interval this stage opened, and every one it closed. The PF6 claim is
 * literally the difference between these two sets. */
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];
let clearedEngines = 0;

beforeEach(() => {
  markers = [];
  openedIntervals = [];
  clearedIntervals = [];
  clearedEngines = 0;
  localStorage.clear();
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
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
  const realEngineClear = Matter.Engine.clear;
  vi.spyOn(Matter.Engine, "clear").mockImplementation((engine) => {
    clearedEngines += 1;
    return realEngineClear(engine);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

function mountMonitor(viewId: string = DEFAULT_MONITOR_VIEW_ID): HTMLElement {
  const view = monitorViewFor(viewId);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <GodviewMonitor view={view} parameters={monitorParameterDefaults(view.parameterGroups)} />,
    );
  });
  return container;
}

const latest = (): GodviewMonitorFacts => markers[markers.length - 1] as GodviewMonitorFacts;

describe("the monitor stage", () => {
  it("mounts on the registry's default view with the mock field on it", () => {
    const host = mountMonitor();
    expect(latest().viewId).toBe("swarm");
    // Eight agents plus the unclaimed terminal — and the marker separates them,
    // because "rows" and "agents" are different claims.
    expect(latest().agents).toBe(9);
    expect(latest().agentBacked).toBe(8);
    expect(host.querySelectorAll(".vf-monitor-bubble").length).toBe(9);
  });

  it("WEARS THE LABEL — in the DOM and in the marker (GT-D13)", () => {
    // The law of this slice. Every row on this stage is invented; a monitor that
    // showed them without saying so would be the honest-states violation the
    // decision was written to forbid, and it would look exactly like a real one.
    const host = mountMonitor();
    const chip = host.querySelector(".vf-monitor-mock-chip");
    expect(chip?.textContent).toBe(MOCK_LABEL);
    expect(latest().mockLabel).toBe(MOCK_LABEL);
    // …and it is CHROME, not decoration: the swarm reads it through this
    // attribute and gives it a solid body to settle around.
    expect(chip?.closest("[data-monitor-chrome]")).not.toBeNull();
  });

  it("reads its colors from the live tokens rather than from a transcription", () => {
    const host = mountMonitor();
    const colors = new Set(
      [...host.querySelectorAll<HTMLElement>(".vf-monitor-bubble")].map((bubble) =>
        bubble.style.getPropertyValue("--agent-color"),
      ),
    );
    // Every color on the stage is one of §2.6's eight, and more than one is in
    // use — a single value would mean the accents never resolved.
    for (const color of colors) expect(Object.values(TOKENS)).toContain(color);
    expect(colors.size).toBeGreaterThan(1);
  });

  it("renders every view in the registry against the same mock field", () => {
    // The contract's real claim: a view is a pure function of its props, so
    // swapping one changes what is drawn and nothing else.
    for (const [viewId, selector] of [
      ["list", ".vf-monitor-list-row"],
      ["rain", ".vf-monitor-rain-agents button"],
    ] as const) {
      const host = mountMonitor(viewId);
      expect(latest().viewId).toBe(viewId);
      expect(host.querySelectorAll(selector).length).toBe(9);
      act(() => root?.unmount());
      container?.remove();
      root = null;
    }
  });

  it("PF6: closing disposes — every timer cleared, every engine cleared", () => {
    mountMonitor();
    expect(openedIntervals.length, "the mock's tick never started").toBeGreaterThan(0);
    expect(clearedIntervals).not.toEqual(expect.arrayContaining(openedIntervals));

    act(() => root?.unmount());
    root = null;

    // The whole PF6 claim for this stage, and it is stronger than the deck's:
    // the deck stays mounted and SILENCED, this is gone. Nothing is left
    // ticking, and matter's engine was torn down rather than left idling.
    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
    expect(clearedEngines, "the physics engine was never cleared").toBeGreaterThan(0);
  });

  it("acknowledges a selection visibly, and mounts nothing (GT-D13)", () => {
    const host = mountMonitor("list");
    const row = host.querySelector<HTMLButtonElement>(".vf-monitor-list-row");
    expect(row?.getAttribute("aria-current")).toBeNull();

    act(() => row?.click());

    // Visible acknowledgement: the row reads as current, and the stage says in
    // words that nothing was mounted.
    const acknowledged = host.querySelector<HTMLButtonElement>(".vf-monitor-list-row.is-active");
    expect(acknowledged?.getAttribute("aria-current")).toBe("true");
    expect(host.querySelector(".vf-monitor-ack")?.textContent).toContain("nothing was mounted");
    // Structurally unable to mount anything: this stage is rendered with two
    // props and holds no runtime, no workspace and no fieldd client — there is
    // no door here for a real session to come through, which is the port's
    // discipline rather than a promise.
    expect(latest().agents).toBe(9);
  });

  it("says create is not wired rather than pretending it is", () => {
    const host = mountMonitor("list");
    const create = host.querySelector<HTMLButtonElement>(".vf-monitor-list-new");
    act(() => create?.click());
    expect(host.querySelector(".vf-monitor-ack")?.textContent).toContain("not wired");
    expect(latest().agents, "a mock create invented no session").toBe(9);
  });
});
