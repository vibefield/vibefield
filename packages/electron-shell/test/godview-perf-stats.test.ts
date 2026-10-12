/**
 * THE PAIRED RUNNER'S GATE (MV-3c; build-mv L14, M24, M33) — `scripts/perf-godview-stats.mjs`,
 * the pure half of `pnpm perf:godview`: K-H's paired estimator, the A/A null
 * arm read the same way, and the gate over the TOTALS (M33) — a synthetic load
 * the size of the negative control must read worse, a copy of A must pass, a
 * moving null arm must make the run unreadable rather than a verdict.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Metrics = Record<string, number>;
interface Row {
  metric: string;
  gate: boolean;
  role: string | null;
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

  it("the heap row is the lab's reading after a collection, and the probe's own where a report has none", () => {
    // a report from a lab before the heap row's collection: the probe's reading alone
    const before = cell(150);
    expect(stats.cellMetrics(before)["js heap MB"]).toBe(100);
    const mb = (megabytes: number): number => megabytes * 1_048_576;
    const collected = { collected: true, usedJSHeapSize: mb(74), totalJSHeapSize: mb(120) };
    expect(stats.cellMetrics({ ...before, heap: collected })["js heap MB"]).toBe(74);
    // a collection that could not be forced: the lab carries the probe's reading, marked
    const kept = { collected: false, usedJSHeapSize: mb(100), totalJSHeapSize: null };
    expect(stats.cellMetrics({ ...before, heap: kept })["js heap MB"]).toBe(100);
    const unread = { collected: false, usedJSHeapSize: null, totalJSHeapSize: null };
    expect(Number.isNaN(stats.cellMetrics({ ...before, heap: unread })["js heap MB"])).toBe(true);
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

// MV-8b (M177, ruling the M176 audit): `worse` is M40's text, z > 4 and T > 2 %
// (components also ≥ 1 ms/s). The reader used to ask an effect to clear the null
// arm's |T₀| + 2·MAD₀ as well, an envelope looser than M40; two recorded reds
// (M107) passed inside it.
describe("M40, literally: no null envelope in worse (MV-8b)", () => {
  const table = () => stats.metricTable(16.7);
  const rounds = (name: string, values: readonly number[]): Metrics[] =>
    values.map((value) => ({ [name]: value }));
  const rowOf = (rows: Row[], name: string): Row => {
    const row = rows.find((candidate) => candidate.metric === name);
    if (row === undefined) throw new Error(`no ${name} row`);
    return row;
  };

  it("an effect past z > 4 and 2 % of A is worse even inside the null arm's |T₀| + 2·MAD₀", () => {
    // B − A ≈ +3 with a small wobble: T = 3, MAD = 0.1, z ≈ 42.7
    const a = [100, 101, 99, 100, 102, 98, 100];
    const b = [103, 104.2, 101.8, 103, 105.1, 100.9, 103];
    // the null arm: T₀ = 1.5 and MAD₀ = 1.5 (z₀ ≈ 1.4, quiet), so the old envelope
    // |T₀| + 2·MAD₀ sat at 4.5, past T
    const a2 = [101.5, 104, 97, 101.5, 105, 96.5, 101.5];
    const rows = stats.judgeCell(
      rounds("task ms/s", a),
      rounds("task ms/s", b),
      rounds("task ms/s", a2),
      table(),
    );
    const task = rowOf(rows, "task ms/s");
    expect(task.z).toBeGreaterThan(4);
    expect(task.T).toBe(3);
    expect(task.reading).toBe("worse");
  });

  it("a total has no 0.5 ms/s minimum: 2 % of a 15 ms/s base is 0.3", () => {
    const a = [15, 15.2, 14.8, 15, 15.1, 14.9, 15];
    const b = a.map((value) => value + 0.4);
    const rows = stats.judgeCell(
      rounds("react render ms/s", a),
      rounds("react render ms/s", b),
      rounds("react render ms/s", a),
      table(),
    );
    expect(rowOf(rows, "react render ms/s").reading).toBe("worse");
  });

  it("a component is material from 1 ms/s, inclusive, and past 2 % of A", () => {
    const a = [40, 40.5, 39.5, 40, 40.25, 39.75, 40];
    const read = (shift: number) =>
      rowOf(
        stats.judgeCell(
          rounds("script ms/s", a),
          rounds(
            "script ms/s",
            a.map((value) => value + shift),
          ),
          rounds("script ms/s", a),
          table(),
        ),
        "script ms/s",
      ).reading;
    expect(read(0.99)).toBe("");
    expect(read(1)).toBe("worse");
  });

  // ── the recorded runs (fixtures/godview-perf-m40.json: each arm's per-round
  // values, as the shipping cellMetrics read them from the named reports) ──
  interface RecordedRow {
    cell: string;
    metric: string;
    recorded: { reading: string; T: number; z: number };
    A: string;
    B: string;
    "A′": string;
  }
  interface RecordedRun {
    recordedVerdict: string;
    rounds: number;
    rows: RecordedRow[];
  }
  const recorded = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "godview-perf-m40.json"), "utf8"),
  ) as Record<"m107" | "perf03" | "m142", RecordedRun>;
  const values = (text: string): number[] => text.split(" ").map(Number);
  /** Each recorded row judged by today's reader, after proving the fixture IS the
   * recorded data: it reproduces the run's own T and z. */
  function judged(run: RecordedRun): { cell: string; row: Row; was: string }[] {
    return run.rows.map((held) => {
      const arm = (name: "A" | "B" | "A′") => rounds(held.metric, values(held[name]));
      const row = rowOf(stats.judgeCell(arm("A"), arm("B"), arm("A′"), table()), held.metric);
      expect(row.T, `${held.cell} · ${held.metric} T`).toBe(held.recorded.T);
      expect(row.z, `${held.cell} · ${held.metric} z`).toBe(held.recorded.z);
      return { cell: held.cell, row, was: held.recorded.reading };
    });
  }

  it("M107's two M40-literal reds (rain and timeline n60 render) now read worse", () => {
    const rows = judged(recorded.m107);
    expect(recorded.m107.recordedVerdict).toBe("pass");
    expect(rows.map(({ cell, row, was }) => [cell, row.metric, was, row.reading])).toEqual([
      ["rain × n60-8s-s1", "react render ms/s", "", "worse"],
      ["timeline × n60-8s-s1", "react render ms/s", "", "worse"],
    ]);
    const gate = stats.gateVerdict(
      rows.map(({ cell, row }) => ({ cell, rows: [row] })),
      { paired: true, rounds: recorded.m107.rounds },
    );
    expect(gate.verdict).toBe("worse");
  });

  it.each(["perf03", "m142"] as const)(
    "the final qualification's 24 gated totals (%s) still pass: every delta favours B, none is worse or noisy, every total that read better still does",
    (name) => {
      const run = recorded[name];
      const rows = judged(run);
      expect(rows).toHaveLength(24);
      expect(rows.every(({ row }) => row.T < 0)).toBe(true);
      expect(rows.filter(({ row }) => row.reading === "worse" || row.reading === "noisy")).toEqual(
        [],
      );
      for (const { cell, row, was } of rows) {
        if (was === "better") expect(row.reading, `${cell} · ${row.metric}`).toBe("better");
      }
      // M40 reads a delta level below z > 4, whatever its sign: one such total in each
      const level = rows.filter(({ row }) => row.reading !== "better");
      expect(level).toHaveLength(1);
      expect(level[0]?.row.z).toBeLessThan(4);
      const gate = stats.gateVerdict(
        rows.map(({ cell, row }) => ({ cell, rows: [row] })),
        { paired: true, rounds: run.rounds },
      );
      expect(gate.verdict).toBe("pass");
    },
  );
});
