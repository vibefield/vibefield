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
  applySwiftRelease,
  cargoLockHidden,
  cargoPlane,
  committedCargoRow,
  committedNpmRow,
  ensureElectronBinary,
  linkedPackages,
  lockHidden,
  npmPlane,
  OVERLAY_CARGO,
  OVERLAY_PNPMFILE,
  OVERLAY_STATE,
  overlayable,
  readOverlay,
  renderProd,
  seedDevLock,
  shapeInstallEnv,
  siblingShape,
  swiftPlane,
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

// --- RD-3: the cargo and Swift overlays ---------------------------------------------------------------------------

const REV = "d".repeat(40);
const LOCK3 = {
  siblings: {
    terminal: {
      path: "../terminal",
      sha: REV,
      patch: { "term-core": "native/core" },
      release: { cargo: { git: "https://example.invalid/terminal.git", rev: REV } },
    },
    mesh: {
      path: "../mesh",
      sha: "e".repeat(40),
      swift: { manifest: "apps/ios/Kit/Package.swift", link: "apps/ios/Kit/.window/mesh" },
      release: { swift: "0.7.17" },
    },
  },
};
const CARGO3 = `[workspace]
members = []

[patch.crates-io]
term-core = { git = "https://example.invalid/terminal.git", rev = "${REV}" }
`;
const SWIFT3 = `// swift-tools-version: 6.0
let meshRelease: Version? = "0.7.17"
`;

function fixture3(t) {
  const { dir, root, git } = fixture(t, {
    lock: LOCK3,
    cargo: CARGO3,
    yaml: "overrides:\n  loro: ^1\n",
  });
  mkdirSync(join(root, "apps", "ios", "Kit"), { recursive: true });
  writeFileSync(join(root, "apps", "ios", "Kit", "Package.swift"), SWIFT3);
  writeFileSync(join(root, "Cargo.lock"), "# committed lock: term-core from git\n");
  writeFileSync(
    join(root, "apps", "ios", "Kit", "Package.resolved"),
    '{ "pins": ["mesh 0.7.17"] }\n',
  );
  writeFileSync(join(root, ".gitignore"), ".vibefield/\n/.pnpmfile.cjs\n/.cargo/config.toml\n");
  git("add", "-A");
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "rd3 fixture",
  );
  return { dir, root, git };
}

test("RD-3: a plane is released when the lock records it; the Swift release is a rendered manifest line", () => {
  assert.equal(cargoPlane(LOCK3.siblings.terminal), "prod");
  assert.equal(cargoPlane(LOCK.siblings.terminal), "dev");
  assert.equal(swiftPlane(LOCK3.siblings.mesh), "prod");
  assert.equal(swiftPlane({ swift: {} }), "dev");
  assert.ok(overlayable(LOCK3.siblings.terminal) && overlayable(LOCK3.siblings.mesh));
  assert.ok(!overlayable(LOCK.siblings.terminal));
  const nil = "let meshRelease: Version? = nil\n";
  assert.deepEqual(applySwiftRelease(nil, "mesh", "0.7.17").changed, [
    { pkg: "meshRelease", from: "nil", to: '"0.7.17"' },
  ]);
  assert.equal(applySwiftRelease(SWIFT3, "mesh", undefined).text.includes("= nil"), true);
  assert.deepEqual(applySwiftRelease("// nothing\n", "mesh", "1.0.0").missing, ["meshRelease"]);
});

test("RD-3: use links a released cargo plane through a generated config, hides the lock, and use --none restores it byte for byte", (t) => {
  const { dir, root, git } = fixture3(t);
  assert.equal(quiet(() => renderProd(root, { check: true })).result, 0);
  const used = quiet(() => useSiblings(root, ["terminal", "--no-install"]));
  assert.equal(used.result, 0);
  assert.match(used.out, /terminal cargo patch ×1 \(overlay over git\) @ ddddddd/);
  const config = readFileSync(join(root, OVERLAY_CARGO), "utf8");
  assert.match(config, /^# GENERATED by `node scripts\/siblings\.mjs use`/);
  assert.ok(
    config.includes(
      `term-core = { path = ${JSON.stringify(join(dir, "terminal", "native", "core"))} }`,
    ),
  );
  assert.equal(cargoLockHidden(root), true);
  // a dev build rewrites the lock's git source as a path entry; git does not see it while the overlay stands
  writeFileSync(join(root, "Cargo.lock"), "# rewritten by a dev build: term-core from a path\n");
  assert.equal(git("status", "--porcelain"), "", "the overlay touched what git shows");
  // the pre-commit check refuses while the lock is hidden
  const refused = quiet(() => renderProd(root, { check: true, staged: true }));
  assert.equal(refused.result, 1);
  assert.match(refused.err, /Cargo\.lock is skip-worktree/);
  assert.equal(quiet(() => useSiblings(root, ["--none", "--no-install"])).result, 0);
  assert.ok(!existsSync(join(root, OVERLAY_CARGO)));
  assert.ok(
    !existsSync(join(root, ".cargo")),
    "the directory the generated config made stayed behind",
  );
  assert.equal(cargoLockHidden(root), false);
  assert.equal(
    readFileSync(join(root, "Cargo.lock"), "utf8"),
    "# committed lock: term-core from git\n",
  );
  assert.equal(git("status", "--porcelain"), "");
});

test("RD-3: a hand-written .cargo/config.toml is refused, never overwritten or deleted", (t) => {
  const { root } = fixture3(t);
  mkdirSync(join(root, ".cargo"), { recursive: true });
  writeFileSync(join(root, OVERLAY_CARGO), '[build]\ntarget-dir = "/somewhere"\n');
  assert.throws(
    () => quiet(() => useSiblings(root, ["terminal", "--no-install"])),
    /was not written by this verb/,
  );
  assert.equal(
    readFileSync(join(root, OVERLAY_CARGO), "utf8"),
    '[build]\ntarget-dir = "/somewhere"\n',
  );
  quiet(() => useSiblings(root, ["--none", "--no-install"]));
  assert.ok(existsSync(join(root, OVERLAY_CARGO)), "--none removed a file it did not write");
});

test("RD-3: the cargo shape names the git rev only when it is not the checkout's own", (t) => {
  const { root } = fixture3(t);
  // LOCK3's release rev IS the checkout's sha: the entry's `@ sha` says it once
  assert.match(
    siblingShape(root, LOCK3, ["terminal"]).line,
    /terminal cargo patch ×1 \(overlay over git\) @ ddddddd/,
  );
  assert.match(siblingShape(root, LOCK3, []).line, /terminal cargo git patch ×1 @ ddddddd/);
  assert.doesNotMatch(siblingShape(root, LOCK3, []).line, /@ ddddddd @ /);
  const other = structuredClone(LOCK3);
  other.siblings.terminal.release.cargo.rev = "e".repeat(40);
  assert.match(
    siblingShape(root, other, ["terminal"]).line,
    /terminal cargo patch ×1 \(overlay over git eeeeeee\) @ ddddddd/,
  );
  assert.match(
    siblingShape(root, other, []).line,
    /terminal cargo git patch ×1 @ eeeeeee @ ddddddd/,
  );
});

test("RD-3: use renders a released Swift plane's own manifest line nil (visible), hides Package.resolved, and use --none renders the lock's line back without touching any other edit", (t) => {
  const { root, git } = fixture3(t);
  const manifest = join(root, "apps", "ios", "Kit", "Package.swift");
  const resolved = join(root, "apps", "ios", "Kit", "Package.resolved");
  const used = quiet(() => useSiblings(root, ["mesh", "--no-install"]));
  assert.equal(used.result, 0);
  assert.match(used.out, /mesh swift path package \(overlay over 0\.7\.17\)/);
  assert.match(used.out, /apps\/ios\/Kit\/Package\.swift: meshRelease rendered nil/);
  assert.match(readFileSync(manifest, "utf8"), /^let meshRelease: Version\? = nil$/m);
  // the path package drops the URL row from Package.resolved: the generated lock is hidden; the manifest is NOT
  assert.equal(lockHidden(root, "apps/ios/Kit/Package.resolved"), true);
  writeFileSync(resolved, '{ "pins": [] }\n');
  assert.equal(git("status", "--porcelain"), "M apps/ios/Kit/Package.swift");
  // the working tree carries the overlay's line, so render's check of it passes; the index is the lock's
  assert.equal(quiet(() => renderProd(root, { check: true })).result, 0);
  // a real edit made while the overlay stands
  writeFileSync(manifest, `${readFileSync(manifest, "utf8")}// a real edit\n`);
  git("add", "apps/ios/Kit/Package.swift");
  const refused = quiet(() => renderProd(root, { check: true, staged: true }));
  assert.equal(refused.result, 1);
  assert.match(refused.err, /meshRelease reads nil but siblings\.lock\.json renders "0\.7\.17"/);
  assert.match(refused.err, /Package\.resolved is skip-worktree/);
  git("reset", "--quiet", "--", "apps/ios/Kit/Package.swift");
  assert.equal(quiet(() => useSiblings(root, ["--none", "--no-install"])).result, 0);
  assert.equal(readFileSync(manifest, "utf8"), `${SWIFT3}// a real edit\n`);
  assert.equal(lockHidden(root, "apps/ios/Kit/Package.resolved"), false);
  assert.equal(readFileSync(resolved, "utf8"), '{ "pins": ["mesh 0.7.17"] }\n');
  assert.equal(
    git("status", "--porcelain"),
    "M apps/ios/Kit/Package.swift",
    "only the real edit is left",
  );
  assert.match(siblingShape(root, LOCK3, []).line, /mesh swift exact 0\.7\.17/);
});

test("THIS tree: the committed sibling rows are exactly what its lock renders, and its hook asks the same", () => {
  const checked = quiet(() => renderProd(REPO_ROOT, { check: true }));
  assert.equal(checked.result, 0, checked.err);
  const hook = readFileSync(join(REPO_ROOT, "scripts", "git-hooks", "pre-commit"), "utf8");
  assert.match(hook, /node scripts\/siblings\.mjs render --prod --check --staged/);
});
