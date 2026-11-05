import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundleModulePaths,
  cfgMatches,
  classifyText,
  createLedger,
  desktopNotices,
  forThisHost,
  GHOSTTY_LICENCE,
  GO_SNAPSHOT,
  goBuildInfo,
  hostTarget,
  IOS_OUTPUT,
  kindOfExpression,
  MIT_BODY,
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
    "artifacts.json": { schemaVersion: 1, source: { commit: "83fb95624b04" } },
  });
  return root;
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
    "Ghostty VT (libghostty-vt) 83fb95624b04",
    "alpha 1.0.0",
    "ghosttea-vt-sys 0.14.0",
    "pkg-a 1.2.3",
    "pkg-b 2.0.0",
    "pkg-c 3.0.0",
    "pkg-shared 0.1.0",
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

  // Ghostty's own notice rides with the -sys crate that links it (the guard REQUIRED_DESKTOP holds)
  assert.ok(text.includes(GHOSTTY_LICENCE.split("\n")[2]));
  assert.match(text, /Ghostty VT \(libghostty-vt\) 83fb95624b04\n {4}Licence: MIT\n/);

  // grouped by licence, in KIND_ORDER: MIT, then Apache-2.0, then ISC
  const at = (kind) => text.indexOf(`${RULE}\n${kind}\n${RULE}`);
  assert.ok(at("MIT") > 0 && at("MIT") < at("Apache-2.0") && at("Apache-2.0") < at("ISC"));
  assert.ok(text.indexOf("COMPONENT INDEX") < at("MIT"));
  assert.match(text, /^VibeField 0\.9\.0 — third-party notices\n/);
  assert.match(text, /Components: 7 \(4 npm packages, 2 Rust crates, 1 other component\)/);

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
  assert.ok(!ledger.components.has("other\u0000Ghostty VT (libghostty-vt)\u000083fb95624b04"));
  assert.deepEqual(ledger.gaps, [
    "missing a required attribution: Ghostty's MIT notice (the terminal engine, through ghosttea-vt-sys)",
  ]);
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
