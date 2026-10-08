// @vitest-environment happy-dom
/**
 * THE PROBE'S TOTAL WORK (MV-3c; build-mv M33): every React root's commits and
 * render time between a reset and a report, read off the ledger the lab's
 * DevTools hook publishes — a root the host's root does not contain included —
 * and the synthetic side root that proves the totals include a root outside
 * the host.
 */
import { afterEach, describe, expect, it } from "vitest";
import { installGodviewPerfProbe } from "../src/godview/monitor/perf/godview-perf-probe";
import { resetGodviewPerfLabForTest } from "../src/godview/monitor/perf/lab-bridge";
import type { ReactCommitLedger } from "../src/godview/monitor/perf/react-roots";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

afterEach(() => {
  resetGodviewPerfLabForTest();
  installGodviewPerfProbe().dispose();
  delete window.__vfReactCommits;
});

function ledger(timed: boolean | null = true): ReactCommitLedger {
  const records: ReactCommitLedger["records"] = [];
  const held: ReactCommitLedger = { records, timed: () => timed, renderers: () => 1 };
  window.__vfReactCommits = held;
  return held;
}

const frames = (count: number): Promise<void> =>
  new Promise((done) => {
    let left = count;
    const step = (): void => {
      left -= 1;
      if (left <= 0) done();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

describe("every root's commits", () => {
  it("says so when no hook stood before React loaded", () => {
    const probe = installGodviewPerfProbe();
    probe.reset();
    expect(probe.report().react).toEqual({
      hooked: false,
      renderers: 0,
      timed: null,
      commits: 0,
      renderMs: 0,
      roots: [],
    });
  });

  it("are the differences since the reset, a root first seen inside the window from zero", () => {
    const held = ledger();
    held.records.push({ id: 1, label: "div#root", commits: 40, renderMs: 90 });
    const probe = installGodviewPerfProbe();
    probe.reset();
    const app = held.records[0] as ReactCommitLedger["records"][number];
    app.commits += 5;
    app.renderMs += 12.5;
    held.records.push({ id: 2, label: "div.vf-view-slot", commits: 3, renderMs: 4 });
    held.records.push({ id: 3, label: "div.idle", commits: 0, renderMs: 0 });
    expect(probe.report().react).toEqual({
      hooked: true,
      renderers: 1,
      timed: true,
      commits: 8,
      renderMs: 16.5,
      roots: [
        { id: 1, label: "div#root", commits: 5, renderMs: 12.5 },
        { id: 2, label: "div.vf-view-slot", commits: 3, renderMs: 4 },
      ],
    });
    // the next window starts where this one ended
    probe.reset();
    expect(probe.report().react.commits).toBe(0);
  });
});

describe("the synthetic loads (negative controls)", () => {
  it("a side root of its own commits once per frame, and leaves with its container", async () => {
    const probe = installGodviewPerfProbe();
    await probe.setSynthetic({ sideRootMs: 0.5 });
    const container = document.querySelector(".vf-perf-side-root");
    expect(container).not.toBeNull();
    await frames(6);
    await new Promise((done) => setTimeout(done, 50));
    const first = Number(container?.textContent);
    expect(first).toBeGreaterThan(0);
    await frames(4);
    await new Promise((done) => setTimeout(done, 50));
    expect(Number(container?.textContent)).toBeGreaterThan(first);
    await probe.setSynthetic({});
    expect(document.querySelector(".vf-perf-side-root")).toBeNull();
  });
});
