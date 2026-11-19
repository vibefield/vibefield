#!/usr/bin/env node
// Item 566 (2026-11-19): every plugin the packaged app bundles passes the authoring kit's
// conformance suite, run rather than only said (the plugin architecture spec §24.2: "every
// built-in passes the conformance suite"). Until this day nothing ran the kit's `check` over a
// bundled plugin, and `check` alone passes a plugin it could not judge: with no build on disk its
// activation and artifact rows are notes, and a note never fails it.
//
// `pnpm verify` runs this right after `census:assert`, which builds every plugin package, so each
// row is judged WITH its build. For every row of BUNDLED_PLUGINS (apps/desktop/packaging/
// bundled-list.mjs, the one list the stager and smoke:bundled read) it runs the kit's own front
// door as an author does, `vibefield-plugin check <dir> --json`, and holds a bundled plugin to more
// than the kit does:
//  - the kit exits 0 (1 is a refusal, 2 the kit's own failure), and every line it writes is a
//    verdict;
//  - each of the suite's five rows (manifest, wall, schema, activation, artifact) says something;
//  - no note stands but the kit's two ceilings, the same for every plugin: the WGSL it reads and
//    does not compile, and the duplicate singletons only the build can see. Any other note (no
//    build, a module plain Node cannot load, a dev alias id, an unknown manifest key, a code the
//    kit adds later) fails the row.
// `--self-test` runs its own cases: the judge on runs as the kit writes them, and the kit itself on
// a fixture plugin under the OS temp (removed after), unbuilt and built.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_PLUGINS } from "../apps/desktop/packaging/bundled-list.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const KIT = join(ROOT, "tooling/plugin-cli/bin/vibefield-plugin.mjs");

/** The suite's rows (tooling/plugin-cli/src/check.ts): each says something about a bundled one. */
export const ROWS = ["manifest", "wall", "schema", "activation", "artifact"];

/** The notes a bundled plugin may carry: the kit's two ceilings, the same for every plugin. */
export const STANDING_NOTES = new Set([
  "object-wgsl-not-compiled",
  "artifact-singleton-build-time",
]);

/** One run of the kit, from the repository root: its exit and what it wrote. */
export function runKit(args) {
  const run = spawnSync(process.execPath, [KIT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: run.status, signal: run.signal, stdout: run.stdout ?? "" };
}

function describe(verdict) {
  const at = verdict.pointer === undefined ? "" : ` at ${verdict.pointer}`;
  return `${verdict.check} ${verdict.code}${at}: ${verdict.detail}`;
}

/** What stands against a bundled plugin, read from one `check <dir> --json` run; [] is a pass. */
export function judge(run) {
  const findings = [];
  const verdicts = [];
  for (const line of run.stdout.split("\n")) {
    if (line.trim() === "") continue;
    try {
      verdicts.push(JSON.parse(line));
    } catch {
      findings.push(`not a verdict: ${line.slice(0, 200)}`);
    }
  }
  if (run.status !== 0) {
    const how = run.status === null ? `on ${run.signal}` : `${run.status}`;
    findings.push(`the kit exited ${how} (1 is a refusal, 2 the kit's own failure)`);
  }
  for (const verdict of verdicts) {
    if (verdict.level === "refuse") findings.push(`refused: ${describe(verdict)}`);
    else if (verdict.level === "note" && !STANDING_NOTES.has(verdict.code))
      findings.push(`not judged: ${describe(verdict)}`);
  }
  for (const row of ROWS)
    if (!verdicts.some((verdict) => verdict.check === row))
      findings.push(`the ${row} row said nothing`);
  return findings;
}

function check() {
  if (BUNDLED_PLUGINS.length === 0) {
    console.error("check-bundled-plugins: BUNDLED_PLUGINS is empty, so nothing was judged");
    return false;
  }
  let failed = 0;
  for (const dir of BUNDLED_PLUGINS) {
    const started = performance.now();
    const findings = judge(runKit(["check", dir, "--json"]));
    const took = ((performance.now() - started) / 1000).toFixed(1);
    if (findings.length === 0) {
      console.log(`  PASS  ${dir} (${took} s)`);
      continue;
    }
    failed++;
    console.error(`  FAIL  ${dir} (${took} s)`);
    for (const finding of findings) console.error(`        ${finding}`);
  }
  const of = `${BUNDLED_PLUGINS.length - failed} of ${BUNDLED_PLUGINS.length}`;
  console.log(`check-bundled-plugins: ${of} pass the kit's check, built`);
  return failed === 0;
}

// ---- self-test ---------------------------------------------------------------------------------

/** A run as the kit writes one: NDJSON verdicts, then its exit. */
function kitRun(status, verdicts, extra = "") {
  const lines = verdicts.map(([level, row, code]) =>
    JSON.stringify({ level, check: row, code, detail: `${row} ${code}` }),
  );
  return { status, signal: null, stdout: `${[...lines, extra].join("\n")}\n` };
}

const CLEAN = [
  ["pass", "manifest", "ok"],
  ["pass", "wall", "ok"],
  ["pass", "schema", "ok"],
  ["pass", "activation", "ok"],
  ["note", "activation", "object-wgsl-not-compiled"],
  ["pass", "artifact", "ok"],
  ["note", "artifact", "artifact-singleton-build-time"],
];

const UNBUILT = [
  ["pass", "manifest", "ok"],
  ["pass", "wall", "ok"],
  ["pass", "schema", "ok"],
  ["note", "activation", "activation-unbuilt"],
  ["note", "artifact", "artifact-absent"],
];

/** Each case: a run, and whether the judge must find something (`fails`) and what. */
const JUDGE_CASES = [
  { label: "a clean built run", run: kitRun(0, CLEAN), fails: false },
  { label: "an unbuilt run the kit passes", run: kitRun(0, UNBUILT), fails: "activation-unbuilt" },
  {
    label: "a module plain Node cannot load",
    run: kitRun(0, [...CLEAN, ["note", "activation", "activation-not-loadable-here"]]),
    fails: "activation-not-loadable-here",
  },
  {
    label: "a row that said nothing",
    run: kitRun(
      0,
      CLEAN.filter(([, row]) => row !== "artifact"),
    ),
    fails: "the artifact row said nothing",
  },
  {
    label: "a refusal",
    run: kitRun(1, [...CLEAN, ["refuse", "wall", "wall-violation"]]),
    fails: "wall-violation",
  },
  { label: "the kit's own failure", run: kitRun(2, CLEAN), fails: "the kit exited 2" },
  {
    label: "a line that is no verdict",
    run: kitRun(0, CLEAN, "Error: boom"),
    fails: "Error: boom",
  },
];

const FIXTURE_ID = "com.example.bundled-check";
const FIXTURE_COMMAND = `${FIXTURE_ID}.go`;
const FIXTURE_MANIFEST = {
  manifestVersion: 1,
  id: FIXTURE_ID,
  version: "0.1.0",
  title: "Bundled check fixture",
  engines: { app: "^0.1.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onCommand:${FIXTURE_COMMAND}`],
  capabilities: [],
  contributes: { commands: [{ id: FIXTURE_COMMAND, title: "Go", placements: ["palette"] }] },
};
const FIXTURE_RENDERER = [
  "export default {",
  "  activate(ctx) {",
  `    ctx.commands.register(${JSON.stringify(FIXTURE_COMMAND)}, () => {});`,
  "  },",
  "};",
  "",
].join("\n");

/** The kit itself on a fixture plugin, before and after its build: [label, problem | null][] */
function kitCases(root) {
  const dir = join(root, "plugin");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{ "type": "module", "private": true }\n');
  writeFileSync(
    join(dir, "src", "manifest.ts"),
    `export const manifest = ${JSON.stringify(FIXTURE_MANIFEST, null, 2)};\n`,
  );
  const emitted = runKit(["emit-manifest", dir, "--json"]);
  if (emitted.status !== 0)
    return [["the kit emits the fixture's manifest", `exit ${emitted.status}: ${emitted.stdout}`]];

  const cases = [];
  const unbuilt = runKit(["check", dir, "--json"]);
  // the gap, held first: the kit itself passes an unbuilt plugin, noting what it did not judge
  const kitPassed = unbuilt.status === 0 && unbuilt.stdout.includes('"activation-unbuilt"');
  cases.push([
    "the kit passes the fixture unbuilt, noting activation-unbuilt",
    kitPassed ? null : `exit ${unbuilt.status}: ${unbuilt.stdout}`,
  ]);
  const unbuiltFindings = judge(unbuilt);
  cases.push([
    "an unbuilt bundled plugin fails here",
    unbuiltFindings.some((finding) => finding.includes("activation-unbuilt"))
      ? null
      : `findings: ${JSON.stringify(unbuiltFindings)}`,
  ]);

  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "renderer.js"), FIXTURE_RENDERER);
  const builtFindings = judge(runKit(["check", dir, "--json"]));
  cases.push([
    "the built fixture passes here",
    builtFindings.length === 0 ? null : `findings: ${JSON.stringify(builtFindings)}`,
  ]);
  return cases;
}

function selfTest() {
  const problems = [];
  for (const { label, run, fails } of JUDGE_CASES) {
    const findings = judge(run);
    if (fails === false && findings.length > 0)
      problems.push(`${label}: wanted a pass, found ${JSON.stringify(findings)}`);
    if (fails !== false && !findings.some((finding) => finding.includes(fails)))
      problems.push(
        `${label}: wanted a finding naming ${fails}, found ${JSON.stringify(findings)}`,
      );
  }
  const root = mkdtempSync(join(tmpdir(), "vf-bundled-check-"));
  let kit = [];
  try {
    kit = kitCases(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [label, problem] of kit) if (problem !== null) problems.push(`${label}: ${problem}`);
  const all = JUDGE_CASES.length + kit.length;
  for (const problem of problems) console.error(`self-test: ${problem}`);
  console.log(`check-bundled-plugins self-test: ${all - problems.length} of ${all}`);
  return problems.length === 0;
}

if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);
process.exit(check() ? 0 : 1);
