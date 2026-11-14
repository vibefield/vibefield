// MK-6 — smoke:market's stager, apps/desktop/packaging/stage-market-fixture.mjs, driven as the
// smoke drives it (a child process running a command once a run) over two fixture plugins
// (`--plugins`: nothing is built), with a probe for the command: what each run is handed (its own
// copy of the list, keyed to it alone through fieldd's development seam, no dev roots, and nothing
// secret, even when the launching shell holds a secret) and what that copy holds — the list as
// signed verifies against the key the run was handed and every pin matches its bytes; the tampered
// copy's artifact misses its pin; the forged copy's signature is a stranger's; the offline address
// names no file; the update's second list verifies and moves VibeField's own on. Its last line,
// MARKET_FIXTURE_DONE, says each run's exit and its parked rows by name (C36). It lives beside
// bundled-smoke-fixture.test.mjs, for the packaging scripts have no test target of their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STAGER = join(REPO_ROOT, "apps/desktop/packaging/stage-market-fixture.mjs");
const work = mkdtempSync(join(tmpdir(), "vf-market-smoke-fixture-"));
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
        title: name,
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
              tray: { category: "things", label: "Card" },
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

const OWN = "vibefield.fixture.own";
const THEIRS = "acme.fixture-theirs";
const plugins = [fixturePlugin("Own", OWN), fixturePlugin("Theirs", THEIRS)].join(",");

// The command each run gets: what it was handed, and what its copy of the list holds, read with
// node:crypto alone (the list's signature over its exact bytes, and each pin over its file's).
const PROBE = join(work, "probe.mjs");
writeFileSync(
  PROBE,
  `import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const env = process.env;
const fixture = JSON.parse(env.VF_MARKET_FIXTURE);
const key = createPublicKey({ key: Buffer.from(env.FIELDD_PLUGIN_REGISTRY_KEY, "base64"), format: "der", type: "spki" });
const signed = (file) => verify(null, readFileSync(file), key, Buffer.from(readFileSync(file + ".sig", "utf8").trim(), "base64"));
const pinned = (base, path, pin) => "sha256:" + createHash("sha256").update(readFileSync(join(base, path))).digest("hex") === pin;
const list = fileURLToPath(env.FIELDD_PLUGIN_REGISTRY_URL);
const facts = { fixture, devRoots: env.FIELDD_PLUGIN_DEV_ROOTS, exists: existsSync(list) };
if (facts.exists) {
  const index = JSON.parse(readFileSync(list, "utf8"));
  const base = dirname(list);
  facts.verifies = signed(list);
  facts.rungs = Object.fromEntries(Object.entries(index.plugins).map(([id, e]) => [id, e.rung ?? null]));
  facts.featured = index.featured;
  facts.artifacts = Object.fromEntries(Object.entries(index.plugins).map(([id, e]) => [id, pinned(base, e.latest.artifactUrl, e.latest.sha256)]));
  const pictures = Object.values(index.plugins).flatMap((e) => [e.listing.spread.day, e.listing.spread.night, ...e.listing.objects.flatMap((o) => [o.stills.day, o.stills.night])]);
  facts.pictures = pictures.every((p) => pinned(base, p.path, p.sha256));
  if (fixture.next !== null) {
    const next = JSON.parse(readFileSync(fixture.next.index, "utf8"));
    facts.next = { verifies: signed(fixture.next.index), latest: next.plugins[fixture.vibefield.id].latest.version, later: next.generatedAt > index.generatedAt };
  }
}
facts.privateKeyInEnv = Object.values(env).some((v) => typeof v === "string" && v.startsWith("MC4CAQAw"));
console.log("PROBE " + JSON.stringify(facts));
process.exit(fixture.run === env.PROBE_FAIL_RUN ? 3 : 0);
`,
);

function stager(args, extraEnv = {}) {
  const child = spawnSync(process.execPath, [STAGER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // the shell's own VF_MARKET_ROWS never narrows these runs: the DONE line's parked rows are
    // the runs' defaults unless a test names its own
    env: { ...process.env, VF_MARKET_ROWS: "", ...extraEnv },
  });
  const lines = (prefix) =>
    child.stdout
      .split("\n")
      .filter((line) => line.startsWith(`${prefix} `))
      .map((line) => JSON.parse(line.slice(prefix.length + 1)));
  return { status: child.status, stderr: child.stderr, lines };
}

test("five runs, each on its own copy of a list signed by dev keys, keyed to it alone", () => {
  // a list the launching shell named reaches no run: each run is handed its own; nor does either
  // secret the packaging scripts read (stand-ins in a private key's shape, which the probe seeks)
  const shaped = `MC4CAQAwBQYDK2VwBCIEI${"A".repeat(43)}`;
  const result = stager(["--plugins", plugins, "--", process.execPath, PROBE], {
    FIELDD_PLUGIN_REGISTRY_URL: "file:///nowhere/index.json",
    FIELDD_PLUGIN_REGISTRY_KEY: "not-a-key",
    VIBEFIELD_BUNDLED_INDEX_SECRET: shaped,
    VIBEFIELD_SMOKE_BUNDLED_SECRET: shaped,
  });
  assert.equal(result.status, 0, result.stderr);
  const [staged] = result.lines("MARKET_FIXTURE");
  assert.equal(staged.keyClass, "dev");
  assert.deepEqual(staged.plugins, [OWN, THEIRS]);
  assert.deepEqual(staged.featured, [OWN]);

  const probes = result.lines("PROBE");
  assert.deepEqual(
    probes.map((p) => p.fixture.run),
    ["listed", "tampered", "forged", "offline", "update"],
  );
  const lists = new Set();
  for (const probe of probes) {
    assert.equal(probe.devRoots, "");
    assert.equal(probe.privateKeyInEnv, false, `${probe.fixture.run} was handed a private key`);
    assert.notEqual(probe.fixture.list, "file:///nowhere/index.json");
    assert.equal(probe.fixture.vibefield.id, OWN);
    assert.deepEqual(probe.fixture.vibefield.objects, [
      { type: `${OWN}.card`, label: "Card", category: "things" },
    ]);
    assert.equal(probe.fixture.community.id, THEIRS);
    lists.add(probe.fixture.list);
  }
  assert.equal(lists.size, 5, "every run has its own copy");

  const [listed, tampered, forged, offline, update] = probes;
  assert.equal(listed.verifies, true);
  assert.deepEqual(listed.rungs, { [OWN]: "R1", [THEIRS]: null });
  assert.deepEqual(listed.featured, [OWN]);
  assert.deepEqual(listed.artifacts, { [OWN]: true, [THEIRS]: true });
  assert.equal(listed.pictures, true);
  assert.equal(listed.fixture.next, null);

  assert.equal(tampered.verifies, true, "a tampered artifact leaves the list verifying");
  assert.deepEqual(tampered.artifacts, { [OWN]: false, [THEIRS]: true });

  assert.equal(forged.verifies, false, "a stranger's signature does not verify");
  assert.deepEqual(forged.artifacts, { [OWN]: true, [THEIRS]: true });

  assert.equal(offline.exists, false);

  assert.equal(update.verifies, true);
  assert.deepEqual(update.next, { verifies: true, latest: "0.2.0", later: true });
  assert.equal(update.fixture.next.version, "0.2.0");
  assert.deepEqual(update.fixture.next.asks, ["canvas.write"]);

  // every run's exit, and listed's two parked rows by name (C36): the line the landing gate quotes
  assert.deepEqual(result.lines("MARKET_FIXTURE_DONE")[0], {
    runs: { listed: 0, tampered: 0, forged: 0, offline: 0, update: 0 },
    parked: { listed: ["PICTURES", "CARRY"] },
  });
  const [removed] = result.lines("MARKET_FIXTURE_REMOVED");
  assert.equal(removed.root, staged.root);
  assert.equal(existsSync(staged.root), false, "the temporary list outlived the runs");
});

test("a red run is the stager's exit, and the runs after it still run", () => {
  const result = stager(["--plugins", plugins, "--", process.execPath, PROBE], {
    PROBE_FAIL_RUN: "forged",
  });
  assert.equal(result.status, 3);
  assert.deepEqual(result.lines("MARKET_FIXTURE_DONE")[0], {
    runs: { listed: 0, tampered: 0, forged: 3, offline: 0, update: 0 },
    parked: { listed: ["PICTURES", "CARRY"] },
  });
  assert.equal(existsSync(result.lines("MARKET_FIXTURE")[0].root), false);
});

test("--runs picks runs by name; an unknown run, a third plugin or a missing command is refused", () => {
  const one = stager(["--plugins", plugins, "--runs", "offline", "--", process.execPath, PROBE]);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(
    one.lines("PROBE").map((p) => p.fixture.run),
    ["offline"],
  );
  assert.equal(stager(["--plugins", plugins, "--runs", "melted", "--", "true"]).status, 2);
  assert.equal(stager(["--plugins", `${plugins},${plugins}`, "--", "true"]).status, 2);
  assert.equal(stager(["--plugins", plugins]).status, 2);
});

test("the DONE line names the parked rows a run leaves out, and none it runs (C36)", () => {
  const only = (run, env) =>
    stager(["--plugins", plugins, "--runs", run, "--", process.execPath, PROBE], env);
  // named, a parked row runs and is no longer said; the one not named still is
  const named = only("listed", { VF_MARKET_ROWS: "CARRY" });
  assert.equal(named.status, 0, named.stderr);
  assert.deepEqual(named.lines("MARKET_FIXTURE_DONE")[0], {
    runs: { listed: 0 },
    parked: { listed: ["PICTURES"] },
  });
  // a run that parks nothing says so with an empty object, never a missing key
  const offline = only("offline");
  assert.equal(offline.status, 0, offline.stderr);
  assert.deepEqual(offline.lines("MARKET_FIXTURE_DONE")[0], { runs: { offline: 0 }, parked: {} });
});
