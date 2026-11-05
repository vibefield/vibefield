// BP-1b's gate (scripts/host-links.mjs) and its one release-build entry (apps/desktop/packaging/build-native-release.mjs):
// a packaged Mach-O's dependency load commands are read from `otool -l` — never a dylib's own install name — and any path
// outside /usr/lib, /System or the bundle is refused; the launch check runs each native binary's `--version`; the release
// build is --locked (its HARFBUZZ_SYS_NO_PKG_CONFIG=1 retired with harfbuzz-sys at the EL8 to ghosttea 0.13.5).
// LP-6: the release build remaps the builder's paths (`--remap-path-prefix` through CARGO_ENCODED_RUSTFLAGS, the caller's
// own flags kept), and the gate fails a builder path in the floor's set while saying one in a binary built elsewhere.
// LP-6b (item 170): the gate counts every marker in EVERY Mach-O of the package and fails each one we build — prod-builder's
// counts of nightly-20261104 are its expected red below — with truffle's Go sidecar the one named exception.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RELEASE_BUILD_ARGS } from "../../../apps/desktop/packaging/build-native-release.mjs";
import {
  auditBuilderPaths,
  auditHostLinks,
  BUILDER_PATH_EXCEPTIONS,
  BUILDER_PATH_MARKERS,
  builderPathCounts,
  builderPathsIn,
  dependencyCommandsOf,
  hostLinks,
  hostTargetMarkers,
  imageCommands,
  isMachO,
  isWasm,
  LAUNCHED,
  launchCheck,
  TOOLCHAIN_MARKERS,
  wasmFiles,
} from "../../../scripts/host-links.mjs";

const HOMEBREW = "/opt/homebrew/opt/harfbuzz/lib/libharfbuzz.0.dylib";

/** A thin 64-bit little-endian Mach-O image's header and load commands: a dylib's own name first (LC_ID_DYLIB), then
 * `loads` as [cmd, name] (an rpath among them, which is no dependency). */
function image(loads) {
  const command = (cmd, name, nameAt) => {
    const size = Math.ceil((nameAt + Buffer.byteLength(name) + 1) / 8) * 8;
    const b = Buffer.alloc(size);
    b.writeUInt32LE(cmd, 0);
    b.writeUInt32LE(size, 4);
    b.writeUInt32LE(nameAt, 8);
    b.write(name, nameAt);
    return b;
  };
  const cmds = [
    command(0xd, "/Volumes/build/target/release/deps/libthing.dylib", 24),
    ...loads.map(([cmd, name]) => command(cmd, name, cmd === 0x8000001c ? 12 : 24)),
  ];
  const body = Buffer.concat(cmds);
  const head = Buffer.alloc(32);
  head.writeUInt32LE(0xfeedfacf, 0);
  head.writeUInt32LE(0x0100000c, 4);
  head.writeUInt32LE(6, 12);
  head.writeUInt32LE(cmds.length, 16);
  head.writeUInt32LE(body.length, 20);
  return Buffer.concat([head, body]);
}
const LOADS = [
  [0xc, "/usr/lib/libSystem.B.dylib"],
  [0xc, HOMEBREW],
  [0x80000018, "@rpath/Electron Framework.framework/Electron Framework"],
  [0x8000001c, "/usr/local/lib"],
  [0x8000001f, "/System/Library/Frameworks/CoreText.framework/Versions/A/CoreText"],
];

test("the dependencies are the load commands that load, never a dylib's own install name or an rpath", () => {
  assert.deepEqual(imageCommands(image(LOADS)), [
    { cmd: "LC_LOAD_DYLIB", name: "/usr/lib/libSystem.B.dylib" },
    { cmd: "LC_LOAD_DYLIB", name: HOMEBREW },
    { cmd: "LC_LOAD_WEAK_DYLIB", name: "@rpath/Electron Framework.framework/Electron Framework" },
    {
      cmd: "LC_REEXPORT_DYLIB",
      name: "/System/Library/Frameworks/CoreText.framework/Versions/A/CoreText",
    },
  ]);
});

test("a host link is any dependency outside /usr/lib, /System and the bundle's own paths", () => {
  assert.deepEqual(hostLinks(imageCommands(image(LOADS))), [
    { cmd: "LC_LOAD_DYLIB", name: HOMEBREW },
  ]);
  for (const name of ["/usr/local/lib/libz.dylib", "/Volumes/build/x.dylib", "/Users/me/lib.dylib"])
    assert.equal(hostLinks([{ cmd: "LC_LOAD_DYLIB", name }]).length, 1, name);
  for (const name of ["/usr/lib/libc++.1.dylib", "@loader_path/x.dylib", "@executable_path/../x"])
    assert.equal(hostLinks([{ cmd: "LC_LOAD_DYLIB", name }]).length, 0, name);
});

test("a fat file is read architecture by architecture, and a name with parentheses is read whole", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const thin = image(LOADS);
    const fat = Buffer.alloc(4096 + thin.length);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(1, 4);
    fat.writeUInt32BE(0x0100000c, 8);
    fat.writeUInt32BE(4096, 16);
    fat.writeUInt32BE(thin.length, 20);
    fat.writeUInt32BE(12, 24);
    thin.copy(fat, 4096);
    const helper = join(dir, "VibeField Helper (GPU)");
    writeFileSync(helper, fat);
    assert.deepEqual(
      dependencyCommandsOf(helper).map((c) => c.name),
      imageCommands(thin).map((c) => c.name),
    );
    assert.deepEqual(auditHostLinks(dir), [
      `HOST LINK  VibeField Helper (GPU): LC_LOAD_DYLIB ${HOMEBREW}`,
    ]);
    writeFileSync(join(dir, "broken"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    assert.match(
      auditHostLinks(dir).find((p) => p.startsWith("UNREADABLE")) ?? "",
      /^UNREADABLE {2}broken: /,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on this Mac the reader agrees with otool -arch all -l (every architecture), and a system binary has no host link", (t) => {
  if (process.platform !== "darwin") return t.skip("a macOS binary to read");
  const otool = spawnSync("otool", ["-arch", "all", "-l", "/usr/bin/true"], {
    encoding: "utf8",
  }).stdout;
  const named = [
    ...otool.matchAll(
      /cmd (LC_LOAD_DYLIB|LC_LOAD_WEAK_DYLIB|LC_REEXPORT_DYLIB)\n.*\n\s*name (\S+) /g,
    ),
  ].map((m) => m[2]);
  assert.deepEqual(
    dependencyCommandsOf("/usr/bin/true").map((c) => c.name),
    named,
  );
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    copyFileSync("/usr/bin/true", join(dir, "true"));
    assert.deepEqual(auditHostLinks(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Mach-O is told by its magic; a Java class file's shared magic is not one", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const file = (name, bytes) => {
      const path = join(dir, name);
      writeFileSync(path, Buffer.from(bytes));
      return path;
    };
    assert.equal(isMachO(file("thin64", [0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0])), true);
    assert.equal(isMachO(file("fat", [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2])), true);
    assert.equal(isMachO(file("class", [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34])), false);
    assert.equal(isMachO(file("text", [0x23, 0x21, 0x2f, 0x62])), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the launch check runs each native binary's --version: a name said and exit 0 passes, anything else is said", (t) => {
  if (process.platform === "win32") return t.skip("a shell stand-in");
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const stand = (name, body) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
    };
    // F1: the floor's whole set is launched — the freeway host beside the floor and its cell
    assert.deepEqual(LAUNCHED, ["field-native", "field-terminal-host", "field-freeway-host"]);
    for (const name of LAUNCHED) stand(name, `echo "${name} 0.1.0"`);
    assert.deepEqual(launchCheck(dir), []);
    stand("field-terminal-host", 'echo "dyld: Library not loaded" >&2; exit 134');
    const problems = launchCheck(dir);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /^field-terminal-host: --version exited 134 — dyld: Library not loaded$/,
    );
    // a host from before it answered --version (`unknown flag`, exit 2) is refused the same way
    stand("field-terminal-host", 'echo "field-terminal-host 0.1.0"');
    stand("field-freeway-host", 'echo "field-freeway-host: unknown flag: --version" >&2; exit 2');
    assert.deepEqual(launchCheck(dir), [
      "field-freeway-host: --version exited 2 — field-freeway-host: unknown flag: --version",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("THE release build of field-native is --locked", () => {
  assert.deepEqual(RELEASE_BUILD_ARGS, ["build", "--release", "--locked", "-p", "field-native"]);
});

test("LP-6b: every marker is counted, once each, across a read's edge too", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-builder-paths-"));
  try {
    assert.deepEqual(BUILDER_PATH_MARKERS, [
      "/Users/runner",
      "/.cargo/registry",
      "/.cargo/git/checkouts",
      "/.rustup/toolchains",
      "hostedtoolcache",
      "/go/pkg/mod",
      "/release/deps/",
    ]);
    assert.deepEqual(TOOLCHAIN_MARKERS, ["/rustc/"]);
    const file = join(dir, "field-native");
    // 64-byte reads: the registry path straddles the first edge, the runner's home sits far past it, and the
    // toolchain's prefix twice more (the first across an edge, its commit cut by it); nothing is counted twice for
    // sitting in the carried bytes. The prefix counts only in its SHAPE, `/rustc/<40 hex>/` (prod-builder 03:58Z): a
    // host's own `rustc/` directory and a short commit are no compiler prefix
    const commit = "58cf8f9c35b355199727627d07ae34a4e2846d67";
    const body = Buffer.alloc(560, 0x2e);
    body.write("/Users/me/.cargo/registry/src/x", 50);
    body.write("/Users/me/rustc/build/x", 120);
    body.write("/rustc/58cf8f9c/library", 170);
    body.write("/Users/runner/work", 250);
    body.write(`/rustc/${commit}/library/core`, 300);
    body.write(`/rustc/${commit}/library/std`, 420);
    body.write(`/rustc/${commit}`, 545);
    writeFileSync(file, body);
    const counts = builderPathCounts(file, [...BUILDER_PATH_MARKERS, ...TOOLCHAIN_MARKERS], 64);
    assert.equal(counts["/.cargo/registry"], 1);
    assert.equal(counts["/Users/runner"], 1);
    assert.equal(counts["/rustc/"], 2);
    assert.equal(counts["hostedtoolcache"], 0);
    // the same bytes read whole say the same
    assert.deepEqual(
      builderPathCounts(file, [...BUILDER_PATH_MARKERS, ...TOOLCHAIN_MARKERS]),
      counts,
    );
    assert.deepEqual(builderPathsIn(file, BUILDER_PATH_MARKERS, 64), [
      "/Users/runner",
      "/.cargo/registry",
    ]);
    // what the release build's remap writes is no builder path
    writeFileSync(
      file,
      Buffer.from(
        "/cargo/registry/src/index.crates.io-0/tokio-1/src/lib.rs\0/rustup/x\0/vibefield/packages/x\0/target/release/build/y/out/z.rs",
      ),
    );
    assert.deepEqual(builderPathsIn(file), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tiny Mach-O stand-in (thin 64-bit magic) carrying `parts`, each [text, times]. */
function wasmWith(path, parts) {
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
      ...parts.map(([text, times]) => Buffer.from(`${text}\0`.repeat(times))),
    ]),
  );
}

function machOWith(path, parts) {
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]),
      ...parts.map(([text, times]) => Buffer.from(`${text}\0`.repeat(times))),
    ]),
  );
}

test("LP-6b: THE EXPECTED RED — today's artifacts at prod-builder's counts fail in every binary we build; the sidecar, loro's wasm and Node's fieldd are the named exceptions", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-builder-paths-"));
  try {
    // nightly-20261104 as prod-builder's strings scan counted it (item 170), every CI path under /Users/runner
    const bin = join(dir, "Contents", "Resources", "bin");
    const helpers = join(
      dir,
      "Contents",
      "Frameworks",
      "VibeField Helper (GPU).app",
      "Contents",
      "MacOS",
    );
    const framework = join(
      dir,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
    );
    for (const d of [bin, helpers, framework]) mkdirSync(d, { recursive: true });
    const registry =
      "/Users/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.53.3/src/lib.rs";
    const std = "/rustc/58cf8f9c35b355199727627d07ae34a4e2846d67/library/core/src/panicking.rs";
    machOWith(join(bin, "field-native"), [
      [registry, 790],
      [std, 171],
    ]);
    machOWith(join(bin, "field-terminal-host"), [[registry, 378]]);
    machOWith(join(bin, "field-freeway-host"), [[registry, 199]]);
    machOWith(join(bin, "rosettad"), [[registry, 450]]);
    machOWith(join(bin, "mille.darwin-arm64.node"), [
      [
        "/Users/runner/work/vibefield/mille-pin/target/aarch64-apple-darwin/release/deps/libmille_binding.dylib",
        1,
      ],
      [registry, 176],
    ]);
    machOWith(join(bin, "sidecar-slim"), [
      ["/Users/runner/hostedtoolcache/go/1.27.3/arm64/src/runtime/proc.go", 924],
      ["/Users/runner/go/pkg/mod/tailscale.com@v1.104.1/tsnet/tsnet.go", 921],
      ["/Users/runner/work/truffle/truffle/packages/sidecar-slim/main.go", 4],
    ]);
    // Node's own binary: its compiler's std prefix and Node's build host, which is no marker of ours (its row reports it)
    machOWith(join(bin, "fieldd"), [
      [std, 96],
      ["/Users/admin/build/ws/deps/crates/vendor/temporal_rs/src/lib.rs", 3531],
    ]);
    // loro's wasm as npm ships it (item 176), counted by this gate on the 2026-11-03 package
    wasmWith(join(bin, "loro_wasm_bg.wasm"), [
      [registry, 74],
      ["/rustc/58cf8f9c35b355199727627d07ae34a4e2846d67/library/alloc/src/raw_vec.rs", 56],
    ]);
    machOWith(join(bin, "desktop-haptics.node"), [["@rpath/desktop-haptics.node", 1]]);
    machOWith(join(helpers, "VibeField Helper (GPU)"), [["helper", 1]]);
    machOWith(join(framework, "Electron Framework"), [
      ["/Volumes/Preboot/Cryptexes/OS/System/Library", 3],
    ]);
    writeFileSync(join(bin, "files-host.cjs"), `// ${registry} — not a Mach-O, never read`);

    const gate = auditBuilderPaths(dir);
    assert.deepEqual(gate.problems, [
      "BUILDER PATH  Contents/Resources/bin/field-freeway-host: /Users/runner ×199, /.cargo/registry ×199",
      "BUILDER PATH  Contents/Resources/bin/field-native: /Users/runner ×790, /.cargo/registry ×790",
      "BUILDER PATH  Contents/Resources/bin/field-terminal-host: /Users/runner ×378, /.cargo/registry ×378",
      "BUILDER PATH  Contents/Resources/bin/mille.darwin-arm64.node: /Users/runner ×177, /.cargo/registry ×176, /release/deps/ ×1",
      "BUILDER PATH  Contents/Resources/bin/rosettad: /Users/runner ×450, /.cargo/registry ×450",
    ]);
    assert.equal(gate.excepted.length, 3);
    assert.match(
      gate.excepted[0],
      /^EXCEPTION {2}Contents\/Resources\/bin\/fieldd: \/Users\/admin\/build\/ws ×3531 — Node's binary; not ours to build .*; measured the 2026-11-03 local package .*; none: a path of ours or any failing marker in it still fails$/u,
    );
    assert.match(
      gate.excepted[1],
      /^EXCEPTION {2}Contents\/Resources\/bin\/loro_wasm_bg\.wasm: \/Users\/runner ×74, \/\.cargo\/registry ×74 — loro-crdt's published wasm .*; item 176 \(upstream: /u,
    );
    assert.match(
      gate.excepted[2],
      /^EXCEPTION {2}Contents\/Resources\/bin\/sidecar-slim: \/Users\/runner ×1849, hostedtoolcache ×924, \/go\/pkg\/mod ×921 — Go, built by truffle's CI .* installed from npm .*; measured nightly-20261104 .*; the truffle -trimpath petition, T14 \(draft\/launch\/truffle-trimpath-petition\.md/u,
    );
    assert.deepEqual(gate.notes, [
      "toolchain path (rustc's own; said, never failed)  Contents/Resources/bin/field-native: /rustc/ ×171",
      "toolchain path (rustc's own; said, never failed)  Contents/Resources/bin/fieldd: /rustc/ ×96",
      "toolchain path (rustc's own; said, never failed)  Contents/Resources/bin/loro_wasm_bg.wasm: /rustc/ ×56",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LP-6b: the exception names its file AND its markers — any other marker in the sidecar fails, and a clean one asks to retire the row", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-builder-paths-"));
  try {
    assert.deepEqual(Object.keys(BUILDER_PATH_EXCEPTIONS), [
      "sidecar-slim",
      "loro_wasm_bg.wasm",
      "fieldd",
    ]);
    assert.deepEqual(BUILDER_PATH_EXCEPTIONS["sidecar-slim"].markers, [
      "/Users/runner",
      "hostedtoolcache",
      "/go/pkg/mod",
    ]);
    machOWith(join(dir, "sidecar-slim"), [
      ["/Users/runner/go/pkg/mod/x.go", 2],
      ["/Users/me/.cargo/registry/src/y.rs", 1],
    ]);
    const gate = auditBuilderPaths(dir);
    assert.deepEqual(gate.problems, ["BUILDER PATH  sidecar-slim: /.cargo/registry ×1"]);
    assert.match(
      gate.excepted[0],
      /^EXCEPTION {2}sidecar-slim: \/Users\/runner ×2, \/go\/pkg\/mod ×2 — /u,
    );
    // truffle built it with -trimpath: the row has nothing left to excuse
    machOWith(join(dir, "sidecar-slim"), [["tailscale.com@v1.104.1/tsnet/tsnet.go", 3]]);
    assert.deepEqual(auditBuilderPaths(dir), {
      problems: [],
      excepted: [],
      notes: [
        "exception sidecar-slim: carries none of /Users/runner, hostedtoolcache, /go/pkg/mod now — retire its row in scripts/host-links.mjs",
      ],
    });
    // the same bytes under another name are no exception
    machOWith(join(dir, "sidecar-slim"), [["/Users/runner/go/pkg/mod/x.go", 1]]);
    machOWith(join(dir, "other-sidecar"), [["/Users/runner/go/pkg/mod/x.go", 1]]);
    assert.deepEqual(auditBuilderPaths(dir).problems, [
      "BUILDER PATH  other-sidecar: /Users/runner ×1, /go/pkg/mod ×1",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LP-6b: this host's own target directories are markers too — the SSD's install name fails where no CI marker would", () => {
  const read = (files) => (path) => files[path] ?? null;
  assert.deepEqual(
    hostTargetMarkers({
      env: {},
      home: "/Users/me",
      read: read({
        "/Users/me/.cargo/config.toml":
          '# shared\n[build]\ntarget-dir = "/Volumes/SamsungRed/rust/target/"\n',
      }),
    }),
    ["/Volumes/SamsungRed/rust/target"],
  );
  assert.deepEqual(
    hostTargetMarkers({
      env: {
        CARGO_TARGET_DIR: "/Volumes/ssd/lane",
        CARGO_BUILD_TARGET_DIR: "relative/t",
        CARGO_HOME: "/h",
      },
      home: "/Users/me",
      read: read({
        "/h/config": "build.target-dir = '/Volumes/ssd/shared'\n",
        "/h/config.toml": "[net]\n",
      }),
    }),
    ["/Volumes/ssd/lane", "/Volumes/ssd/shared"],
  );
  assert.deepEqual(hostTargetMarkers({ env: {}, home: "/nowhere", read: () => null }), []);
  const dir = mkdtempSync(join(tmpdir(), "vf-builder-paths-"));
  try {
    // mille's .node as the 11-03 local package carries it: the SSD's install name, a registry under the builder's home
    machOWith(join(dir, "mille.darwin-arm64.node"), [
      [
        "/Volumes/SamsungRed/rust/target/aarch64-apple-darwin/release/deps/libmille_binding.dylib",
        1,
      ],
      ["/Users/me/.cargo/registry/src/index.crates.io-0/notify-6.1.1/src/lib.rs", 176],
    ]);
    assert.deepEqual(
      auditBuilderPaths(dir, { host: ["/Volumes/SamsungRed/rust/target"] }).problems,
      [
        "BUILDER PATH  mille.darwin-arm64.node: /.cargo/registry ×176, /release/deps/ ×1, /Volumes/SamsungRed/rust/target ×1",
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LP-6b (VF-PM 03:58Z): a shipped wasm is scanned like a Mach-O, fieldd's row reports Node's paths and fails ours, and a text file is never read", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-builder-paths-"));
  try {
    const registry =
      "/Users/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x-1.0.0/src/lib.rs";
    wasmWith(join(dir, "other_bg.wasm"), [[registry, 2]]);
    writeFileSync(join(dir, "notes.txt"), `a text, not a module: ${registry}`);
    writeFileSync(join(dir, "tiny.wasm"), Buffer.from([0x00, 0x61, 0x73]));
    assert.equal(isWasm(join(dir, "other_bg.wasm")), true);
    assert.equal(isWasm(join(dir, "notes.txt")), false);
    assert.deepEqual(
      wasmFiles(dir).map((f) => f.slice(dir.length + 1)),
      ["other_bg.wasm"],
    );
    // a wasm under no row fails on our markers like any Mach-O
    assert.deepEqual(auditBuilderPaths(dir).problems, [
      "BUILDER PATH  other_bg.wasm: /Users/runner ×2, /.cargo/registry ×2",
    ]);
    rmSync(join(dir, "other_bg.wasm"));
    // fieldd: Node's build host is reported (never failed); a marker of ours in it fails, row or no row
    machOWith(join(dir, "fieldd"), [
      ["/Users/admin/build/ws/deps/v8/src/api.cc", 4],
      ["/Users/me/.cargo/registry/src/z.rs", 1],
    ]);
    const gate = auditBuilderPaths(dir);
    assert.deepEqual(gate.problems, ["BUILDER PATH  fieldd: /.cargo/registry ×1"]);
    assert.match(
      gate.excepted[0],
      /^EXCEPTION {2}fieldd: \/Users\/admin\/build\/ws ×4 — Node's binary; not ours to build /u,
    );
    // a fieldd that carries none of it asks to retire the row, naming the reported marker
    machOWith(join(dir, "fieldd"), [["node", 1]]);
    assert.deepEqual(auditBuilderPaths(dir).notes, [
      "exception fieldd: carries none of /Users/admin/build/ws now — retire its row in scripts/host-links.mjs",
    ]);
    // the same Node path under another name is no marker of ours: neither failed nor said
    rmSync(join(dir, "fieldd"));
    machOWith(join(dir, "other-node"), [["/Users/admin/build/ws/deps/v8/src/api.cc", 4]]);
    assert.deepEqual(auditBuilderPaths(dir), { problems: [], excepted: [], notes: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
