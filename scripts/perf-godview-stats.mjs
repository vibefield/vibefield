// THE PAIRED RUNNER'S STATISTICS AND GATE (MV-3c; build-mv L14, M24, M33) —
// pure, so a test can hold it (`electron-shell/test/godview-perf-stats.test.ts`);
// `perf-godview.mjs` launches the arms and calls these.
//
// The estimator is K-H's rule (memory `aa-control-read-paired`): every metric
// is read PAIRED per round, T = median(B − A), MAD = median |d − T|,
// z = |T| ÷ (1.858·MAD ÷ √R); the A/A null arm (A′ − A, the same build twice
// in the same session) is read with the SAME estimator and judged by its own
// spread. Medians, never tails (memory `loaded-host-measurement-discipline`).
//
// M33 + M40: the GATE reads the decisive rows — frame p50, the LoAF rows, and
// the TOTALS: Chromium's main-thread task time per second and every React
// root's render time per second (a view in its own root, or work moved into
// rAF, is inside them and outside every per-view row). The task total's
// COMPONENTS (script, layout, recalc style) gate only when material — B − A of
// at least 1 ms/s besides z > 4 and T > 2 % — and a component that rises while
// its cell's task total falls reads `shifted`: named, never a failure. The
// per-view rows stay as context.

export const median = (values) => {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mad = (values, centre) => median(values.map((value) => Math.abs(value - centre)));

/** T = median of paired diffs, MAD, z = |T| / (1.858·MAD/√R). */
export function pairedDiff(a, b) {
  const diffs = a.map((value, index) => b[index] - value).filter((d) => Number.isFinite(d));
  if (diffs.length === 0) return { T: Number.NaN, mad: Number.NaN, z: Number.NaN, R: 0 };
  const T = median(diffs);
  const spread = mad(diffs, T);
  const z =
    spread === 0
      ? T === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(T) / ((1.858 * spread) / Math.sqrt(diffs.length));
  return { T, mad: spread, z, R: diffs.length };
}

const relative =
  (share, least = 1) =>
  (a) =>
    Math.max(least, Math.abs(a) * share);

/**
 * Each metric: its name, which way is worse, its materiality floor (from A's
 * median where it is relative), and its role in the GATE (M33, M40): `total`
 * and `decisive` rows gate, `component` rows gate only when material and not
 * shifted; rows with no role are context. A frame is the window mode's
 * (`frameMs`).
 */
export function metricTable(frameMs) {
  const gate = (role) => ({ gate: true, role });
  return [
    // ── the decisive rows: the totals, frame p50, the LoAF rows (M33, M40) ──
    { name: "task ms/s", direction: "up", floor: relative(0.02, 0.5), ...gate("total") },
    { name: "react render ms/s", direction: "up", floor: relative(0.02, 0.5), ...gate("total") },
    { name: "frame p50 ms", direction: "up", floor: () => 0.02 * frameMs, ...gate("decisive") },
    { name: "loaf count", direction: "up", floor: () => 1, ...gate("decisive") },
    { name: "loaf blocking ms", direction: "up", floor: () => 50, ...gate("decisive") },
    // ── the task total's components: material at ≥ 1 ms/s and > 2 % (M40) ──
    { name: "script ms/s", direction: "up", floor: relative(0.02, 1), ...gate("component") },
    { name: "layout ms/s", direction: "up", floor: relative(0.02, 1), ...gate("component") },
    { name: "recalc style ms/s", direction: "up", floor: relative(0.02, 1), ...gate("component") },
    // ── context ──
    { name: "react commits/s", direction: "up", floor: relative(0.02) },
    { name: "react roots", direction: "up", floor: () => 0.5 },
    { name: "frame p95 ms", direction: "up", floor: () => 0.02 * frameMs },
    { name: "fps", direction: "down", floor: relative(0.02, 0.5) },
    { name: "raf work ms", direction: "up", floor: relative(0.05) },
    { name: "raf work p95 ms/frame", direction: "up", floor: () => 0.05 * frameMs },
    { name: "delivery work ms", direction: "up", floor: relative(0.05) },
    { name: "delivery work p95 ms", direction: "up", floor: () => 0.05 * frameMs },
    { name: "view renders", direction: "up", floor: relative(0.02) },
    { name: "view commits", direction: "up", floor: relative(0.02) },
    { name: "worker posts", direction: "up", floor: relative(0.02) },
    { name: "updateAgents posts", direction: "up", floor: relative(0.02) },
    { name: "canvas2d calls", direction: "up", floor: relative(0.02) },
    { name: "gpu submits", direction: "up", floor: relative(0.02) },
    { name: "dom mutations", direction: "up", floor: relative(0.02) },
    { name: "mark→render ms", direction: "up", floor: () => frameMs },
    { name: "mark→commit ms", direction: "up", floor: () => frameMs },
    { name: "mark→mutation ms", direction: "up", floor: () => frameMs },
    { name: "mark→draw2d ms", direction: "up", floor: () => frameMs },
    { name: "mark→gpu ms", direction: "up", floor: () => frameMs },
    { name: "mark→frame ms", direction: "up", floor: () => frameMs },
    { name: "js heap MB", direction: "up", floor: relative(0.05) },
    { name: "renderer MB", direction: "up", floor: relative(0.05) },
    { name: "gpu MB", direction: "up", floor: relative(0.05) },
  ];
}

/** The metrics read out of one cell of a lab run, flat. */
export function cellMetrics(cell) {
  const r = cell.report;
  const mark = r.marks.find((m) => m.name === "status-flip");
  const latency = (key) =>
    mark && typeof mark[key] === "number" ? mark[key] - mark.at : Number.NaN;
  const view = cell.view;
  const work = cell.replay?.work;
  const totals = cell.totals ?? null;
  const react = r.react ?? null;
  const seconds = r.windowMs / 1_000;
  const perSecond = (value) => (seconds > 0 ? value / seconds : Number.NaN);
  return {
    "task ms/s": totals?.taskMsPerS ?? Number.NaN,
    "script ms/s": totals?.scriptMsPerS ?? Number.NaN,
    "layout ms/s": totals?.layoutMsPerS ?? Number.NaN,
    "recalc style ms/s": totals?.recalcStyleMsPerS ?? Number.NaN,
    // an untimed renderer (production React) has no render time to read
    "react render ms/s": react?.hooked && react.timed ? perSecond(react.renderMs) : Number.NaN,
    "react commits/s": react?.hooked ? perSecond(react.commits) : Number.NaN,
    "react roots": react?.hooked ? react.roots.length : Number.NaN,
    "frame p50 ms": r.frames.p50,
    "frame p95 ms": r.frames.p95,
    fps: r.frames.fps,
    "loaf count": r.loaf.count,
    "loaf blocking ms": r.loaf.blockingMs,
    "raf work ms": r.raf?.totalMs ?? Number.NaN,
    "raf work p95 ms/frame": r.raf?.perFrame?.p95 ?? Number.NaN,
    "delivery work ms": work?.totalMs ?? Number.NaN,
    "delivery work p95 ms": work?.p95 ?? Number.NaN,
    "view renders": r.renders?.[view] ?? Number.NaN,
    "view commits": r.commits?.[view] ?? Number.NaN,
    "worker posts": r.postsTotal ?? Number.NaN,
    "updateAgents posts": r.posts?.updateAgents ?? Number.NaN,
    "canvas2d calls": r.canvas2d.calls,
    "gpu submits": r.gpu.submits,
    "dom mutations": r.dom.mutations,
    "mark→render ms": latency("firstRenderAfter"),
    "mark→commit ms": latency("firstCommitAfter"),
    "mark→mutation ms": latency("firstMutationAfter"),
    "mark→draw2d ms": latency("firstDraw2dAfter"),
    "mark→gpu ms": latency("firstGpuAfter"),
    "mark→frame ms": latency("nextFrameAfter"),
    "js heap MB":
      r.memory.usedJSHeapSize === null ? Number.NaN : r.memory.usedJSHeapSize / 1_048_576,
    "renderer MB": cell.memory?.rendererMB ?? Number.NaN,
    "gpu MB": cell.memory?.gpuMB ?? Number.NaN,
  };
}

/**
 * A reading aid per row: `worse` / `better` when the paired effect clears
 * z > 4, its materiality floor, AND the null arm's own offset by two of its
 * spreads; `noisy` when the null arm itself clears z > 4 and the floor (that
 * metric cannot be read this run).
 */
export function reading(direction, floor, effect, nullArm) {
  if (!Number.isFinite(effect.T)) return "";
  if (
    nullArm !== null &&
    Number.isFinite(nullArm.T) &&
    nullArm.z > 4 &&
    Math.abs(nullArm.T) > floor
  )
    return "noisy";
  const noise = nullArm === null ? 0 : Math.abs(nullArm.T) + 2 * (nullArm.mad || 0);
  if (effect.z <= 4 || Math.abs(effect.T) <= floor || Math.abs(effect.T) <= noise) return "";
  const worse = direction === "up" ? effect.T > 0 : effect.T < 0;
  return worse ? "worse" : "better";
}

/** One cell's rows: A's, B's (and A′'s) per-round metrics, read paired. With
 * no A′ the run IS the null arm, and a row past z > 4 and its floor reads
 * `moved` (the instrument's own noise), never worse or better. A component
 * that reads worse while the cell's task total fell reads `shifted` (M40). */
export function judgeCell(a, b, a2, table) {
  const rows = table.map(({ name, direction, floor: floorOf, gate, role }) => {
    const av = a.map((m) => m[name]);
    const bv = b.map((m) => m[name]);
    const effect = pairedDiff(av, bv);
    const nullArm =
      a2 === null
        ? null
        : pairedDiff(
            av,
            a2.map((m) => m[name]),
          );
    const floor = floorOf(median(av));
    return {
      metric: name,
      gate: gate === true,
      role: role ?? null,
      A: median(av),
      B: median(bv),
      ...effect,
      ...(nullArm !== null ? { T0: nullArm.T, mad0: nullArm.mad, z0: nullArm.z } : {}),
      floor,
      reading:
        a2 === null
          ? Number.isFinite(effect.T) && effect.z > 4 && Math.abs(effect.T) > floor
            ? "moved"
            : ""
          : reading(direction, floor, effect, nullArm),
    };
  });
  const total = rows.find((row) => row.role === "total" && row.metric === "task ms/s");
  if (a2 !== null && total !== undefined && Number.isFinite(total.T) && total.T < 0) {
    for (const row of rows) {
      if (row.role === "component" && row.reading === "worse") row.reading = "shifted";
    }
  }
  return rows;
}

/** M24: z is not read before seven paired rounds (with fewer, MAD collapses
 * and z reads ∞ on a difference of nothing). */
export const MIN_ROUNDS = 7;

/**
 * THE GATE (M33, M40) over every cell's gate rows. A paired run: `worse` when
 * any gate row reads worse (a shifted component is listed, never counted); else `noisy` when a gate row's null arm moved; else
 * `missing` when a gate row could not be read (no totals, or an untimed React
 * render row); else `pass`. An A/A run (no null arm: the run IS the null arm)
 * reads `null-ok` when no gate row clears z > 4 and its floor, else
 * `null-moved` — the instrument's own noise would have been called an effect.
 * Fewer than seven rounds read `unread` whatever the rows say (M24).
 */
export function gateVerdict(cells, { paired, rounds }) {
  const worse = [];
  const better = [];
  const noisy = [];
  const missing = [];
  const moved = [];
  const shifted = [];
  for (const { cell, rows } of cells) {
    for (const row of rows) {
      if (!row.gate) continue;
      const where = `${cell} · ${row.metric}`;
      if (!Number.isFinite(row.T)) missing.push(where);
      else if (row.reading === "moved") moved.push(where);
      else if (row.reading === "worse") worse.push(where);
      else if (row.reading === "better") better.push(where);
      else if (row.reading === "noisy") noisy.push(where);
      else if (row.reading === "shifted") shifted.push(where);
    }
  }
  const verdict =
    rounds < MIN_ROUNDS
      ? "unread"
      : !paired
        ? moved.length > 0
          ? "null-moved"
          : missing.length > 0
            ? "missing"
            : "null-ok"
        : worse.length > 0
          ? "worse"
          : noisy.length > 0
            ? "noisy"
            : missing.length > 0
              ? "missing"
              : "pass";
  return { verdict, worse, better, noisy, missing, moved, shifted };
}
