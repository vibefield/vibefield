// @vitest-environment happy-dom
/**
 * THE LAB'S RENDERER HALF (MV-0, step 6): the probe, the player, the counting
 * wrapper and the replay mode of the door's instruments. The property that
 * matters most is the first one — with no lab installed, nothing here is in
 * the product's tree or on its door — and then that each instrument counts
 * what it says it counts.
 */
import type { AgentMonitorProps } from "@vibecook/puppeteer-views";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCorpus } from "../src/godview/monitor/perf/corpus";
import {
  godviewDoorInstrument,
  instrumentMonitorDoor,
  resetGodviewDoorInstrumentsForTest,
} from "../src/godview/monitor/perf/door-instruments";
import { activeProbe } from "../src/godview/monitor/perf/godview-perf-probe";
import { instrumentedMonitorView } from "../src/godview/monitor/perf/instrumented-view";
import {
  godviewPerfLab,
  godviewPerfLabRequested,
  installGodviewPerfLab,
  resetGodviewPerfLabForTest,
} from "../src/godview/monitor/perf/lab-bridge";
import { createReplayPlayer } from "../src/godview/monitor/perf/replay-player";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function door(): MonitorDoor {
  return {
    observe: vi.fn(() => () => undefined),
    observeMesh: vi.fn(() => () => undefined),
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: {
      status: async () => ({
        reachable: false,
        detail: "fixture",
        checkedAt: "2026-10-03T00:00:00Z",
      }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "fixture", checkedAt: "2026-10-03T00:00:00Z" },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: "2026-10-03T00:00:00Z", entries: [] }),
      subscribe: () => () => undefined,
    },
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(async () => {
  if (root !== null) {
    const held = root;
    await act(async () => {
      held.unmount();
    });
    root = null;
  }
  host?.remove();
  host = null;
  resetGodviewDoorInstrumentsForTest();
  resetGodviewPerfLabForTest();
  vi.useRealTimers();
});

const View = (props: AgentMonitorProps): ReactElement =>
  createElement("div", { className: "fake-view", "data-agents": props.agents.length });

describe("with no lab installed", () => {
  it("the counting wrapper is the view's own component and the door is the door", () => {
    expect(activeProbe()).toBeNull();
    expect(godviewPerfLab()).toBeNull();
    expect(instrumentedMonitorView({ id: "list", Component: View })).toBe(View);
    const real = door();
    expect(instrumentMonitorDoor(real, "?godviewMarkers=1")).toBe(real);
    expect(godviewPerfLabRequested("?godviewMarkers=1")).toBe(false);
    expect(godviewDoorInstrument("?godviewReplay=1")).toBe("replay");
    expect(godviewDoorInstrument("?godviewReplay=1&godviewRecord=1")).toBe("replay");
    expect(window.__vfGodviewPerf).toBeUndefined();
    expect(window.__vfGodviewReplay).toBeUndefined();
  });
});

describe("the lab bridge", () => {
  it("installs once, publishes both globals, and the replay door feeds from the player", () => {
    expect(godviewPerfLabRequested("?godviewPerf=1")).toBe(true);
    const lab = installGodviewPerfLab();
    expect(installGodviewPerfLab()).toBe(lab);
    expect(window.__vfGodviewPerf).toBe(lab.probe);
    expect(window.__vfGodviewReplay).toBe(lab.player);
    expect(activeProbe()).toBe(lab.probe);

    const real = door();
    const replay = instrumentMonitorDoor(real, "?godviewReplay=1");
    expect(replay).not.toBe(real);
    // the roster arrives when the lab LOADS, even though the door was built first
    const rosters: number[] = [];
    replay.devices?.subscribe((devices) => rosters.push(devices.length));
    expect(rosters).toEqual([]);
    const loaded = lab.player.load("n=3,duration=600,seed=2,markerQuietMs=50");
    expect(loaded.frames).toBeGreaterThan(10);
    expect(rosters).toEqual([2]);
    // the real door's streams are never asked; its verbs are
    expect(real.observe).not.toHaveBeenCalled();
    expect(real.observeMesh).not.toHaveBeenCalled();
  });
});

describe("the player", () => {
  it("delivers every frame on the corpus's timeline, fold frames through the text path, and marks the probe", () => {
    const lab = installGodviewPerfLab();
    const real = door();
    const replay = instrumentMonitorDoor(real, "?godviewReplay=1");
    const folds: number[] = [];
    const meshes: string[] = [];
    replay.observe({ onFrame: (rows) => folds.push(rows.length), onError: () => folds.push(-1) });
    replay.observeMesh({
      onOpen: () => meshes.push("open"),
      onFrame: () => meshes.push("frame"),
      onError: () => meshes.push("error"),
    });
    const corpus = generateCorpus({ n: 3, durationMs: 600, seed: 2, markerQuietMs: 50 });
    lab.player.load("n=3,duration=600,seed=2,markerQuietMs=50");
    const state = lab.player.start();
    expect(state.phase).toBe("playing");
    expect(state.listeners).toEqual({ fold: 1, mesh: 1, devices: 0 });
    // the first frame is due at t=0: delivered at start
    expect(folds).toEqual([3]);
    vi.advanceTimersByTime(700);
    const ended = lab.player.state();
    expect(ended.phase).toBe("ended");
    expect(ended.delivered).toBe(corpus.frames.length);
    expect(folds.filter((n) => n === -1)).toEqual([]);
    expect(folds.length).toBe(corpus.meta.counts.fold);
    expect(meshes[0]).toBe("open");
    expect(meshes.filter((m) => m === "frame").length).toBe(corpus.meta.counts.meshFrames);
    expect(ended.marks.map((m) => m.name)).toEqual(["status-flip"]);
    const report = lab.probe.report();
    expect(report.marks.map((m) => m.name)).toEqual(["status-flip"]);
    expect(lab.player.stop().phase).toBe("ended");
  });

  it("pushes recorded lines, with the roster from a corpus header when there is one", () => {
    const player = createReplayPlayer({ now: () => 0 });
    const corpus = generateCorpus({ n: 2, durationMs: 200, seed: 1, markerQuietMs: 20 });
    const lines = corpus.frames.map((frame) => JSON.stringify(frame)).join("\n");
    const loaded = player.push(
      `${JSON.stringify({ kind: "corpus-roster", devices: corpus.roster })}\n${lines}\n`,
    );
    expect(loaded.frames).toBe(corpus.frames.length);
    expect(loaded.roster).toBe(2);
    player.clear();
    expect(player.state().phase).toBe("empty");
    expect(player.roster()).toEqual([]);
  });
});

describe("the counting wrapper", () => {
  it("counts the view's renders and commits while a probe is installed, and nothing else changes", async () => {
    const lab = installGodviewPerfLab();
    const Counted = instrumentedMonitorView({ id: "list", Component: View });
    expect(Counted).not.toBe(View);
    expect(instrumentedMonitorView({ id: "list", Component: View })).toBe(Counted);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const props = {
      agents: [],
      parameters: {} as AgentMonitorProps["parameters"],
      actions: {} as AgentMonitorProps["actions"],
      palette: {} as AgentMonitorProps["palette"],
    } as unknown as AgentMonitorProps;
    await act(async () => {
      root?.render(createElement(Counted, props));
    });
    await act(async () => {
      root?.render(createElement(Counted, { ...props, agents: [] }));
    });
    expect(host.querySelector(".fake-view")?.getAttribute("data-agents")).toBe("0");
    const report = lab.probe.report();
    expect(report.renders).toEqual({ list: 2 });
    expect(report.commits).toEqual({ list: 2 });
    lab.probe.workerPost("updateAgents");
    lab.probe.workerPost("updateAgents");
    lab.probe.workerPost("init");
    expect(lab.probe.report().posts).toEqual({ updateAgents: 2, init: 1 });
    expect(lab.probe.report().postsTotal).toBe(3);
    lab.probe.reset();
    expect(lab.probe.report().renders).toEqual({});
  });
});

describe("the probe's marks", () => {
  it("settle the first render, commit, mutation and frame after a mark", () => {
    const lab = installGodviewPerfLab();
    host = document.createElement("div");
    host.className = "vf-godview-monitor-stage";
    document.body.appendChild(host);
    lab.probe.observeStage(".vf-godview-monitor-stage");
    vi.advanceTimersByTime(20); // the rAF that attaches the observer
    lab.probe.mark("status-flip", 100);
    lab.probe.viewRender("list", 90); // before the mark: not it
    lab.probe.viewRender("list", 104);
    lab.probe.viewCommit("list", 106);
    lab.probe.viewRender("list", 120);
    const [mark] = lab.probe.report().marks;
    expect(mark).toMatchObject({
      name: "status-flip",
      at: 100,
      firstRenderAfter: 104,
      firstCommitAfter: 106,
    });
  });
});
