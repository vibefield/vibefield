// WP8d (build-wp8-bundled-plugins.md W9) — the packaged-plugins verifier, apps/desktop/packaging/verify-plugins-package.mjs,
// `--offline` over app-shaped trees: the stage's producer writes `plugins/bundled/` and `identity/` straight into a
// fixture `VibeField.app/Contents/Resources`, as electron-builder copies them. Each refusal is its own row, in words;
// the packaged fieldd's rows need a built SEA and run only from the verifier itself (`package:verify:plugins`). It lives
// here beside the producer's test (bundled-plugins.test.mjs) because the packaging scripts have no test target of
// their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERIFIER = join(REPO_ROOT, "apps/desktop/packaging/verify-plugins-package.mjs");
const PRODUCER = join(REPO_ROOT, "apps/desktop/packaging/bundled-plugins.mjs");
const work = mkdtempSync(join(tmpdir(), "vf-plugins-package-"));
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

/** A fresh app-shaped tree: the producer's DEV stage written where electron-builder puts it. */
function freshApp(name) {
  const app = join(work, name, "VibeField.app");
  const resources = join(app, "Contents", "Resources");
  const env = { ...process.env };
  delete env.VIBEFIELD_BUNDLED_INDEX_SECRET;
  const staged = spawnSync(
    process.execPath,
    [PRODUCER, "stage", "--stage", resources, "--plugins", plugins, "--app-version", "0.9.0"],
    { cwd: REPO_ROOT, encoding: "utf8", env },
  );
  assert.equal(staged.status, 0, staged.stdout + staged.stderr);
  return { app, resources };
}

function verify(app, ...flags) {
  const child = spawnSync(process.execPath, [VERIFIER, "--app", app, ...flags], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const verdict = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "");
  const row = (name) => verdict.rows?.find((r) => r.name === name);
  return { status: child.status, verdict, row, stdout: child.stdout, stderr: child.stderr };
}

test("a DEV-keyed app verifies offline: every row passed, the packaged fieldd said skipped", () => {
  const { app } = freshApp("dev");
  const result = verify(app, "--offline");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.verdict.ok, true);
  assert.equal(result.verdict.keyClass, "dev");
  assert.equal(result.verdict.appVersion, "0.9.0");
  assert.equal(result.verdict.fieldd, "skipped (--offline)");
  assert.deepEqual(result.verdict.plugins.sort(), [
    "vibefield.fixture.alpha",
    "vibefield.fixture.beta",
  ]);
  assert.deepEqual(
    result.verdict.rows.map((r) => r.name),
    [
      "layout",
      "identity",
      "key-class",
      "trust-root",
      "index",
      "plugin:vibefield.fixture.alpha",
      "plugin:vibefield.fixture.beta",
      "contents",
    ],
  );
  assert.ok(result.verdict.rows.every((r) => r.ok));
  assert.match(result.row("layout").detail, /plugins\/bundled\/bundled-plugins\.json/);
  assert.match(result.row("layout").detail, /identity\/release-identity\.json/);
});

test("--require-release-key refuses a DEV-keyed app on its key-class row", () => {
  const { app } = freshApp("dev-refused");
  const result = verify(app, "--offline", "--require-release-key");
  assert.equal(result.status, 1);
  assert.equal(result.row("key-class").ok, false);
  assert.match(result.row("key-class").detail, /KEY CLASS: DEV/);
  assert.equal(result.row("index").ok, true, "the other rows still read");
});

test("the vanishing directory: an app without identity/ is refused on its layout row", () => {
  const { app, resources } = freshApp("no-identity");
  rmSync(join(resources, "identity"), { recursive: true });
  const result = verify(app, "--offline");
  assert.equal(result.status, 1);
  assert.equal(result.row("layout").ok, false);
  assert.match(result.row("layout").detail, /identity\/release-identity\.json/);
});

test("a byte of a plugin changed in the app is refused on that plugin's row, naming the file", () => {
  const { app, resources } = freshApp("tampered");
  const js = join(resources, "plugins", "bundled", "vibefield.fixture.beta", "dist", "renderer.js");
  writeFileSync(js, "steal()\n");
  const result = verify(app, "--offline");
  assert.equal(result.status, 1);
  assert.equal(result.row("plugin:vibefield.fixture.alpha").ok, true);
  assert.equal(result.row("plugin:vibefield.fixture.beta").ok, false);
  assert.match(
    result.row("plugin:vibefield.fixture.beta").detail,
    /dist\/renderer\.js does not match the bundled index/,
  );
});

test("a trust-root no root key of the identity signed is refused on its row", () => {
  const { app, resources } = freshApp("stranger-root");
  const doc = join(resources, "identity", "trust-root.json");
  const stranger = generateKeyPairSync("ed25519").privateKey;
  writeFileSync(`${doc}.sig`, `${sign(null, readFileSync(doc), stranger).toString("base64")}\n`);
  const result = verify(app, "--offline");
  assert.equal(result.status, 1);
  assert.equal(result.row("trust-root").ok, false);
  assert.match(result.row("trust-root").detail, /signed by 0 of the app's root keys/);
});

test("anything the index and the identity do not name is refused on the contents row", () => {
  const { app, resources } = freshApp("stray");
  writeFileSync(join(resources, "plugins", "bundled", "notes.txt"), "left behind\n");
  mkdirSync(join(resources, "plugins", "dev"));
  const result = verify(app, "--offline");
  assert.equal(result.status, 1);
  assert.equal(result.row("contents").ok, false);
  assert.match(result.row("contents").detail, /plugins\/bundled\/notes\.txt/);
  assert.match(result.row("contents").detail, /plugins\/dev/);
});

test("a path that is not an application bundle is refused before any row", () => {
  const result = verify(join(work, "nowhere.app"), "--offline");
  assert.equal(result.status, 2);
  assert.equal(result.verdict.ok, false);
  assert.match(result.verdict.error, /not an application bundle/);
});
