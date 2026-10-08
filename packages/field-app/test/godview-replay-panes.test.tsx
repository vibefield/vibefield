// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCorpus } from "../src/godview/monitor/perf/corpus";
import { EMPTY_PANES, encodeCorpusJsonl } from "../src/godview/monitor/perf/corpus-codec";
import {
  godviewPerfLab,
  installGodviewPerfLab,
  resetGodviewPerfLabForTest,
} from "../src/godview/monitor/perf/lab-bridge";
import { useGodviewReplayPanes } from "../src/godview/monitor/perf/replay-panes";
import { createReplayPlayer } from "../src/godview/monitor/perf/replay-player";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE = { n: 2, bareTerminals: 1, durationMs: 600, seed: 2, markerQuietMs: 50 };
const TEXT = "n=2,bareTerminals=1,duration=600,seed=2,markerQuietMs=50";
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  resetGodviewPerfLabForTest();
});

function mount(live: MonitorPaneFacts, search: string): () => MonitorPaneFacts | undefined {
  let seen: MonitorPaneFacts | undefined;
  function MonitorBoundary() {
    seen = useGodviewReplayPanes(live, search);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(<MonitorBoundary />));
  return () => seen;
}

describe("the replay monitor's pane input", () => {
  it("passes the exact live deck facts through without installing a lab", () => {
    const live = { sessionIds: ["real-shell"], activeSessionId: "real-shell" };
    const seen = mount(live, "?godviewMarkers=1");
    expect(seen()).toBe(live);
    expect(godviewPerfLab()).toBeNull();
    // Even an independently installed lab must not change this live consumer.
    act(() => installGodviewPerfLab().player.load(TEXT));
    expect(seen()).toBe(live);
  });

  it("publishes corpus joins and focus only to the monitor, preserving the physical deck", () => {
    const live = Object.freeze({
      sessionIds: Object.freeze(["real-shell"]),
      activeSessionId: "real-shell",
    });
    const seen = mount(live, "?godviewReplay=1");
    const { player } = installGodviewPerfLab();
    expect(seen()).toBe(EMPTY_PANES);
    act(() => player.load(TEXT));
    const expected = generateCorpus(RECIPE).panes;
    expect(seen()).toEqual(expected);
    expect(seen()).toBe(player.panes());
    expect(seen()?.sessionIds).not.toContain("real-shell");
    expect(expected.sessionIds).toHaveLength(3);
    expect(expected.activeSessionId).toBe(expected.sessionIds[0]);
    expect(live).toEqual({ sessionIds: ["real-shell"], activeSessionId: "real-shell" });
    act(() => player.clear());
    expect(seen()).toBe(EMPTY_PANES);
  });

  it("keeps the pane header across frame chunks and resets only on a header or clear", () => {
    const player = createReplayPlayer();
    const listener = vi.fn();
    const off = player.onPanes(listener);
    const lines = encodeCorpusJsonl(generateCorpus(RECIPE)).trimEnd().split("\n");
    player.push(lines.slice(0, 3).join("\n"));
    const snapshot = player.panes();
    expect(snapshot).toEqual(generateCorpus(RECIPE).panes);
    expect(listener).toHaveBeenCalledTimes(1);
    player.push(lines.slice(3, 4).join("\n"));
    player.push(lines.slice(4).join("\n"));
    expect(player.panes()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
    player.push(JSON.stringify({ kind: "corpus-panes", panes: EMPTY_PANES }));
    expect(player.panes()).toEqual(EMPTY_PANES);
    expect(listener).toHaveBeenCalledTimes(2);
    player.load(TEXT);
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    player.clear();
    expect(player.panes()).toBe(EMPTY_PANES);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("supplies an already loaded corpus to a later monitor subscriber", () => {
    const { player } = installGodviewPerfLab();
    player.load(TEXT);
    const seen = mount({ sessionIds: ["unrelated-deck-session"] }, "?godviewReplay=1");
    expect(seen()).toBe(player.panes());
  });
});
