/**
 * THE PAIRED RUNNER'S GATE (MV-3c; build-mv L14, M24, M33) — `scripts/perf-godview-stats.mjs`,
 * the pure half of `pnpm perf:godview`: K-H's paired estimator, the A/A null
 * arm read the same way, and the gate over the TOTALS (M33) — a synthetic load
 * the size of the negative control must read worse, a copy of A must pass, a
 * moving null arm must make the run unreadable rather than a verdict.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Metrics = Record<string, number>;
interface Row {
  metric: string;
  gate: boolean;
  T: number;
  z: number;
  reading: string;
}
interface Stats {
  pairedDiff(a: number[], b: number[]): { T: number; mad: number; z: number; R: number };
  metricTable(frameMs: number): { name: string; gate?: boolean }[];
  cellMetrics(cell: unknown): Metrics;
  judgeCell(a: Metrics[], b: Metrics[], a2: Metrics[] | null, table: unknown): Row[];
  gateVerdict(
    cells: { cell: string; rows: Row[] }[],
    options: { paired: boolean; rounds: number },
  ): {
    verdict: string;
    worse: string[];
    noisy: string[];
    missing: string[];
    moved: string[];
    shifted: string[];
  };
}

let stats: Stats;
beforeAll(async () => {
  // a computed specifier: the script is plain ESM outside this package's types
  const url = pathToFileURL(
    join(import.meta.dirname, "..", "..", "..", "scripts", "perf-godview-stats.mjs"),
  ).href;
  stats = (await import(/* @vite-ignore */ url)) as Stats;
});

/** One lab cell, the shape `godview-perf-lab.ts` writes. */
function cell(
  task: number,
  options: { renderMs?: number; timed?: boolean; script?: number; layout?: number } = {},
) {
  return {
    view: "list",
    report: {
      windowMs: 8_000,
      frames: { p50: 16.7, p95: 16.8, fps: 60 },
      loaf: { count: 0, blockingMs: 0 },
      raf: { totalMs: 2, perFrame: { p95: 0.1 } },
      renders: { list: 480 },
      commits: { list: 480 },
      posts: {},
      postsTotal: 0,
      canvas2d: { calls: 0 },
      gpu: { submits: 0 },
      dom: { mutations: 300 },
      marks: [],
      memory: { usedJSHeapSize: 100 * 1_048_576 },
      react: {
        hooked: true,
        timed: options.timed ?? true,
        commits: 500,
        renderMs: options.renderMs ?? 400,
        roots: [{ id: 1 }, { id: 2 }],
      },
    },
    replay: { work: { totalMs: 80, p95: 0.4 } },
    memory: { rendererMB: 500, gpuMB: 200 },
    totals: {
      seconds: 8,
      taskMsPerS: task,
      scriptMsPerS: options.script ?? task * 0.8,
      layoutMsPerS: options.layout ?? 2,
      recalcStyleMsPerS: 1,
    },
  };
}

/** Seven rounds of a level with a deterministic wobble (a loaded host's). */
const WOBBLE = [3, -4, 1, 6, -2, -5, 2];
const arm = (level: number, shift = 0): Metrics[] =>
  WOBBLE.map((w, round) => stats.cellMetrics(cell(level + w + (round % 2) * shift)));

describe("the paired estimator", () => {
  it("reads a constant difference exactly, and nothing as nothing", () => {
    expect(stats.pairedDiff([1, 2, 3], [1, 2, 3])).toEqual({ T: 0, mad: 0, z: 0, R: 3 });
    const shifted = stats.pairedDiff([10, 20, 30, 40], [12, 22, 32, 42]);
    expect(shifted.T).toBe(2);
    expect(shifted.z).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("a cell's metrics", () => {
  it("are per second where the gate reads them, and an untimed React has no render row", () => {
    const timed = stats.cellMetrics(cell(150, { renderMs: 400 }));
    expect(timed["task ms/s"]).toBe(150);
    expect(timed["react render ms/s"]).toBe(50);
    expect(timed["react commits/s"]).toBe(62.5);
    expect(timed["react roots"]).toBe(2);
    expect(Number.isNaN(stats.cellMetrics(cell(150, { timed: false }))["react render ms/s"])).toBe(
      true,
    );
  });

  it("reads legacy counters when present and leaves retired counters unknown", () => {
    const legacy = cell(150);
    const old = stats.cellMetrics(legacy);
    expect(old["view renders"]).toBe(480);
    expect(old["worker posts"]).toBe(0);
    const {
      renders: _renders,
      commits: _commits,
      posts: _posts,
      postsTotal: _total,
      ...report
    } = legacy.report;
    const current = stats.cellMetrics({ ...legacy, report });
    for (const name of [
      "view renders",
      "view commits",
      "worker posts",
      "updateAgents posts",
      "mark→render ms",
      "mark→commit ms",
    ]) {
      expect(Number.isNaN(current[name]), name).toBe(true);
    }
    expect(current["task ms/s"]).toBe(old["task ms/s"]);
    expect(current["react render ms/s"]).toBe(old["react render ms/s"]);
  });

  it("the gate rows are the totals, frame p50, the LoAF rows and the total's components (M33, M40)", () => {
    const gate = stats
      .metricTable(16.7)
      .filter((row) => row.gate)
      .map((row) => row.name);
    expect(gate).toEqual([
      "task ms/s",
      "react render ms/s",
      "frame p50 ms",
      "loaf count",
      "loaf blocking ms",
      "script ms/s",
      "layout ms/s",
      "recalc style ms/s",
    ]);
  });
});

describe("the gate", () => {
  const table = () => stats.metricTable(16.7);

  it("calls the negative control's load worse (B = A + 120 ms/s of task time)", () => {
    const rows = stats.judgeCell(arm(150), arm(270), arm(150, 1), table());
    const task = rows.find((row) => row.metric === "task ms/s");
    expect(task?.reading).toBe("worse");
    const gate = stats.gateVerdict([{ cell: "list × n10", rows }], { paired: true, rounds: 7 });
    expect(gate.verdict).toBe("worse");
    expect(gate.worse).toContain("list × n10 · task ms/s");
  });

  it("passes a copy of A", () => {
    const rows = stats.judgeCell(arm(150), arm(150, 1), arm(150, -1), table());
    expect(
      stats.gateVerdict([{ cell: "list × n10", rows }], { paired: true, rounds: 7 }).verdict,
    ).toBe("pass");
  });

  it("will not judge a run whose null arm moved", () => {
    const rows = stats.judgeCell(arm(150), arm(270), arm(200), table());
    const gate = stats.gateVerdict([{ cell: "list × n10", rows }], { paired: true, rounds: 7 });
    expect(gate.verdict).toBe("noisy");
    expect(gate.noisy).toContain("list × n10 · task ms/s");
  });

  it("says a gate row it could not read is unreadable, not passed", () => {
    const untimed = WOBBLE.map((w) => stats.cellMetrics(cell(150 + w, { timed: false })));
    const rows = stats.judgeCell(untimed, untimed, untimed, table());
    const gate = stats.gateVerdict([{ cell: "list × n10", rows }], { paired: true, rounds: 7 });
    expect(gate.verdict).toBe("missing");
    expect(gate.missing).toEqual(["list × n10 · react render ms/s"]);
  });

  it("a component's rise under 1 ms/s is not material (M40), however sure", () => {
    const at = (layout: number) =>
      WOBBLE.map((w, round) => stats.cellMetrics(cell(150 + w, { layout: layout + round * 0.01 })));
    const rows = stats.judgeCell(at(1), at(1.4), at(1), table());
    const layout = rows.find((row) => row.metric === "layout ms/s");
    expect(layout?.z).toBeGreaterThan(4);
    expect(layout?.reading).toBe("");
    expect(stats.gateVerdict([{ cell: "c", rows }], { paired: true, rounds: 7 }).verdict).toBe(
      "pass",
    );
  });

  it("a component that rose while the task total fell is shifted, named and not a failure (M40)", () => {
    const at = (task: number, script: number) =>
      WOBBLE.map((w) => stats.cellMetrics(cell(task + w, { script: script + w })));
    const rows = stats.judgeCell(at(150, 100), at(130, 112), at(150, 100), table());
    expect(rows.find((row) => row.metric === "task ms/s")?.reading).toBe("better");
    expect(rows.find((row) => row.metric === "script ms/s")?.reading).toBe("shifted");
    const gate = stats.gateVerdict([{ cell: "c", rows }], { paired: true, rounds: 7 });
    expect(gate.verdict).toBe("pass");
    expect(gate.shifted).toEqual(["c · script ms/s"]);
  });

  it("reads nothing before seven rounds (M24), whatever the rows say", () => {
    const rows = stats.judgeCell(arm(150), arm(270), arm(150, 1), table());
    expect(stats.gateVerdict([{ cell: "c", rows }], { paired: true, rounds: 3 }).verdict).toBe(
      "unread",
    );
  });

  it("reads an A/A run as the null arm: quiet is null-ok, an effect there is the instrument moving", () => {
    const quiet = stats.judgeCell(arm(150), arm(150, 1), null, table());
    expect(
      stats.gateVerdict([{ cell: "c", rows: quiet }], { paired: false, rounds: 7 }).verdict,
    ).toBe("null-ok");
    const moved = stats.judgeCell(arm(150), arm(190), null, table());
    // the null arm's own effect is never called worse
    expect(moved.find((row) => row.metric === "task ms/s")?.reading).toBe("moved");
    expect(
      stats.gateVerdict([{ cell: "c", rows: moved }], { paired: false, rounds: 7 }).verdict,
    ).toBe("null-moved");
  });
});
