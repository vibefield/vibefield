// WP8b (build-wp8-bundled-plugins.md §4; trust-and-distribution.md §5) — the stage's producer and verifier,
// apps/desktop/packaging/bundled-plugins.mjs, driven as the stager drives it (a child process, one JSON verdict line)
// over fixture plugins in a temporary directory. It lives here beside the stager's other guards
// (siblings-window.test.mjs) because the packaging scripts have no test target of their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PRODUCER = join(REPO_ROOT, "apps/desktop/packaging/bundled-plugins.mjs");
const work = mkdtempSync(join(tmpdir(), "vf-bundled-producer-"));
after(() => rmSync(work, { recursive: true, force: true }));

function run(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!("VIBEFIELD_BUNDLED_INDEX_SECRET" in extraEnv)) delete env.VIBEFIELD_BUNDLED_INDEX_SECRET;
  const child = spawnSync(process.execPath, [PRODUCER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  });
  const line = child.stdout.trim().split("\n").at(-1) ?? "";
  return { status: child.status, verdict: JSON.parse(line), stderr: child.stderr };
}

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

const alpha = fixturePlugin("alpha", "vibefield.fixture.alpha");
const beta = fixturePlugin("beta", "vibefield.fixture.beta");
const plugins = `${alpha},${beta}`;

function freshStage(name) {
  const stage = join(work, name);
  const staged = run(["stage", "--stage", stage, "--plugins", plugins, "--app-version", "0.9.0"]);
  assert.equal(staged.status, 0, JSON.stringify(staged.verdict));
  return { stage, staged: staged.verdict };
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath ?? d.path, d.name));
}

test("a DEV stage: both plugins staged under a signed index, a dev trust-root, and the stage verifies", () => {
  const { stage, staged } = freshStage("dev");
  assert.equal(staged.keyClass, "dev");
  assert.deepEqual(staged.plugins.sort(), ["vibefield.fixture.alpha", "vibefield.fixture.beta"]);
  const identity = JSON.parse(
    readFileSync(join(stage, "identity", "release-identity.json"), "utf8"),
  );
  assert.equal(identity.keyClass, "dev");
  assert.equal(identity.trustRootKeys.length, 2);
  const verified = run(["verify", "--stage", stage, "--plugins", plugins]);
  assert.equal(verified.status, 0, JSON.stringify(verified.verdict));
  assert.ok(verified.verdict.files.includes("identity/trust-root.json"));
  assert.ok(verified.verdict.files.includes("plugins/bundled/bundled-plugins.json.sig"));
  assert.ok(
    verified.verdict.files.includes("plugins/bundled/vibefield.fixture.alpha/dist/renderer.js"),
  );
});

test("EL7: no secret is written anywhere in a stage — every file is public", () => {
  const { stage } = freshStage("el7");
  for (const file of filesUnder(stage)) {
    const text = readFileSync(file, "utf8");
    // a base64 PKCS#8 Ed25519 secret begins MC4CAQAw…; the keygen's secrets are exactly that shape
    assert.doesNotMatch(text, /MC4CAQAw[A-Za-z0-9+/]{40,}/, `${file} carries a secret`);
  }
});

test("--require-release-key refuses a DEV stage in words", () => {
  const { stage } = freshStage("dev-refused");
  const verified = run(["verify", "--stage", stage, "--plugins", plugins, "--require-release-key"]);
  assert.equal(verified.status, 1);
  assert.match(verified.verdict.problems.join("\n"), /KEY CLASS: DEV/);
});

test("a staged copy changed after staging is refused, naming the file", () => {
  const { stage } = freshStage("tampered");
  const js = join(stage, "plugins", "bundled", "vibefield.fixture.beta", "dist", "renderer.js");
  writeFileSync(js, "steal()\n");
  const verified = run(["verify", "--stage", stage, "--plugins", plugins]);
  assert.equal(verified.status, 1);
  assert.match(
    verified.verdict.problems.join("\n"),
    /dist\/renderer\.js does not match the bundled index/,
  );
});

test("a stage older than its sources is stale, though its own index still verifies", () => {
  const { stage } = freshStage("stale");
  const source = join(alpha, "dist", "renderer.js");
  const before = readFileSync(source);
  writeFileSync(source, "export default 'rebuilt';\n");
  try {
    const verified = run(["verify", "--stage", stage, "--plugins", plugins]);
    assert.equal(verified.status, 1);
    assert.match(verified.verdict.problems.join("\n"), /is stale against/);
  } finally {
    writeFileSync(source, before);
  }
});

test("a RELEASE stage refuses while the ledger's trustRootKeys is still a TD-1 blocker", () => {
  const secret = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const staged = run(
    ["stage", "--stage", join(work, "release"), "--plugins", plugins, "--app-version", "0.9.0"],
    { VIBEFIELD_BUNDLED_INDEX_SECRET: secret },
  );
  assert.equal(staged.status, 1);
  assert.match(staged.verdict.problems.join("\n"), /trustRootKeys is not frozen/);
});
