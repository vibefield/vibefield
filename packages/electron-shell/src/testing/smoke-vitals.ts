// VT-2 (track VT, 2026-11-24) — THE VITALS ROW of the Godview smoke, its pure half. The smoke presses the Window
// menu's Vitals as the native menu does, and this reads what the window then draws: a real daemon pair measured by
// the floor, named by fieldd and by main's roster, relayed by main down the window's one port. Nothing here is a
// fixture. The row is judged on what a person would see: the state line, the groups, the named rows and their
// figures, the traces, and that the page holds the one door and no other.
//
// The page is read through `executeJavaScript`, so the script reads only what the view draws (its class names are
// field-app's `vitals/VitalsView.tsx`). It prints names and figures, never a pid, a path or a log line's words.

/** The Vitals document, as its window's URL ends in every mode. */
export const VITALS_DOCUMENT = "/vitals.html";

export interface VitalsRowGroup {
  /** the group's own id (`data-group`): shell · fieldd · floor · agents · observer */
  readonly group: string;
  /** each row: its name, then its CPU and memory as the list says them */
  readonly rows: readonly (readonly [name: string, cpu: string, memory: string])[];
}

/** What the open Vitals window draws at one moment. */
export interface VitalsRowFacts {
  readonly state: string;
  readonly groups: readonly VitalsRowGroup[];
  /** the foot's CPU and memory for all of VibeField, or null while there is no foot */
  readonly total: readonly [cpu: string, memory: string] | null;
  /** the lanes' group traces that hold a drawn path */
  readonly traces: number;
  /** VT-3 — the groups whose processes the Loop lane draws a trace for: who said its own loop */
  readonly loop: readonly string[];
  /** VT-3 — the Loop lane's own reading at this moment ("Main · 3% busy"); printed for a reader, never judged */
  readonly loopReading: string;
  /** the sparklines that hold a drawn path */
  readonly sparks: number;
  /** the log lines drawn under the lanes */
  readonly lines: number;
  /** the keys of the page's one door */
  readonly door: readonly string[];
  /** `typeof` the product window's bridge and Node's two globals, as this page sees them */
  readonly product: string;
  readonly node: string;
}

/** Reads `VitalsRowFacts` in the Vitals page. One expression, no page state kept. */
export const VITALS_ROW_READ = `(() => {
  const text = (node) => (node?.textContent ?? "").trim();
  const figures = (row) => [...row.querySelectorAll(".vf-vitals__num")].map(text);
  const groups = [...document.querySelectorAll(".vf-vitals__group")].map((group) => ({
    group: group.getAttribute("data-group") ?? "",
    rows: [...group.querySelectorAll(".vf-vitals__row")].map((row) => {
      const [cpu, memory] = figures(row);
      return [text(row.querySelector(".vf-vitals__name")), cpu ?? "", memory ?? ""];
    }),
  }));
  const foot = document.querySelector(".vf-vitals__row--total");
  const drawn = (selector) =>
    [...document.querySelectorAll(selector)].filter((path) => (path.getAttribute("d") ?? "") !== "").length;
  return {
    state: text(document.querySelector(".vf-vitals__state")),
    groups,
    total: foot === null ? null : figures(foot).slice(0, 2),
    traces: drawn("path.vf-vitals__trace[data-group]"),
    loop: [...document.querySelectorAll('[data-lane="loop"] path.vf-vitals__trace[data-group]')]
      .filter((path) => (path.getAttribute("d") ?? "") !== "")
      .map((path) => path.getAttribute("data-group") ?? ""),
    loopReading: text(document.querySelector('[data-lane="loop"] .vf-vitals__reading')),
    sparks: drawn("path.vf-vitals__trace--spark"),
    lines: document.querySelectorAll(".vf-vitals__line").length,
    door: Object.keys(globalThis.vibefieldVitals ?? {}),
    product: typeof globalThis.vibefield,
    node: typeof globalThis.require + " " + typeof globalThis.process,
  };
})()`;

/** The state line of a recording census (field-app's `stateWords`, restated: testing reads the page, not its code). */
export const VITALS_RECORDING = "Recording · every second";
/** What the list says for a figure that was not measured. */
const NOT_MEASURED = "–";

/** The rows a running desk with a daemon pair and one terminal must show: the group, then the name's start. A
 * terminal's rows are matched by their start, because a tree's row also says how many processes it counts. */
export const VITALS_ROW_EXPECTED: readonly (readonly [group: string, name: string])[] = [
  ["shell", "Main"],
  ["shell", "Desk window"],
  ["fieldd", "fieldd"],
  ["floor", "field-native"],
  ["floor", "Terminal cell"],
  ["agents", "Terminal"],
  ["observer", "Vitals window"],
];

/** VT-3 — whose loop the Loop lane must draw in a run with the window open: fieldd's group and the shell's (Main). */
export const VITALS_LOOP_EXPECTED: readonly string[] = ["fieldd", "shell"];

/** Every way the facts fall short of a drawn, live census: empty when the row is green. Each problem names what was
 * read, so a red run says what the window showed. */
export function vitalsRowProblems(facts: VitalsRowFacts): string[] {
  const problems: string[] = [];
  if (facts.state !== VITALS_RECORDING) problems.push(`the state line says "${facts.state}"`);
  for (const [group, name] of VITALS_ROW_EXPECTED) {
    const rows = facts.groups.find((candidate) => candidate.group === group)?.rows ?? [];
    const row = rows.find(([said]) => said.startsWith(name));
    if (row === undefined) {
      problems.push(
        `no "${name}" row under ${group} (it lists: ${rows.map(([said]) => said).join(", ") || "nothing"})`,
      );
      continue;
    }
    const [, cpu, memory] = row;
    // a row's memory is read on its first reading; its CPU needs two, so only memory is held here
    if (memory === "" || memory === NOT_MEASURED) problems.push(`"${name}" has no memory figure`);
    if (cpu === "") problems.push(`"${name}" has no CPU cell`);
  }
  if (facts.total === null) problems.push("the list has no foot for all of VibeField");
  else if (facts.total[1] === NOT_MEASURED || facts.total[1] === "")
    problems.push("the foot has no memory figure");
  // one trace a group in each lane: VibeField, fieldd and the floor in CPU and in Memory
  if (facts.traces < 6) problems.push(`${facts.traces} lane trace(s) drawn, expected at least 6`);
  if (facts.sparks < 4) problems.push(`${facts.sparks} sparkline(s) drawn, expected at least 4`);
  // VT-3: fieldd says its own loop from its first sample, and main says its own once the window is open (its
  // reporter, the report door and the row that carries it, end to end)
  for (const group of VITALS_LOOP_EXPECTED) {
    if (!facts.loop.includes(group)) {
      problems.push(
        `the Loop lane draws no trace for ${group} (it draws: ${facts.loop.join(", ") || "none"})`,
      );
    }
  }
  if (facts.lines < 1) problems.push("no log line under the lanes");
  if (facts.door.join(",") !== "subscribe")
    problems.push(`the page's door holds [${facts.door.join(", ")}], expected subscribe alone`);
  if (facts.product !== "undefined") problems.push("the page holds the product window's bridge");
  if (facts.node !== "undefined undefined") problems.push(`the page sees Node (${facts.node})`);
  return problems;
}

/** The row's print: the counts and the named rows' figures, for the run's log. */
export function vitalsRowSummary(facts: VitalsRowFacts): Record<string, unknown> {
  return {
    state: facts.state,
    groups: Object.fromEntries(facts.groups.map((group) => [group.group, group.rows.length])),
    rows: Object.fromEntries(
      VITALS_ROW_EXPECTED.map(([group, name]) => {
        const row = facts.groups
          .find((candidate) => candidate.group === group)
          ?.rows.find(([said]) => said.startsWith(name));
        return [`${group}/${name}`, row === undefined ? null : `${row[1]} · ${row[2]}`];
      }),
    ),
    total: facts.total,
    traces: facts.traces,
    loop: facts.loop,
    loopReading: facts.loopReading,
    sparks: facts.sparks,
    lines: facts.lines,
    door: facts.door,
  };
}
