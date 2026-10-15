#!/usr/bin/env node
// WP8b (build-wp8-bundled-plugins.md §4 as amended by trust-and-distribution.md §5) — the producer and verifier of a
// stage's two signed outputs, called by scripts/stage-package.mjs (which is builtins-only, so it spawns this):
//   plugins/bundled/   each first-party plugin's §5.2 members + bundled-plugins.json(.sig), signed by the
//                      trust-root's `bundled` role (the kit's buildBundledIndex / verifyBundledIndex — the ONE verifier
//                      fieldd also runs)
//   identity/          trust-root.json(.sig) and release-identity.json (StagedReleaseIdentity: the key class and the
//                      root keys the shell hands fieldd)
//
// The KEY decides the class (WP8-D4): VIBEFIELD_BUNDLED_INDEX_SECRET set → a RELEASE stage, which needs James's
// embedded trust-root (TD-1: apps/desktop/packaging/trust-root.json, its root keys the ledger's frozen trustRootKeys)
// and a secret whose public half IS that document's `bundled` key. Unset → a DEV stage: five keys minted in memory
// (scripts/trust-keygen.mjs), a dev trust-root signed by its own root, the index signed by its bundled key, and every
// secret dropped when this process exits — none is ever written (EL7).
//
// Usage (the stager's calls; stdout is ONE JSON line, the verdict):
//   node apps/desktop/packaging/bundled-plugins.mjs stage  --stage <dir> --plugins <a,b> --app-version <v>
//   node apps/desktop/packaging/bundled-plugins.mjs verify --stage <dir> --plugins <a,b> [--require-release-key]
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The workspace's sources run as plugin-build's bin runs them: Node strips the types, and an extensionless relative
// import is retried as `.ts` (stage-kind-fixtures.mjs's recipe, one answer in the repo).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const { buildBundledIndex, verifyBundledIndex } = await load(
  "tooling/plugin-build/src/bundled-index.ts",
);
const { verifyTrustRoot } = await load("tooling/plugin-build/src/trust.ts");
const { listBundleMembers } = await load("tooling/plugin-build/src/pack.ts");
const contracts = await load("packages/contracts/src/index.ts");
const keygen = await load("scripts/trust-keygen.mjs");

const {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
  IDENTITY_DIR,
  RELEASE_IDENTITY_FILE,
} = contracts;
const TRUST_ROOT = contracts.TRUST_ROOT_FILE;
const SIG = contracts.SIGNATURE_SUFFIX;
const LEDGER = "apps/desktop/packaging/release-identity.json";
const EMBEDDED = "apps/desktop/packaging/trust-root.json";
const SECRET_ENV = "VIBEFIELD_BUNDLED_INDEX_SECRET";
const DATA_MODE = 0o644;

/** A plugin named repo-relative (the stager's list) or absolute (a test's fixture). */
const pluginDir = (rel) => (isAbsolute(rel) ? rel : join(repo, rel));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (name === "require-release-key") out[name] = true;
    else out[name] = argv[++i];
  }
  return out;
}

const ledger = () => JSON.parse(readFileSync(join(repo, LEDGER), "utf8"));
const frozenRootKeys = (l) =>
  l.fields?.trustRootKeys?.status === "frozen" ? l.fields.trustRootKeys.value : null;

/** The release trust-root: the embedded document, verified against the ledger's frozen root keys. */
function releaseTrustRoot() {
  const keys = frozenRootKeys(ledger());
  if (keys === null)
    refuse(
      `${SECRET_ENV} is set, but ${LEDGER}'s trustRootKeys is not frozen — a release stage needs James's trust-root (TD-1)`,
    );
  if (!existsSync(join(repo, EMBEDDED)) || !existsSync(join(repo, EMBEDDED + SIG)))
    refuse(
      `${SECRET_ENV} is set, but ${EMBEDDED}(.sig) is missing — embed the trust-root first (trust-keygen embed)`,
    );
  const bytes = readFileSync(join(repo, EMBEDDED));
  const sigText = readFileSync(join(repo, EMBEDDED + SIG), "utf8");
  const verdict = verifyTrustRoot(bytes, sigText, { keys, threshold: 1 });
  if (!verdict.ok) refuse(`the embedded trust-root does not verify: ${verdict.reason}`);
  return { bytes, sigText, doc: verdict.doc, rootKeys: keys };
}

/** A dev trust-root for ONE stage: five keys minted here, the document signed by its own root; only public halves
 * leave this function's caller, and nothing secret is ever written. */
function devTrustRoot() {
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
  return {
    bytes,
    sigText: keygen.signTrustRoot(bytes, "", rootA.secretKey),
    doc,
    rootKeys: doc.root.keys,
    bundledSecret: bundled.secretKey,
  };
}

function chmodTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) chmodTree(abs);
    else chmodSync(abs, DATA_MODE);
  }
}

async function stage({ stage: stageDir, plugins, "app-version": appVersion }) {
  if (!stageDir || !plugins || !appVersion)
    refuse("stage needs --stage, --plugins and --app-version");
  const secret = process.env[SECRET_ENV];
  const keyClass = secret ? "release" : "dev";
  let trust;
  let bundledSecret;
  if (keyClass === "release") {
    trust = releaseTrustRoot();
    if (!trust.doc.roles.bundled.keys.includes(keygen.publicKeyOf(secret)))
      refuse(`${SECRET_ENV}'s public half is not the trust-root's bundled key`);
    bundledSecret = secret;
  } else {
    trust = devTrustRoot();
    bundledSecret = trust.bundledSecret;
  }
  const root = join(stageDir, "plugins", "bundled");
  const result = await buildBundledIndex({
    stageRoot: root,
    plugins: plugins.split(",").map((rel) => ({ rootDir: pluginDir(rel) })),
    appVersion,
    secretKey: bundledSecret,
  });
  const identityDir = join(stageDir, IDENTITY_DIR);
  mkdirSync(identityDir, { recursive: true });
  writeFileSync(join(identityDir, TRUST_ROOT), trust.bytes);
  writeFileSync(join(identityDir, TRUST_ROOT + SIG), trust.sigText);
  const l = ledger();
  const identity = contracts.StagedReleaseIdentity.parse({
    schemaVersion: 1,
    keyClass,
    identityRevision: l.identityRevision,
    trustRootKeys: trust.rootKeys,
    appId: l.fields.appId.value,
    productName: l.fields.productName.value,
    updateChannel: l.fields.updateChannel.value,
    updateOrigin: l.fields.updateOrigin.value,
    // WP12's build-time floor: the updater never accepts a signed document below what this build was staged with.
    // The trust-root's version is known here; the channel heads have no build-time source; each channel policy's floor
    // joins when WP12d stages the committed policy sources.
    updateFloors: {
      trustRoot: trust.doc.version,
      channels: null,
      policy: { nightly: null, beta: null, stable: null },
    },
  });
  writeFileSync(join(identityDir, RELEASE_IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`);
  chmodTree(root);
  chmodTree(identityDir);
  return { ok: true, keyClass, plugins: Object.keys(result.index.plugins) };
}

async function verify({ stage: stageDir, plugins, "require-release-key": requireRelease }) {
  if (!stageDir || !plugins) refuse("verify needs --stage and --plugins");
  const problems = [];
  const files = [];
  const identityDir = join(stageDir, IDENTITY_DIR);
  const read = (path) => (existsSync(path) ? readFileSync(path) : null);
  const identityBytes = read(join(identityDir, RELEASE_IDENTITY_FILE));
  const docBytes = read(join(identityDir, TRUST_ROOT));
  const sigBytes = read(join(identityDir, TRUST_ROOT + SIG));
  for (const [name, bytes] of [
    [RELEASE_IDENTITY_FILE, identityBytes],
    [TRUST_ROOT, docBytes],
    [TRUST_ROOT + SIG, sigBytes],
  ]) {
    if (bytes === null) problems.push(`${IDENTITY_DIR}/${name} is missing`);
    else files.push(`${IDENTITY_DIR}/${name}`);
  }
  if (problems.length > 0) return { ok: false, keyClass: null, plugins: [], files, problems };

  const parsed = contracts.StagedReleaseIdentity.safeParse(
    JSON.parse(identityBytes.toString("utf8")),
  );
  if (!parsed.success)
    return {
      ok: false,
      keyClass: null,
      plugins: [],
      files,
      problems: [`${RELEASE_IDENTITY_FILE} is malformed: ${parsed.error.issues[0]?.message}`],
    };
  const identity = parsed.data;
  if (identity.keyClass === "dev" && requireRelease)
    problems.push(
      "KEY CLASS: DEV — a release stage must be signed with the release keys (set VIBEFIELD_BUNDLED_INDEX_SECRET; TD-1)",
    );
  if (identity.keyClass === "release") {
    const keys = frozenRootKeys(ledger());
    if (keys === null || !sameSet(keys, identity.trustRootKeys))
      problems.push(`a release stage's root keys are not the ledger's frozen trustRootKeys`);
    const embedded = read(join(repo, EMBEDDED));
    if (embedded === null || !embedded.equals(docBytes))
      problems.push(`a release stage's trust-root is not the embedded ${EMBEDDED}`);
  }
  const trust = verifyTrustRoot(docBytes, sigBytes.toString("utf8"), {
    keys: identity.trustRootKeys,
    threshold: 1,
  });
  if (!trust.ok) {
    problems.push(`${IDENTITY_DIR}/${TRUST_ROOT}: ${trust.reason}`);
    return { ok: false, keyClass: identity.keyClass, plugins: [], files, problems };
  }
  if (trust.signers.length < trust.doc.root.threshold)
    problems.push(
      `${IDENTITY_DIR}/${TRUST_ROOT}: ${trust.signers.length} root signature(s); its threshold is ${trust.doc.root.threshold}`,
    );

  const root = join(stageDir, "plugins", "bundled");
  const verdict = await verifyBundledIndex({ root, trust: trust.doc.roles.bundled });
  if (!verdict.ok) {
    problems.push(`plugins/bundled: ${verdict.reason}`);
    return { ok: false, keyClass: identity.keyClass, plugins: [], files, problems };
  }
  files.push(
    `plugins/bundled/${BUNDLED_PLUGIN_INDEX_FILE}`,
    `plugins/bundled/${BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE}`,
  );
  for (const dir of verdict.unlisted)
    problems.push(`plugins/bundled/${dir}/ is not in the bundled index`);
  const wanted = new Map();
  for (const rel of plugins.split(",")) {
    const manifest = JSON.parse(
      readFileSync(join(pluginDir(rel), "vibefield.plugin.json"), "utf8"),
    );
    wanted.set(manifest.id, pluginDir(rel));
  }
  if (!sameSet(wanted.keys(), verdict.plugins.keys()))
    problems.push(
      `the bundled index lists ${[...verdict.plugins.keys()].join(", ") || "nothing"}, the stager names ${[...wanted.keys()].join(", ")}`,
    );
  for (const [id, plugin] of verdict.plugins) {
    if (!plugin.ok) problems.push(`plugins/bundled/${id}: ${plugin.reason}`);
    for (const path of Object.keys(plugin.entry.files)) files.push(`plugins/bundled/${id}/${path}`);
    // The stage is compared against what the SOURCES say now, like every other stager row: a stage whose plugin
    // bytes predate a rebuild is stale even though its own index still verifies.
    const source = wanted.get(id);
    if (source === undefined) continue;
    const members = listBundleMembers(source);
    if (!sameSet(members, Object.keys(plugin.entry.files)))
      problems.push(`plugins/bundled/${id}: its files are not the source's §5.2 members — restage`);
    else
      for (const member of members)
        if (sha256(readFileSync(join(source, ...member.split("/")))) !== plugin.entry.files[member])
          problems.push(`plugins/bundled/${id}/${member} is stale against ${source} — restage`);
  }
  return {
    ok: problems.length === 0,
    keyClass: identity.keyClass,
    plugins: [...verdict.plugins.keys()],
    files,
    problems,
  };
}

const [command, ...rest] = process.argv.slice(2);
try {
  const f = flags(rest);
  const out =
    command === "stage"
      ? await stage(f)
      : command === "verify"
        ? await verify(f)
        : refuse("usage: stage|verify …");
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(out.ok ? 0 : 1);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, problems: [error instanceof Refusal ? error.message : String(error?.stack ?? error)] })}\n`,
  );
  process.exit(error instanceof Refusal ? 1 : 2);
}
