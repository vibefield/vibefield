#!/usr/bin/env node
// Build the standalone fieldd executable — a Node single-executable application.
//
// Specs: electron-distribution-and-tray.md EDP-14 (production fieldd is a standalone
// sidecar, never ELECTRON_RUN_AS_NODE), EDP-15 (the SEA is built with the Node major the
// repo pins — dev and release may not straddle majors), EDP-16 (a failed conformance gate
// blocks release; it never licenses falling back to RunAsNode) and §8.2 (the SEA
// configuration + acceptance list). electron-security-packaging.md §9.3 condition 1 — the
// artifact this script produces is what lets RunAsNode be disabled at all.
//
// The mechanics below are not invented here: probe P-A (implementation plan §7, F-9…F-13)
// established them empirically on Node 26 / macOS arm64 — blob → copy node → postject with
// the SEA sentinel fuse → ad-hoc codesign, two sidecars that cannot be embedded, ~145 MB.
// This script is that probe made reproducible and assertable.
//
// Usage:
//   node apps/desktop/packaging/build-fieldd-sea.mjs [--out <dir>] [--verify]
//                                                    [--timestamp <iso8601|epoch-seconds>]
//
// Node >=26 ESM. Depends only on builtins plus `postject`, resolved from apps/desktop's
// node_modules — a build step that reaches the network (npx) is not reproducible.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const outDir = resolve(root, argValue("--out") ?? join("apps", "desktop", "build", "fieldd-sea"));
const wantVerify = args.includes("--verify");

const FIELDD_DIST = join(root, "packages", "fieldd", "dist");
const BUNDLE = join(FIELDD_DIST, "bin.cjs");
const BUILD_CMD = "pnpm --filter @vibefield/fieldd build";
const EXE_NAME = "fieldd";
const MANIFEST_NAME = "fieldd.sea.manifest.json";

// F-10: neither of these can live inside the blob, and both resolve against the
// EXECUTABLE'S directory (F-11: __dirname in a SEA is the executable's dir, not the cwd),
// so whatever stages the package must copy them beside the binary. The manifest below
// re-states this so the stager reads it off the artifact instead of off this comment.
const SIDECARS = [
  {
    name: "service-harness.mjs",
    why: "PluginHost worker entry — `new Worker(path)` needs a real path on disk",
  },
  {
    name: "loro_wasm_bg.wasm",
    why: "loro-crdt reads it with readFileSync(join(__dirname, …)); bundling the JS carries none of it",
  },
];

// postject's SEA contract. The sentinel fuse and the Mach-O segment name are Node's, not
// postject's defaults — injecting under the default names produces a binary that runs as a
// plain Node REPL, which is the confusing failure mode P-A hit first.
const SEA_RESOURCE = "NODE_SEA_BLOB";
const SEA_SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SEA_MACHO_SEGMENT = "NODE_SEA";

const fail = (msg) => {
  console.error(`build-fieldd-sea FAIL: ${msg}`);
  process.exit(1);
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const rel = (path) => relative(root, path).split(sep).join("/");
const describe = (path) => ({ path: rel(path), bytes: statSync(path).size, sha256: sha256(path) });
// Decimal MB on purpose: F-13 and the distribution spec's installer-size budget (§13.8)
// both talk in decimal, and a MiB figure here would read as an unexplained 5% shrink.
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// --- 1. the Node major, asserted (EDP-15, decision D-node) --------------------
// EL8's lockstep law applied to the runtime itself: the SEA embeds whichever Node is
// running this script, so a developer on a different major silently ships a different
// runtime than the one the repo tests against. .nvmrc is the single source of that number
// — this refuses rather than records the drift.
function assertNodeMajor() {
  const nvmrcPath = join(root, ".nvmrc");
  if (!existsSync(nvmrcPath)) fail(`no .nvmrc at ${rel(nvmrcPath)} — EDP-15 has nothing to pin to`);
  const pinned = readFileSync(nvmrcPath, "utf8").trim();
  const pinnedMajor = Number(pinned.replace(/^v/, "").split(".")[0]);
  if (!Number.isInteger(pinnedMajor)) {
    fail(`.nvmrc says "${pinned}", which names no Node major — EDP-15 needs a concrete version`);
  }
  const running = process.versions.node;
  const runningMajor = Number(running.split(".")[0]);
  if (runningMajor !== pinnedMajor) {
    console.error(
      [
        `build-fieldd-sea FAIL: Node major mismatch — running ${running}, .nvmrc pins ${pinned}.`,
        "",
        "EDP-15 forbids dev and release straddling Node majors: this executable EMBEDS the",
        "running Node binary, so building it here would ship a runtime the repo never tests.",
        `Switch first (\`nvm use\` / \`fnm use\` reads .nvmrc), then re-run.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  return { version: running, major: runningMajor, pinned };
}

// --- 2. the inputs, asserted present and fresh --------------------------------
// "Never build a SEA from a stale or missing bundle" is not pedantry: the artifact is
// opaque once injected, and a stale blob produces a 145 MB binary that looks perfect and
// runs last week's daemon. Cheapest honest check is mtime against the sources esbuild
// actually consumes — fieldd's own src plus the workspace packages it declares.
function workspaceSourceDirs() {
  const fieldd = JSON.parse(readFileSync(join(root, "packages", "fieldd", "package.json"), "utf8"));
  const wanted = new Set(
    Object.entries(fieldd.dependencies ?? {})
      .filter(([, spec]) => String(spec).startsWith("workspace:"))
      .map(([name]) => name),
  );
  const dirs = [join(root, "packages", "fieldd", "src")];
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJson = join(root, "packages", entry.name, "package.json");
    if (!existsSync(pkgJson)) continue;
    const { name } = JSON.parse(readFileSync(pkgJson, "utf8"));
    // Directory names and package names disagree (plugin-build lives in plugin-runtime),
    // so match on the declared name rather than guessing the path.
    if (wanted.has(name) && existsSync(join(root, "packages", entry.name, "src"))) {
      dirs.push(join(root, "packages", entry.name, "src"));
    }
  }
  return dirs;
}

function newestSourceFile(dirs) {
  let newest = { path: undefined, mtimeMs: 0 };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx|mjs|cjs|js|json|wasm)$/.test(entry.name)) {
        const { mtimeMs } = statSync(p);
        if (mtimeMs > newest.mtimeMs) newest = { path: p, mtimeMs };
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return newest;
}

function assertInputs() {
  const missing = [BUNDLE, ...SIDECARS.map((s) => join(FIELDD_DIST, s.name))].filter(
    (p) => !existsSync(p),
  );
  if (missing.length > 0) {
    console.error(
      [
        `build-fieldd-sea FAIL: fieldd's build output is incomplete — missing ${missing
          .map(rel)
          .join(", ")}.`,
        "",
        `Produce it first:  ${BUILD_CMD}`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const bundleMtime = statSync(BUNDLE).mtimeMs;
  const newest = newestSourceFile(workspaceSourceDirs());
  if (newest.path !== undefined && newest.mtimeMs > bundleMtime) {
    console.error(
      [
        `build-fieldd-sea FAIL: ${rel(BUNDLE)} is older than ${rel(newest.path)}.`,
        "",
        "A SEA is opaque once injected — a stale bundle ships as a binary that looks correct.",
        `Rebuild first:  ${BUILD_CMD}`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

// --- 3. build ------------------------------------------------------------------
function run(cmd, cmdArgs, what, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "inherit", "inherit"], ...opts });
  if (r.error) fail(`${what}: ${r.error.message}`);
  if (r.status !== 0) fail(`${what} exited ${r.status ?? `on ${r.signal}`}`);
}

function buildSea() {
  mkdirSync(outDir, { recursive: true });
  const exe = join(outDir, EXE_NAME);
  const blob = join(outDir, "fieldd.blob");
  const cfg = join(outDir, "sea-config.json");

  // RELATIVE paths, generated from inside outDir — not a style choice. Node's SEA
  // blob RECORDS the main script's path verbatim, so an absolute `main` ships the
  // build machine's home directory inside a 145 MB binary. stage-package's §13.2
  // leak check caught exactly that on the first real build; with a bare `bin.cjs`
  // the recorded string is `bin.cjs` and nothing else. The bundle is copied in
  // rather than referenced so the relative name resolves.
  const localBundle = join(outDir, "bin.cjs");
  copyFileSync(BUNDLE, localBundle);

  // useCodeCache/useSnapshot stay off: both bake V8 state tied to the exact Node build,
  // and neither is needed to meet the cold-start budget today. Turning either on is a
  // deliberate change with its own conformance evidence, not a default.
  writeFileSync(
    cfg,
    `${JSON.stringify(
      {
        main: "bin.cjs",
        output: "fieldd.blob",
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    )}\n`,
  );
  run(process.execPath, ["--experimental-sea-config", "sea-config.json"], "sea-config", {
    cwd: outDir,
  });
  rmSync(localBundle, { force: true });

  // Copy the CURRENT Node binary — this is the runtime the .nvmrc guard above just
  // asserted, so the artifact and the repo's test runtime are the same build.
  copyFileSync(process.execPath, exe);
  chmodSync(exe, 0o755);

  // macOS: injection rewrites the Mach-O, which invalidates the signature Node ships with;
  // Apple Silicon refuses to execute an unsigned Mach-O at all, so the signature has to be
  // removed before and re-applied (ad-hoc) after. Real Developer ID signing is WP10's job.
  const darwin = process.platform === "darwin";
  if (darwin) run("codesign", ["--remove-signature", exe], "codesign --remove-signature");

  const require = createRequire(join(root, "apps", "desktop", "package.json"));
  const { inject } = require("postject");
  return { exe, blob, cfg, darwin, inject };
}

async function injectAndSign({ exe, blob, darwin, inject }) {
  await inject(exe, SEA_RESOURCE, readFileSync(blob), {
    sentinelFuse: SEA_SENTINEL,
    machoSegmentName: SEA_MACHO_SEGMENT,
    overwrite: true,
  });
  if (darwin) run("codesign", ["--sign", "-", exe], "codesign --sign -");
}

// --- 4. the manifest -----------------------------------------------------------
// Small, beside the artifact, and read BY the stager rather than duplicated in it: it
// names the sidecars that must travel with the executable and records what §8.2 asks
// release metadata to carry (Node version + bundle hash).
function resolveTimestamp() {
  const raw = argValue("--timestamp") ?? process.env["SOURCE_DATE_EPOCH"];
  if (raw === undefined) return new Date().toISOString();
  const epoch = Number(raw);
  const d = Number.isFinite(epoch) ? new Date(epoch * 1000) : new Date(raw);
  if (Number.isNaN(d.getTime())) fail(`--timestamp "${raw}" is neither ISO-8601 nor epoch seconds`);
  return d.toISOString();
}

function writeManifest({ exe, blobSha256, node }) {
  const manifest = {
    "//": "Standalone fieldd SEA (EDP-14/15, §8.2). Generated by apps/desktop/packaging/build-fieldd-sea.mjs — do not hand-edit.",
    kind: "fieldd-sea",
    builtAt: resolveTimestamp(),
    platform: process.platform,
    arch: process.arch,
    node: { version: node.version, major: node.major, nvmrc: node.pinned },
    source: describe(BUNDLE),
    output: { name: EXE_NAME, ...describe(exe) },
    // The stager copies these BESIDE the executable. They are not optional and they are
    // not embeddable (F-10); a package missing either boots into a bare ENOENT.
    sidecars: SIDECARS.map((s) => ({
      name: s.name,
      ...describe(join(FIELDD_DIST, s.name)),
      why: s.why,
    })),
    sea: {
      resourceName: SEA_RESOURCE,
      sentinelFuse: SEA_SENTINEL,
      machoSegmentName: SEA_MACHO_SEGMENT,
      blobSha256,
      useSnapshot: false,
      useCodeCache: false,
    },
    signature: process.platform === "darwin" ? "adhoc" : "none",
  };
  const path = join(outDir, MANIFEST_NAME);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, path };
}

// --- 5. --verify: does it boot, and does it stay off the filesystem? -----------
// Both claims are made by RUNNING the artifact, never by reasoning about it. §8.2 asks for
// "proves zero filesystem node_modules resolution" — absence of node_modules proves only
// that nothing was there to find, so the second sandbox plants a hostile one.

/** Walk to the filesystem root asserting no ancestor could supply a node_modules. */
function ancestorsWithNodeModules(dir) {
  const hits = [];
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, "node_modules"))) hits.push(cur);
    const parent = dirname(cur);
    if (parent === cur) return hits;
    cur = parent;
  }
}

/**
 * Boot the executable and wait for fieldd's readiness line. There is no `timeout` binary on
 * this macOS, so the deadline is a timer over a child process.
 */
function bootProbe({ exe, cwd, env, deadlineMs = 30_000 }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // SIGTERM first — bin.ts installs a handler and shuts the daemon down; a process
      // that needs SIGKILL is itself a finding (§8.2 "bounded shutdown").
      const termAt = Date.now();
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => {
        clearTimeout(hard);
        done({ ...result, stdout, stderr, shutdownMs: Date.now() - termAt });
      });
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no readiness line within ${deadlineMs} ms` }),
      deadlineMs,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready === true) finish({ ok: true, ready: msg, bootMs: Date.now() - started });
        } catch {
          // partial line; the next chunk completes it
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (e) => finish({ ok: false, reason: `spawn failed: ${e.message}` }));
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ok: false, reason: `exited early (${signal ?? code})`, stdout, stderr });
    });
  });
}

/** Everything fieldd is allowed to see: no NODE_*, no inherited FIELD_*, no ambient PATH. */
function sandboxEnv(home, dataDir, nativeBin) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    // Ephemeral ports: a developer's real daemon may already hold the registered ones,
    // and a port collision would look exactly like a boot failure.
    FIELDD_DATA_DIR: dataDir,
    FIELDD_CONTROL_PORT: "0",
    FIELDD_DATA_PORT: "0",
    // Two planes: fieldd's bootstrap blocks on field-native's pairing file, so "it boots"
    // is only answerable with a native plane present. Pointing at a copy in the sandbox
    // keeps the executable's own directory pristine and gives §8.2's "launches the paired
    // field-native binary" a real answer instead of a mocked one.
    FIELDD_NATIVE_BIN: nativeBin,
  };
}

// TC-S2 — field-native's terminal cell, spawned by the floor as its own sibling. No `.exe`
// variant: this probe is unix-only throughout (it execs /usr/bin/pkill and pins PATH to
// /usr/bin:/bin), so a win32 name here would be the only ported line in the file.
const CELL_NAME = "field-terminal-host";

/** The release field-native, or the debug one; `--native-bin` overrides both. */
function findNativeBin() {
  const override = argValue("--native-bin");
  const candidates =
    override !== undefined
      ? [resolve(root, override)]
      : [
          join(root, "target", "release", "field-native"),
          join(root, "target", "debug", "field-native"),
        ];
  return candidates.find((p) => existsSync(p));
}

/**
 * field-native is spawned DETACHED and outlives fieldd by design (two planes) — the probe
 * must reap the copy it made, or every verify run leaks a daemon holding a sandbox that is
 * about to be deleted. Matching on the sandbox path keeps a developer's real one untouched.
 */
function reapNative(nativePath) {
  spawnSync("/usr/bin/pkill", ["-f", nativePath], { stdio: "ignore" });
}

function stageSandbox(dir, exe) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(exe, join(dir, EXE_NAME));
  chmodSync(join(dir, EXE_NAME), 0o755);
  for (const s of SIDECARS) copyFileSync(join(FIELDD_DIST, s.name), join(dir, s.name));
  return join(dir, EXE_NAME);
}

/** A node_modules that screams if it is ever consulted. */
function plantPoison(dir, marker) {
  for (const name of ["loro-crdt", "ws", "ajv"]) {
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: "0.0.0-poison" }));
    writeFileSync(
      join(pkg, "index.js"),
      [
        "// Planted by build-fieldd-sea.mjs --verify. Loading this file at all means the",
        "// executable resolved a dependency from the filesystem, which EDP §8.2 forbids.",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name)});`,
        `throw new Error("filesystem node_modules was consulted for ${name}");`,
      ].join("\n"),
    );
  }
}

async function verify({ exe, manifest }) {
  const problems = [];
  const say = (ok, line) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) problems.push(line);
  };
  console.log("verify — the artifact, exercised");

  // The manifest is evidence only if it describes THIS file.
  say(sha256(exe) === manifest.output.sha256, `manifest sha256 matches ${rel(exe)}`);

  const nativeSource = findNativeBin();
  if (nativeSource === undefined) {
    console.error(
      [
        "build-fieldd-sea FAIL: --verify needs a field-native binary — fieldd's bootstrap",
        "waits for the native plane's pairing file and exits without one.",
        "",
        "Produce it first:  cargo build --release -p field-native   (or pass --native-bin <path>)",
      ].join("\n"),
    );
    process.exit(1);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "fieldd-sea-verify-"));
  const nativeBin = join(sandbox, "native", "field-native");
  mkdirSync(dirname(nativeBin), { recursive: true });
  copyFileSync(nativeSource, nativeBin);
  chmodSync(nativeBin, 0o755);
  // TC-S2 — the floor booted here is a REAL floor, and its terminal unit spawns the cell it
  // resolves as its own sibling. Copying the cell from the floor's own directory reproduces that
  // resolution law in the sandbox instead of booting a floor that could only report the cell
  // missing; taking it from `dirname(nativeSource)` also keeps the pair matched, so a release
  // floor is never paired with a debug cell.
  const cellSource = join(dirname(nativeSource), CELL_NAME);
  const cellPresent = existsSync(cellSource);
  if (cellPresent) {
    const cellBin = join(dirname(nativeBin), CELL_NAME);
    copyFileSync(cellSource, cellBin);
    chmodSync(cellBin, 0o755);
  }
  say(
    cellPresent,
    cellPresent
      ? `terminal cell staged beside the floor — ${rel(cellSource)}`
      : `no ${CELL_NAME} beside ${rel(nativeSource)}; that floor's terminal unit can only ` +
          `report the cell missing. Build the pair: cargo build --release -p field-native`,
  );
  try {
    const ancestors = ancestorsWithNodeModules(sandbox);
    say(
      ancestors.length === 0,
      `sandbox has no node_modules ancestor${ancestors.length > 0 ? ` (found: ${ancestors.join(", ")})` : ""}`,
    );

    // Probe A — a directory holding the executable and its two sidecars, nothing else.
    // cwd is `/` deliberately: F-11's claim is that __dirname follows the EXECUTABLE, so
    // booting from an unrelated cwd is the claim, not a detail.
    const clean = join(sandbox, "clean");
    const cleanExe = stageSandbox(clean, exe);
    const entries = readdirSync(clean).sort();
    say(
      entries.length === 3 && entries.includes(EXE_NAME),
      `staged dir holds exactly the executable + ${SIDECARS.length} sidecars (${entries.join(", ")})`,
    );
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    const a = await bootProbe({
      exe: cleanExe,
      cwd: "/",
      // Data dirs stay terse: field-native's mgmt socket lives under them, and a unix
      // socket path over SUN_LEN (~104 bytes) fails as "path must be shorter than SUN_LEN".
      env: sandboxEnv(home, join(sandbox, "dA"), nativeBin),
    });
    reapNative(nativeBin);
    say(
      a.ok === true,
      a.ok
        ? `boots from a node_modules-free tree with cwd=/ — ready in ${a.bootMs} ms on control port ${a.ready.port}, bootId ${a.ready.bootId}`
        : `boot: ${a.reason}${a.stderr ? ` — stderr: ${a.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    // The PluginHost worker is the F-11 claim in practice: it is `new Worker(join(__dirname,
    // "service-harness.mjs"))`, so a booted daemon whose harness sits beside the executable
    // proves the sidecar resolved against the EXECUTABLE'S directory, not the cwd.
    if (a.ok) {
      say(
        !/service-harness|Cannot find module|ENOENT/.test(a.stderr),
        "no missing-sidecar complaint on stderr (worker harness resolved from the executable's dir)",
      );
    }
    if (a.ok) say(a.shutdownMs < 5_000, `SIGTERM shutdown in ${a.shutdownMs} ms (no SIGKILL)`);

    // Probe B — same three files, plus a node_modules that would break the daemon if it
    // were ever read, and cwd set to that directory so both resolution roots are hostile.
    const poisoned = join(sandbox, "poisoned");
    const poisonedExe = stageSandbox(poisoned, exe);
    const marker = join(sandbox, "POISON-TOUCHED");
    plantPoison(poisoned, marker);
    const b = await bootProbe({
      exe: poisonedExe,
      cwd: poisoned,
      env: sandboxEnv(home, join(sandbox, "dB"), nativeBin),
    });
    reapNative(nativeBin);
    say(
      b.ok === true,
      b.ok
        ? `boots with a hostile node_modules beside it and as cwd (ready in ${b.bootMs} ms)`
        : `poisoned boot: ${b.reason}${b.stderr ? ` — stderr: ${b.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    say(
      !existsSync(marker),
      existsSync(marker)
        ? `filesystem node_modules WAS consulted (${readFileSync(marker, "utf8")})`
        : "no filesystem node_modules resolution — loro-crdt, ws and ajv all came from the blob",
    );
  } finally {
    reapNative(nativeBin);
    rmSync(sandbox, { recursive: true, force: true });
  }
  return problems;
}

// --- main ----------------------------------------------------------------------
const node = assertNodeMajor();
assertInputs();
console.log(
  `build-fieldd-sea — node ${node.version} (.nvmrc ${node.pinned}) · ${process.platform}-${process.arch}`,
);
console.log(`  source ${rel(BUNDLE)} (${mb(statSync(BUNDLE).size)})`);

const built = buildSea();
// Hash the blob HERE, while it exists: injection consumes it, so hashing after
// injectAndSign reads a path that is already gone (the first real re-run of this
// script failed exactly that way). Its digest is what ties this executable to
// that bundle, and it is 1.4 MB of intermediate nothing should ship.
const blobSha256 = sha256(built.blob);
await injectAndSign(built);
rmSync(built.blob, { force: true });

const { manifest, path: manifestPath } = writeManifest({ ...built, blobSha256, node });
console.log(`  ${rel(built.exe)} — ${mb(manifest.output.bytes)}`);
console.log(`  ${rel(manifestPath)}`);
for (const s of manifest.sidecars) console.log(`  stage beside it: ${s.name} (${mb(s.bytes)})`);

if (wantVerify) {
  const problems = await verify({ exe: built.exe, manifest });
  if (problems.length > 0) {
    console.error(`build-fieldd-sea FAIL: ${problems.length} verification claim(s) did not hold`);
    process.exit(1);
  }
  console.log("verify OK — boots standalone, resolves nothing from the filesystem");
}
console.log(`build-fieldd-sea OK — ${basename(built.exe)}`);
