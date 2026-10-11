#!/usr/bin/env node
// THE PROOF AUDIT (MV-8b, M176 item 3; build-mv M44, M137–M139, M155, M171) —
// whether a run of `perf-godview.mjs` measured what it says it measured, read
// off its own files before anyone reads a grade from it. Instrument
// validation, never a grade:
//
//   · a completed summary, and every arm × round it declares has its launch
//     report, which ended and was metered, the hook standing, from its own
//     isolated Chromium profile (one per launch, M155);
//   · every report holds every view × recipe the run asked for, exactly once,
//     and the same cells the summary judged;
//   · each cell's replay ended having delivered something, through the source
//     its arm declares — `model`: model frames and ONE model listener, no fold
//     or mesh listener; `fold` (a pre-MV-3b arm): one fold and one mesh
//     listener and no model;
//   · React timed, and the view's own root committing: a model arm's view is
//     an SDK view in a root of its own (exactly one root named `mv-<view>`); a
//     fold arm's view draws in the host root, which its own counters show;
//   · WebGPU under the swarm; the deck's one healthy pane at the cell's start
//     and end (M137–M139);
//   · the monitor's membership is the corpus the recipe declares, in every
//     report (M147–M151).
//
// And it READS, without refusing (MV lab debts, 2026-10-11): the load at each
// launch's two ends — before it, as the runner recorded (`loadRange`), and as
// it ended, off each report's own `loadavg` (`endLoadRange`) — and names every
// launch that ended over the quiet line (`endedOverQuiet`: arm, round, start
// and end load), one plain line each after the account. The quiet line is
// `--quiet <n>` when given, else the run's own `--load-max` where its summary
// recorded one, else 15. Naming is all it does: the exit code and the verdict
// do not move for a loud launch.
//
//   node scripts/perf-godview-proof.mjs <run dir> [--quiet <n>]
//
// Exit 0 with a one-line JSON account on stdout, or 1 with every problem found.
// Ported from the continuation's check-live-proof.py (vf modes) and the
// declared-corpus half of check-isolated-inputs.mjs, minus their historical
// archive adapters (MV-8b's commit body lists what stayed behind as evidence).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertLabDeckProof,
  assertLabMonitorProof,
  assertLabProfileProof,
} from "./godview-lab-arms.mjs";

/** A report's file, as the runner names it: A′ is `A2`. */
export const reportFile = (arm, round) => `${arm === "A′" ? "A2" : arm}-r${round}.json`;

/**
 * The monitor's membership a recipe declares: `resolveRecipe`'s own defaults in
 * field-app's `godview/monitor/perf/corpus.ts` (n local agents, `bareTerminals`
 * terminals, `peers`/`peerAgents` rows on one peer desktop), every row shown.
 * field-app's corpus test holds this copy to that one.
 */
export function declaredMembership(recipe, viewId) {
  const fields = new Map();
  for (const part of String(recipe).split(",")) {
    const [key, value] = part.split("=");
    const number = Number(value?.trim());
    if (key !== undefined && value !== undefined && Number.isFinite(number)) {
      fields.set(key.trim(), number);
    }
  }
  const declared = fields.get("n");
  if (declared === undefined) throw new Error(`a corpus recipe names n: ${JSON.stringify(recipe)}`);
  const localAgents = Math.max(1, Math.floor(declared));
  const terminals = fields.get("bareTerminals") ?? 2;
  const remoteSessions =
    fields.get("peers") ?? fields.get("peerAgents") ?? Math.max(1, Math.round(localAgents / 4));
  const agents = localAgents + terminals + remoteSessions;
  return {
    viewId,
    agents,
    localAgents,
    terminals,
    remoteSessions,
    remoteHosts: remoteSessions > 0 ? 1 : 0,
    shownAgents: agents,
  };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The quiet line when neither the caller nor the run names one. */
export const DEFAULT_QUIET = 15;

/**
 * The line a launch's end load is held to, and whose it is: the caller's
 * `--quiet` when given; else the run's own `--load-max` — the ceiling every
 * launch STARTED under — where its summary recorded one (runs before
 * 2026-10-11 did not); else 15.
 */
export function quietLine(summary, asked) {
  if (Number.isFinite(asked)) return { quietLine: asked, quietLineFrom: "--quiet" };
  if (Number.isFinite(summary?.loadMax)) {
    return { quietLine: summary.loadMax, quietLineFrom: "the run's --load-max" };
  }
  return { quietLine: DEFAULT_QUIET, quietLineFrom: "default" };
}

/**
 * THE LOAD AT EACH LAUNCH'S TWO ENDS (MV lab debts). `summary.loads` is the
 * runner's reading BEFORE each launch, the only load this audit printed, and a
 * launch that started under the ceiling can end far over it: 0e020306's A r5
 * started at 12 and ended at 108. Every lab report holds `loadavg` as its
 * launch ended (`loadavg[0]`, the one-minute load). `launches` are the
 * reports' `{arm, round, loadavg}`. Returns the range of the end loads, how
 * many launches had none to read, and every launch that ended over `quiet`, in
 * launch order, with its start and end. NAMED, never refused: this audit
 * validates the instrument, and what a loud launch did to a reading is the
 * lead's to weigh (L14).
 */
export function launchLoads(summary, launches, quiet) {
  const key = (arm, round) => `${arm} r${round}`;
  const starts = new Map(
    (summary?.loads ?? []).map((entry, index) => [key(entry.arm, entry.round), { index, entry }]),
  );
  const read = launches
    .map(({ arm, round, loadavg }) => {
      const start = starts.get(key(arm, round));
      const end = Array.isArray(loadavg) ? loadavg[0] : undefined;
      return {
        order: start?.index ?? Number.POSITIVE_INFINITY,
        arm,
        round,
        startLoad: Number.isFinite(start?.entry.load) ? start.entry.load : null,
        endLoad: Number.isFinite(end) ? end : null,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...launch }) => launch);
  const ends = read.map((launch) => launch.endLoad).filter((load) => load !== null);
  return {
    endLoadRange: ends.length > 0 ? [Math.min(...ends), Math.max(...ends)] : null,
    endLoadUnread: read.length - ends.length,
    endedOverQuiet: read.filter((launch) => launch.endLoad !== null && launch.endLoad > quiet),
  };
}

/** One plain line per launch that ended over the quiet line, as the audit prints them. */
export function overQuietLines(account) {
  const load = (value) => (value === null ? "unread" : value.toFixed(2));
  return account.endedOverQuiet.map(
    ({ arm, round, startLoad, endLoad }) =>
      `${arm} r${round} ended over the quiet line (${account.quietLine}): load ${load(startLoad)} before the launch, ${load(endLoad)} at its end`,
  );
}

/** One cell's own checks, by its arm's source; each problem is pushed to `fail`. */
function auditCell(cell, source, where, fail) {
  const replay = cell?.replay ?? {};
  const listeners = replay.listeners ?? {};
  const react = cell?.report?.react ?? {};
  if (replay.phase !== "ended") fail(`${where}: the replay did not end (${replay.phase})`);
  if (!(replay.delivered > 0)) fail(`${where}: the replay delivered nothing`);
  if (source === "model") {
    if (!(replay.model?.frames > 0)) fail(`${where}: no model frames reached the window`);
    if (listeners.model !== 1) fail(`${where}: ${listeners.model ?? 0} model listeners, not one`);
    if ((listeners.fold ?? 0) !== 0 || (listeners.mesh ?? 0) !== 0) {
      fail(`${where}: a model arm also listened to the retired fold/mesh boards`);
    }
  } else {
    if (listeners.fold !== 1 || listeners.mesh !== 1) {
      fail(`${where}: a fold arm needs one fold and one mesh listener`);
    }
    if ((listeners.model ?? 0) !== 0) fail(`${where}: a fold arm listened to the model board`);
  }
  if (react.hooked !== true || react.timed !== true || !(react.renderMs > 0)) {
    fail(`${where}: React was not hooked and timed, or rendered nothing`);
  }
  const roots = Array.isArray(react.roots) ? react.roots : [];
  if (source === "model") {
    const own = roots.filter((root) => String(root.label).includes(`mv-${cell.view}`));
    if (own.length !== 1 || !(own[0].commits > 0)) {
      // (an arm whose view still drew through the legacy bridge — MV-4's swarm
      // and timeline — has none, and this audit cannot prove it)
      fail(`${where}: the view's own root (mv-${cell.view}) is not exactly one committing root`);
    }
  } else {
    const host = roots.filter((root) => root.label === "div#root");
    if (host.length !== 1 || !(host[0].commits > 0)) fail(`${where}: the host root did not commit`);
    if (!(cell?.report?.renders?.[cell.view] > 0) || !(cell?.report?.commits?.[cell.view] > 0)) {
      fail(`${where}: the view's own counters show no render and commit`);
    }
  }
  if (cell.view === "swarm" && cell.swarmRenderer !== "webgpu") {
    fail(`${where}: the swarm drew on ${cell.swarmRenderer}, not WebGPU`);
  }
  for (const edge of ["start", "end"]) {
    try {
      assertLabDeckProof(cell?.deck?.[edge], `${where} ${edge}`);
    } catch (error) {
      fail(error.message);
    }
  }
  try {
    const membership = assertLabMonitorProof(cell?.monitor, cell.view, where);
    const declared = declaredMembership(cell.recipe, cell.view);
    if (JSON.stringify(membership) !== JSON.stringify(declared)) {
      fail(
        `${where}: the monitor drew ${JSON.stringify(membership)}, not the declared corpus ${JSON.stringify(declared)}`,
      );
    }
  } catch (error) {
    fail(error.message);
  }
}

/**
 * Audit one run directory. Returns the account (arms, rounds, reports, cells,
 * profiles, the recorded verdict, the load at each launch's two ends and the
 * launches that ended over the quiet line) or throws with every problem
 * found, one per line. `quiet` is the caller's `--quiet`, when given.
 */
export function auditProof(directory, { quiet } = {}) {
  const dir = resolve(directory);
  const problems = [];
  const fail = (message) => problems.push(message);
  const refuse = () => {
    throw new Error(`proof audit refused ${dir}:\n  - ${problems.join("\n  - ")}`);
  };
  const summaryPath = join(dir, "summary.json");
  if (!existsSync(summaryPath)) {
    fail("no summary.json: the run did not complete");
    refuse();
  }
  const summary = readJson(summaryPath);
  const arms = Object.keys(summary.arms ?? {});
  const rounds = summary.rounds;
  const cellKeys = (summary.cells ?? []).map((cell) => cell.cell);
  if (arms.length === 0 || !Number.isSafeInteger(rounds) || rounds < 1) {
    fail("the summary declares no arms or rounds");
  }
  if (typeof summary.gate?.verdict !== "string") fail("the summary carries no gate verdict");
  if (cellKeys.length === 0 || new Set(cellKeys).size !== cellKeys.length) {
    fail("the summary's cells are empty or repeated");
  }
  if (problems.length > 0) refuse();

  const expected = arms.flatMap((arm) =>
    Array.from({ length: rounds }, (_, index) => reportFile(arm, index + 1)),
  );
  const present = readdirSync(dir).filter((name) => /^(A|B|A2)-r\d+\.json$/.test(name));
  for (const name of expected) if (!present.includes(name)) fail(`${name}: missing`);
  for (const name of present) if (!expected.includes(name)) fail(`${name}: not a declared launch`);

  const seen = new Set();
  const launches = [];
  let cells = 0;
  for (const arm of arms) {
    const source = summary.arms[arm].source;
    for (let round = 1; round <= rounds; round += 1) {
      const name = reportFile(arm, round);
      if (!present.includes(name)) continue;
      const report = readJson(join(dir, name));
      launches.push({ arm, round, loadavg: report.loadavg });
      if (report.arm !== arm) fail(`${name}: names arm ${report.arm}`);
      if (!(report.endedAt > report.startedAt)) fail(`${name}: the launch record never ended`);
      if (report.source !== source) fail(`${name}: read ${report.source}, its arm says ${source}`);
      if (report.metered !== true || report.reactHook !== true) {
        fail(`${name}: CDP did not meter it, or React's hook did not stand`);
      }
      try {
        assertLabProfileProof(report.profile, name, { seen });
      } catch (error) {
        fail(error.message);
      }
      const views = Array.isArray(report.views) ? report.views : [];
      const recipes = Array.isArray(report.recipes) ? report.recipes : [];
      const asked = recipes.flatMap((recipe) => views.map((view) => `${view} @ ${recipe}`));
      const measured = (report.cells ?? []).map((cell) => `${cell.view} @ ${cell.recipe}`);
      if (
        asked.length === 0 ||
        measured.length !== asked.length ||
        new Set(measured).size !== measured.length ||
        !asked.every((pair) => measured.includes(pair))
      ) {
        fail(`${name}: its cells are not every view × recipe it asked for, once each`);
      }
      const keys = (report.cells ?? []).map((cell) => `${cell.view} × ${cell.corpus}`);
      if (JSON.stringify(keys) !== JSON.stringify(cellKeys)) {
        fail(`${name}: its cells are not the summary's, in its order`);
      }
      for (const cell of report.cells ?? []) {
        auditCell(cell, source, `${name} ${cell.view} × ${cell.corpus}`, fail);
        cells += 1;
      }
    }
  }
  const declaredProfiles = new Set(summary.profiles ?? []);
  if (declaredProfiles.size !== seen.size || [...seen].some((id) => !declaredProfiles.has(id))) {
    fail("the summary's profiles are not the launches' own");
  }
  if (problems.length > 0) refuse();
  const loads = (summary.loads ?? []).map((entry) => entry.load);
  const line = quietLine(summary, quiet);
  return {
    dir,
    arms,
    rounds,
    reports: present.length,
    cells,
    profiles: seen.size,
    verdict: summary.gate.verdict,
    loadRange: loads.length > 0 ? [Math.min(...loads), Math.max(...loads)] : null,
    ...line,
    ...launchLoads(summary, launches, line.quietLine),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const asked = argv.includes("--quiet") ? Number(argv[argv.indexOf("--quiet") + 1]) : undefined;
  const [directory] = argv.filter(
    (arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--quiet",
  );
  if (directory === undefined || (asked !== undefined && !Number.isFinite(asked))) {
    process.stderr.write("usage: node scripts/perf-godview-proof.mjs <run dir> [--quiet <n>]\n");
    process.exit(2);
  }
  try {
    const account = auditProof(directory, { quiet: asked });
    process.stdout.write(`${JSON.stringify(account)}\n`);
    for (const line of overQuietLines(account)) process.stdout.write(`${line}\n`);
    process.stdout.write("PROOF OK — instrument validation, not a performance grade\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
