// WHAT A RUN SAYS OF ITS OWN METHOD (MV lab debts, 2026-10-11) — pure, so a
// test can hold it (`electron-shell/test/godview-perf-method.test.ts`);
// `perf-godview.mjs` writes these into the summary's `instruments` and header.
//
// A lab change is a change of method: an A/B pair must run the same lab in both
// arms. Each arm's launches are run by THAT arm's own lab build, so what a lab
// did around its measured cells is read off its reports, per arm, and a pair
// whose arms did not do the same thing reads so in the summary's own words —
// never a silent mix. A report from a lab before this one says nothing of
// these, and nothing is what the summary then says of it.

/**
 * The views an arm's launches say their discarded warm-up replayed through
 * (`warmedViews`, in order): the list when every launch names the same one —
 * empty when the warm-up was off — and null when a launch names none (a lab
 * from before the per-view warm-up warmed its default view and said nothing)
 * or the launches differ.
 */
export function warmedViews(runs) {
  const said = runs.map((run) => (Array.isArray(run?.warmedViews) ? run.warmedViews : null));
  const [first] = said;
  if (first === undefined || first === null) return null;
  const same = said.every((views) => JSON.stringify(views) === JSON.stringify(first));
  return same ? [...first] : null;
}

/** The summary header's line for the warm-up: one account when every arm ran
 * the same, otherwise each arm's and the method law's verdict on the pair. */
export function warmupLine(recipe, byArm) {
  const head = `- warm-up (discarded, \`${recipe}\`), the views it replayed through before the first cell:`;
  const say = (views) =>
    views === null
      ? "NOT SAID (a lab from before the per-view warm-up, or launches that differ)"
      : views.length === 0
        ? "NONE (no warm-up ran: each view first mounts inside its first measured cell)"
        : views.join(" → ");
  const arms = Object.entries(byArm);
  const [first] = arms;
  if (first === undefined) return `${head} no arm`;
  if (arms.every(([, views]) => JSON.stringify(views) === JSON.stringify(first[1]))) {
    return `${head} every arm ${say(first[1])}`;
  }
  return `${head} ${arms.map(([arm, views]) => `${arm} ${say(views)}`).join("; ")} — THE ARMS DID NOT RUN THE SAME WARM-UP: another lab is another method, and this pair is not one measurement`;
}

/**
 * How many of an arm's cells had their heap read after a forced collection
 * (`cell.heap.collected`), over every launch. A lab from before the heap row's
 * collection marks none: its row is the probe's reading, a collector's phase.
 */
export function heapCollection(runs) {
  const cells = runs.flatMap((run) => run?.cells ?? []);
  return {
    cells: cells.length,
    collected: cells.filter((cell) => cell?.heap?.collected === true).length,
  };
}

/** The summary header's line for the heap row: whether it is a level (read
 * after a collection) in every cell of every arm, and where it is not. */
export function heapLine(byArm) {
  const head =
    "- js heap MB, read after a forced collection (CDP `HeapProfiler.collectGarbage`, once the cell's window had closed):";
  const arms = Object.entries(byArm);
  const whole = ({ cells, collected }) => cells > 0 && collected === cells;
  if (arms.length > 0 && arms.every(([, count]) => whole(count))) {
    return `${head} every cell of every arm`;
  }
  const say = (count) =>
    whole(count) ? `all ${count.cells} cells` : `${count.collected} of ${count.cells} cells`;
  return `${head} ${arms.map(([arm, count]) => `${arm} ${say(count)}`).join("; ")} — an uncollected cell keeps the probe's own reading, A PHASE OF THE COLLECTOR AND NOT A LEVEL: a heap row over such cells is not a reading`;
}
