// WP8d (build-wp8-bundled-plugins.md W7) — smoke:bundled's stager, apps/desktop/packaging/stage-bundled-fixture.mjs,
// driven as the smoke drives it (a child process running a command three times) over fixture plugins, with a probe
// for the command: what each run is handed (its own copy of the stage, keyed to that root alone, and no secret), and
// what the kit's verifier says of that copy — the root as staged verifies, the corrupted copy is refused naming the
// file, the forged index is refused by its signature. It lives here beside the producer's test
// (bundled-plugins.test.mjs) because the packaging scripts have no test target of their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STAGER = join(REPO_ROOT, "apps/desktop/packaging/stage-bundled-fixture.mjs");
const PRODUCER = join(REPO_ROOT, "apps/desktop/packaging/bundled-plugins.mjs");
const work = mkdtempSync(join(tmpdir(), "vf-bundled-smoke-fixture-"));
after(() => rmSync(work, { recursive: true, force: true }));

function fixturePlugin(name, id) {
  const root = join(work, "src", name);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "vibefield.plugin.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id,
        version: "0.1.0",
        title: id,
        engines: { app: ">=0.0.0", contracts: "^0.1.0" },
        entries: { renderer: "./dist/renderer.js" },
        activation: [`onObject:${id}.card`],
        capabilities: [],
        contributes: {
          objects: [
            {
              type: `${id}.card`,
              title: "Card",
              schemaVersion: 1,
              size: { w: 200, h: 120 },
              provides: ["desk.object"],
              binding: { kind: "card" },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, "dist", "renderer.js"), `export default "${id}";\n`);
  return root;
}

const plugins = [
  fixturePlugin("alpha", "vibefield.fixture.alpha"),
  fixturePlugin("beta", "vibefield.fixture.beta"),
].join(",");

// The command each run gets: it says what it was handed and what the producer's own verifier says of its copy.
const PROBE = join(work, "probe.mjs");
writeFileSync(
  PROBE,
  `import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
const env = process.env;
const fixture = JSON.parse(env.VF_BUNDLED_FIXTURE);
const stage = dirname(dirname(env.FIELDD_PLUGIN_ROOTS));
const run = spawnSync(process.execPath, [${JSON.stringify(PRODUCER)}, "verify", "--stage", stage, "--plugins", ${JSON.stringify(plugins)}], { encoding: "utf8" });
const verdict = JSON.parse(run.stdout.trim().split("\\n").at(-1));
console.log("PROBE " + JSON.stringify({
  fixture,
  roots: env.FIELDD_PLUGIN_ROOTS,
  devRoots: env.FIELDD_PLUGIN_DEV_ROOTS,
  trustRoot: env.FIELDD_TRUST_ROOT,
  keys: env.FIELDD_TRUST_ROOT_KEYS,
  secret: env.VIBEFIELD_BUNDLED_INDEX_SECRET ?? null,
  verdict,
}));
process.exit(fixture.run === env.PROBE_FAIL_RUN ? 3 : 0);
`,
);

function stager(args, extraEnv = {}) {
  const child = spawnSync(process.execPath, [STAGER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  const lines = (prefix) =>
    child.stdout
      .split("\n")
      .filter((line) => line.startsWith(`${prefix} `))
      .map((line) => JSON.parse(line.slice(prefix.length + 1)));
  return { status: child.status, stderr: child.stderr, lines };
}

test("both stagers take the bundled list from its one home (bundled-list.mjs)", () => {
  for (const path of [STAGER, join(REPO_ROOT, "scripts/stage-package.mjs")]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /import \{ BUNDLED_PLUGINS \} from "[^"]*bundled-list\.mjs"/u, path);
    assert.doesNotMatch(source, /const BUNDLED_PLUGINS =/u, `${path} restates the list`);
  }
});

test("three runs, each on its own copy keyed to that root alone: it loads, a corrupted copy, a forged index", () => {
  // a secret in the launching shell reaches neither the producer (the stage stays DEV) nor any run (EL7)
  const result = stager(["--plugins", plugins, "--", process.execPath, PROBE], {
    VIBEFIELD_BUNDLED_INDEX_SECRET: "not-a-secret",
  });
  assert.equal(result.status, 0, result.stderr);
  const [fixture] = result.lines("BUNDLED_FIXTURE");
  assert.equal(fixture.keyClass, "dev");
  assert.deepEqual(fixture.plugins, ["vibefield.fixture.alpha", "vibefield.fixture.beta"]);
  assert.deepEqual(fixture.renderers, fixture.plugins);
  assert.deepEqual(fixture.corrupt, { id: "vibefield.fixture.alpha", path: "dist/renderer.js" });

  const probes = result.lines("PROBE");
  assert.deepEqual(
    probes.map((p) => p.fixture.run),
    ["loads", "corrupt", "forged"],
  );
  const roots = new Set();
  for (const probe of probes) {
    assert.equal(probe.secret, null, `${probe.fixture.run} was handed the secret`);
    assert.equal(probe.devRoots, "");
    assert.equal(probe.roots, probe.fixture.root);
    assert.ok(probe.roots.endsWith(join(probe.fixture.run, "plugins", "bundled")));
    assert.equal(
      probe.trustRoot,
      join(dirname(dirname(probe.roots)), "identity", "trust-root.json"),
    );
    assert.equal(probe.keys.split(",").length, 2);
    assert.deepEqual(probe.fixture.plugins, fixture.plugins);
    roots.add(probe.roots);
  }
  assert.equal(roots.size, 3, "every run has its own copy");

  const [loads, corrupt, forged] = probes;
  assert.equal(loads.fixture.corrupted, null);
  assert.equal(loads.verdict.ok, true, JSON.stringify(loads.verdict));
  assert.deepEqual(corrupt.fixture.corrupted, fixture.corrupt);
  assert.equal(corrupt.verdict.ok, false);
  assert.match(
    corrupt.verdict.problems.join("\n"),
    /vibefield\.fixture\.alpha: dist\/renderer\.js does not match the bundled index/,
  );
  assert.doesNotMatch(corrupt.verdict.problems.join("\n"), /vibefield\.fixture\.beta:/);
  assert.equal(forged.verdict.ok, false);
  assert.match(forged.verdict.problems.join("\n"), /signature does not verify/);

  assert.deepEqual(result.lines("BUNDLED_FIXTURE_DONE")[0], {
    runs: { loads: 0, corrupt: 0, forged: 0 },
  });
  const [removed] = result.lines("BUNDLED_FIXTURE_REMOVED");
  assert.equal(removed.root, fixture.root);
  assert.equal(existsSync(fixture.root), false, "the temporary stage outlived the runs");
});

test("a red run is the stager's exit, and the runs after it still run", () => {
  const result = stager(["--plugins", plugins, "--", process.execPath, PROBE], {
    PROBE_FAIL_RUN: "corrupt",
  });
  assert.equal(result.status, 3);
  assert.deepEqual(result.lines("BUNDLED_FIXTURE_DONE")[0], {
    runs: { loads: 0, corrupt: 3, forged: 0 },
  });
  assert.equal(existsSync(result.lines("BUNDLED_FIXTURE")[0].root), false);
});

test("--runs picks runs by name; an unknown run or a missing command is refused", () => {
  const one = stager(["--plugins", plugins, "--runs", "forged", "--", process.execPath, PROBE]);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(
    one.lines("PROBE").map((p) => p.fixture.run),
    ["forged"],
  );
  assert.equal(stager(["--plugins", plugins, "--runs", "melted", "--", "true"]).status, 2);
  assert.equal(stager(["--plugins", plugins]).status, 2);
});
