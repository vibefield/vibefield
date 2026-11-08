import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
// Item 259's rule is read through the module, so a missing export is an assertion's red, never a link error.
import * as notices from "../../../scripts/third-party-notices.mjs";
import {
  bundleModulePaths,
  cfgMatches,
  classifyText,
  compilesNative,
  createLedger,
  desktopNotices,
  forThisHost,
  GHOSTTY_LICENCE,
  GHOSTTY_VT_BUNDLED,
  GHOSTTY_VT_LIBRARIES,
  GO_SNAPSHOT,
  ghostteaEcosystem,
  ghosttyVtBundled,
  goBuildInfo,
  hostTarget,
  IOS_OUTPUT,
  kindOfExpression,
  MIT_BODY,
  milleEngine,
  NOTICES_FILE,
  nodeModulesPackage,
  normalizeText,
  parseCargoLock,
  parseGhostteaNotices,
  parseManifest,
  reachableTargets,
  renderAcknowledgements,
  swiftTargets,
  textId,
} from "../../../scripts/third-party-notices.mjs";

// LP-5 (the 0.9 launch) — the third-party notices generator (scripts/third-party-notices.mjs). The real inputs are a
// built tree, cargo's registry and the SwiftPM checkouts, none of which a test may lean on; these run it on a small
// fixture tree that has each shape the real one has: an esbuild bundle's module comments, a production closure with a
// devDependency and another platform's optional package, a Cargo.lock graph with a cfg(windows) and a dev edge, a
// -sys crate that links Ghostty, and two copies of one licence that differ only in line endings and trailing blanks.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RULE = "=".repeat(80);
// The Ghostty commit ghosttea-vt-sys 0.14.0 links, whose library's members GHOSTTY_VT_BUNDLED records.
const GHOSTTY_COMMIT = "83fb95624b0439ee660c2679b43b38c8b63769cd";

const mit = (holder) => `MIT License\n\nCopyright (c) 2020 ${holder}\n\n${MIT_BODY}\n`;
const APACHE =
  "                                 Apache License\n                           Version 2.0, January 2004\n" +
  "                        http://www.apache.org/licenses/\n\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n";
const ISC =
  "ISC License\n\nCopyright (c) 2021 C\n\nPermission to use, copy, modify, and/or distribute this software for any\n" +
  "purpose with or without fee is hereby granted, provided that the above copyright notice and this permission\n" +
  'notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.\n';

function tree(t) {
  // real, as the generator resolves every package directory (macOS's tmpdir is under the /var link)
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-notices-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  };
  // npm: the renderer's closure root (the workspace's own package, never listed) and what it installs
  write("app/package.json", {
    name: "fixture-app",
    version: "1.0.0",
    dependencies: { "pkg-a": "*", "pkg-shared": "*" },
    optionalDependencies: { "plat-other": "*" },
    devDependencies: { "dev-only": "*" },
  });
  write("app/node_modules/pkg-a/package.json", {
    name: "pkg-a",
    version: "1.2.3",
    license: "MIT",
    dependencies: { "pkg-b": "*" },
  });
  write("app/node_modules/pkg-a/LICENSE", mit("A"));
  write("app/node_modules/pkg-b/package.json", {
    name: "pkg-b",
    version: "2.0.0",
    license: "Apache-2.0",
  });
  write("app/node_modules/pkg-b/LICENSE", APACHE);
  // the same text as pkg-a's, with CRLF line endings and trailing blanks: one text, two users
  write("app/node_modules/pkg-shared/package.json", {
    name: "pkg-shared",
    version: "0.1.0",
    license: "MIT",
  });
  write("app/node_modules/pkg-shared/LICENSE.md", `${mit("A").replace(/\n/g, "  \r\n")}\r\n\r\n`);
  write("app/node_modules/dev-only/package.json", {
    name: "dev-only",
    version: "9.9.9",
    license: "MIT",
  });
  write("app/node_modules/dev-only/LICENSE", mit("Dev"));
  write("app/node_modules/plat-other/package.json", {
    name: "plat-other",
    version: "1.0.0",
    license: "MIT",
    os: ["win32"],
  });
  // npm: a bundle's module comments — one package beside the bundler, one reached up a level, one own source file
  write("shell/package.json", { name: "fixture-shell", version: "1.0.0" });
  write("shell/node_modules/pkg-c/package.json", {
    name: "pkg-c",
    version: "3.0.0",
    license: "ISC",
  });
  write("shell/node_modules/pkg-c/LICENSE", ISC);
  write(
    "shell/dist/main.cjs",
    [
      '"use strict";',
      "// node_modules/pkg-c/index.js",
      "var c = 1;",
      "// ../app/node_modules/pkg-a/lib/x.js",
      "var a = 2;",
      "// src/own.ts",
      "var own = 3;",
      "",
    ].join("\n"),
  );
  // cargo: one workspace member, its graph, and cargo's extracted sources (every crate extracted, so the cfg and
  // dev filters are what keep winonly and devcrate out — not their absence)
  write("Cargo.toml", '[workspace]\nmembers = ["crates/root"]\nresolver = "2"\n');
  write(
    "crates/root/Cargo.toml",
    [
      "[package]",
      'name = "root-crate"',
      'version = "0.1.0"',
      "",
      "[dependencies]",
      'alpha = "1"',
      'ghosttea-vt-sys = "0.14"',
      "",
      "[target.'cfg(windows)'.dependencies]",
      'winonly = "0.1"',
      "",
      "[dev-dependencies]",
      'devcrate = "1"',
      "",
    ].join("\n"),
  );
  const reg = 'source = "registry+https://github.com/rust-lang/crates.io-index"';
  write(
    "Cargo.lock",
    [
      "version = 4",
      "",
      "[[package]]",
      'name = "alpha"',
      'version = "1.0.0"',
      reg,
      "",
      "[[package]]",
      'name = "devcrate"',
      'version = "1.0.0"',
      reg,
      "",
      "[[package]]",
      'name = "ghosttea-vt-sys"',
      'version = "0.14.0"',
      reg,
      "",
      "[[package]]",
      'name = "root-crate"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "alpha",',
      ' "devcrate",',
      ' "ghosttea-vt-sys",',
      ' "winonly",',
      "]",
      "",
      "[[package]]",
      'name = "winonly"',
      'version = "0.1.0"',
      reg,
      "",
    ].join("\n"),
  );
  const crate = (name, version, license, files) => {
    write(
      `registry/index/${name}-${version}/Cargo.toml`,
      `[package]\nname = "${name}"\nversion = "${version}"\nlicense = "${license}"\n`,
    );
    for (const [file, body] of Object.entries(files))
      write(`registry/index/${name}-${version}/${file}`, body);
  };
  crate("alpha", "1.0.0", "MIT OR Apache-2.0", {
    "LICENSE-MIT": mit("Alpha"),
    "LICENSE-APACHE": APACHE,
  });
  crate("winonly", "0.1.0", "MIT", { LICENSE: mit("Windows only") });
  crate("devcrate", "1.0.0", "MIT", { LICENSE: mit("Dev crate") });
  crate("ghosttea-vt-sys", "0.14.0", "MIT", {
    LICENSE: mit("James Yong"),
    "artifacts.json": { schemaVersion: 1, source: { commit: GHOSTTY_COMMIT } },
  });
  return root;
}

/**
 * Add a registry crate to a fixture tree as a direct dependency of root-crate: its lock entry, the root's declaration
 * and its extracted source (`manifest` is appended to its [package] table; `files` are crate-relative).
 */
function addCrate(root, { name, version, license = null, manifest = "", files = {} }) {
  const lockFile = join(root, "Cargo.lock");
  // root-crate's own list is the lock's only one naming winonly
  const lock = readFileSync(lockFile, "utf8").replace(
    ' "winonly",\n',
    ` "winonly",\n "${name}",\n`,
  );
  writeFileSync(
    lockFile,
    `${lock}\n[[package]]\nname = "${name}"\nversion = "${version}"\n` +
      'source = "registry+https://github.com/rust-lang/crates.io-index"\n',
  );
  const rootManifest = join(root, "crates/root/Cargo.toml");
  writeFileSync(
    rootManifest,
    readFileSync(rootManifest, "utf8").replace(
      "[dependencies]\n",
      `[dependencies]\n${name} = "${version}"\n`,
    ),
  );
  const dir = join(root, "registry/index", `${name}-${version}`);
  const head = `[package]\nname = "${name}"\nversion = "${version}"\n${license ? `license = "${license}"\n` : ""}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), `${head}${manifest}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const inputsOf = (root, overrides = {}) => ({
  repoRoot: root,
  version: "0.9.0",
  bundles: [
    {
      file: join(root, "shell/dist/main.cjs"),
      base: join(root, "shell"),
      role: "the app's main process",
    },
  ],
  closures: [
    { roots: [join(root, "app")], role: "the app's renderer", platform: "darwin", arch: "arm64" },
  ],
  buildOutput: [],
  cargo: [
    {
      lockFile: join(root, "Cargo.lock"),
      workspaceRoot: root,
      roots: ["root-crate"],
      role: "field-native",
    },
  ],
  sidecar: null,
  vendored: [],
  target: hostTarget("darwin", "arm64"),
  registryDirs: [join(root, "registry/index")],
  ...overrides,
});

const names = (ledger) =>
  [...ledger.components.values()].map((c) => `${c.name} ${c.version}`).sort();

test("texts: one spelling per text, so line endings, trailing blanks and wrapping never split one licence in two", () => {
  const a = mit("A");
  const b = `﻿${a.replace(/\n/g, "  \r\n")}\r\n`;
  assert.equal(normalizeText(b), normalizeText(a));
  assert.equal(textId(a), textId(b));
  assert.equal(textId(a), textId(a.replace(/\n(?!\n)/g, " "))); // rewrapped
  assert.notEqual(textId(a), textId(mit("B")));
  assert.match(textId(a), /^[0-9a-f]{12}$/);
});

test("classification reads a licence's own words, and a NOTICE file is a notice whatever it quotes", () => {
  assert.equal(classifyText(mit("A")), "MIT");
  assert.equal(classifyText(APACHE), "Apache-2.0");
  assert.equal(classifyText(ISC), "ISC");
  assert.equal(classifyText(mit("A"), "THIRD_PARTY_NOTICES.md"), "Notices");
  assert.equal(
    classifyText(
      "Redistribution and use in source and binary forms, with or without modification, are permitted. " +
        "Neither the name of the copyright holder nor the names of its contributors may be used.",
    ),
    "BSD-3-Clause",
  );
  assert.equal(kindOfExpression("(MIT OR Apache-2.0)"), "MIT");
  assert.equal(kindOfExpression("LGPL-3.0-or-later"), "LGPL");
  assert.equal(kindOfExpression("Unicode-3.0"), "Unicode");
  assert.equal(kindOfExpression(null), "Other");
});

test("classification: the X11 spelling of MIT keeps its attribution clause, and a licence in comment markers is still its licence", () => {
  // bytemuck's MIT says "this permission notice (including the next paragraph) shall be included": MIT, never the
  // no-attribution MIT-0, which is the same grant with the attribution sentence gone
  const x11 = mit("Daniel Gee").replace(
    "this permission notice shall",
    "this permission notice (including the next paragraph) shall",
  );
  assert.ok(x11.includes("(including the next paragraph)"));
  assert.equal(classifyText(x11), "MIT");
  assert.equal(classifyText(MIT_BODY.replace(/The above copyright notice[^.]*\.\n?/, "")), "MIT-0");
  // untrusted's LICENSE.txt is ISC written as `//` lines; a C header's ` * ` lines are the same case
  const slashes = ISC.split("\n")
    .map((line) => (line ? `// ${line}` : "//"))
    .join("\n");
  const stars = ["/*", ...ISC.split("\n").map((line) => ` * ${line}`), " */"].join("\n");
  assert.equal(classifyText(slashes), "ISC");
  assert.equal(classifyText(stars), "ISC");
  // classification only: the printed body keeps every character, so its id is its own
  const ledger = createLedger();
  const id = ledger.addText(slashes, "LICENSE.txt");
  assert.equal(ledger.texts.get(id).kind, "ISC");
  assert.ok(ledger.texts.get(id).body.startsWith("// ISC License"));
  assert.notEqual(id, textId(ISC));
});

test("ghosttea's iOS components: a crate is a lower-case name at a semver version, a C library its archive carries never is", () => {
  assert.equal(ghostteaEcosystem({ name: "anyhow", version: "1.0.103" }), "crate");
  assert.equal(ghostteaEcosystem({ name: "zstd-sys", version: "2.0.16+zstd.1.5.7" }), "crate");
  assert.equal(ghostteaEcosystem({ name: "libssh2", version: "libssh2-1.11.1" }), "other");
  // a library the native table names is C whatever its version reads like
  assert.equal(ghostteaEcosystem({ name: "libssh2", version: "1.11.1" }), "other");
  assert.equal(ghostteaEcosystem({ name: "OpenSSL", version: "openssl-3.5.7" }), "other");
  assert.equal(
    ghostteaEcosystem({ name: "Ghostty VT", version: "83fb95624b0439ee660c2679b43b38c8b63769cd" }),
    "other",
  );
  assert.equal(ghostteaEcosystem({ name: "TailscaleKit", version: "d1dc45d0" }), "swift");
  assert.equal(ghostteaEcosystem({ name: "Truffle Swift", version: "101889f6" }), "swift");
});

test("esbuild's module comments name the packages a bundle carries, at their innermost node_modules", () => {
  const paths = bundleModulePaths(
    "// node_modules/a/index.js\nx\n// ../../node_modules/@s/b/lib/c.mjs\n// src/own.ts\n  // not/a/comment.js\n",
  );
  assert.deepEqual(paths, [
    "../../node_modules/@s/b/lib/c.mjs",
    "node_modules/a/index.js",
    "src/own.ts",
  ]);
  assert.equal(nodeModulesPackage("../../node_modules/@s/b/lib/c.mjs"), "../../node_modules/@s/b");
  assert.equal(
    nodeModulesPackage("node_modules/.pnpm/x@1/node_modules/y/index.js"),
    "node_modules/.pnpm/x@1/node_modules/y",
  );
  assert.equal(nodeModulesPackage("src/own.ts"), null);
});

test("cfg conditions hold or not against the target's facts", () => {
  const mac = hostTarget("darwin", "arm64");
  assert.equal(cfgMatches(null, mac), true);
  assert.equal(cfgMatches("cfg(unix)", mac), true);
  assert.equal(cfgMatches("cfg(windows)", mac), false);
  assert.equal(cfgMatches('cfg(target_os = "android")', mac), false);
  assert.equal(cfgMatches('cfg(any(target_os = "macos", target_os = "ios"))', mac), true);
  assert.equal(cfgMatches('cfg(all(unix, not(target_os = "macos")))', mac), false);
  assert.equal(cfgMatches('cfg(target_feature = "neon")', mac), true);
  assert.equal(cfgMatches("aarch64-apple-darwin", mac), true);
  assert.equal(cfgMatches("x86_64-pc-windows-msvc", mac), false);
});

test("a manifest's dependency tables: renames, target conditions, optional and dev edges", () => {
  const m = parseManifest(
    [
      "[package]",
      'name = "p"',
      'version = "1.0.0"',
      'license = "MIT"',
      'description = """',
      "[dependencies] inside a string is not a table",
      '"""',
      "",
      "[dependencies]",
      'serde = { version = "1", optional = true }',
      'core2 = { package = "core-two", version = "0.4" }',
      "",
      '[target."cfg(windows)".dependencies.windows-sys]',
      'version = "0.59"',
      "",
      "[dev-dependencies]",
      'proptest = "1"',
      "",
    ].join("\n"),
  );
  assert.equal(m.name, "p");
  assert.equal(m.license, "MIT");
  const byKey = Object.fromEntries(m.deps.map((d) => [d.key, d]));
  assert.equal(byKey.serde.optional, true);
  assert.equal(byKey.core2.crate, "core-two");
  assert.equal(byKey["windows-sys"].target, "cfg(windows)");
  assert.equal(byKey.proptest.kind, "dev");
  assert.equal(
    parseCargoLock(
      '[[package]]\nname = "x"\nversion = "1.0.0"\ndependencies = [\n "y 2.0.0 (registry+z)",\n]\n',
    )[0].deps[0],
    "y 2.0.0",
  );
});

test("an optional package is for this host only when its os and cpu allow it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vf-notices-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = (name, body) => {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "package.json"), JSON.stringify({ name, ...body }));
    return join(root, name);
  };
  assert.equal(forThisHost(pkg("any", {}), "darwin", "arm64"), true);
  assert.equal(
    forThisHost(pkg("mac-arm", { os: ["darwin"], cpu: ["arm64"] }), "darwin", "arm64"),
    true,
  );
  assert.equal(
    forThisHost(pkg("mac-x64", { os: ["darwin"], cpu: ["x64"] }), "darwin", "arm64"),
    false,
  );
  assert.equal(forThisHost(pkg("not-mac", { os: ["!darwin"] }), "darwin", "arm64"), false);
  assert.equal(forThisHost(pkg("win", { os: ["win32"] }), "darwin", "arm64"), false);
});

test("the desktop notices: what ships, each distinct text once, grouped by licence in the file's order", (t) => {
  const root = tree(t);
  const { text, ledger } = desktopNotices(inputsOf(root));
  assert.deepEqual(ledger.errors, []);
  assert.deepEqual(ledger.gaps, []);
  assert.deepEqual(names(ledger), [
    `Ghostty VT (libghostty-vt) ${GHOSTTY_COMMIT}`,
    "Highway in Ghostty VT 83fb9562",
    "Wuffs in Ghostty VT 83fb9562",
    "Zig compiler_rt in Ghostty VT 83fb9562",
    "alpha 1.0.0",
    "ghosttea-vt-sys 0.14.0",
    "pkg-a 1.2.3",
    "pkg-b 2.0.0",
    "pkg-c 3.0.0",
    "pkg-shared 0.1.0",
    "simdutf in Ghostty VT 83fb9562",
  ]);
  // never a devDependency, another platform's optional package, a cfg(windows) crate or a dev-dependency
  for (const absent of [
    "dev-only",
    "plat-other",
    "winonly",
    "devcrate",
    "fixture-app",
    "root-crate",
  ])
    assert.ok(![...ledger.components.values()].some((c) => c.name === absent), absent);
  assert.ok(ledger.skipped.some((s) => s.startsWith("plat-other ")));

  // dedupe: pkg-a's LICENSE and pkg-shared's LICENSE.md are one text, printed once, naming both
  const a = [...ledger.components.values()].find((c) => c.name === "pkg-a");
  const shared = [...ledger.components.values()].find((c) => c.name === "pkg-shared");
  assert.deepEqual(a.texts, shared.texts);
  const id = a.texts[0];
  assert.equal(text.split(`\n${id} · `).length - 1, 1, "each text's body once");
  assert.match(
    text,
    new RegExp(`${id} · LICENSE, LICENSE\\.md\\nUsed by: pkg-a 1\\.2\\.3, pkg-shared 0\\.1\\.0\\n`),
  );
  // alpha's MIT and the Apache text it shares with pkg-b
  const alpha = [...ledger.components.values()].find((c) => c.name === "alpha");
  const b = [...ledger.components.values()].find((c) => c.name === "pkg-b");
  assert.equal(alpha.licence, "MIT OR Apache-2.0");
  assert.ok(alpha.texts.includes(b.texts[0]));

  // Ghostty's own notice rides with the -sys crate that links it (the guard REQUIRED_DESKTOP holds), and so does each
  // library its static library carries at that commit (GHOSTTY_VT_BUNDLED), each text the library's own
  assert.ok(text.includes(GHOSTTY_LICENCE.split("\n")[2]));
  assert.match(
    text,
    new RegExp(`Ghostty VT \\(libghostty-vt\\) ${GHOSTTY_COMMIT}\\n {4}Licence: MIT\\n`),
  );
  for (const line of [
    "Copyright 2021 The simdutf authors",
    "Copyright (c) The Highway Project Authors. All rights reserved.",
    "Copyright 2023 The Wuffs Authors",
    "Copyright (c) Zig contributors",
  ])
    assert.ok(text.includes(line), line);
  assert.match(text, /simdutf in Ghostty VT 83fb9562\n {4}Licence: Apache-2\.0 OR MIT\n/);

  // grouped by licence, in KIND_ORDER: MIT, then Apache-2.0, then BSD-3-Clause (Highway's), then ISC
  const at = (kind) => text.indexOf(`${RULE}\n${kind}\n${RULE}`);
  assert.ok(at("MIT") > 0 && at("MIT") < at("Apache-2.0") && at("Apache-2.0") < at("ISC"));
  assert.ok(at("Apache-2.0") < at("BSD-3-Clause") && at("BSD-3-Clause") < at("ISC"));
  assert.ok(text.indexOf("COMPONENT INDEX") < at("MIT"));
  assert.match(text, /^VibeField 0\.9\.0 — third-party notices\n/);
  assert.match(text, /Components: 11 \(4 npm packages, 2 Rust crates, 5 other components\)/);

  // plain text a person reads: no host path, no trailing blanks, one final newline
  assert.ok(!text.includes(root), "no absolute path of the building host");
  assert.ok(text.split("\n").every((line) => line === line.trimEnd()));
  assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
});

test("the desktop notices are deterministic: the same tree gives the same bytes, whatever order it is read in", (t) => {
  const root = tree(t);
  const first = desktopNotices(inputsOf(root)).text;
  assert.equal(desktopNotices(inputsOf(root)).text, first);
  const shuffled = inputsOf(root, {
    bundles: [...inputsOf(root).bundles].reverse(),
    closures: [
      {
        roots: [join(root, "app/node_modules/pkg-b")],
        role: "the app's renderer",
        platform: "darwin",
        arch: "arm64",
      },
      ...inputsOf(root).closures,
    ],
  });
  assert.equal(desktopNotices(shuffled).text, first);
  assert.equal(NOTICES_FILE, "THIRD_PARTY_NOTICES.txt");
});

test("a required attribution that no text carries is a gap, never a silent drop", (t) => {
  const root = tree(t);
  // the -sys crate gone from the graph: nothing carries Ghostty's copyright line, and an MIT under the same
  // author's name (as mitchellh/go-ps is, a Go module of the sidecar) must not stand in for it
  const manifest = readFileSync(join(root, "crates/root/Cargo.toml"), "utf8");
  writeFileSync(
    join(root, "crates/root/Cargo.toml"),
    manifest.replace('ghosttea-vt-sys = "0.14"\n', ""),
  );
  const lock = readFileSync(join(root, "Cargo.lock"), "utf8");
  writeFileSync(join(root, "Cargo.lock"), lock.replace(' "ghosttea-vt-sys",\n', ""));
  writeFileSync(join(root, "app/node_modules/pkg-b/LICENSE"), mit("Mitchell Hashimoto"));
  const { ledger } = desktopNotices(inputsOf(root));
  assert.ok(!ledger.components.has(`other\u0000Ghostty VT (libghostty-vt)\u0000${GHOSTTY_COMMIT}`));
  // ... and with no Ghostty VT in the graph, nothing asks for what its library carries
  assert.deepEqual(ledger.gaps, [
    "missing a required attribution: Ghostty's MIT notice (the terminal engine, through ghosttea-vt-sys)",
  ]);
});

// libwebp's own words, as libwebp-sys vendors them (vendor/COPYING's head, vendor/PATENTS's head)
const WEBP_COPYING =
  "Copyright (c) 2010, Google Inc. All rights reserved.\n\nRedistribution and use in source and binary forms, with or " +
  "without\nmodification, are permitted provided that the following conditions are\nmet:\n\n  * Neither the name of " +
  "Google nor the names of its contributors may\n    be used to endorse or promote products derived from this " +
  "software\n    without specific prior written permission.\n";
const WEBP_PATENTS =
  'Additional IP Rights Grant (Patents)\n------------------------------------\n\n"These implementations" means the ' +
  "copyrightable works that implement the WebM\ncodecs distributed by Google as part of the WebM Project.\n";

test("vendored native code is a component of its own: libwebp from libwebp-sys's vendor/, its texts required while the crate ships", (t) => {
  const root = tree(t);
  const sys = addCrate(root, {
    name: "libwebp-sys",
    version: "0.9.6",
    license: "MIT",
    manifest: '\n[build-dependencies.cc]\nversion = "1"\n',
    files: {
      "vendor/COPYING": WEBP_COPYING,
      "vendor/PATENTS": WEBP_PATENTS,
      "vendor/configure.ac":
        "AC_INIT([libwebp], [1.3.1],\n        [https://issues.webmproject.org],,\n",
    },
  });
  const { text, ledger } = desktopNotices(inputsOf(root));
  assert.deepEqual(ledger.gaps, []);
  const webp = ledger.components.get("other\u0000libwebp\u00001.3.1");
  assert.ok(webp, "libwebp is listed beside the crate that compiles it");
  assert.equal(webp.licence, "BSD-3-Clause");
  assert.deepEqual(webp.texts.map((id) => ledger.texts.get(id).kind).sort(), [
    "BSD-3-Clause",
    "Patent grant",
  ]);
  assert.ok(text.includes("Copyright (c) 2010, Google Inc. All rights reserved."));
  assert.ok(text.includes("codecs distributed by Google as part of the WebM Project."));
  assert.match(text, /vendor\/COPYING/, "the file is named where the crate keeps it");
  // the binding itself declares MIT and carries no text: listed as declared, never standing in for libwebp's BSD
  assert.deepEqual(ledger.components.get("crate\u0000libwebp-sys\u00000.9.6").texts, []);

  // the patent grant gone from the crate: a gap where it was read, and the guard's own
  rmSync(join(sys, "vendor/PATENTS"));
  const gaps = desktopNotices(inputsOf(root)).ledger.gaps;
  assert.ok(
    gaps.includes("libwebp-sys 0.9.6: vendor/PATENTS is gone — libwebp's licence is not read"),
  );
  assert.ok(
    gaps.includes(
      "missing a required attribution: libwebp's WebM patent grant (compiled in by libwebp-sys)",
    ),
  );
});

test("the next vendored library is a gap, not a silence: a crate compiling native code with licence files below its root, or none", (t) => {
  const root = tree(t);
  const cc = '\n[build-dependencies]\ncc = "1"\n';
  addCrate(root, {
    name: "vendc-sys",
    version: "1.0.0",
    license: "MIT",
    manifest: cc,
    files: { LICENSE: mit("Binding"), "vendor/libvend/COPYING": mit("Vend C") },
  });
  addCrate(root, { name: "bare-sys", version: "2.0.0", license: "MIT", manifest: cc });
  addCrate(root, {
    name: "linked-sys",
    version: "3.0.0",
    license: "MIT",
    manifest: `links = "linked"\n${cc}`,
    files: { LICENSE: mit("Linked binding"), "linked/LICENSE": mit("Linked C") },
  });
  // a crate that compiles C under its own root licence only, and one with a vendored folder but no native build
  addCrate(root, {
    name: "own-c",
    version: "1.0.0",
    license: "MIT",
    manifest: cc,
    files: { LICENSE: mit("Own C") },
  });
  addCrate(root, {
    name: "pure",
    version: "1.0.0",
    license: "MIT",
    files: { LICENSE: mit("Pure"), "vendor/x/LICENSE": mit("X") },
  });
  const { ledger } = desktopNotices(inputsOf(root));
  assert.deepEqual(ledger.gaps.sort(), [
    "bare-sys 2.0.0 compiles native code and carries no licence text of its own — add its row to NATIVE_LINKS in scripts/third-party-notices.mjs",
    "linked-sys 3.0.0 compiles native code whose licence files below its root (linked/LICENSE) are not read — add its row to NATIVE_LINKS in scripts/third-party-notices.mjs",
    "vendc-sys 1.0.0 compiles native code whose licence files below its root (vendor/libvend/COPYING) are not read — add its row to NATIVE_LINKS in scripts/third-party-notices.mjs",
  ]);
  assert.equal(compilesNative(parseManifest(`[package]\nname = "a"\n${cc}`)), true);
  assert.equal(compilesNative(parseManifest('[package]\nname = "a"\n')), false);
  assert.equal(parseManifest('[package]\nname = "a"\nlinks = "zstd"\n').links, "zstd");
});

test("what Ghostty VT's library carries is measured per commit: a commit the table lacks is a gap until someone measures it", (t) => {
  // the table and the texts agree, and each row's text is its library's own
  for (const [commit, keys] of Object.entries(GHOSTTY_VT_BUNDLED)) {
    assert.match(commit, /^[0-9a-f]{40}$/);
    const { components, gaps } = ghosttyVtBundled(commit, "the terminal");
    assert.deepEqual(gaps, []);
    assert.equal(components.length, keys.length);
    for (const [i, key] of keys.entries()) {
      const lib = GHOSTTY_VT_LIBRARIES[key];
      assert.ok(lib, key);
      assert.equal(components[i].name, lib.name);
      assert.equal(components[i].version, `in Ghostty VT ${commit.slice(0, 8)}`);
      assert.match(components[i].texts[0].body, lib.line);
    }
  }
  assert.equal(classifyText(GHOSTTY_VT_LIBRARIES.highway.body), "BSD-3-Clause");
  for (const key of ["simdutf", "wuffs", "compiler_rt"])
    assert.equal(classifyText(GHOSTTY_VT_LIBRARIES[key].body), "MIT", key);

  // ghosttea moves to a Ghostty the table has not measured: the desktop says so, and still lists Ghostty itself
  const root = tree(t);
  const artifacts = join(root, "registry/index/ghosttea-vt-sys-0.14.0/artifacts.json");
  writeFileSync(
    artifacts,
    JSON.stringify({ schemaVersion: 1, source: { commit: "f".repeat(40) } }),
  );
  const { ledger } = desktopNotices(inputsOf(root));
  assert.ok(ledger.components.has(`other\u0000Ghostty VT (libghostty-vt)\u0000${"f".repeat(40)}`));
  assert.ok(![...ledger.components.values()].some((c) => c.name === "simdutf"));
  assert.deepEqual(ledger.gaps, [
    `Ghostty VT ${"f".repeat(40)}: what its static library carries beside Ghostty is not measured — ` +
      "list its members (`ar -t libghostty-vt.a`) and add the commit to GHOSTTY_VT_BUNDLED",
  ]);
});

test("mille's crates follow the engine the stage ships: a checkout's lock while it is built there, the package's own files once released", async (t) => {
  if (process.platform === "win32") return t.skip("the fixture links packages with symlinks");
  // installedMilleNativeFile's triple, as fieldd's build reads it
  const glibc =
    process.platform === "linux" && process.report?.getReport()?.header?.glibcVersionRuntime;
  const triple = {
    darwin: `darwin-${process.arch}`,
    linux: `linux-${process.arch}-${glibc ? "gnu" : "musl"}`,
  }[process.platform];
  if (!triple || !["arm64", "x64"].includes(process.arch))
    return t.skip("mille ships no engine here");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-notices-mille-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof body === "string" ? body : JSON.stringify(body));
  };
  const link = (target, rel) => {
    rmSync(join(root, rel), { recursive: true, force: true });
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    symlinkSync(join(root, target), join(root, rel));
  };
  const fielddMille = "a/packages/fieldd/node_modules/@vibecook/mille";

  // nothing installed: a problem that names it, never a silent omission
  assert.match((await milleEngine(join(root, "a"))).problem, /not installed beside fieldd/);

  // unreleased (a link: row): the addon is built inside the pinned checkout, so that checkout's lock is its graph
  write("mille-pin/Cargo.lock", "version = 4\n");
  mkdirSync(join(root, "mille-pin/.git"), { recursive: true });
  write("mille-pin/packages/mille/package.json", { name: "@vibecook/mille", version: "0.1.0" });
  write(`mille-pin/packages/mille/mille.${triple}.node`, "addon");
  link("mille-pin/packages/mille", fielddMille);
  assert.deepEqual(await milleEngine(join(root, "a")), { cargo: join(root, "mille-pin") });

  // released (RD-5): the checkout is gone and the addon comes from the platform package beside mille's own
  rmSync(join(root, "mille-pin"), { recursive: true, force: true });
  const store = "a/node_modules/.pnpm/@vibecook+mille@1.0.0/node_modules/@vibecook";
  write(`${store}/mille/package.json`, { name: "@vibecook/mille", version: "1.0.0" });
  write(`${store}/mille-${triple}/package.json`, {
    name: `@vibecook/mille-${triple}`,
    version: "1.0.0",
    license: "MIT",
    main: `mille.${triple}.node`,
  });
  write(`${store}/mille-${triple}/mille.${triple}.node`, "addon");
  write(`${store}/mille-${triple}/LICENSE`, mit("Mille"));
  link(`${store}/mille`, fielddMille);
  const engine = await milleEngine(join(root, "a"));
  assert.deepEqual(engine, { npm: join(root, `${store}/mille-${triple}`) });

  // the package speaks for itself; one that carries no notices for the crates it links is a gap, one that does is not
  const notices = (pkgDir) => {
    const fixture = tree(t);
    return desktopNotices(
      inputsOf(fixture, { packages: [{ dir: pkgDir, role: "mille's engine", native: true }] }),
    ).ledger;
  };
  const bare = notices(engine.npm);
  assert.ok(bare.components.has(`npm\u0000@vibecook/mille-${triple}\u00001.0.0`));
  assert.deepEqual(bare.gaps, [
    `@vibecook/mille-${triple} 1.0.0 is a prebuilt native package with no third-party notices for the crates it ` +
      "links — ask its owner to ship them, or build it from its pinned checkout",
  ]);
  write(`${store}/mille-${triple}/THIRD_PARTY_NOTICES.txt`, mit("A crate mille links"));
  assert.deepEqual(notices(engine.npm).gaps, []);
});

test("the acknowledgements JSON: each text once, every id a component names present, the same bytes twice", () => {
  const build = (order) => {
    const ledger = createLedger();
    const rows = [
      {
        ecosystem: "swift",
        name: "ghosttea",
        version: "0.14.0",
        licence: "MIT",
        texts: [{ file: "LICENSE", body: mit("G") }],
      },
      {
        ecosystem: "crate",
        name: "anyhow",
        version: "1.0.0",
        licence: "MIT OR Apache-2.0",
        texts: [
          { file: "LICENSE-MIT", body: mit("G") },
          { file: "LICENSE-APACHE", body: APACHE },
        ],
      },
      {
        ecosystem: "asset",
        name: "Lobe Icons",
        version: "1.94.0",
        licence: "MIT",
        role: "the agents' marks",
        texts: [{ file: "LICENSE (Lobe Icons)", body: mit("LobeHub") }],
      },
    ];
    for (const row of order(rows)) ledger.add(row);
    return renderAcknowledgements(ledger, {
      pins: { ghosttea: { version: "0.14.0", revision: "abc" } },
    });
  };
  const json = build((r) => r);
  assert.equal(
    build((r) => [...r].reverse()),
    json,
  );
  const doc = JSON.parse(json);
  assert.deepEqual(Object.keys(doc), ["schema", "note", "pins", "components", "texts"]);
  assert.equal(doc.schema, 1);
  assert.deepEqual(
    doc.components.map((c) => [c.ecosystem, c.name]),
    [
      ["crate", "anyhow"],
      ["swift", "ghosttea"],
      ["asset", "Lobe Icons"],
    ],
  );
  const ids = doc.texts.map((x) => x.id);
  assert.deepEqual(ids, [...new Set(ids)].sort());
  assert.equal(ids.length, 3, "ghosttea's and anyhow's MIT are one text");
  for (const c of doc.components)
    for (const id of c.texts) assert.ok(ids.includes(id), `${c.name}: ${id}`);
  assert.deepEqual(doc.components[2].roles, ["the agents' marks"]);
});

test("ghosttea's iOS notices: its index and its documents, read back as it writes them", () => {
  const THIN = "-".repeat(80);
  const text = [
    "GHOSTTEA iOS THIRD-PARTY NOTICES",
    "================================",
    "",
    "COMPONENT INDEX",
    "===============",
    "",
    "Ghostty VT 83fb95624b04",
    "  License: MIT",
    "  Documents: LICENSE-001",
    "",
    "anyhow 1.0.103",
    "  License: MIT OR Apache-2.0",
    "  Documents: LICENSE-001, LICENSE-002",
    "",
    "LICENSE DOCUMENTS",
    "=================",
    "",
    RULE,
    "LICENSE-001 · MIT.txt",
    "SHA-256: 00",
    "Used by: Ghostty VT, anyhow",
    THIN,
    GHOSTTY_LICENCE,
    "",
    RULE,
    "LICENSE-002 · LICENSE-APACHE",
    "Used by: anyhow",
    THIN,
    APACHE,
  ].join("\n");
  const parsed = parseGhostteaNotices(text);
  assert.deepEqual(
    parsed.components.map((c) => [c.name, c.version, c.licence, c.documents]),
    [
      ["Ghostty VT", "83fb95624b04", "MIT", ["LICENSE-001"]],
      ["anyhow", "1.0.103", "MIT OR Apache-2.0", ["LICENSE-001", "LICENSE-002"]],
    ],
  );
  assert.equal(parsed.documents.get("LICENSE-001").file, "MIT.txt");
  assert.equal(
    normalizeText(parsed.documents.get("LICENSE-001").body),
    normalizeText(GHOSTTY_LICENCE),
  );
  assert.equal(classifyText(parsed.documents.get("LICENSE-002").body), "Apache-2.0");
  assert.equal(parseGhostteaNotices("no index here"), null);
});

test("a Package.swift's targets: a one-line target never swallows its neighbour, a nested .target is a dependency", () => {
  const manifest = [
    "let package = Package(",
    '  name: "kit",',
    "  targets: [",
    "    // `.binaryTarget(url:checksum:)` in a comment is no target",
    '    .binaryTarget(name: "Native", path: "Native.xcframework"),',
    '    .target(name: "Diagnostics", path: "Sources/Diagnostics"),',
    '    .target(name: "Performance", path: "Sources/Performance"),',
    "    .target(",
    '      name: "Core",',
    '      dependencies: ["Native", "Performance", .product(name: "Truffle", package: "truffle")],',
    '      path: "Sources/Core"',
    "    ),",
    "    .target(",
    '      name: "SSHShim",',
    '      dependencies: [.target(name: "Native", condition: .when(platforms: [.iOS]))],',
    '      path: "Sources/SSHShim"',
    "    ),",
    '    .target(name: "Terminal", dependencies: ["Core"], path: "Sources/Terminal"),',
    "  ]",
    ")",
  ].join("\n");
  const targets = swiftTargets(manifest);
  assert.deepEqual(
    [...targets.keys()],
    ["Native", "Diagnostics", "Performance", "Core", "SSHShim", "Terminal"],
  );
  assert.deepEqual(targets.get("Diagnostics").deps, []);
  assert.deepEqual(targets.get("Core").deps, ["Native", "Performance", "truffle"]);
  assert.deepEqual(targets.get("SSHShim").deps, ["Native"]);
  assert.deepEqual([...reachableTargets(targets, ["Terminal"])].sort(), [
    "Core",
    "Native",
    "Performance",
    "Terminal",
  ]);
});

test("a Go binary's embedded build info: its toolchain and every module, a replacement standing in for its module", () => {
  const sentinel = (c) => Buffer.alloc(16, c);
  const modinfo = [
    "path\tgithub.com/vibecook/sidecar",
    "mod\tgithub.com/vibecook/sidecar\t(devel)\t",
    "dep\tgolang.org/x/sys\tv0.48.0\th1:x=",
    "dep\tgithub.com/old/mod\tv1.0.0\th1:y=",
    "=>\tgithub.com/new/mod\tv1.1.0\th1:z=",
    "build\tGOOS=darwin",
    "",
  ].join("\n");
  const mod = Buffer.concat([sentinel(0x30), Buffer.from(modinfo), sentinel(0x31)]);
  const varint = (n) =>
    Buffer.from([(n & 0x7f) | (n > 0x7f ? 0x80 : 0), ...(n > 0x7f ? [n >> 7] : [])]);
  const header = Buffer.concat([
    Buffer.from("\xff Go buildinf:", "latin1"),
    Buffer.from([8, 2]),
    Buffer.alloc(16),
  ]);
  const version = Buffer.from("go1.27.3");
  const binary = Buffer.concat([
    Buffer.from("leading bytes"),
    header,
    varint(version.length),
    version,
    varint(mod.length),
    mod,
  ]);
  const info = goBuildInfo(binary);
  assert.equal(info.goVersion, "go1.27.3");
  assert.equal(info.path, "github.com/vibecook/sidecar");
  assert.deepEqual(info.deps, [
    { path: "golang.org/x/sys", version: "v0.48.0" },
    { path: "github.com/new/mod", version: "v1.1.0" },
  ]);
  assert.equal(info.build.GOOS, "darwin");
  assert.equal(goBuildInfo(Buffer.from("no build info at all")), null);
});

// Item 259 (2026-11-08) — a sibling the kit links as a Swift package takes the desktop's sibling rule on its
// checkout: the owner's own with no licence file (listed so the inventory is whole; the phone's page draws no own
// part), a licensed row with one, and no row while the kit's manifest takes none of its products.
test("item 259: a sibling the kit links is the owner's own with no licence file, licensed with one, absent unlinked", (t) => {
  assert.equal(
    typeof notices.iosSiblingRows,
    "function",
    "the iOS path applies the sibling rule (item 259)",
  );
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-notices-ios-sibling-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkouts = join(root, "checkouts");
  mkdirSync(join(checkouts, "rosetta"), { recursive: true });
  writeFileSync(join(checkouts, "rosetta", "Package.swift"), "// swift-tools-version: 6.0\n");
  const pins = {
    rosetta: { version: "0.1.5", revision: "811e554c64e60509ef624660f0709fd33717cc2c" },
  };
  const takes = '        .product(name: "RosettaClient", package: "rosetta"),\n';
  assert.deepEqual(notices.iosSiblingRows({ kitManifest: takes, checkouts, pins }), [
    {
      ecosystem: "swift",
      name: "rosetta",
      version: "0.1.5",
      own: true,
      note: "agent history's Swift client (RosettaClient); the owner's own, UNLICENSED",
    },
  ]);
  writeFileSync(join(checkouts, "rosetta", "LICENSE"), mit("Rosetta"));
  assert.deepEqual(notices.iosSiblingRows({ kitManifest: takes, checkouts, pins }), [
    {
      ecosystem: "swift",
      name: "rosetta",
      version: "0.1.5",
      licence: null,
      texts: [{ file: "LICENSE", body: mit("Rosetta") }],
      role: "agent history",
    },
  ]);
  const unlinked = '        .product(name: "Truffle", package: "truffle"),\n';
  assert.deepEqual(notices.iosSiblingRows({ kitManifest: unlinked, checkouts, pins }), []);
});

// Item 259 — the desktop's cargo sibling (rosettad's crates), held as it reads today, before and after the rule moves
// into the one `siblingRow` the iOS path shares: the owner's own with no licence, a licensed crate with one.
test("the desktop's cargo sibling: the owner's own with no licence, a licensed crate with a licence file", (t) => {
  const root = tree(t);
  const sibling = {
    name: "rosetta",
    ownNote: "agent history (rosettad and its crates); the owner's own, UNLICENSED",
  };
  const read = () => {
    const ledger = createLedger();
    notices.collectCargo(ledger, {
      lockFile: join(root, "Cargo.lock"),
      workspaceRoot: root,
      roots: ["root-crate"],
      target: hostTarget("darwin", "arm64"),
      registryDirs: [join(root, "registry/index")],
      role: "rosettad (agent history)",
      sibling,
    });
    const c = [...ledger.components.values()].find((x) => x.name === "rosetta");
    return c && { ...c, texts: c.texts.map((id) => [...ledger.texts.get(id).files]) };
  };
  assert.deepEqual(read(), {
    ecosystem: "crate",
    name: "rosetta",
    version: "",
    licence: null,
    texts: [],
    roles: [],
    own: true,
    note: sibling.ownNote,
  });
  writeFileSync(join(root, "LICENSE"), mit("Rosetta"));
  assert.deepEqual(read(), {
    ecosystem: "crate",
    name: "rosetta",
    version: "",
    licence: null,
    texts: [["LICENSE"]],
    roles: ["rosettad (agent history)"],
    own: false,
    note: null,
  });
});

test("the committed records are the pins' own: the iOS acknowledgements and the sidecar's Go record", () => {
  // The iOS build runs no Node, so its acknowledgements are committed; this holds them to Package.resolved's pins
  // (regenerate with `node scripts/third-party-notices.mjs --ios --checkouts <DerivedData>/SourcePackages/checkouts`).
  const doc = JSON.parse(readFileSync(join(REPO_ROOT, IOS_OUTPUT), "utf8"));
  const resolved = JSON.parse(
    readFileSync(join(REPO_ROOT, "apps/ios/VibeFieldKit/Package.resolved"), "utf8"),
  );
  for (const pin of resolved.pins)
    assert.deepEqual(
      doc.pins[pin.identity],
      { version: pin.state.version, revision: pin.state.revision },
      pin.identity,
    );
  const ids = new Set(doc.texts.map((x) => x.id));
  for (const c of doc.components)
    for (const id of c.texts) assert.ok(ids.has(id), `${c.name}: ${id}`);
  const bodies = doc.texts.map((x) => x.body).join("\n");
  assert.match(bodies, /Copyright \(c\) 2024 Mitchell Hashimoto, Ghostty contributors/);
  assert.match(bodies, /Tailscale & AUTHORS/);
  assert.match(bodies, /Jan Mróz[\s\S]*creativecommons\.org\/licenses\/by\/3\.0/);
  for (const name of [
    "TailscaleKit",
    "truffle",
    "ghosttea",
    "gvisor.dev/gvisor",
    "Lobe Icons",
    "Sparks from Fire (shader)",
  ])
    assert.ok(
      doc.components.some((c) => c.name === name),
      name,
    );
  assert.ok(
    doc.components.some((c) => c.licence === "OFL-1.1"),
    "the terminal's fonts",
  );
  // item 259: VibeField's own rides the record, so its inventory is whole (the phone's page draws no own part)
  const rosetta = doc.components.find((c) => c.ecosystem === "swift" && c.name === "rosetta");
  assert.deepEqual(
    rosetta && { version: rosetta.version, own: rosetta.own, texts: rosetta.texts },
    { version: doc.pins.rosetta.version, own: true, texts: [] },
    "the record lists rosetta's Swift client as VibeField's own",
  );
  // what Ghostty VT's library carries rides with it (measured for its commit), and a C library is never a Rust crate
  const ghosttyVt = doc.components.find((c) => c.name === "Ghostty VT");
  assert.ok(GHOSTTY_VT_BUNDLED[ghosttyVt.version], `Ghostty VT ${ghosttyVt.version} is measured`);
  for (const key of GHOSTTY_VT_BUNDLED[ghosttyVt.version])
    assert.ok(
      doc.components.some((c) => c.name === GHOSTTY_VT_LIBRARIES[key].name),
      key,
    );
  for (const c of doc.components.filter((c) => c.ecosystem === "crate"))
    assert.match(c.version, /^\d+\.\d+\.\d+/, c.name);
  assert.equal(doc.components.find((c) => c.name === "libssh2")?.ecosystem, "other");

  // The release host has no Go toolchain, so the sidecar's Go texts are committed; the stager checks them against
  // the binary's own build info, and this holds the record to the version apps/desktop installs.
  const go = JSON.parse(readFileSync(join(REPO_ROOT, GO_SNAPSHOT), "utf8"));
  const desktop = JSON.parse(readFileSync(join(REPO_ROOT, "apps/desktop/package.json"), "utf8"));
  const sidecars = Object.entries(desktop.optionalDependencies ?? {}).filter(([n]) =>
    n.startsWith("@vibecook/truffle-sidecar-"),
  );
  assert.ok(sidecars.length > 0);
  for (const [name, version] of sidecars) assert.equal(go.sidecar.version, version, name);
  for (const m of go.modules) for (const id of m.texts) assert.ok(go.texts[id], `${m.path}: ${id}`);
});

test("the stage generates the notices and ships them with Electron's and Node's licences in Resources/legal", () => {
  // A source-level guard, as for the stager's other rows (it stages at import time, so it cannot be imported).
  const stager = readFileSync(join(REPO_ROOT, "scripts/stage-package.mjs"), "utf8");
  assert.match(stager, /import \{[^}]*\bstageNotices\b[^}]*\} from "\.\/third-party-notices\.mjs"/);
  assert.match(stager, /const STAGE_ROOTS = \[[^\]]*"legal"[^\]]*\]/);
  assert.match(stager, /\.\.\.stageExternals\(\{ repoRoot \}\)\.map\(/);
  assert.match(stager, /STALE {2}\$\{notices\.rel\}/);
  const builder = readFileSync(
    join(REPO_ROOT, "apps/desktop/packaging/electron-builder.yml"),
    "utf8",
  );
  assert.match(builder, /- from: build\/stage\/legal\n {4}to: legal\n/);
});
