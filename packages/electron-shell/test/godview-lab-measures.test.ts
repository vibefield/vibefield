/**
 * THE GODVIEW LAB'S TOTAL-WORK MEASURES (MV-3c; build-mv M33): the React
 * commit hook the lab evaluates before any page script, the per-second
 * main-thread totals from two CDP samples, and the negative controls' spelling.
 * The live half (React really calling the hook in the profiling build, CDP
 * really answering) is the lab run's own proof; this holds the bookkeeping.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { metricTotals, parseSynthetic } from "../src/testing/godview-lab-measures";
import { REACT_COMMIT_HOOK_SOURCE } from "../src/testing/react-commit-hook";

interface Ledger {
  records: { id: number; label: string; commits: number; renderMs: number }[];
  timed(): boolean | null;
  renderers(): number;
}

interface Hook {
  supportsFiber: boolean;
  inject(renderer: unknown): number;
  onCommitFiberRoot(id: number, root: unknown): void;
}

function page(existing?: unknown): {
  hook: Hook;
  ledger: Ledger | undefined;
} {
  const context: Record<string, unknown> = {};
  context["window"] = context;
  if (existing !== undefined) context["__REACT_DEVTOOLS_GLOBAL_HOOK__"] = existing;
  runInNewContext(REACT_COMMIT_HOOK_SOURCE, context);
  return {
    hook: context["__REACT_DEVTOOLS_GLOBAL_HOOK__"] as Hook,
    ledger: context["__vfReactCommits"] as Ledger | undefined,
  };
}

const element = (tagName: string, id: string, className: string) => ({
  nodeType: 1,
  nodeName: tagName,
  tagName,
  id,
  className,
});

describe("the React commit hook", () => {
  it("keeps one record per root: its container, its commits, its summed render time", () => {
    const { hook, ledger } = page();
    expect(hook.supportsFiber).toBe(true);
    expect(hook.inject({})).toBe(1);
    expect(hook.inject({})).toBe(2);
    const app = { containerInfo: element("DIV", "root", ""), current: { actualDuration: 3 } };
    const view = {
      containerInfo: element("DIV", "", "vf-view-slot legacy"),
      current: { actualDuration: 1.5 },
    };
    hook.onCommitFiberRoot(1, app);
    hook.onCommitFiberRoot(1, view);
    app.current = { actualDuration: 2 };
    hook.onCommitFiberRoot(1, app);
    expect(ledger?.renderers()).toBe(2);
    expect(ledger?.timed()).toBe(true);
    expect(JSON.parse(JSON.stringify(ledger?.records))).toEqual([
      { id: 1, label: "div#root", commits: 2, renderMs: 5 },
      { id: 2, label: "div.vf-view-slot", commits: 1, renderMs: 1.5 },
    ]);
  });

  it("counts a production build's commits and says they are untimed", () => {
    const { hook, ledger } = page();
    expect(ledger?.timed()).toBeNull();
    hook.onCommitFiberRoot(1, { containerInfo: element("DIV", "root", ""), current: {} });
    expect(ledger?.timed()).toBe(false);
    expect(ledger?.records[0]).toMatchObject({ commits: 1, renderMs: 0 });
  });

  it("leaves a hook already standing alone", () => {
    const standing = { supportsFiber: true, mine: true };
    const { hook, ledger } = page(standing);
    expect(hook).toBe(standing);
    expect(ledger).toBeUndefined();
  });
});

describe("a window's totals", () => {
  it("are each metric's growth per second of the window, in ms", () => {
    const start = { at: 100, task: 1, script: 0.5, layout: 0.1, recalcStyle: 0.05 };
    const end = { at: 104, task: 1.8, script: 0.9, layout: 0.14, recalcStyle: 0.07 };
    const totals = metricTotals(start, end);
    expect(totals?.seconds).toBe(4);
    expect(totals?.taskMsPerS).toBeCloseTo(200, 6);
    expect(totals?.scriptMsPerS).toBeCloseTo(100, 6);
    expect(totals?.layoutMsPerS).toBeCloseTo(10, 6);
    expect(totals?.recalcStyleMsPerS).toBeCloseTo(5, 6);
  });

  it("are absent when either sample is, or no time passed", () => {
    const sample = { at: 1, task: 0, script: 0, layout: 0, recalcStyle: 0 };
    expect(metricTotals(null, sample)).toBeNull();
    expect(metricTotals(sample, null)).toBeNull();
    expect(metricTotals(sample, sample)).toBeNull();
  });
});

describe("the negative controls' spelling", () => {
  it("reads view and root loads, and ignores the rest", () => {
    expect(parseSynthetic(undefined)).toEqual({});
    expect(parseSynthetic("")).toEqual({});
    expect(parseSynthetic("view:2")).toEqual({ viewRenderMs: 2 });
    expect(parseSynthetic("view:2, root:0.5")).toEqual({ viewRenderMs: 2, sideRootMs: 0.5 });
    expect(parseSynthetic("root:-1,view:x,disk:3")).toEqual({});
  });
});
