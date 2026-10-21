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
import * as keygen from "../../../scripts/trust-keygen.mjs";

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

// TD-1 (2026-10-21): the ledger's trustRootKeys is frozen and James's trust-root is embedded, so a release stage now
// passes the blocker refusal and verifies the embedded document; its remaining guard is the key. (The "not frozen"
// refusal stays in the producer but is unreachable against this ledger: check-release-identity forbids thawing it.)
test("a RELEASE stage refuses a secret that is not the embedded trust-root's bundled key (TD-1)", () => {
  const secret = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const staged = run(
    ["stage", "--stage", join(work, "release"), "--plugins", plugins, "--app-version", "0.9.0"],
    { VIBEFIELD_BUNDLED_INDEX_SECRET: secret },
  );
  assert.equal(staged.status, 1);
  assert.match(
    staged.verdict.problems.join("\n"),
    /VIBEFIELD_BUNDLED_INDEX_SECRET's public half is not the trust-root's bundled key/,
  );
});

// WP12 L4 (R1; build-wp12-updater.md §14, the PM's ruling 2026-10-15 21:41Z) — `smoke:update`'s trust-root for a DEV
// stage: the root-signed document as a file, its bundled key in the producer's environment only; never a release stage's.
function smokeRoot(name) {
  const [rootA, rootB, release, bundled, registry] = Array.from({ length: 5 }, () =>
    keygen.generateKeypair(),
  );
  const doc = keygen.assembleTrustRoot({
    root: [rootA.publicKey, rootB.publicKey],
    release: [release.publicKey],
    bundled: [bundled.publicKey],
    registry: [registry.publicKey],
  });
  const bytes = Buffer.from(keygen.canonicalJson(doc));
  const path = join(work, `${name}-trust-root.json`);
  writeFileSync(path, bytes);
  writeFileSync(`${path}.sig`, keygen.signTrustRoot(bytes, "", rootA.secretKey));
  return { path, doc, bundledSecret: bundled.secretKey, stranger: release.secretKey };
}

const smokeStageArgs = (stage, rootPath) => [
  "stage",
  "--stage",
  stage,
  "--plugins",
  plugins,
  "--app-version",
  "0.9.0",
  "--dev-trust-root",
  rootPath,
];

test("--dev-trust-root: a DEV stage on the smoke's trust-root — its root keys embedded, the index by its bundled key", () => {
  const root = smokeRoot("smoke");
  const stage = join(work, "smoke");
  const staged = run(smokeStageArgs(stage, root.path), {
    VIBEFIELD_SMOKE_BUNDLED_SECRET: root.bundledSecret,
  });
  assert.equal(staged.status, 0, JSON.stringify(staged.verdict));
  assert.equal(staged.verdict.keyClass, "dev");
  assert.equal(staged.verdict.trust, "smoke");
  const identity = JSON.parse(
    readFileSync(join(stage, "identity", "release-identity.json"), "utf8"),
  );
  assert.equal(identity.keyClass, "dev");
  assert.deepEqual(identity.trustRootKeys, root.doc.root.keys);
  assert.deepEqual(
    readFileSync(join(stage, "identity", "trust-root.json")),
    readFileSync(root.path),
  );
  const verified = run(["verify", "--stage", stage, "--plugins", plugins]);
  assert.equal(verified.status, 0, JSON.stringify(verified.verdict));
  // EL7: the smoke's key reached the stage only as signatures — never as bytes on disk
  for (const file of filesUnder(stage))
    assert.ok(!readFileSync(file, "utf8").includes(root.bundledSecret), `${file} carries the key`);
});

test("EL7: a RELEASE stage refuses --dev-trust-root — the release switch set means James's trust-root only", () => {
  const root = smokeRoot("smoke-release");
  const staged = run(smokeStageArgs(join(work, "smoke-release"), root.path), {
    VIBEFIELD_SMOKE_BUNDLED_SECRET: root.bundledSecret,
    VIBEFIELD_BUNDLED_INDEX_SECRET: root.bundledSecret,
  });
  assert.equal(staged.status, 1);
  assert.match(
    staged.verdict.problems.join("\n"),
    /--dev-trust-root is a DEV stage's: VIBEFIELD_BUNDLED_INDEX_SECRET is set, which makes this a release stage — a release stage stages only James's trust-root \(TD-1\)/,
  );
});

test("--dev-trust-root refuses without the smoke's bundled key, and with a key that is not the document's", () => {
  const root = smokeRoot("smoke-keys");
  const missing = run(smokeStageArgs(join(work, "smoke-nokey"), root.path));
  assert.equal(missing.status, 1);
  assert.match(missing.verdict.problems.join("\n"), /needs VIBEFIELD_SMOKE_BUNDLED_SECRET/);
  const wrong = run(smokeStageArgs(join(work, "smoke-wrongkey"), root.path), {
    VIBEFIELD_SMOKE_BUNDLED_SECRET: root.stranger,
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.verdict.problems.join("\n"), /is not the smoke trust-root's bundled key/);
});

test("--dev-trust-root refuses a document its own root did not sign", () => {
  const root = smokeRoot("smoke-unsigned");
  writeFileSync(`${root.path}.sig`, "");
  const staged = run(smokeStageArgs(join(work, "smoke-unsigned"), root.path), {
    VIBEFIELD_SMOKE_BUNDLED_SECRET: root.bundledSecret,
  });
  assert.equal(staged.status, 1);
  assert.match(staged.verdict.problems.join("\n"), /does not verify/);
});
