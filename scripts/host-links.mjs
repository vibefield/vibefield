#!/usr/bin/env node
// BP-1b's gate (2026-10-26; LANDED "BP-1b"; VF-PM 03:14Z and 03:48Z) — a packaged Mach-O loads only what every Mac
// has (`/usr/lib`, `/System`) or what the bundle carries (`@rpath`, `@loader_path`, `@executable_path`). A dependency
// anywhere else, such as Homebrew's `/opt/homebrew` or `/usr/local`, or a build machine's own path, loads on the build
// host alone. Under a signed build's hardened runtime (no library-validation exception) it loads nowhere. The package's
// field-native once linked Homebrew's harfbuzz this way: harfbuzz-sys 0.5.0's build.rs prefers a pkg-config host
// library. No release step noticed, because none loads field-native. (Since the EL8 to ghosttea 0.13.5, 2026-10-26, the
// shaper is harfrust and no harfbuzz-sys is in the graph; this gate stays the defense against the next such build script.)
//
// The load commands are read from the file's own headers: LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB,
// LC_LAZY_LOAD_DYLIB and LC_LOAD_UPWARD_DYLIB, in every architecture of a fat file. Never LC_ID_DYLIB, a dylib's OWN
// install name, which `otool -L` prints first. A build path there is harmless, and reading it as a dependency was this
// finding's own false positive (mille's .node). Not through otool either: it takes `name(member)` for an archive member,
// so Electron's "VibeField Helper (GPU)" cannot be named to it.
//
// The launch check runs each named native binary with `--version`. dyld resolves every load command before `main`, so a
// binary that cannot load fails there, and one that can says its name and exits 0.
//
// LP-6 (2026-11-05) — the build host's PATHS, too. A Rust binary carries the source path of every panic location and
// `file!()`, and a dependency's is its cargo registry checkout under the builder's home: the field-native of a local
// package built 2026-11-03 named `/Users/<name>/.cargo/registry/src/…` 634 times (its cell 377, its freeway host 197;
// `grep -a -o`, read 2026-11-05), and a CI build names `/Users/runner/…` the same way. The release build now remaps
// those prefixes (apps/desktop/packaging/build-native-release.mjs,
// `--remap-path-prefix`), and the packaged app's gate (`--app`) scans `Contents/Resources/bin` for the markers: a hit in
// the floor's set — the binaries that build remaps — fails; a hit in anything else there (rosettad, mille's .node,
// truffle's sidecar: each built by its own project's build) is said and not failed, so the gap stays visible until
// that build remaps too. *(Corrected 2026-11-05, LP-6b: the scan covers every Mach-O of the package, not bin/ alone, and
// rosettad's and mille's builds are ours and now remap, so a hit in either FAILS; truffle's sidecar is the one named
// exception, and the release build remaps only under the release switch. Below.)*
//
// LP-6b (item 170, 2026-11-05) — EVERY shipped Mach-O, counted. prod-builder's strings scan of the published
// nightly-20261104 counted field-native 790, field-terminal-host 378 and field-freeway-host 199 registry paths, rosettad
// 450, mille.darwin-arm64.node 176 plus its own install name (`otool -D`:
// `/Users/runner/work/vibefield/mille-pin/target/…/libmille_binding.dylib`; built here it is the SSD's
// `/Volumes/SamsungRed/rust/target/…`), and truffle's Go sidecar 924 under `hostedtoolcache`, 921 under `go/pkg/mod`
// and 4 under `work/truffle`; zero in the main executable, desktop-haptics, live-surface-adapter, the capture helper and
// Electron's helpers (a local package of 2026-11-03 reads the same counts, `/Users/<name>` for `/Users/runner`). So the
// gate now walks the whole package — bin/*, every .node, the helper executables, Electron's own — and counts each marker
// per file: CI's home, the cargo and Go caches, a target's `deps/` (a dylib's install name) and this host's own target
// directories FAIL wherever they are found, but under a named exception (BUILDER_PATH_EXCEPTIONS), each a binary we do
// not build: truffle's sidecar (Go, built by truffle's CI and installed from npm, nothing staging can rewrite; its
// petition, T14 (the index's next free row), asks for `-trimpath`), loro's wasm (item 176: npm's `loro-crdt` as
// shipped, /Users/runner ×74 and /.cargo/registry ×74), and fieldd (Node's binary; not ours to build — its Node build
// host's `/Users/admin/build/ws`, ×3531, is no marker of ours, so its row REPORTS it, and a marker of ours in it still
// fails). WebAssembly modules are scanned beside the Mach-O files (2026-11-05, VF-PM's ruling of 03:58Z). rustc's
// `/rustc/<commit>/` prefix is counted and said, never failed: it is the toolchain's own virtual path for the standard
// library, the same on every machine (Node's binary, fieldd, carries its compiler's too). The builds that make the rest
// pass remap under the release switch (scripts/build-paths.mjs), and the stage rewrites mille's install name.
//
// Usage: node scripts/host-links.mjs (--app <VibeField.app> | --dir <dir>) [--launch <bin dir>]   (exit 1 on any; the
// launch check needs macOS)
import { spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOOR_BINARIES } from "./native-floor.mjs";

/** The load commands that make a dependency, by number (never LC_ID_DYLIB, 0xd: a dylib's own name). */
export const DEPENDENCY_COMMANDS = new Map([
  [0xc, "LC_LOAD_DYLIB"],
  [0x80000018, "LC_LOAD_WEAK_DYLIB"],
  [0x8000001f, "LC_REEXPORT_DYLIB"],
  [0x20, "LC_LAZY_LOAD_DYLIB"],
  [0x80000023, "LC_LOAD_UPWARD_DYLIB"],
]);
/** Where a shipped dependency may live: on every Mac, or inside the bundle. */
export const ALLOWED_PREFIXES = [
  "/usr/lib/",
  "/System/",
  "@rpath/",
  "@loader_path/",
  "@executable_path/",
];
/** The packaged native binaries the launch check runs, each with `--version`: the floor's set (`native-floor.mjs`), the
 * stage's NATIVE_BINARIES — the floor, its terminal cell and, since F1, its freeway host. */
export const LAUNCHED = FLOOR_BINARIES;

/** One thin image's dependency load commands, from a buffer holding its header and load commands (either byte order). */
export function imageCommands(buf) {
  const magicLE = buf.readUInt32LE(0);
  const le = magicLE === 0xfeedface || magicLE === 0xfeedfacf;
  if (!le && magicLE !== 0xcefaedfe && magicLE !== 0xcffaedfe)
    throw new Error("not a thin Mach-O image");
  const u32 = (at) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ncmds = u32(16);
  let at = u32(0) === 0xfeedfacf ? 32 : 28;
  const out = [];
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = u32(at);
    const size = u32(at + 4);
    if (size < 8 || at + size > buf.length)
      throw new Error(`load command ${i} runs past the headers`);
    const kind = DEPENDENCY_COMMANDS.get(cmd);
    if (kind !== undefined) {
      const from = at + u32(at + 8);
      const nul = buf.indexOf(0, from);
      out.push({
        cmd: kind,
        name: buf.toString("utf8", from, nul === -1 || nul > at + size ? at + size : nul),
      });
    }
    at += size;
  }
  return out;
}

/** A Mach-O file's dependency load commands: its one image, or every architecture of a fat file. */
export function dependencyCommandsOf(file) {
  const fd = openSync(file, "r");
  try {
    const read = (pos, len) => {
      const b = Buffer.alloc(len);
      return b.subarray(0, readSync(fd, b, 0, len, pos));
    };
    const magic = read(0, 4).readUInt32BE(0);
    const bases = [];
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const wide = magic === 0xcafebabf;
      const n = read(4, 4).readUInt32BE(0);
      const table = read(8, n * (wide ? 32 : 20));
      for (let i = 0; i < n; i += 1)
        bases.push(
          wide ? Number(table.readBigUInt64BE(i * 32 + 8)) : table.readUInt32BE(i * 20 + 8),
        );
    } else bases.push(0);
    const out = [];
    for (const base of bases) {
      const head = read(base, 32);
      const le = head.readUInt32LE(0) === 0xfeedface || head.readUInt32LE(0) === 0xfeedfacf;
      const wide = (le ? head.readUInt32LE(0) : head.readUInt32BE(0)) === 0xfeedfacf;
      const sizeofcmds = le ? head.readUInt32LE(20) : head.readUInt32BE(20);
      out.push(...imageCommands(read(base, (wide ? 32 : 28) + sizeofcmds)));
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

/** The dependencies outside the allowed prefixes. */
export function hostLinks(commands) {
  return commands.filter((c) => !ALLOWED_PREFIXES.some((p) => c.name.startsWith(p)));
}

const MACH_O_MAGIC = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xcafebabf, 0xbebafeca,
]);

/** Whether a file is Mach-O (thin either byte order, or fat), by its first bytes. `0xcafebabe` is a Java class file's
 * magic too: a fat header's next word counts its architectures (a handful), a class file's is its version (45 and up). */
export function isMachO(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(8);
    const read = readSync(fd, head, 0, 8, 0);
    if (read < 4) return false;
    const magic = head.readUInt32BE(0);
    if (!MACH_O_MAGIC.has(magic)) return false;
    if (magic === 0xcafebabe && read === 8) return head.readUInt32BE(4) < 30;
    return true;
  } finally {
    closeSync(fd);
  }
}

/** Every regular Mach-O file under `root` (symlinks are not followed: a bundle's framework links point inside it). */
/** A WebAssembly module by its magic, `\0asm`. */
export function isWasm(path) {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && head.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  } finally {
    closeSync(fd);
  }
}

/** Every WebAssembly module under a tree (a shipped `.wasm`, as loro's in bin/), sorted. */
export function wasmFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && lstatSync(path).size >= 4 && isWasm(path)) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

export function machOFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && lstatSync(path).size >= 4 && isMachO(path)) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

/** The gate over a tree: one line per host link (`HOST LINK  <file>: <cmd> <path>`) or unreadable Mach-O, each file
 * named relative to `root`. */
export function auditHostLinks(root, commandsOf = dependencyCommandsOf) {
  const problems = [];
  for (const file of machOFiles(root)) {
    let commands;
    try {
      commands = commandsOf(file);
    } catch (error) {
      problems.push(
        `UNREADABLE  ${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const c of hostLinks(commands))
      problems.push(`HOST LINK  ${relative(root, file)}: ${c.cmd} ${c.name}`);
  }
  return problems;
}

/** LP-6, widened at LP-6b (item 170): a build host's own paths, as no shipped Mach-O may carry them. Each FAILS the gate
 * wherever it is found, but under a row of BUILDER_PATH_EXCEPTIONS that names that file and that marker. */
export const BUILDER_PATH_MARKERS = [
  // GitHub's macOS runner's home: every path a CI build writes (its checkouts, CARGO_HOME, the tool cache)
  "/Users/runner",
  // a dependency's panic locations and `file!()`: its cargo registry checkout, under any home
  "/.cargo/registry",
  // the same for a git dependency's checkout
  "/.cargo/git/checkouts",
  // a rustup toolchain's own files (its rust-src), under any home
  "/.rustup/toolchains",
  // GitHub's tool cache: a Go GOROOT, any setup-* toolchain
  "hostedtoolcache",
  // Go's module cache
  "/go/pkg/mod",
  // a cargo target's deps directory: a dylib's OWN install name (mille's .node, built on CI or on the SSD alike)
  "/release/deps/",
];

/** Counted and said, never failed: rustc's virtual prefix for the standard library it ships (`/rustc/<commit>/library/…`).
 * It is the same on every machine — the compiler's commit, not the builder's path — and no stable flag removes it from a
 * std panic location; Node's own binary (fieldd) carries its compiler's too (read 2026-11-05 on the 11-03 package:
 * field-native 171, rosettad 257, fieldd 96). */
export const TOOLCHAIN_MARKERS = ["/rustc/"];

/** A marker counted only in its whole SHAPE (prod-builder's L6b review, 2026-11-05 03:58Z): rustc's virtual prefix is
 * `/rustc/<its 40-hex commit>/`, so a host path with a `rustc/` directory in it is never counted as the compiler's. Each
 * names the fixed length of what must follow the marker, and its test. */
export const MARKER_SHAPES = new Map([
  ["/rustc/", { tail: 41, fits: (bytes) => /^[0-9a-f]{40}\/$/u.test(bytes.toString("latin1")) }],
]);

/** The named exceptions (item 170; widened 2026-11-05 on VF-PM's ruling of 03:58Z), by file name: the failing markers it
 * may carry (`markers`), any further markers counted and said for that file alone (`reported`: a builder's path that is
 * no marker of ours, so it would otherwise go unsaid), the measurement, why, and where its fix waits. Each is a binary
 * we do not build. Any OTHER marker in it fails like anywhere else, and a row that matched nothing in a package says so
 * (retire it). */
export const BUILDER_PATH_EXCEPTIONS = {
  "sidecar-slim": {
    markers: ["/Users/runner", "hostedtoolcache", "/go/pkg/mod"],
    measured:
      "nightly-20261104 (prod-builder's strings scan): hostedtoolcache 924, /go/pkg/mod 921, /Users/runner/work/truffle 4",
    reason:
      "Go, built by truffle's CI (release-sidecar.yml's `go build` without -trimpath) and installed from npm " +
      "(@vibecook/truffle-sidecar-*): the GOROOT, module-cache and checkout paths sit in the pclntab Go's own runtime " +
      "reads, which no staging step can rewrite",
    petition:
      "the truffle -trimpath petition, T14 (draft/launch/truffle-trimpath-petition.md; upstream on James's word)",
  },
  // item 176: loro's own wasm, as npm ships it
  "loro_wasm_bg.wasm": {
    markers: ["/Users/runner", "/.cargo/registry"],
    measured:
      "the 2026-11-03 local package (this gate's count, 2026-11-05): /Users/runner 74, /.cargo/registry 74 (and rustc's /rustc/ 56)",
    reason:
      "loro-crdt's published wasm (npm `loro-crdt`, the EL8 override), built by loro's CI and copied as shipped: its " +
      "crates' panic locations name that runner's cargo registry, inside a wasm no staging step rebuilds",
    petition:
      "item 176 (upstream: loro's release build remapping its paths, at an EL8 or by a loro petition; James's hand)",
  },
  // Node's own binary: fieldd is Node's official release executable with the SEA blob injected
  fieldd: {
    markers: [],
    reported: ["/Users/admin/build/ws"],
    measured:
      "the 2026-11-03 local package (this gate's count, 2026-11-05): /Users/admin/build/ws 3531 (Node's vendored crates and sources), /rustc/ 96",
    reason:
      "Node's binary; not ours to build (the SEA injects fieldd's bundle into the node release named by .nvmrc, and " +
      "its paths are the Node project's build host)",
    petition: "none: a path of ours or any failing marker in it still fails",
  },
};

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The local target path patterns: each cargo target directory this host sets for every build — the environment's
 * (CARGO_TARGET_DIR, CARGO_BUILD_TARGET_DIR) and the user config's `target-dir` (`$CARGO_HOME/config.toml`, or its
 * legacy `config`; James's Mac shares /Volumes/SamsungRed/rust/target across checkouts). Absolute ones only. A path
 * under one is a build tree's, never a shipped binary's. A sibling's own `.cargo/config.toml` (rosetta's SSD target) is
 * not read: `/release/deps/` stands for any target's install name, and the remap writes OUT_DIR paths as `/target`. */
export function hostTargetMarkers({
  env = process.env,
  home = homedir(),
  read = readTextOrNull,
} = {}) {
  const found = new Set();
  const add = (path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return;
    const trimmed = path.replace(/\/+$/u, "");
    if (trimmed !== "") found.add(trimmed);
  };
  add(env.CARGO_TARGET_DIR);
  add(env.CARGO_BUILD_TARGET_DIR);
  const cargoHome = env.CARGO_HOME || join(home, ".cargo");
  for (const name of ["config.toml", "config"]) {
    const text = read(join(cargoHome, name));
    if (text === null) continue;
    for (const m of text.matchAll(/^\s*(?:build\.)?target-dir\s*=\s*["']([^"']+)["']/gmu))
      add(m[1]);
  }
  return [...found];
}

/** How many times each marker occurs in a file's bytes, read a MiB at a time with an overlap, so one across a read's
 * edge counts once (a match ending inside the carried bytes was counted by the window before). */
export function builderPathCounts(
  file,
  markers = [...BUILDER_PATH_MARKERS, ...TOOLCHAIN_MARKERS],
  chunkSize = 1 << 20,
) {
  const unique = [...new Set(markers)];
  const needles = unique.map((marker) => Buffer.from(marker, "utf8"));
  const shapes = unique.map((marker) => MARKER_SHAPES.get(marker));
  // a match's whole span: the marker and, for a shaped one, the tail its shape fixes
  const spans = needles.map((needle, i) => needle.length + (shapes[i]?.tail ?? 0));
  const overlap = Math.max(0, ...spans.map((span) => span - 1));
  const counts = Object.fromEntries(unique.map((marker) => [marker, 0]));
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(chunkSize);
    let carry = Buffer.alloc(0);
    let position = 0;
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, position);
      if (read === 0) break;
      position += read;
      const window = Buffer.concat([carry, chunk.subarray(0, read)]);
      needles.forEach((needle, i) => {
        for (
          let at = window.indexOf(needle);
          at !== -1;
          at = window.indexOf(needle, at + needle.length)
        ) {
          const end = at + spans[i];
          // a span this window cuts is read whole by the next (the carry holds it), or ends with the file
          if (end > window.length) break;
          // a span ending inside the carried bytes was counted by the window before
          if (end <= carry.length) continue;
          if (shapes[i] === undefined || shapes[i].fits(window.subarray(at + needle.length, end)))
            counts[unique[i]] += 1;
        }
      });
      carry = window.subarray(Math.max(0, window.length - overlap));
    }
  } finally {
    closeSync(fd);
  }
  return counts;
}

/** The markers a file's bytes contain (LP-6's question; build-native-release's scan of what it just built). */
export function builderPathsIn(file, markers = BUILDER_PATH_MARKERS, chunkSize = 1 << 20) {
  const counts = builderPathCounts(file, markers, chunkSize);
  return markers.filter((marker) => counts[marker] > 0);
}

const counted = (counts, markers) => markers.map((m) => `${m} ×${counts[m]}`).join(", ");

/** The builder-path gate over a tree, every Mach-O and every WebAssembly module in it (the wasm since 2026-11-05: loro's,
 * item 176), each marker counted per file:
 *  - `problems`: `BUILDER PATH  <file>: <marker> ×<n>, …` — a failing marker (BUILDER_PATH_MARKERS and `host`, this
 *    host's own target directories) anywhere but under its file's exception row;
 *  - `excepted`: `EXCEPTION  <file>: … — <reason>; measured …; <petition>` — said, not failed;
 *  - `notes`: rustc's own prefix (TOOLCHAIN_MARKERS), said, never failed; and an exception row whose file carried none
 *    of its markers (`retire the row`). */
export function auditBuilderPaths(
  root,
  {
    markers = BUILDER_PATH_MARKERS,
    host = [],
    toolchain = TOOLCHAIN_MARKERS,
    exceptions = BUILDER_PATH_EXCEPTIONS,
    countsOf = builderPathCounts,
  } = {},
) {
  const failing = [...new Set([...markers, ...host])];
  const problems = [];
  const excepted = [];
  const notes = [];
  const exceptionFiles = new Map();
  for (const file of [...machOFiles(root), ...wasmFiles(root)].sort()) {
    const rel = relative(root, file);
    const name = basename(file).replace(/\.exe$/u, "");
    const row = Object.hasOwn(exceptions, name) ? exceptions[name] : undefined;
    const reported = (row?.reported ?? []).filter((m) => !failing.includes(m));
    const counts = countsOf(file, [...failing, ...toolchain, ...reported]);
    const hits = failing.filter((m) => counts[m] > 0);
    const allowed = row === undefined ? [] : hits.filter((m) => row.markers.includes(m));
    const failed = hits.filter((m) => !allowed.includes(m));
    const named = [...allowed, ...reported.filter((m) => counts[m] > 0)];
    if (row !== undefined) exceptionFiles.set(name, [...(exceptionFiles.get(name) ?? []), named]);
    if (failed.length > 0) problems.push(`BUILDER PATH  ${rel}: ${counted(counts, failed)}`);
    if (named.length > 0)
      excepted.push(
        `EXCEPTION  ${rel}: ${counted(counts, named)} — ${row.reason}; measured ${row.measured}; ${row.petition}`,
      );
    const said = toolchain.filter((m) => counts[m] > 0);
    if (said.length > 0)
      notes.push(
        `toolchain path (rustc's own; said, never failed)  ${rel}: ${counted(counts, said)}`,
      );
  }
  for (const [name, seen] of exceptionFiles)
    if (seen.every((named) => named.length === 0))
      notes.push(
        `exception ${name}: carries none of ${[...exceptions[name].markers, ...(exceptions[name].reported ?? [])].join(", ")} now — retire its row in scripts/host-links.mjs`,
      );
  return { problems, excepted, notes };
}

/** The launch check: each of LAUNCHED in `binDir` runs `--version`, exits 0 and names itself; one line per failure. */
export function launchCheck(binDir) {
  const problems = [];
  for (const name of LAUNCHED) {
    const run = spawnSync(join(binDir, name), ["--version"], {
      encoding: "utf8",
      env: {},
      timeout: 15_000,
    });
    const said = (run.stdout ?? "").trim();
    if (run.error !== undefined) problems.push(`${name}: did not run (${run.error.message})`);
    else if (run.status !== 0 || !said.startsWith(`${name} `))
      problems.push(
        `${name}: --version exited ${run.status ?? run.signal}${said === "" ? "" : `, said ${JSON.stringify(said)}`}` +
          `${(run.stderr ?? "").trim() === "" ? "" : ` — ${(run.stderr ?? "").trim().split("\n")[0]}`}`,
      );
  }
  return problems;
}

function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const app = at("--app");
  const root =
    app !== undefined ? resolve(app) : at("--dir") !== undefined ? resolve(at("--dir")) : undefined;
  if (root === undefined)
    throw new Error("usage: --app <VibeField.app> | --dir <dir> [--launch <bin dir>]");
  const launchDir =
    at("--launch") ?? (app !== undefined ? join(root, "Contents", "Resources", "bin") : undefined);
  const files = machOFiles(root);
  const problems = auditHostLinks(root);
  if (launchDir !== undefined && process.platform === "darwin")
    problems.push(...launchCheck(resolve(launchDir)).map((p) => `LAUNCH  ${p}`));
  // LP-6b: the builder-path scan over EVERY Mach-O the tree holds (bin/*, each .node, the helpers, Electron's own) and
  // every WebAssembly module (loro's), with this host's own target directories as markers beside the fixed ones
  const host = hostTargetMarkers();
  const builder = auditBuilderPaths(root, { host });
  problems.push(...builder.problems);
  for (const line of [...builder.excepted, ...builder.notes]) console.log(line);
  for (const p of problems) console.error(p);
  console.log(
    `host-links: ${files.length} Mach-O file(s) and ${wasmFiles(root).length} wasm module(s) under ${root}; ${problems.length === 0 ? "no host link, no builder path" : `${problems.length} problem(s)`}` +
      `${launchDir === undefined || process.platform !== "darwin" ? "" : `; launched ${LAUNCHED.join(", ")} --version`}` +
      `; builder paths counted in every one (${[...BUILDER_PATH_MARKERS, ...host].join(", ")}; ` +
      `${builder.excepted.length} excepted: ${Object.keys(BUILDER_PATH_EXCEPTIONS).join(", ")})`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`host-links: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
