// RD-1 (thinking-release-deps.md §2, §5) — one lock, two coordinates, two shapes: `render --prod` writes and checks
// the committed sibling rows from the lock, `use` links a RELEASED sibling in a local overlay that never touches a
// committed file, the shape is one derivation, and the pre-commit hook refuses a staged row the lock does not render.
// Fixture repos in a temporary directory; the last case reads THIS tree, whose committed rows must be the lock's.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  alignOverlay,
  applyCargoRows,
  applyNpmRows,
  committedCargoRow,
  committedNpmRow,
  ensureElectronBinary,
  linkedPackages,
  npmPlane,
  OVERLAY_PNPMFILE,
  OVERLAY_STATE,
  readOverlay,
  renderProd,
  seedDevLock,
  shapeInstallEnv,
  siblingShape,
  unalignOverlay,
  useSiblings,
} from "../../../scripts/siblings.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const LOCK = {
  siblings: {
    runtime: {
      path: "../runtime",
      sha: "a".repeat(40),
      packages: { "@x/runtime-core": "packages/core", "@x/runtime-views": "packages/views" },
    },
    history: {
      path: "../history",
      sha: "b".repeat(40),
      packages: { "@x/history-protocol": "clients/ts" },
      cargo: { crate: "historyd", profile: "release" },
      release: { npm: "0.1.1" },
    },
    terminal: {
      path: "../terminal",
      sha: "c".repeat(40),
      patch: { "term-core": "native/core" },
    },
  },
};

const YAML = `packages:
  - "packages/*"
overrides:
  loro-crdt: ^1.13.8
  # history went exact
  "@x/history-protocol": 0.1.1
  # ---- SIBLING MODE ----
  "@x/runtime-core": link:../runtime/packages/core
  '@x/runtime-views': 'link:../runtime/packages/views'
minimumReleaseAgeExclude:
  - '@x/history-protocol@0.1.1'
`;

const CARGO = `[workspace]
members = ["packages/native"]

[patch.crates-io]
term-core = { path = "../terminal/native/core" }
`;

function fixture(t, { lock = LOCK, yaml = YAML, cargo = CARGO } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vf-sibling-shape-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "consumer");
  mkdirSync(root);
  writeFileSync(join(root, "siblings.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(join(root, "pnpm-workspace.yaml"), yaml);
  writeFileSync(join(root, "Cargo.toml"), cargo);
  writeFileSync(join(root, ".gitignore"), ".vibefield/\n/.pnpmfile.cjs\n");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "fixture-root" })}\n`);
  for (const sub of ["runtime/packages/core", "runtime/packages/views", "history/clients/ts"]) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, "package.json"), "{}\n");
  }
  // the released sibling's package declares a dependency and a peer: what the overlay installs for it and aligns
  writeFileSync(
    join(dir, "history/clients/ts/package.json"),
    `${JSON.stringify({ name: "@x/history-protocol", dependencies: { "@x/codec": "^2.0.0" }, peerDependencies: { react: ">=19" } })}\n`,
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", "-A");
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return { dir, root, git };
}

/** Run `fn` with console output captured; returns { result, out, err }. */
function quiet(fn) {
  const out = [];
  const err = [];
  const { log, error, warn } = console;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  console.warn = (...a) => err.push(a.join(" "));
  try {
    return { result: fn(), out: out.join("\n"), err: err.join("\n") };
  } finally {
    Object.assign(console, { log, error, warn });
  }
}

test("a plane is committed prod exactly when the lock records its release", () => {
  const { runtime, history, terminal } = LOCK.siblings;
  assert.equal(npmPlane(runtime), "dev");
  assert.equal(npmPlane(history), "prod");
  assert.equal(npmPlane(terminal), "none");
  assert.equal(committedNpmRow(runtime, "@x/runtime-core"), "link:../runtime/packages/core");
  assert.equal(committedNpmRow(history, "@x/history-protocol"), "0.1.1");
  assert.equal(committedCargoRow(terminal, "term-core"), '{ path = "../terminal/native/core" }');
  assert.equal(
    committedCargoRow(
      {
        ...terminal,
        release: { cargo: { git: "https://example.invalid/t.git", rev: "c".repeat(40) } },
      },
      "term-core",
    ),
    `{ git = "https://example.invalid/t.git", rev = "${"c".repeat(40)}" }`,
  );
});

test("rows are rewritten in place inside overrides only, keeping their quoting; a missing row is named, never appended", () => {
  const rows = new Map([
    ["@x/runtime-views", "0.2.0"],
    ["@x/history-protocol", "link:../history/clients/ts"],
    ["@x/absent", "1.0.0"],
  ]);
  const { text, changed, missing } = applyNpmRows(YAML, rows);
  assert.deepEqual(missing, ["@x/absent"]);
  assert.equal(changed.length, 2);
  assert.match(text, /^ {2}'@x\/runtime-views': '0\.2\.0'$/m);
  assert.match(text, /^ {2}"@x\/history-protocol": link:\.\.\/history\/clients\/ts$/m);
  // the list item in minimumReleaseAgeExclude is not an override row and stays
  assert.match(text, /^ {2}- '@x\/history-protocol@0\.1\.1'$/m);
  const cargo = applyCargoRows(CARGO, new Map([["term-core", '{ path = "../elsewhere" }']]));
  assert.match(cargo.text, /^term-core = \{ path = "\.\.\/elsewhere" \}$/m);
  assert.deepEqual(cargo.missing, []);
});

test("render --prod is a no-op on a tree that is the lock's, rewrites a drifted row, and --check refuses it in words", (t) => {
  const { root } = fixture(t);
  const before = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  assert.equal(quiet(() => renderProd(root)).result, 0);
  assert.equal(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"), before);

  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    before.replace(
      '"@x/history-protocol": 0.1.1',
      '"@x/history-protocol": link:../history/clients/ts',
    ),
  );
  const checked = quiet(() => renderProd(root, { check: true }));
  assert.equal(checked.result, 1);
  assert.match(
    checked.err,
    /@x\/history-protocol reads link:\.\.\/history\/clients\/ts but siblings\.lock\.json renders 0\.1\.1/,
  );
  assert.equal(quiet(() => renderProd(root)).result, 0);
  assert.equal(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"), before);
});

test("use links a released sibling in an ignored overlay; use --none removes it; no committed file changes", (t) => {
  const { root, git } = fixture(t);
  const used = quiet(() => useSiblings(root, ["history", "--no-install"]));
  assert.equal(used.result, 0);
  assert.deepEqual(readOverlay(root), ["history"]);
  assert.match(used.out, /history npm link ×1 \(overlay over 0\.1\.1\)/);
  const pnpmfile = join(root, OVERLAY_PNPMFILE);
  assert.ok(existsSync(pnpmfile));
  // RD-2: the overrides are the link (pnpm's overrider runs after readPackage), a relative link: row becomes absolute
  // against the root (the dev lock lives elsewhere), the lock and the store are moved; the root manifest gains the
  // linked package's dependencies, every other manifest passes untouched
  const { hooks } = createRequire(import.meta.url)(pnpmfile);
  const config = hooks.updateConfig({
    overrides: {
      "@x/history-protocol": "0.1.1",
      "@x/runtime-core": "link:../runtime/packages/core",
      loro: "^1",
    },
  });
  assert.match(config.overrides["@x/history-protocol"], /^link:\/.*\/history\/clients\/ts$/);
  assert.equal(
    config.overrides["@x/runtime-core"],
    `link:${join(root, "..", "runtime", "packages", "core")}`,
  );
  assert.equal(config.overrides.loro, "^1");
  assert.equal(config.lockfileDir, join(root, ".vibefield", "dev"));
  assert.equal(config.virtualStoreDir, join(root, "node_modules", ".pnpm"));
  const rootPkg = hooks.readPackage({ name: "fixture-root", dependencies: { left: "1" } });
  assert.deepEqual(rootPkg.dependencies, { "@x/codec": "^2.0.0", left: "1" });
  const other = hooks.readPackage({ name: "@x/app", dependencies: { "@x/history-protocol": "*" } });
  assert.deepEqual(other.dependencies, { "@x/history-protocol": "*" });
  assert.equal(git("status", "--porcelain"), "", "the overlay touched a committed file");

  // the overlay's links are what the single-copy guard and the shape see
  assert.deepEqual(
    [...linkedPackages(root).entries()].map(([name, { via }]) => `${name}:${via}`).sort(),
    ["@x/history-protocol:overlay", "@x/runtime-core:committed", "@x/runtime-views:committed"],
  );

  assert.equal(quiet(() => useSiblings(root, ["--none", "--no-install"])).result, 0);
  assert.deepEqual(readOverlay(root), []);
  assert.ok(!existsSync(pnpmfile));
  assert.ok(!existsSync(join(root, OVERLAY_STATE)));
  assert.equal(git("status", "--porcelain"), "");
  assert.deepEqual(
    [...linkedPackages(root).values()].map(({ via }) => via),
    ["committed", "committed"],
  );
});

test("use on a sibling committed in dev shape says so and links nothing; an unknown name is refused", (t) => {
  const { root } = fixture(t);
  const dev = quiet(() => useSiblings(root, ["runtime", "--no-install"]));
  assert.equal(dev.result, 0);
  assert.match(dev.out, /runtime is committed in dev shape already/);
  assert.deepEqual(readOverlay(root), []);
  const typo = quiet(() => useSiblings(root, ["histroy", "--no-install"]));
  assert.equal(typo.result, 2);
  assert.match(typo.err, /unknown sibling histroy/);
});

test("the shape is prod only when no plane is a checkout, and names each plane", () => {
  const dev = siblingShape("/nowhere", LOCK, []);
  assert.equal(dev.mode, "dev");
  assert.equal(
    dev.line,
    `shape: dev — runtime npm link ×2 @ aaaaaaa · history npm exact 0.1.1 ×1 + historyd built from the checkout @ bbbbbbb · terminal cargo patch ×1 @ ccccccc`,
  );
  const released = {
    siblings: {
      history: {
        path: "../history",
        sha: "b".repeat(40),
        packages: { "@x/h": "c" },
        release: { npm: "1.0.0" },
      },
    },
  };
  assert.equal(
    siblingShape("/nowhere", released, []).line,
    "shape: prod — history npm exact 1.0.0 ×1 @ bbbbbbb",
  );
  assert.equal(siblingShape("/nowhere", released, ["history"]).mode, "dev");
  assert.equal(
    siblingShape("/nowhere", { siblings: {} }, []).line,
    "shape: prod — no sibling checkout in the build",
  );
});

test("the pre-commit check reads the INDEX: a staged row the lock does not render is refused, the working tree's ignored", (t) => {
  const { root, git } = fixture(t);
  // the CLI resolves its repository from its own location, so call the function the hook runs, against the fixture
  const staged = () => quiet(() => renderProd(root, { check: true, staged: true }));
  assert.equal(staged().result, 0);
  const yaml = join(root, "pnpm-workspace.yaml");
  writeFileSync(
    yaml,
    readFileSync(yaml, "utf8").replace(
      '"@x/history-protocol": 0.1.1',
      '"@x/history-protocol": link:../history/clients/ts',
    ),
  );
  assert.equal(staged().result, 0, "an unstaged edit is not the commit's");
  git("add", "pnpm-workspace.yaml");
  const refused = staged();
  assert.equal(refused.result, 1);
  assert.match(refused.err, /pnpm-workspace\.yaml \(staged\): @x\/history-protocol reads link:/);
  assert.match(refused.err, /SKIP_SHAPE=1 bypasses/);
});

test("the dev lock is seeded from the committed one, its importers rebased to the lockfile directory", () => {
  const committed = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      biome:
        specifier: 2.5.4
        version: 2.5.4

  packages/app:
    dependencies:
      react:
        specifier: ^19
        version: 19.2.7

packages:

  biome@2.5.4:
    resolution: {integrity: sha512-x}
`;
  const seeded = seedDevLock(committed);
  assert.match(seeded, /^ {2}\.\.\/\.\.:$/m);
  assert.match(seeded, /^ {2}\.\.\/\.\.\/packages\/app:$/m);
  assert.match(seeded, /^ {2}biome@2\.5\.4:$/m, "the packages section is untouched");
  assert.doesNotMatch(seeded, /^ {2}\.:$/m);
});

test("a shape install never inherits a pnpmfile, lockfile or store directory from the environment", () => {
  const env = shapeInstallEnv({
    PATH: "/bin",
    pnpm_config_pnpmfile: "/elsewhere.cjs",
    pnpm_config_lockfile_dir: "/x",
    pnpm_config_virtual_store_dir: "/y",
  });
  assert.deepEqual(env, { PATH: "/bin" });
});

test("align links a linked package's dependencies and peers from the store, and re-points its hoist; unalign undoes the hoist", (t) => {
  const { dir, root } = fixture(t);
  quiet(() => useSiblings(root, ["history", "--no-install"]));
  const store = join(root, "node_modules", ".pnpm");
  // a fake installed store: the hoist holds the dependency and the peer, and the registry copy of the release
  for (const [name, at] of [
    ["@x/codec", "@x+codec@2.0.0/node_modules/@x/codec"],
    ["react", "react@19.2.7/node_modules/react"],
    [
      "@x/history-protocol",
      "@x+history-protocol@0.1.1_react@19.2.7/node_modules/@x/history-protocol",
    ],
  ]) {
    mkdirSync(join(store, at), { recursive: true });
    writeFileSync(join(store, at, "package.json"), `${JSON.stringify({ name })}\n`);
    mkdirSync(dirname(join(store, "node_modules", name)), { recursive: true });
    symlinkSync(join(store, at), join(store, "node_modules", name));
  }
  assert.deepEqual(alignOverlay(root), []);
  const checkout = join(dir, "history", "clients", "ts");
  assert.equal(
    realpathSync(join(checkout, "node_modules", "@x", "codec")),
    realpathSync(join(store, "@x+codec@2.0.0/node_modules/@x/codec")),
  );
  assert.equal(
    realpathSync(join(checkout, "node_modules", "react")),
    realpathSync(join(store, "react@19.2.7/node_modules/react")),
  );
  assert.equal(
    realpathSync(join(store, "node_modules", "@x", "history-protocol")),
    realpathSync(checkout),
  );
  assert.deepEqual(unalignOverlay(root, ["@x/history-protocol"]), [
    "@x/history-protocol → the store's 0.1.1",
  ]);
  assert.equal(
    realpathSync(join(store, "node_modules", "@x", "history-protocol")),
    realpathSync(
      join(store, "@x+history-protocol@0.1.1_react@19.2.7/node_modules/@x/history-protocol"),
    ),
  );
});

test("a shape switch gives the desktop's Electron its binary when the store directory came back without one", (t) => {
  const { root } = fixture(t);
  assert.equal(ensureElectronBinary(root), "no Electron resolvable from apps/desktop");
  mkdirSync(join(root, "apps", "desktop"), { recursive: true });
  writeFileSync(
    join(root, "apps", "desktop", "package.json"),
    `${JSON.stringify({ name: "desktop" })}\n`,
  );
  const electron = join(root, "node_modules", "electron");
  mkdirSync(electron, { recursive: true });
  writeFileSync(join(electron, "package.json"), `${JSON.stringify({ name: "electron" })}\n`);
  // Electron's own installer writes path.txt (and dist/) from its download cache; the fake one writes path.txt alone
  writeFileSync(
    join(electron, "install.js"),
    'require("node:fs").writeFileSync(require("node:path").join(__dirname, "path.txt"), "Electron.app/Contents/MacOS/Electron");\n',
  );
  const did = quiet(() => ensureElectronBinary(root));
  assert.match(did.result, /^Electron's binary installed at node_modules\/electron/);
  assert.ok(existsSync(join(electron, "path.txt")));
  assert.equal(ensureElectronBinary(root), null, "a binary already there is left alone");
});

test("THIS tree: the committed sibling rows are exactly what its lock renders, and its hook asks the same", () => {
  const checked = quiet(() => renderProd(REPO_ROOT, { check: true }));
  assert.equal(checked.result, 0, checked.err);
  const hook = readFileSync(join(REPO_ROOT, "scripts", "git-hooks", "pre-commit"), "utf8");
  assert.match(hook, /node scripts\/siblings\.mjs render --prod --check --staged/);
});
