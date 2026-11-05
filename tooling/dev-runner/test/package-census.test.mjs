// The package census (scripts/package-census.mjs): each row copies the census into a workspace of its own and runs it
// there, so the census's repo root is that workspace. FS (the handwritten plugin entries) and LP-6 (the host singletons
// read as addresses, a dependency's esbuild chunk hash as a counted hash).
//
// LP-6 review (2026-11-05): moved here from scripts/package-census.test.mjs, which no target ran (verify, CI and the Nx
// graph all missed it). dev-runner's `test` target runs test/*.test.mjs and is in `pnpm test`, and its inputs name the
// census, as they name the other release scripts whose tests live here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MILLE_NATIVE, SIDECARS } from "../../../apps/desktop/packaging/fieldd-sidecars.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");
const CENSUS = join(REPO, "scripts", "package-census.mjs");

function fixture(t, entry, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-census-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  };
  write("pnpm-workspace.yaml", 'packages:\n  - "plugins/*"\n');
  write("scripts/package-census.mjs", "");
  copyFileSync(CENSUS, join(root, "scripts/package-census.mjs"));
  write(
    "plugins/built/package.json",
    JSON.stringify({ name: "built", scripts: { build: "builder" } }),
  );
  write("plugins/built/dist/main.js", "export {};\n");
  write(
    "plugins/plain/package.json",
    JSON.stringify({ name: "plain", scripts: { build: "plugin-build" } }),
  );
  write("plugins/plain/vibefield.plugin.json", JSON.stringify({ entries: { service: entry } }));
  for (const [name, value] of Object.entries(files)) write(`plugins/plain/${name}`, value);
  const result = spawnSync(
    process.execPath,
    ["scripts/package-census.mjs", "--update", "--assert", "--strict"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return { result, root };
}

test("a handwritten service is inventoried with its manifest without needing dist", (t) => {
  const { result, root } = fixture(t, "./service.mjs", { "service.mjs": "export {};\n" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(root, "apps/desktop/packaging/package-manifest.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(manifest.packages["plugins/plain"].files).sort(), [
    "service.mjs",
    "vibefield.plugin.json",
  ]);
});

test("missing generated entries and missing handwritten entries still fail the census", (t) => {
  for (const entry of ["./dist/service.mjs", "./service.mjs", "../outside.mjs"]) {
    const { result } = fixture(t, entry);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /declared a build but produced no output/u);
  }
});

test("handwritten entry points still pass through the never-ship checks", (t) => {
  const { result } = fixture(t, "./service.test.mjs", { "service.test.mjs": "export {};\n" });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /test-material/u);
});

// LP-6: a renderer's assets/ in a workspace of its own, censused with `args`.
function rendererRoot(t, assets) {
  const root = mkdtempSync(join(tmpdir(), "vf-census-shapes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(CENSUS, join(root, "scripts/package-census.mjs"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  mkdirSync(join(root, "packages/shell"), { recursive: true });
  writeFileSync(
    join(root, "packages/shell/package.json"),
    JSON.stringify({ name: "shell", scripts: { build: "vite build" } }),
  );
  writeAssets(root, assets);
  return root;
}

function writeAssets(root, assets) {
  const dir = join(root, "packages/shell/dist/renderer/assets");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of assets) writeFileSync(join(dir, name), "export {};\n");
}

const census = (root, args) =>
  spawnSync(process.execPath, ["scripts/package-census.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });

const shapes = (root) =>
  JSON.parse(readFileSync(join(root, "apps/desktop/packaging/package-manifest.json"), "utf8"))
    .packages["packages/shell"].files;

const RENDERER = [
  "main-BUR9erT_.js",
  "lab-bridge-DLa_duIe.js",
  "chunk-ENIFIUEP-BR8A4VUB.js",
  "chunk-RTBW5AIZ-C-q3VlBf.js",
  "singleton-react.js",
  "singleton-vibecook-ice-desk.js",
  "singleton-vibecook-ice-desk-kit.js",
  "singleton-vibefield-plugin-sdk-behavior.js",
];

test("LP-6: host singletons are exact names, and a dependency's esbuild chunk hash is a counted hash", (t) => {
  const root = rendererRoot(t, RENDERER);
  const result = census(root, ["--update"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = shapes(root);
  const at = (shape) => files[`dist/renderer/assets/${shape}`];
  // the import map's addresses, byte for byte — never `singleton-vibecook-[hash].js`
  for (const name of [
    "singleton-react.js",
    "singleton-vibecook-ice-desk.js",
    "singleton-vibecook-ice-desk-kit.js",
    "singleton-vibefield-plugin-sdk-behavior.js",
  ])
    assert.equal(at(name)?.count, 1, name);
  assert.equal(at("singleton-vibecook-[hash].js"), undefined);
  assert.equal(at("singleton-vibefield-plugin-sdk-[hash].js"), undefined);
  // Vite's hash, as before; ICE's two esbuild chunks are one shape, counted twice
  assert.equal(at("main-[hash].js")?.count, 1);
  assert.equal(at("lab-bridge-[hash].js")?.count, 1);
  assert.equal(at("chunk-[upstream-hash]-[hash].js")?.count, 2);
  assert.equal(at("chunk-ENIFIUEP-[hash].js"), undefined);
});

test("LP-6: a dependency release that renames its chunks is no drift; one that adds a chunk, or a renamed singleton, is", (t) => {
  const root = rendererRoot(t, RENDERER);
  assert.equal(census(root, ["--update"]).status, 0);

  // every Vite hash and both upstream hashes moved: the same package, rebuilt
  writeAssets(root, [
    "main-Q1w2E3r4.js",
    "lab-bridge-x_Y-z9a8.js",
    "chunk-BH5AFWJX-B9AcHnbl.js",
    "chunk-Y7K6CHSF-YzdjxLIT.js",
    "singleton-react.js",
    "singleton-vibecook-ice-desk.js",
    "singleton-vibecook-ice-desk-kit.js",
    "singleton-vibefield-plugin-sdk-behavior.js",
  ]);
  const renamed = census(root, ["--assert", "--strict"]);
  assert.equal(renamed.status, 0, renamed.stdout + renamed.stderr);
  assert.match(renamed.stdout, /no drift/u);

  // a third upstream chunk is a new file
  writeAssets(root, [...RENDERER, "chunk-REJTEK3V-D7gT2J_r.js"]);
  const added = census(root, ["--assert", "--strict"]);
  assert.equal(added.status, 1);
  assert.match(added.stdout, /chunk-\[upstream-hash\]-\[hash\]\.js: expected 2, found 3/u);

  // a singleton's address moved: the import map would miss it
  writeAssets(root, [
    ...RENDERER.filter((name) => name !== "singleton-vibecook-ice-desk.js"),
    "singleton-vibecook-ice-deck.js",
  ]);
  const moved = census(root, ["--assert", "--strict"]);
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, /MISSING[\s\S]*singleton-vibecook-ice-desk\.js/u);
  assert.match(moved.stdout, /UNEXPECTED[\s\S]*singleton-vibecook-ice-deck\.js/u);
});

test("LP-6: the census's singleton rule names the prefix the renderer build reserves", () => {
  const source = readFileSync(
    join(REPO, "packages/electron-shell/src/vite/host-singletons.ts"),
    "utf8",
  );
  assert.match(source, /export const SINGLETON_CHUNK_PREFIX = "singleton-";/u);
  assert.match(
    readFileSync(CENSUS, "utf8"),
    /const SINGLETON = \/\\\/assets\\\/singleton-\[\^\/\]\+\$\/u;/u,
  );
});

// LP-6c (2026-11-05, VF-PM's ruling at 06:37Z): the census is main's gate. `pnpm verify` runs it STRICT, right after
// bundle:assert has built the shell and the renderer, so a shipped file the committed baseline does not name reddens
// verify, and so CI, instead of printing drift nobody reads (package-preview.yml, PR-time only, stays non-strict).
test("LP-6c: verify runs the census strict, after the build it inventories", () => {
  const { scripts } = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.match(scripts.verify, /pnpm bundle:assert && pnpm census:assert && /u);
  // --assert refuses a tree where any package that declares a build has no dist/. bundle:assert
  // has built electron-shell, so census:assert builds the rest it inventories: fieldd and
  // every plugin package.
  assert.match(scripts["census:assert"], /^pnpm --filter @vibefield\/fieldd /u);
  assert.match(
    scripts["census:assert"],
    / --filter "\.\/plugins\/\*" --filter "\.\/examples\/plugins\/\*" /u,
  );
  assert.match(scripts["census:assert"], / run --if-present build && /u);
  assert.match(scripts["census:assert"], /node scripts\/package-census\.mjs --assert --strict$/u);
});

// Every file the stager copies from a package's dist/ by a literal path is one the baseline names, so a new shipped
// bundle (SD-2's main/sound-worker.cjs was the one that had none) cannot reach a package without its census row. Rows
// whose path is computed (fieldd's SEA, mille's per-arch .node) and directories (the renderer's assets) are the
// census's own shapes, held by the strict assert itself.
// *(Item 178, 2026-11-05: fieldd's sidecars left the stager's text for the table it spreads,
// apps/desktop/packaging/fieldd-sidecars.mjs, so they are read from there. mille's .node is named by the reading
// host's triple and the baseline by the host it was drawn on, so it is held by its shape instead, the same on every
// verify host: the baseline names exactly one `dist/mille.<triple>.node` under fieldd.)*
test("LP-6c: the baseline names every bundle the stager copies by a literal dist path", () => {
  const stager = readFileSync(join(REPO, "scripts/stage-package.mjs"), "utf8");
  const manifest = JSON.parse(
    readFileSync(join(REPO, "apps/desktop/packaging/package-manifest.json"), "utf8"),
  );
  const fielddFiles = Object.keys(manifest.packages["packages/fieldd"]?.files ?? {});
  const milles = fielddFiles.filter((file) => /^dist\/mille\.[^/]+\.node$/u.test(file));
  assert.equal(milles.length, 1, `the baseline's mille engine rows: ${milles.join(", ")}`);
  const rows = [
    ...stager.matchAll(/from: "(packages\/[^/"]+)\/(dist\/[^"]+\.(?:cjs|mjs|js|wasm|node))"/gu),
    ...SIDECARS.filter((s) => s.name !== MILLE_NATIVE).map((s) =>
      /^(packages\/[^/]+)\/(dist\/.+)$/u.exec(s.from),
    ),
  ];
  assert.ok(rows.length >= 6, `the stager's literal dist rows: found ${rows.length}`);
  const unnamed = rows
    .filter(([, pkg, file]) => !(file in (manifest.packages[pkg]?.files ?? {})))
    .map(([, pkg, file]) => `${pkg}/${file}`);
  assert.deepEqual(unnamed, [], `staged with no census row: ${unnamed.join(", ")}`);
});
