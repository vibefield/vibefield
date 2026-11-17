// RD-5's exit for mille's npm plane (the EL8 to 0.3.6): the renderer's aliases into the locked checkout stand only
// while a checkout is linked, and check:deps (scripts/check-single-copy.mjs) reads the installed packages instead:
// fieldd's and field-app's `@vibecook/mille`, field-app's mille-ui and the room's own two, each at the release, with
// one directory per package (RD-5, 2026-11-13: one engine, and one mille-ui in the renderer's bundle).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as mille from "../../../scripts/mille-aliases.mjs";

const SHA = "85c35e7da27ece66f4d4856d4161b20117d42c37";
const PINNED = "mille@85c35e7d (daemon, renderer and room pinned together)";
const RELEASED = "mille@0.3.6 (daemon, renderer and room at the release, from npm";
const RESOLVER = [
  'import { milleAliases } from "../../scripts/mille-aliases.mjs";',
  "export default { resolve: { alias: [...milleAliases(root)] } };",
  "",
].join("\n");

function write(file, body) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : `${JSON.stringify(body)}\n`);
}

function link(target, at) {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at);
}

/** A repo beside its `../mille-pin`, whose lock names mille at `release` (undefined: the dev plane), with the two
 * renderer configs check:deps reads. */
function tree(t, release) {
  const base = mkdtempSync(join(tmpdir(), "vf-mille-copies-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const entry = {
    path: "../mille-pin",
    repository: "https://github.com/vibecook-dev/mille.git",
    sha: SHA,
    packages: { "@vibecook/mille": "packages/mille", "@vibecook/mille-ui": "packages/mille-ui" },
  };
  if (release !== undefined) entry.release = { npm: release };
  write(join(root, "siblings.lock.json"), { siblings: { mille: entry } });
  write(join(root, "packages/electron-shell/vite.config.ts"), RESOLVER);
  write(join(root, "packages/field-app/vitest.config.ts"), RESOLVER);
  return { base, root };
}

/** The checkout's two packages, built, each exporting `.` and `./port`. */
function checkout(base) {
  const dir = join(base, "mille-pin/packages");
  for (const name of ["mille", "mille-ui"]) {
    write(join(dir, name, "package.json"), {
      name: `@vibecook/${name}`,
      exports: { ".": "./dist/index.js", "./port": { import: "./dist/port.js" } },
    });
    write(join(dir, name, "dist/index.js"), "");
    write(join(dir, name, "dist/port.js"), "");
  }
  return dir;
}

/** `name@version` as pnpm stores it under `key`. */
function store(root, key, name, version) {
  const dir = join(root, "node_modules/.pnpm", key, "node_modules", name);
  write(join(dir, "package.json"), { name, version });
  return dir;
}

/** The registry install: fieldd, field-app and the room each link one store copy of each package. */
function install(root, version) {
  const engine = store(root, `@vibecook+mille@${version}`, "@vibecook/mille", version);
  const ui = store(root, `@vibecook+mille-ui@${version}`, "@vibecook/mille-ui", version);
  const room = store(root, "@vibefield+rosetta-room@0.1.6", "@vibefield/rosetta-room", "0.1.6");
  link(engine, join(root, "packages/fieldd/node_modules/@vibecook/mille"));
  link(engine, join(root, "packages/field-app/node_modules/@vibecook/mille"));
  link(ui, join(root, "packages/field-app/node_modules/@vibecook/mille-ui"));
  link(room, join(root, "packages/field-app/node_modules/@vibefield/rosetta-room"));
  link(engine, join(dirname(dirname(room)), "@vibecook/mille"));
  link(ui, join(dirname(dirname(room)), "@vibecook/mille-ui"));
}

/** Point `consumer`'s `name` at `target` instead. */
function relink(root, consumer, name, target) {
  const at = join(root, consumer, "node_modules", name);
  rmSync(at);
  link(target, at);
}

test("a released mille the overlay does not link takes no aliases: the renderer resolves the installed packages", (t) => {
  const { root } = tree(t, "0.3.6"); // and no ../mille-pin beside it
  assert.deepEqual(mille.milleAliases(root), []);
});

test("a dev mille, and a released one the overlay links, keep their aliases into the locked checkout", (t) => {
  const dev = tree(t, undefined);
  const dir = checkout(dev.base);
  assert.deepEqual(mille.milleAliases(dev.root), [
    { find: "@vibecook/mille-ui/port", replacement: join(dir, "mille-ui/dist/port.js") },
    { find: "@vibecook/mille/port", replacement: join(dir, "mille/dist/port.js") },
    { find: "@vibecook/mille-ui", replacement: join(dir, "mille-ui/dist/index.js") },
    { find: "@vibecook/mille", replacement: join(dir, "mille/dist/index.js") },
  ]);
  const linked = tree(t, "0.3.6");
  checkout(linked.base);
  write(join(linked.root, ".vibefield/dev/siblings.json"), { linked: ["mille"] });
  assert.equal(mille.milleAliases(linked.root).length, 4);
});

test("check:deps, released: fieldd, field-app and the room resolve the release, one copy of each package", (t) => {
  const { root } = tree(t, "0.3.6");
  install(root, "0.3.6");
  assert.deepEqual(mille.milleCopies(root), {
    problems: [],
    report: `${RELEASED}: @vibecook/mille ×1, @vibecook/mille-ui ×1)`,
  });
});

test("check:deps, released: a consumer off the release fails, and so does a second copy of mille or of mille-ui", (t) => {
  const off = tree(t, "0.3.6");
  install(off.root, "0.3.5");
  assert.deepEqual(mille.milleCopies(off.root).problems, [
    "packages/fieldd, packages/field-app, the room (@vibefield/rosetta-room): @vibecook/mille@0.3.5, but the lock's release is 0.3.6",
    "packages/field-app, the room (@vibefield/rosetta-room): @vibecook/mille-ui@0.3.5, but the lock's release is 0.3.6",
  ]);
  // the engine: fieldd's and field-app's copies are one directory
  const engine = tree(t, "0.3.6");
  install(engine.root, "0.3.6");
  const second = store(engine.root, "@vibecook+mille@0.3.6_x", "@vibecook/mille", "0.3.6");
  relink(engine.root, "packages/fieldd", "@vibecook/mille", second);
  const two = mille.milleCopies(engine.root);
  assert.equal(two.problems.length, 1);
  assert.match(two.problems[0], /^2 distinct @vibecook\/mille copies are resolvable \(the engine/);
  // the renderer: field-app's mille-ui and the room's nested one are one directory, so it bundles one
  const ui = tree(t, "0.3.6");
  install(ui.root, "0.3.6");
  const variant = store(ui.root, "@vibecook+mille-ui@0.3.6_x", "@vibecook/mille-ui", "0.3.6");
  relink(ui.root, "packages/field-app", "@vibecook/mille-ui", variant);
  const split = mille.milleCopies(ui.root);
  assert.equal(split.report, `${RELEASED}: @vibecook/mille ×1, @vibecook/mille-ui ×2)`);
  assert.equal(split.problems.length, 1);
  assert.match(
    split.problems[0],
    /^2 distinct @vibecook\/mille-ui copies are resolvable \(the renderer bundles/,
  );
});

test("check:deps, released: a consumer that resolves no mille, and a field-app with no room, are named", (t) => {
  const none = tree(t, "0.3.6");
  install(none.root, "0.3.6");
  rmSync(join(none.root, "packages/fieldd/node_modules/@vibecook/mille"));
  assert.deepEqual(mille.milleCopies(none.root).problems, [
    "packages/fieldd: no @vibecook/mille resolves",
  ]);
  const roomless = tree(t, "0.3.6");
  install(roomless.root, "0.3.6");
  rmSync(join(roomless.root, "packages/field-app/node_modules/@vibefield/rosetta-room"));
  assert.deepEqual(mille.milleCopies(roomless.root).problems, [
    "packages/field-app resolves no @vibefield/rosetta-room, so the room's mille is unread",
  ]);
});

test("check:deps, linked: every consumer resolves the locked checkout, as before the release", (t) => {
  const { base, root } = tree(t, undefined);
  const dir = checkout(base);
  link(join(dir, "mille"), join(root, "packages/fieldd/node_modules/@vibecook/mille"));
  link(join(dir, "mille"), join(root, "packages/field-app/node_modules/@vibecook/mille"));
  link(join(dir, "mille-ui"), join(root, "packages/field-app/node_modules/@vibecook/mille-ui"));
  assert.deepEqual(mille.milleCopies(root), { problems: [], report: PINNED });
});
