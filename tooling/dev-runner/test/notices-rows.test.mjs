// Item 178 (2026-11-05): the notices rows held to what the stage copies, both ways (scripts/notices-rows.mjs), on the
// committed tables. The stager stages at import, so its PLAN is read from its text (`literalStageRows`, which refuses a
// dist/ row it cannot read) plus the two tables it spreads or names: fieldd's sidecars and the executable's row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FIELDD_EXE, SIDECARS } from "../../../apps/desktop/packaging/fieldd-sidecars.mjs";
import { literalStageRows, noticesRowProblems } from "../../../scripts/notices-rows.mjs";
import {
  createLedger,
  MILLE_ENGINE_ROLE,
  NODE_BUNDLES,
  sidecarNoticesProblems,
} from "../../../scripts/third-party-notices.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");
const read = (path) => readFileSync(join(REPO, path), "utf8");
const STAGER = read("scripts/stage-package.mjs");
const TRANSCRIPT = "packages/fieldd/dist/transcript-host.cjs";

/** The stage's rows as the committed stager builds them. */
function mainPlan() {
  const { rows, problems } = literalStageRows(STAGER);
  assert.deepEqual(problems, [], "the stager's text reads whole");
  // the two rows the stager does not spell literally: the executable's, and fieldd's sidecars (spread from the table)
  assert.match(
    STAGER,
    /stage: `bin\/\$\{FIELDD_EXE\}`,\n\s*from: `apps\/desktop\/build\/fieldd-sea\/\$\{FIELDD_EXE\}`/u,
  );
  assert.match(STAGER, /\n {2}\.\.\.SIDECARS\.map\(\(\{ stage, from, kind, produce \}\) => \(\{/u);
  const exe = {
    stage: `bin/${FIELDD_EXE}`,
    from: `apps/desktop/build/fieldd-sea/${FIELDD_EXE}`,
    kind: "file",
  };
  return [...rows, exe, ...SIDECARS.map(({ stage, from, kind }) => ({ stage, from, kind }))];
}
const problemsOf = ({ plan = mainPlan(), sidecars = SIDECARS, nodeBundles = NODE_BUNDLES } = {}) =>
  noticesRowProblems({ plan, sidecars, nodeBundles });

test("item 178: main's tables agree — every staged bundle has its notices row, every row is staged or embedded", () => {
  assert.deepEqual(problemsOf(), []);
  // what it covered: the shell's three bundles, fieldd's four, the embedded one
  const bundles = mainPlan().filter((row) => NODE_BUNDLES.some((b) => b.file === row.from));
  assert.ok(bundles.length >= 7, `staged bundles with a row: ${bundles.length}`);
  assert.ok(
    NODE_BUNDLES.some((b) => b.embeddedIn === `bin/${FIELDD_EXE}`),
    "bin.cjs rides the executable",
  );
});

test("item 178: A2's tables before its fix read red, naming transcript-host.cjs; with its rows, green", () => {
  // TH-1 as first cut (found before land): the SEA builder listed the transcript worker, the stager's hand-written
  // PLAN and the notices' NODE_BUNDLES did not.
  const plan = mainPlan().filter((row) => row.from !== TRANSCRIPT);
  const nodeBundles = NODE_BUNDLES.filter((b) => b.file !== TRANSCRIPT);
  assert.deepEqual(problemsOf({ plan, nodeBundles }), [
    `${TRANSCRIPT}: a sidecar of the fieldd executable that the stage never copies (want bin/transcript-host.cjs)`,
    `${TRANSCRIPT}: a bundle beside the executable with no NODE_BUNDLES row`,
  ]);
  // the stage row alone: the bundle ships, and nothing inside it is attributed
  assert.deepEqual(problemsOf({ nodeBundles }), [
    `${TRANSCRIPT}: staged as bin/transcript-host.cjs with no NODE_BUNDLES row, so nothing inside it is attributed`,
    `${TRANSCRIPT}: a bundle beside the executable with no NODE_BUNDLES row`,
  ]);
  assert.deepEqual(problemsOf(), []);
});

test("item 178: SD-2's case — a shell bundle staged with no notices row reads red, naming it", () => {
  const worker = "packages/electron-shell/dist/main/sound-worker.cjs";
  assert.deepEqual(problemsOf({ nodeBundles: NODE_BUNDLES.filter((b) => b.file !== worker) }), [
    `${worker}: staged as app/shell/main/sound-worker.cjs with no NODE_BUNDLES row, so nothing inside it is attributed`,
  ]);
});

test("item 178: dropping any one row of any of the three tables reads red, naming the dropped file", () => {
  const plan = mainPlan();
  const dropped = [];
  for (const b of NODE_BUNDLES) {
    const problems = problemsOf({ nodeBundles: NODE_BUNDLES.filter((x) => x !== b) });
    if (b.embeddedIn === undefined)
      assert.ok(
        problems.some((p) => p.startsWith(`${b.file}:`)),
        b.file,
      );
    else
      assert.deepEqual(problems, [], `${b.file} is embedded, never staged: no stage row reads it`);
    dropped.push(b.file);
  }
  for (const row of plan.filter((r) =>
    NODE_BUNDLES.some((b) => b.file === r.from || b.embeddedIn === r.stage),
  )) {
    const problems = problemsOf({ plan: plan.filter((x) => x !== row) });
    const named = NODE_BUNDLES.find((b) => b.embeddedIn === row.stage)?.file ?? row.from;
    assert.ok(
      problems.some((p) => p.startsWith(`${named}:`)),
      `${row.stage}: ${problems.join(" | ")}`,
    );
    dropped.push(row.stage);
  }
  for (const s of SIDECARS) {
    const problems = problemsOf({ sidecars: SIDECARS.filter((x) => x !== s) });
    assert.ok(
      problems.some((p) => p.startsWith(`${s.from}: staged from fieldd's dist/`)),
      s.from,
    );
    dropped.push(s.name);
  }
  // ten notices rows, the ten stage rows that carry or embed them, eight sidecars (CP-4a2a, 2026-11-05: the flow
  // host's bundle, flows-host.cjs, joins each table; RV #1, item 203: the agents' forwarder, agent-forwarder.cjs)
  assert.equal(dropped.length, 10 + 10 + 8, `rows dropped one at a time: ${dropped.length}`);
});

test("item 178: each sidecar declares ONE source for its notices, and only JavaScript can be a bundle", () => {
  const wasm = SIDECARS.find((s) => s.name.endsWith(".wasm"));
  const shim = SIDECARS.find((s) => s.name === "agent-shim.cjs");
  const swap = (s, notices) => SIDECARS.map((x) => (x === s ? { ...x, notices } : x));
  const one = (sidecars) => problemsOf({ sidecars });
  assert.deepEqual(one(swap(wasm, { bundle: true })), [
    `${wasm.from}: not JavaScript, so it cannot be a bundle; declare { npm } or { engine }`,
    `${wasm.from}: a bundle beside the executable with no NODE_BUNDLES row`,
  ]);
  assert.deepEqual(one(swap(shim, { npm: "puppeteer" })), [
    `${shim.from}: JavaScript beside the executable must be a bundle with its own NODE_BUNDLES row`,
  ]);
  const none = `${wasm.from}: declares no single source for its notices ({ bundle }, { npm } or { engine })`;
  assert.deepEqual(one(swap(wasm, undefined)), [none]);
  assert.deepEqual(one(swap(wasm, { npm: "loro-crdt", engine: "mille" })), [none]);
  // the committed declarations: each JavaScript sidecar a bundle; the wasm loro-crdt's; the .node mille's engine
  for (const s of SIDECARS) {
    if (/\.(?:cjs|mjs|js)$/u.test(s.name)) assert.deepEqual(s.notices, { bundle: true }, s.name);
  }
  assert.deepEqual(wasm.notices, { npm: "loro-crdt" });
  assert.deepEqual(SIDECARS.find((s) => s.name.endsWith(".node")).notices, { engine: "mille" });
});

test("item 178: an embeddedIn naming no staged row reads red", () => {
  const nodeBundles = NODE_BUNDLES.map((b) =>
    b.embeddedIn ? { ...b, embeddedIn: "bin/nothing" } : b,
  );
  assert.deepEqual(problemsOf({ nodeBundles }), [
    "packages/fieldd/dist/bin.cjs: NODE_BUNDLES says it is embedded in bin/nothing, which the stage does not ship",
  ]);
});

test("item 178: the stager's reader refuses a dist/ row it cannot read, never skips it", () => {
  const text = (from) =>
    `  {\n    stage: "bin/x.cjs",\n    from: ${from},\n    kind: "file",\n  },\n`;
  assert.deepEqual(literalStageRows(text('"packages/a/dist/x.cjs"')), {
    rows: [{ stage: "bin/x.cjs", from: "packages/a/dist/x.cjs", kind: "file" }],
    problems: [],
  });
  // a template, the shape mille's row had in the stager before this slice
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the stager's source text, read as text, never evaluated
  assert.equal(literalStageRows(text("`packages/fieldd/dist/${name}`")).problems.length, 1);
  // a computed stage beside a literal dist source
  const computed =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the stager's source text, read as text, never evaluated
    '  {\n    stage: `bin/${n}`,\n    from: "packages/a/dist/x.cjs",\n    kind: "file",\n  },\n';
  assert.equal(literalStageRows(computed).problems.length, 1);
  // a computed row that reads from no dist/ is not a bundle row, and is left to its own checks
  assert.deepEqual(literalStageRows(text("built?.path ?? null")), { rows: [], problems: [] });
  // a from: with no kind: after it
  assert.deepEqual(literalStageRows('  {\n    stage: "x",\n    from: "y",\n  },\n').problems, [
    "1 line-leading from: rows, and 0 read up to their kind:",
  ]);
});

test("item 178: the stager refuses on the check before it copies anything, on every stage, --verify included", () => {
  const check = STAGER.search(
    /\nconst rowProblems = noticesRowProblems\(\{\s*plan: PLAN,\s*sidecars: SIDECARS,\s*nodeBundles: NODE_BUNDLES,?\s*\}\);\n/u,
  );
  assert.ok(check > -1, "the check runs at the top level, on the live PLAN");
  assert.ok(check > STAGER.indexOf("\nconst PLAN = ["), "after the PLAN");
  assert.ok(check < STAGER.indexOf("copyFileSync("), "before any copy");
  assert.match(
    STAGER.slice(check, check + 600),
    /if \(rowProblems\.length > 0\) \{[\s\S]*?process\.exit\(1\);/u,
  );
  // the stager and the SEA builder spell neither the table nor mille's name of their own
  const sea = read("apps/desktop/packaging/build-fieldd-sea.mjs");
  assert.match(
    sea,
    /import \{ AGENT_SHIM_BUNDLE, MILLE_NATIVE, SIDECARS \} from "\.\/fieldd-sidecars\.mjs";/u,
  );
  for (const [path, source] of [
    ["build-fieldd-sea.mjs", sea],
    ["stage-package.mjs", STAGER],
  ]) {
    assert.doesNotMatch(
      source,
      /const SIDECARS = \[|function milleTriple|const milleNativeName|const fielddName/u,
      path,
    );
  }
});

test("item 178: the stage's notices hold each sidecar's declared source, or the release stage refuses", () => {
  assert.match(STAGER, /stageNotices\(\{[^}]*\bsidecars: SIDECARS,[^}]*\}\)/u);
  assert.deepEqual(sidecarNoticesProblems(createLedger(), SIDECARS), [
    "bin/loro_wasm_bg.wasm: its notices are loro-crdt's, and the notices hold no loro-crdt",
    `bin/${SIDECARS.find((s) => s.name.endsWith(".node")).name}: mille's native engine, and the notices hold nothing of it`,
  ]);
  const ledger = createLedger();
  ledger.add({ ecosystem: "npm", name: "loro-crdt", version: "1.0.0", role: "fieldd" });
  ledger.add({
    ecosystem: "crate",
    name: "mille-binding",
    version: "0.1.0",
    role: MILLE_ENGINE_ROLE,
  });
  assert.deepEqual(sidecarNoticesProblems(ledger, SIDECARS), []);
  // the released package's role reads as the engine too
  const released = createLedger();
  released.add({ ecosystem: "npm", name: "loro-crdt", version: "1.0.0", role: "fieldd" });
  released.add({
    ecosystem: "npm",
    name: "@vibecook/mille-darwin-arm64",
    role: `${MILLE_ENGINE_ROLE} (its released package)`,
  });
  assert.deepEqual(sidecarNoticesProblems(released, SIDECARS), []);
});

test("item 178: the test target re-runs on an edit to any table it checks", () => {
  const { inputs } = JSON.parse(read("tooling/dev-runner/project.json")).targets.test;
  for (const path of [
    "apps/desktop/packaging/fieldd-sidecars.mjs",
    "apps/desktop/packaging/build-fieldd-sea.mjs",
    "scripts/notices-rows.mjs",
    "scripts/stage-package.mjs",
    "scripts/third-party-notices.mjs",
  ]) {
    assert.ok(inputs.includes(`{workspaceRoot}/${path}`), path);
  }
});
