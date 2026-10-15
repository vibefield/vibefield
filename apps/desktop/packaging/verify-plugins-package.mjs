#!/usr/bin/env node
// WP8d (build-wp8-bundled-plugins.md W9; §10 addendum, "WP8d, the packaged witness's shape") — the app's own plugins
// as the BUILT app carries them. There is no source to compare against here, only the app: its
// `Contents/Resources/identity/` (the staged trust-root, its signatures, release-identity.json) and
// `Contents/Resources/plugins/bundled/` (each plugin's staged files and the signed index), each checked with the kit's
// ONE verifier — the same calls fieldd makes at every registry refresh:
//   layout     the five files present as regular files (electron-builder drops an empty folder: the vanishing-directory
//              check);
//   identity   release-identity.json parses (StagedReleaseIdentity);
//   key-class  a RELEASE identity's root keys are the ledger's frozen trustRootKeys and its trust-root is the embedded
//              apps/desktop/packaging/trust-root.json; `--require-release-key` refuses a DEV identity;
//   trust-root the document verifies against the identity's root keys, at its own root threshold;
//   index      the index verifies against the document's `bundled` role, and lists at least one plugin;
//   plugin:<id> each listed plugin's file set and bytes;
//   contents   nothing in identity/, plugins/ or plugins/bundled/ the index and the identity do not name.
// Then, unless `--offline`, the packaged fieldd itself (packages/fieldd/test/packaged-plugins.test.ts, opt-in through
// FIELDD_TEST_PLUGINS_PACKAGE): the SEA from `Resources/bin` behind the mock floor, keyed as the packaged shell keys it —
// every row of its JSON report must have PASSED (the history verifier's rule: a skip would read as a pass).
//
// Usage: node packaging/verify-plugins-package.mjs --app <VibeField.app> [--require-release-key] [--offline]
// Prints one line per row and, last, ONE JSON verdict line; exits 0 only when every row passed.
import { spawn } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const LEDGER = join(desktopRoot, "packaging", "release-identity.json");
const EMBEDDED = join(desktopRoot, "packaging", "trust-root.json");
const GATE = "WP8-plugins-package";

function usage(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, gate: GATE, error: message })}\n`);
  process.stderr.write(
    "usage: verify-plugins-package.mjs --app <VibeField.app> [--require-release-key] [--offline]\n",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const requireRelease = args.includes("--require-release-key");
const offline = args.includes("--offline");
const positional = args.filter((arg) => arg !== "--require-release-key" && arg !== "--offline");
if (positional.length !== 2 || positional[0] !== "--app")
  usage("--app <VibeField.app> is required");
const appPath = resolve(positional[1]);
const resources = join(appPath, "Contents", "Resources");
if (!isDirectory(resources))
  usage(`${appPath} is not an application bundle (no Contents/Resources)`);

// The workspace's sources run as plugin-build's bin runs them (bundled-plugins.mjs's recipe): Node strips the types,
// and an extensionless relative import is retried as `.ts`.
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
const load = (rel) => import(pathToFileURL(join(repoRoot, rel)).href);
const contracts = await load("packages/contracts/src/index.ts");
const { verifyBundledIndex } = await load("tooling/plugin-build/src/bundled-index.ts");
const { verifyTrustRoot } = await load("tooling/plugin-build/src/trust.ts");
const {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
  IDENTITY_DIR,
  RELEASE_IDENTITY_FILE,
  SIGNATURE_SUFFIX,
  TRUST_ROOT_FILE,
} = contracts;

const identityDir = join(resources, IDENTITY_DIR);
const pluginsDir = join(resources, "plugins");
const bundledRoot = join(pluginsDir, "bundled");
const rel = (path) => path.slice(resources.length + 1);
const rows = [];
const verdict = { keyClass: null, plugins: [], appVersion: null };

function row(name, ok, detail) {
  rows.push({ name, ok, detail });
  process.stdout.write(`PLUGINS_PACKAGE ${ok ? "ok  " : "FAIL"} ${name} — ${detail}\n`);
  return ok;
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** The offline rows, in order; each returns false when the rows after it cannot be read. */
async function offlineRows() {
  const files = {
    identity: join(identityDir, RELEASE_IDENTITY_FILE),
    doc: join(identityDir, TRUST_ROOT_FILE),
    docSig: join(identityDir, TRUST_ROOT_FILE + SIGNATURE_SUFFIX),
    index: join(bundledRoot, BUNDLED_PLUGIN_INDEX_FILE),
    indexSig: join(bundledRoot, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE),
  };
  const missing = Object.values(files).filter((path) => !isRegularFile(path));
  if (
    !row(
      "layout",
      missing.length === 0,
      missing.length === 0
        ? `${Object.values(files).map(rel).join(", ")} present`
        : `missing or not a regular file: ${missing.map(rel).join(", ")}`,
    )
  )
    return false;

  let parsed;
  try {
    parsed = contracts.StagedReleaseIdentity.safeParse(
      JSON.parse(readFileSync(files.identity, "utf8")),
    );
  } catch {
    parsed = { success: false, error: { issues: [{ message: "not JSON" }] } };
  }
  if (
    !row(
      "identity",
      parsed.success,
      parsed.success
        ? `${parsed.data.keyClass}-keyed, identityRevision ${parsed.data.identityRevision}, ${parsed.data.trustRootKeys.length} root keys`
        : `${rel(files.identity)} is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    )
  )
    return false;
  const identity = parsed.data;
  verdict.keyClass = identity.keyClass;
  const docBytes = readFileSync(files.doc);

  const classProblems = [];
  if (identity.keyClass === "dev" && requireRelease)
    classProblems.push(
      "KEY CLASS: DEV — a release build's plugins must be signed with the release keys (VIBEFIELD_BUNDLED_INDEX_SECRET; TD-1)",
    );
  if (identity.keyClass === "release") {
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
    const frozen =
      ledger.fields?.trustRootKeys?.status === "frozen" ? ledger.fields.trustRootKeys.value : null;
    if (frozen === null)
      classProblems.push("a RELEASE identity, but the ledger's trustRootKeys is not frozen (TD-1)");
    else if (!sameSet(frozen, identity.trustRootKeys))
      classProblems.push(
        "a RELEASE identity whose root keys are not the ledger's frozen trustRootKeys",
      );
    let embedded = null;
    try {
      embedded = readFileSync(EMBEDDED);
    } catch {
      embedded = null;
    }
    if (embedded === null || !embedded.equals(docBytes))
      classProblems.push(
        `a RELEASE identity whose trust-root is not the embedded ${rel(EMBEDDED)}`,
      );
  }
  row(
    "key-class",
    classProblems.length === 0,
    classProblems.length > 0
      ? classProblems.join("; ")
      : identity.keyClass === "release"
        ? "RELEASE — the ledger's root keys, the embedded trust-root"
        : "DEV — a development package (refused under --require-release-key)",
  );

  const trust = verifyTrustRoot(docBytes, readFileSync(files.docSig, "utf8"), {
    keys: identity.trustRootKeys,
    threshold: 1,
  });
  if (!trust.ok) {
    row("trust-root", false, trust.reason);
    return false;
  }
  if (
    !row(
      "trust-root",
      trust.signers.length >= trust.doc.root.threshold,
      `signed by ${trust.signers.length} of the identity's ${identity.trustRootKeys.length} root keys (threshold ${trust.doc.root.threshold}); document version ${trust.doc.version}, expires ${trust.doc.expires}`,
    )
  )
    return false;

  const index = await verifyBundledIndex({ root: bundledRoot, trust: trust.doc.roles.bundled });
  if (!index.ok) {
    row("index", false, index.reason);
    return false;
  }
  verdict.appVersion = index.index.appVersion;
  verdict.plugins = [...index.plugins.keys()];
  if (
    !row(
      "index",
      index.plugins.size > 0,
      index.plugins.size > 0
        ? `signed by the bundled role; ${index.plugins.size} plugin(s), app ${index.index.appVersion}, platform ${index.index.platform}`
        : "the index lists no plugin — the app ships none of its own",
    )
  )
    return false;
  for (const [id, plugin] of index.plugins) {
    row(
      `plugin:${id}`,
      plugin.ok,
      plugin.ok
        ? `${plugin.entry.version}, ${Object.keys(plugin.entry.files).length} file(s), artifact ${plugin.entry.artifactSha256}`
        : plugin.reason,
    );
  }

  const stray = [
    ...readdirSync(pluginsDir)
      .filter((name) => name !== "bundled")
      .map((name) => `plugins/${name}`),
    ...readdirSync(bundledRoot)
      .filter(
        (name) =>
          name !== BUNDLED_PLUGIN_INDEX_FILE &&
          name !== BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE &&
          !index.plugins.has(name),
      )
      .map((name) => `plugins/bundled/${name}`),
    ...readdirSync(identityDir)
      .filter((name) => !Object.values(files).includes(join(identityDir, name)))
      .map((name) => `${IDENTITY_DIR}/${name}`),
  ];
  row(
    "contents",
    stray.length === 0,
    stray.length === 0
      ? "nothing the index and the identity do not name"
      : `not named by the index or the identity: ${stray.join(", ")}`,
  );
  return rows.every((r) => r.ok);
}

/** The packaged fieldd's rows: vitest's JSON report, every row PASSED. */
async function fielddRows() {
  const reports = mkdtempSync(join(tmpdir(), "vf-plugins-package-"));
  const report = join(reports, "fieldd.json");
  const file = "test/packaged-plugins.test.ts";
  const code = await new Promise((resolveRun, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "--filter",
        "@vibefield/fieldd",
        "exec",
        "vitest",
        "run",
        file,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${report}`,
        // a cold signed SEA outlasts the 5 s default; each row's own deadlines remain the tighter checks
        "--testTimeout=240000",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, FIELDD_TEST_PLUGINS_PACKAGE: resources },
        // the verdict line is this script's: vitest's own words go to stderr
        stdio: ["ignore", 2, 2],
        shell: process.platform === "win32",
      },
    );
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolveRun(exitCode ?? (signal === null ? 1 : 2)));
  });
  let results = [];
  try {
    const { testResults } = JSON.parse(readFileSync(report, "utf8"));
    results = testResults.find((entry) => entry.name.endsWith(file))?.assertionResults ?? [];
  } catch {
    results = [];
  }
  if (results.length === 0) {
    row("fieldd", false, `${file}: none ran (vitest exit ${code})`);
    return;
  }
  for (const result of results)
    row(
      `fieldd: ${result.title}`,
      result.status === "passed",
      result.status === "passed"
        ? "passed against the packaged SEA"
        : `${result.status}${result.failureMessages?.[0] ? `: ${result.failureMessages[0].split("\n")[0]}` : ""}`,
    );
}

process.stdout.write(`Plugins package under test: ${resources}\n`);
const offlineOk = await offlineRows();
let fieldd;
if (offline) fieldd = "skipped (--offline)";
else if (!offlineOk) {
  fieldd = "not run";
  row("fieldd", false, "not run: an offline row failed");
} else {
  fieldd = "ran";
  await fielddRows();
}
const ok = rows.length > 0 && rows.every((r) => r.ok);
process.stdout.write(
  `${JSON.stringify({ ok, gate: GATE, app: appPath, ...verdict, fieldd, rows })}\n`,
);
process.exit(ok ? 0 : 1);
