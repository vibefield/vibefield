#!/usr/bin/env node
// `node packaging/stage-bundled-fixture.mjs [--plugins a,b] [--runs loads,corrupt,forged] -- <command…>` — WP8d's
// witness W7 (build-wp8-bundled-plugins.md §4 WP8d, §5): the app's own plugins staged the way a package carries them,
// for THREE runs of the command, and removed after them.
//
// It runs the stage's own producer (bundled-plugins.mjs `stage`, as scripts/stage-package.mjs does) into a temporary
// directory: `plugins/bundled/` — each plugin's §5.2 members and the index signed by the trust-root's `bundled` role —
// and `identity/` — the trust-root and release-identity.json. The stage is DEV-keyed (the secret variable is taken out of
// every environment here): the producer mints the keys in memory and drops them; nothing secret is ever written (EL7).
// The producer's own `verify` must pass on it before anything launches. Then each run gets its OWN copy of that stage and
// the command is run with it keyed to that root alone — `FIELDD_PLUGIN_ROOTS` the copy's bundled root,
// `FIELDD_PLUGIN_DEV_ROOTS` empty, `FIELDD_TRUST_ROOT`/`_KEYS` the copy's trust-root and the root keys its identity names
// (the development layout passes them through to fieldd, `main/fieldd.ts`) — and `VF_BUNDLED_FIXTURE` saying which run:
//   loads   — the copy as staged;
//   corrupt — one byte flipped in the first renderer-bearing plugin's renderer entry (`dist/renderer.js`);
//   forged  — the same flip, its new hash written into the index and the index re-signed by a STRANGER's key, minted
//             here and dropped: every file matches the index, and only the signature is wrong.
// The smoke judges each run (packages/electron-shell/src/testing/smoke-bundled.ts). Every run runs, whatever the one
// before said; the exit is the first red run's code, 0 when all three are green; the temporary directory goes either way.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// WP8-D6: the stager's own list (one home: bundled-list.mjs).
import { BUNDLED_PLUGINS } from "./bundled-list.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SECRET_ENV = "VIBEFIELD_BUNDLED_INDEX_SECRET";

function usage(message) {
  process.stderr.write(
    `stage-bundled-fixture: ${message}\nusage: stage-bundled-fixture.mjs [--plugins a,b] [--runs loads,corrupt,forged] -- <command…>\n`,
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator < 0 || separator === argv.length - 1) usage("no command after --");
const command = argv.slice(separator + 1);
const options = {};
for (let i = 0; i < separator; i++) {
  const name = argv[i];
  if ((name !== "--plugins" && name !== "--runs") || i + 1 >= separator) usage(`unknown ${name}`);
  options[name.slice(2)] = argv[++i];
}

// The workspace's sources run as plugin-build's bin runs them (stage-kind-fixtures.mjs's recipe): Node strips the
// types, and an extensionless relative import is retried as `.ts`.
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
const contracts = await load("packages/contracts/src/index.ts");
const { canonicalJson } = await load("tooling/plugin-build/src/canonical.ts");
const { generateRegistryKeypair, signRegistryIndex } = await load(
  "tooling/plugin-build/src/registry-sign.ts",
);
const { BUNDLED_FIXTURE_ENV, BUNDLED_RUNS } = await load(
  "packages/electron-shell/src/testing/smoke-bundled.ts",
);
const {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
  FIELDD_TRUST_ROOT_ENV,
  FIELDD_TRUST_ROOT_KEYS_ENV,
  IDENTITY_DIR,
  RELEASE_IDENTITY_FILE,
  TRUST_ROOT_FILE,
} = contracts;

const plugins = (options.plugins ?? BUNDLED_PLUGINS.join(",")).split(",").filter(Boolean);
const runs = (options.runs ?? BUNDLED_RUNS.join(",")).split(",").filter(Boolean);
for (const run of runs) if (!BUNDLED_RUNS.includes(run)) usage(`no run named ${run}`);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const withoutSecret = (env) => {
  const out = { ...env };
  delete out[SECRET_ENV];
  return out;
};
const bundledRoot = (stage) => join(stage, "plugins", "bundled");

/** The producer, driven as the stager drives it: one JSON verdict line on stdout. */
function producer(verb, stage, extra = []) {
  const run = spawnSync(
    process.execPath,
    [
      join(repo, "apps/desktop/packaging/bundled-plugins.mjs"),
      verb,
      "--stage",
      stage,
      "--plugins",
      plugins.join(","),
      ...extra,
    ],
    { cwd: repo, encoding: "utf8", env: withoutSecret(process.env), maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    return JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "");
  } catch {
    return {
      ok: false,
      problems: [
        `the producer gave no verdict (exit ${run.status}): ${(run.stderr ?? "").trim().slice(0, 2000)}`,
      ],
    };
  }
}

const tmp = mkdtempSync(join(tmpdir(), "vf-bundled-fixture-"));
const remove = () => {
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`BUNDLED_FIXTURE_REMOVED ${JSON.stringify({ root: tmp })}\n`);
};
const refuse = (message) => {
  process.stderr.write(`stage-bundled-fixture: ${message}\n`);
  remove();
  process.exit(1);
};

const pristine = join(tmp, "pristine");
const staged = producer("stage", pristine, ["--app-version", "0.0.0-smoke"]);
if (!staged.ok) refuse(`the producer did not stage: ${(staged.problems ?? []).join("; ")}`);
if (staged.keyClass !== "dev") refuse(`the stage is ${staged.keyClass}-keyed, not dev`);
const verified = producer("verify", pristine);
if (!verified.ok)
  refuse(`the staged root does not verify: ${(verified.problems ?? []).join("; ")}`);

const identity = contracts.StagedReleaseIdentity.parse(
  JSON.parse(readFileSync(join(pristine, IDENTITY_DIR, RELEASE_IDENTITY_FILE), "utf8")),
);
const index = contracts.BundledPluginIndex.parse(
  JSON.parse(readFileSync(join(bundledRoot(pristine), BUNDLED_PLUGIN_INDEX_FILE), "utf8")),
);
const ids = staged.plugins;
/** Each staged plugin's renderer entry, plugin-relative — what the renderer's staged path loads. */
const renderers = new Map();
for (const id of ids) {
  const manifest = JSON.parse(
    readFileSync(join(bundledRoot(pristine), id, "vibefield.plugin.json"), "utf8"),
  );
  const entry = manifest.entries?.renderer;
  if (typeof entry === "string") renderers.set(id, entry.replace(/^\.\//u, ""));
}
const targetId = ids.find(
  (id) => renderers.has(id) && renderers.get(id) in index.plugins[id].files,
);
if (targetId === undefined) refuse("no staged plugin carries a renderer entry to corrupt");
const target = { id: targetId, path: renderers.get(targetId) };

/** One run's own copy of the stage, changed as the run says. */
function prepare(run) {
  const stage = join(tmp, run);
  cpSync(pristine, stage, { recursive: true });
  const root = bundledRoot(stage);
  if (run === "loads") return { stage, root, corrupted: null };
  const file = join(root, target.id, ...target.path.split("/"));
  const bytes = readFileSync(file);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  writeFileSync(file, bytes);
  if (run === "forged") {
    const indexPath = join(root, BUNDLED_PLUGIN_INDEX_FILE);
    const forged = JSON.parse(readFileSync(indexPath, "utf8"));
    forged.plugins[target.id].files[target.path] = sha256(bytes);
    const forgedBytes = Buffer.from(canonicalJson(forged));
    writeFileSync(indexPath, forgedBytes);
    const stranger = generateRegistryKeypair();
    writeFileSync(
      join(root, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE),
      `${signRegistryIndex(forgedBytes, stranger.secretKey)}\n`,
    );
  }
  return { stage, root, corrupted: target };
}

process.stdout.write(
  `BUNDLED_FIXTURE ${JSON.stringify({
    root: tmp,
    keyClass: staged.keyClass,
    plugins: ids,
    renderers: [...renderers.keys()],
    corrupt: target,
    runs,
    rootKeys: identity.trustRootKeys.length,
  })}\n`,
);

let child = null;
let stopped = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopped = signal;
    child?.kill(signal);
  });
}

let exit = 0;
const verdicts = {};
for (const run of runs) {
  if (stopped !== null) break;
  const { stage, root, corrupted } = prepare(run);
  const fixture = { run, root, plugins: ids, renderers: [...renderers.keys()], corrupted };
  const code = await new Promise((resolveRun) => {
    child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: {
        ...withoutSecret(process.env),
        FIELDD_PLUGIN_ROOTS: root,
        FIELDD_PLUGIN_DEV_ROOTS: "",
        [FIELDD_TRUST_ROOT_ENV]: join(stage, IDENTITY_DIR, TRUST_ROOT_FILE),
        [FIELDD_TRUST_ROOT_KEYS_ENV]: identity.trustRootKeys.join(","),
        [BUNDLED_FIXTURE_ENV]: JSON.stringify(fixture),
      },
    });
    child.once("error", (error) => {
      process.stderr.write(
        `stage-bundled-fixture: ${command[0]} did not start: ${error.message}\n`,
      );
      resolveRun(2);
    });
    child.once("exit", (status, signal) => resolveRun(status ?? (signal === null ? 1 : 2)));
  });
  child = null;
  process.stdout.write(`BUNDLED_FIXTURE_RUN ${JSON.stringify({ run, exit: code })}\n`);
  verdicts[run] = code;
  if (code !== 0 && exit === 0) exit = code;
}
// one line for the landing gate's verdict (scripts/gate-landing.mjs quotes it): every run's exit, and any not run
process.stdout.write(
  `BUNDLED_FIXTURE_DONE ${JSON.stringify({ runs: verdicts, ...(stopped !== null ? { stopped } : {}) })}\n`,
);
remove();
process.exit(stopped !== null && exit === 0 ? 1 : exit);
