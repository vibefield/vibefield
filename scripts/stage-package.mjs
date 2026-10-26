#!/usr/bin/env node
// Deterministic package stager (WP4; distribution spec §7.2 build/stage pipeline, §7.3 ASAR
// allowlist + the must-never-ship list, §7.4 external resources; the layout it produces is
// electron-security-packaging.md §10.1's, which owns resource ownership and §10.2's ASAR policy).
//
// Copies an EXACT allowlist out of the build trees into a task-owned stage that
// electron-builder then packages. Nothing is globbed out of `dist/` wholesale: a file reaches a
// package only by being named in PLAN below, which is what keeps the §7.3 list enforceable
// rather than aspirational. `packages/electron-shell/dist/testing/smoke.cjs` is the live proof —
// `pnpm build` emits it on purpose (`pnpm smoke` loads it) and it must never ship, so
// package-census.mjs carries it as an acknowledged non-shipping artifact and this stage is where
// it actually gets dropped.
//
// Usage: node scripts/stage-package.mjs [--out <dir>] [--verify] [--require-complete] [--require-release-key]
//   (no flag)  wipe and rebuild the stage, then verify what was produced
//   --verify   verify an EXISTING stage without touching it — the check CI runs against a stage
//              it did not just create, and the only form that can catch a stale or tampered one
//   --require-complete  make every declared optional gap fatal; release packaging uses this after
//                       the ordinary stage build so an explicitly incomplete preview cannot ship
//   --require-release-key  refuse a stage whose bundled index and trust-root are DEV-keyed (WP8-D4)
//
// Node >=22 ESM, builtins only — no new dependencies, no glob library.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// WP8-D6: the bundled list's one home, shared with smoke:bundled's stager.
import { BUNDLED_PLUGINS } from "../apps/desktop/packaging/bundled-list.mjs";
// Tooling (a) — field-native's binaries are read where cargo builds them, never `<repo>/target` by guess.
import { cargoBinaries } from "./cargo-target.mjs";
import { auditHostLinks, launchCheck } from "./host-links.mjs";
// Not a dependency — a repo script. scripts/siblings.mjs is the ONE reader of
// siblings.lock.json (CLAUDE.md §Machine setup), and staging is its fourth
// consumer after preflight, the Nx cache stamp and the dev runner.
import { cargoBuildFreshness, rosettadBinary, sidecarStagingSource } from "./siblings.mjs";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
// Resolved from the script's own location, not cwd: every path below is repo-relative so the
// stage is identical whichever directory the tool is invoked from (package-census.mjs idiom).
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outRel = argValue("--out") ?? "apps/desktop/build/stage";
const outAbs = resolve(repoRoot, outRel);
const verifyOnly = args.includes("--verify");
const requireComplete = args.includes("--require-complete");
const requireReleaseKey = args.includes("--require-release-key");
// WP12 L4 (R1) — `smoke:update`'s trust-root for a DEV stage (public, root-signed); the producer refuses it on a release
// stage. Its bundled key reaches the producer only through the environment the smoke gave this process.
const devTrustRoot = argValue("--dev-trust-root");

// Modes are SET rather than inherited (§7.4 "executable permission bits are asserted after
// staging"; §13.2 "exact executable modes"). A stage whose modes depend on the umask of whoever
// built it is not deterministic, and a sidecar that lost its exec bit fails at first spawn.
const EXEC_MODE = 0o755;
const DATA_MODE = 0o644;
// Windows has no POSIX mode bits to assert; chmod there is a near no-op, so the mode check is
// skipped rather than reported as a false violation on a legitimately staged tree.
const MODES_ENFORCEABLE = process.platform !== "win32";

// ---- the allowlist ---------------------------------------------------------
// Sidecars are architecture-specific and flat under `bin/` (EDP-22/23) — per-arch subdirectories
// arrive with the universal-build amendment, not before.
//
// Tooling (a), 2026-10-26 — field-native's binaries, LIST-shaped. One release build makes
// them all; each name stages as `bin/<file>`, read from where cargo builds it (`cargoBinaries`: cargo's own target
// directory — CARGO_TARGET_DIR, the other spelling, a config's `build.target-dir`). They were path literals,
// `target/release/<name>` against the repo root, which a lane's CARGO_TARGET_DIR or the shared target-dir made a
// stale file or none, staged as a mere warning. They ship as a SET or not at all (verify's SET check), and a missing
// one is a declared optional gap: warned about loudly, FATAL under --require-complete, the release stage. A third
// binary is one more row.
//   - field-native: the floor.
//   - field-terminal-host (TC-S2): the floor's terminal cell. Flat under `bin/` is the resolution law, not a
//     convenience: the floor finds it as a SIBLING of its own executable (field-native `config.rs::cell_binary()`,
//     with FIELD_NATIVE_CELL_BIN as a test-only override packaging never sets).
const NATIVE_BINARIES = [
  {
    name: "field-native",
    gap: "the field-native sidecar is absent — the packaged app will have no native plane",
  },
  {
    name: "field-terminal-host",
    gap: "the terminal cell binary is absent — the native plane will have no terminal",
  },
];
const nativeFile = (name) => (process.platform === "win32" ? `${name}.exe` : name);
let nativeBuilt = null;
let nativeUnknown = null;
try {
  nativeBuilt = cargoBinaries(
    repoRoot,
    "release",
    NATIVE_BINARIES.map((binary) => binary.name),
  );
} catch (error) {
  nativeUnknown = error instanceof Error ? error.message : String(error);
}
const fielddName = process.platform === "win32" ? "fieldd.exe" : "fieldd";
// FS-1a — mille's napi triple (fieldd workspace/launch.ts `milleTriple`)
const milleNativeName = (() => {
  if (process.platform === "darwin") return `mille.darwin-${process.arch}.node`;
  if (process.platform === "win32") return `mille.win32-${process.arch}-msvc.node`;
  const musl = !process.report?.getReport()?.header?.glibcVersionRuntime;
  return `mille.linux-${process.arch}-${musl ? "musl" : "gnu"}.node`;
})();
const truffleSidecarName = process.platform === "win32" ? "sidecar-slim.exe" : "sidecar-slim";
const trufflePlatform = `${process.platform}-${process.arch}`;
const truffleSidecarPackages = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
if (!truffleSidecarPackages.has(trufflePlatform)) {
  // Names the SET, not a version: the number in this message was `0.7.12` while
  // the pin moved underneath it, and an error that states a version it never
  // read is the class of claim this repo corrects at its source.
  throw new Error(
    `no @vibecook/truffle-sidecar package exists for ${trufflePlatform} ` +
      `(published targets: ${[...truffleSidecarPackages].join(", ")})`,
  );
}

// ---- which sidecar a package stages ----------------------------------------
// The floor resolves this binary BESIDE ITSELF first (services/mesh.rs
// resolve_sidecar), so whatever lands in `bin/` is what a packaged desktop runs.
// While a truffle petition window is open the registry package and the built one
// are NOT interchangeable: a node started gated (UA-P-4 passes `login_allow`)
// refuses to come up against a sidecar below protocol 5 — no row would carry a
// login, the gate would fail closed on every peer — and the floor surfaces that
// as Degraded. The registry package is protocol 4 at 0.7.12; the window's is 5.
// So: window open ⇒ stage the BUILT sidecar; no window ⇒ the registry package,
// exactly as before; window open but the binary missing or stale ⇒ REFUSE. There
// is deliberately no fallback, because the fallback is a green build that ships a
// mismatched pair. The decision and its freshness rule live in siblings.mjs, with
// preflight and `pnpm siblings`, so all three cannot disagree.
const sidecarStaging = sidecarStagingSource(repoRoot);
if (sidecarStaging.source === "refuse") {
  console.error(`stage REFUSED: ${sidecarStaging.reason}`);
  process.exit(1);
}

// ---- which rosettad a package stages (AR-8, L3) ----------------------------
// History's index daemon is the lock's own build — `pnpm siblings:build` puts it
// in the rosetta checkout's cargo target, outside this repo, so the row below
// carries an ABSOLUTE `from` (resolvePlan resolves against the repo root, which
// leaves an absolute path as it is). Optional like the screenshot helper: a
// package without it boots, and fieldd says in a person's words that this copy
// has no agent history. A binary older than a source cargo RECORDED it was
// built from (its dep-info — `cargoBuildFreshness`, item 56) is preflight's
// WARN, said again here where the binary ships; a warning, because the package
// still boots, and the build that clears it is `pnpm siblings:build`.
const rosettadName = process.platform === "win32" ? "rosettad.exe" : "rosettad";
const rosettadBuilt = rosettadBinary(repoRoot);
if (rosettadBuilt?.path && existsSync(rosettadBuilt.path)) {
  const built = cargoBuildFreshness(rosettadBuilt.path, rosettadBuilt.dir);
  if (built.state === "stale") {
    const why = built.gone
      ? `${built.source}, a source cargo built it from, is gone`
      : `${built.source} is newer than it`;
    console.warn(
      `stage WARN: ${rosettadBuilt.path} — ${why}; run \`pnpm siblings:build\` before packaging`,
    );
  } else if (built.state === "unrecorded") {
    console.warn(
      `stage WARN: cargo left no record of what ${rosettadBuilt.path} was built from — ` +
        "run `pnpm siblings:build` before packaging, which writes it",
    );
  }
}

// `app/` becomes app.asar (electron-builder's `files` root); `bin/`, `tray/` and `plugins/` are
// extraResources. The split is §10.1's law: executable app code goes in the archive, native
// executables and anything needing a real filesystem path stay outside it.
const PLAN = [
  {
    stage: "app/shell/main/index.cjs",
    from: "packages/electron-shell/dist/main/index.cjs",
    kind: "file",
  },
  {
    stage: "app/shell/preload/index.cjs",
    from: "packages/electron-shell/dist/preload/index.cjs",
    kind: "file",
  },
  {
    stage: "app/shell/renderer/index.html",
    from: "packages/electron-shell/dist/renderer/index.html",
    kind: "file",
  },
  {
    stage: "app/shell/renderer/assets",
    from: "packages/electron-shell/dist/renderer/assets",
    kind: "dir",
  },
  {
    // The rename this table anticipated: WP9 made fieldd a standalone executable
    // (EDP-14), so `bin.cjs` is gone and `bin/fieldd[.exe]` is the stable §7.4 name. The shell
    // execs this directly — no Electron-as-node, which is what let the RunAsNode fuse close.
    // ~145 MB, because a SEA embeds the whole Node runtime; that cost buys the fuse.
    stage: `bin/${fielddName}`,
    from: `apps/desktop/build/fieldd-sea/${fielddName}`,
    kind: "file",
    mode: EXEC_MODE,
    produce: "pnpm --filter @vibefield/desktop run package:sea",
  },
  {
    // Outside the ASAR because `new Worker(path)` needs a real file on disk (§7.4, P-A).
    stage: "bin/service-harness.mjs",
    from: "packages/fieldd/dist/service-harness.mjs",
    kind: "file",
  },
  {
    // 3.1 MB, and loro resolves it via __dirname — unembeddable, hence a resource (§7.4, P-A).
    stage: "bin/loro_wasm_bg.wasm",
    from: "packages/fieldd/dist/loro_wasm_bg.wasm",
    kind: "file",
  },
  {
    // FS-1a (L1): the files worker's bundle. The packaged fieldd re-runs ITSELF with
    // `--vibefield-role=files-host`, and that role loads this file from beside the
    // executable — a real file on disk, as the service harness is.
    stage: "bin/files-host.cjs",
    from: "packages/fieldd/dist/files-host.cjs",
    kind: "file",
  },
  {
    // AR-7: the spawn-through shim the agent gateway writes its launchers over. The
    // gateway looks for it beside the daemon (agent-gateway.ts `bundledShim`), so
    // beside the SEA it goes; fieldd's build bundles it from the kit the daemon was
    // bundled with. Staged, it is found — and a packaged gateway still offers no
    // launcher until a launcher runtime exists for a single executable (AR-7j):
    // the shim is the file a launcher runs, not the Node that runs it.
    stage: "bin/agent-shim.cjs",
    from: "packages/fieldd/dist/agent-shim.cjs",
    kind: "file",
  },
  {
    // FS-1a: mille's native file engine, dlopened by the worker from the explicit path
    // fieldd hands it (workspace/launch.ts) — staged by fieldd's build from the installed
    // per-platform package, named by mille's own triple.
    stage: `bin/${milleNativeName}`,
    from: `packages/fieldd/dist/${milleNativeName}`,
    kind: "file",
    mode: DATA_MODE,
    produce: "pnpm --filter @vibefield/fieldd build",
  },
  // tooling (a) — field-native's binaries (NATIVE_BINARIES): each from where cargo builds it, the
  // place looked said in the gap
  ...NATIVE_BINARIES.map((binary, i) => {
    const built = nativeBuilt?.[i];
    return {
      stage: `bin/${nativeFile(binary.name)}`,
      from: built?.path ?? null,
      kind: "file",
      mode: EXEC_MODE,
      optional:
        built === undefined
          ? `${binary.gap} (${nativeUnknown})`
          : `${binary.gap} (cargo builds it to ${built.path})`,
      produce: "pnpm --filter @vibefield/desktop build:native-release",
    };
  }),
  ...(process.platform === "darwin"
    ? [
        {
          // LSF4: one accessory helper multiplexes ScreenCaptureKit sessions.
          // It is a real child executable and remains outside the ASAR so the
          // package signer can seal it as a nested binary.
          stage: "bin/live-surface-capture-helper",
          from: "apps/desktop/build/native/macos/live-surface-capture-helper",
          kind: "file",
          mode: EXEC_MODE,
          produce: "pnpm --filter @vibefield/desktop run build:live-surfaces-native",
        },
        {
          // The least-privilege Node-API adapter receives authenticated
          // IOSurface Mach rights; it exposes no arbitrary native-call API.
          stage: "bin/live-surface-adapter.node",
          from: "apps/desktop/build/native/macos/live-surface-adapter.node",
          kind: "file",
          mode: DATA_MODE,
          produce: "pnpm --filter @vibefield/desktop run build:live-surfaces-native",
        },
        {
          // SNAP-D5/D9: the screenshot helper is a nested BUNDLE — TCC keys Screen
          // Recording consent on it — staged whole so its Info.plist, PkgInfo and
          // signature seal travel with the executable. OPTIONAL like field-native: a
          // package without it boots and answers `helper-missing` at capture time.
          stage: "bin/field-screenshot-helper.app",
          from: "apps/desktop/build/native/macos/field-screenshot-helper.app",
          kind: "dir",
          exec: ["Contents/MacOS/field-screenshot-helper"],
          optional:
            "the screenshot helper is absent — the packaged app will have no Take Screenshot",
          produce: "pnpm --filter @vibefield/desktop run build:screenshot-helper",
        },
      ]
    : []),
  ...(process.platform === "win32"
    ? [
        {
          // SNAP-D7: the Windows helper is its own cargo workspace; the desktop package's
          // build script copies the release exe here. Same optionality as the bundle above.
          stage: "bin/field-screenshot-helper.exe",
          from: "apps/desktop/build/native/windows/field-screenshot-helper.exe",
          kind: "file",
          mode: EXEC_MODE,
          optional:
            "the screenshot helper is absent — the packaged app will have no Take Screenshot",
          produce: "pnpm --filter @vibefield/desktop run build:screenshot-helper",
        },
      ]
    : []),
  {
    // AH-1b: field-native resolves this exact executable beside itself. The
    // platform packages are optional only so pnpm can install one lockfile on
    // every OS; for the active package target this input is REQUIRED.
    //
    // The SOURCE is the window's, decided above. `target/debug/` is where
    // `pnpm siblings:build` puts it — beside the floor's dev binary, which is
    // the whole point of that path — and `go build` has no profile split, so a
    // release package staging from a directory cargo named "debug" ships the
    // same bytes truffle tests at this revision.
    stage: `bin/${truffleSidecarName}`,
    from:
      sidecarStaging.source === "window"
        ? sidecarStaging.from
        : `apps/desktop/node_modules/@vibecook/truffle-sidecar-${trufflePlatform}` +
          `/bin/${truffleSidecarName}`,
    kind: "file",
    mode: EXEC_MODE,
    produce:
      sidecarStaging.source === "window" ? "pnpm siblings:build" : "pnpm install --frozen-lockfile",
  },
  {
    // AR-8 (L3): History's index daemon, decided above. The shell resolves it
    // beside fieldd (resources.ts `rosettadPath`) and hands it to fieldd as
    // FIELDD_ROSETTAD_BIN; a real child executable, so it stays outside the ASAR
    // and the signer seals it as a nested binary (electron-builder.yml).
    stage: `bin/${rosettadName}`,
    from: rosettadBuilt?.path ?? null,
    kind: "file",
    mode: EXEC_MODE,
    optional:
      "rosettad is absent — the packaged app's History will say this copy has no agent history",
    produce: "pnpm siblings:build",
  },
  {
    stage: "tray",
    from: "apps/desktop/packaging/tray",
    kind: "dir",
  },
];

// ---- the produced outputs (WP8b) ----------------------------------------------
// `plugins/bundled/` and `identity/` are not copies of a build tree: they are PRODUCED, signed, for this stage —
// each first-party plugin's §5.2 members and the canonical index naming every staged file's hash, signed by the
// trust-root's `bundled` role, and the trust-root document with the stage's public identity
// (apps/desktop/packaging/bundled-plugins.mjs; the kit's ONE verifier checks both, as fieldd will). The list is
// NAMED, never globbed (WP8-D6): DK-8's retired plugin folders keep build leftovers that must never ship. RL2 (b),
// TD-7: both stay. A release stage needs VIBEFIELD_BUNDLED_INDEX_SECRET and James's embedded trust-root; without
// the secret the stage is DEV-keyed (minted for this stage only) and says so in capitals. The list lives in
// apps/desktop/packaging/bundled-list.mjs.
const BUNDLED_PRODUCER = join(repoRoot, "apps/desktop/packaging/bundled-plugins.mjs");
const runProducer = (command, extra = []) => {
  const run = spawnSync(
    process.execPath,
    [
      BUNDLED_PRODUCER,
      command,
      "--stage",
      outAbs,
      "--plugins",
      BUNDLED_PLUGINS.join(","),
      ...extra,
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return {
      ok: false,
      problems: [
        `the bundled-plugin producer gave no verdict (exit ${run.status}): ${(run.stderr ?? "").trim().slice(0, 2000)}`,
      ],
    };
  }
};

// The stage roots always exist. electron-builder fails a build when an extraResources source is
// missing, and it DROPS an empty one (the WP8 plan's addendum: no bundle examined before WP8 had a
// Resources/plugins) — since WP8 the bundled root and identity/ are produced, so neither is empty by
// construction. The tray is required and validated by the icon gate before staging.
const STAGE_ROOTS = ["app", "bin", "tray", "plugins/bundled", "identity"];

// ---- §7.3 "must never ship" ------------------------------------------------
// package-census.mjs owns the canonical list; this is the same policy applied to STAGE-relative
// paths rather than build-tree paths. Kept as a copy on purpose: census executes its whole census
// at import time, so it cannot be imported as a module, and the two lists are small enough that
// duplication beats restructuring a working tool. THEY MUST STAY ALIGNED — a class added there is
// a class that belongs here.
//
// Evaluated against the destination path, never the source: `target/release/field-native` is a
// legitimate input whose staged path (`bin/field-native`) carries no `target` segment, and what
// §7.3 governs is what the package contains.
const TEST_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "fixture",
  "fixtures",
  "coverage",
  "snapshots",
  "__snapshots__",
]);
const REPO_DIRS = new Set([
  "draft",
  ".git",
  ".github",
  ".vscode",
  ".idea",
  ".cache",
  ".turbo",
  ".pnpm-store",
]);
const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
]);
const CREDENTIAL_FILES = /\.(pem|p12|pfx|key|keystore|jks|mobileprovision)$/i;

const NEVER_SHIP = [
  {
    id: "testing-tree",
    why: "§7.3 — `dist/testing`; the smoke harness is development-only",
    hit: ({ segs }) => segs.some((s) => s.toLowerCase() === "testing"),
  },
  {
    id: "smoke-or-spike-entry",
    why: "§7.3 — smoke/spike entries never enter a package (ESP §10.1)",
    hit: ({ segs }) => segs.some((s) => /^(smoke|spike)([-._]|$)/i.test(s)),
  },
  {
    id: "ui-bench-entry",
    why: "§7.3 — UI Bench/design-system entries and fixtures are development-only",
    hit: ({ segs }) => segs.some((s) => /^(design-system|ui-bench)([-._]|$)/i.test(s)),
  },
  {
    id: "test-material",
    why: "§7.3 — tests, fixtures, coverage, snapshots",
    hit: ({ segs, name }) =>
      segs.some((s) => TEST_DIRS.has(s.toLowerCase())) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name) ||
      name.endsWith(".snap"),
  },
  {
    id: "source-map",
    why: "§7.3 — `.map` files publish source absent an explicit security review",
    hit: ({ name }) => name.endsWith(".map"),
  },
  {
    id: "typescript-source",
    why: "§7.3 — TypeScript source and declarations belong to the build, not the package",
    hit: ({ name }) => /\.[cm]?tsx?$/i.test(name),
  },
  {
    id: "repo-material",
    why: "§7.3 — draft/.git/.github, editor files, logs, caches, lockfiles, sibling checkouts",
    hit: ({ segs, name }) =>
      segs.some((s) => REPO_DIRS.has(s.toLowerCase())) ||
      LOCKFILES.has(name) ||
      /\.(log|swp|swo)$/i.test(name) ||
      name === ".DS_Store" ||
      name.endsWith("~"),
  },
  {
    id: "cargo-target",
    why: "§7.3 + EDP-13 — a Cargo `target` tree; a debug field-native can never reach a package",
    hit: ({ segs }) => segs.some((s) => s === "target"),
  },
  {
    id: "renderer-dev-server",
    why: "§7.3 — renderer development-server code (the Vite client)",
    hit: ({ rel }) =>
      rel.includes("@vite/") || rel.includes("/vite/dist/client/") || rel.includes("/.vite/"),
  },
  {
    id: "secret-material",
    why: "§7.3/§9.4 — signing credentials, `.env` files, update tokens",
    hit: ({ name }) =>
      /^\.env($|\.)/i.test(name) || CREDENTIAL_FILES.test(name) || name === ".npmrc",
  },
  {
    id: "second-electron",
    why: "§7.3/§13.2 — a second copy of Electron, or an unintended `node_modules`",
    hit: ({ segs }) =>
      segs.some((s) => s === "node_modules") ||
      segs.some((s) => /^electron(\.exe|\.app)?$/i.test(s)),
  },
  {
    id: "irregular-entry",
    why: "§13.2 — a symlink can resolve outside the stage; a package holds plain files only",
    hit: ({ irregular }) => irregular === true,
  },
];

const neverShipClasses = (rel, name, irregular) => {
  const subject = { rel, name, segs: rel.split("/"), irregular };
  return NEVER_SHIP.filter((c) => c.hit(subject)).map((c) => c.id);
};
const whyOf = (ids) => NEVER_SHIP.filter((c) => ids.includes(c.id)).map((c) => c.why);

// §13.2's "no absolute workspace paths": a build that inlines the build machine's path leaks the
// developer's filesystem into a shipped artifact and breaks everywhere else. Matching this
// checkout's own root keeps it machine-independent — CI checks CI's path.
const rootBytes = Buffer.from(repoRoot, "utf8");
const leaksRepoPath = (abs) => {
  try {
    return readFileSync(abs).includes(rootBytes);
  } catch {
    return false;
  }
};

// ---- resolving the plan against what is actually built ---------------------
const fail = (message) => {
  console.error(`\nstage-package FAILED — ${message}`);
  process.exit(1);
};

// `exec` names the entry-relative paths inside a walked directory that are executables (a
// nested .app bundle's Contents/MacOS binary — SNAP-D5); everything else a directory entry
// carries is data. Modes are still SET, never inherited, per the rule above.
const walkSource = (
  absDir,
  stagePrefix,
  files,
  skipped,
  exec = new Set(),
  entryStage = stagePrefix,
) => {
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const abs = join(absDir, entry.name);
    const stage = `${stagePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walkSource(abs, stage, files, skipped, exec, entryStage);
      continue;
    }
    // Dirent classification is lstat-based, so a non-file here is a symlink/socket/device.
    const classes = neverShipClasses(stage, entry.name, !entry.isFile());
    if (classes.length > 0) {
      skipped.push({ stage, abs, classes });
      continue;
    }
    const withinEntry = stage.slice(entryStage.length + 1);
    files.push({ stage, abs, mode: exec.has(withinEntry) ? EXEC_MODE : DATA_MODE });
  }
};

// Both modes derive expectations the same way, from the allowlist plus the build trees on disk.
// A stage is therefore only ever compared against what the current sources say it should be.
const resolvePlan = () => {
  const files = [];
  const skipped = [];
  const missing = [];
  for (const entry of PLAN) {
    // `resolve`, not `join`: every row is repo-relative except rosettad's, which
    // lives in the rosetta checkout's cargo target and arrives absolute.
    const abs = entry.from ? resolve(repoRoot, entry.from) : null;
    if (!abs || !existsSync(abs)) {
      if (!entry.optional) {
        fail(
          `required input missing: ${entry.from} (for ${entry.stage}) — run \`pnpm build\` first`,
        );
      }
      missing.push(entry);
      continue;
    }
    if (entry.kind === "dir") {
      if (!statSync(abs).isDirectory()) fail(`${entry.from} is not a directory`);
      const before = files.length;
      walkSource(abs, entry.stage, files, skipped, new Set(entry.exec ?? []));
      if (files.length === before) missing.push(entry); // present but empty is the same gap
      // An executable the entry NAMES must exist in the walk: a bundle whose binary went
      // missing is a stage that fails at first spawn, which is what this check is for.
      for (const rel of entry.exec ?? []) {
        if (!files.some((f) => f.stage === `${entry.stage}/${rel}`)) {
          fail(`${entry.from} lacks its declared executable ${rel}`);
        }
      }
      continue;
    }
    // A named entry that trips §7.3 means the ALLOWLIST is wrong, which is not something to
    // paper over by skipping the file — it is a bug in this tool.
    const classes = neverShipClasses(entry.stage, entry.stage.split("/").at(-1), false);
    if (classes.length > 0) {
      fail(`allowlist entry ${entry.stage} is itself forbidden by §7.3 [${classes.join(",")}]`);
    }
    files.push({ stage: entry.stage, abs, mode: entry.mode ?? DATA_MODE });
  }

  // The generated stage manifest (§7.3): release version, entry point, nothing else. No scripts,
  // no dependencies — a packaged manifest that carries dev wiring is how build-time tooling ends
  // up inside a shipped archive. `type` is deliberately omitted: `.cjs` and `.mjs` extensions
  // already pin their module systems, so the field would only add a way to get it wrong.
  const desktopPkg = JSON.parse(readFileSync(join(repoRoot, "apps/desktop/package.json"), "utf8"));
  if (typeof desktopPkg.version !== "string") fail("apps/desktop/package.json has no version");
  const manifest = {
    // §7.7: apps/desktop is the builder's authoritative manifest. This `name` is a package
    // identifier only — the user-visible identity (productName, appId) comes from the builder
    // config and release-identity.json, never from here.
    name: desktopPkg.name,
    version: desktopPkg.version,
    main: "shell/main/index.cjs",
  };
  return { files, skipped, missing, manifest };
};

// ---- staging ---------------------------------------------------------------
const stage = ({ files, manifest }) => {
  // §7.2: "no release job packages stale output left by a prior local or CI step" — the stage is
  // always wiped. That makes the wipe destructive, so it is checked first: an --out that holds
  // anything this tool did not put there is refused rather than deleted, because a mistyped path
  // must not cost someone a directory.
  if (existsSync(outAbs)) {
    if (!statSync(outAbs).isDirectory()) fail(`--out ${outRel} exists and is not a directory`);
    const roots = new Set(STAGE_ROOTS.map((r) => r.split("/")[0]));
    const foreign = readdirSync(outAbs).filter((n) => !roots.has(n));
    if (foreign.length > 0) {
      fail(
        `refusing to wipe ${outRel} — it holds entries this stager never writes ` +
          `(${foreign.join(", ")}); remove it by hand if that is really the stage directory`,
      );
    }
    rmSync(outAbs, { recursive: true, force: true });
  }
  for (const root of STAGE_ROOTS) mkdirSync(join(outAbs, root), { recursive: true });

  for (const f of files) {
    const dest = join(outAbs, f.stage);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f.abs, dest);
    chmodSync(dest, f.mode);
  }
  const manifestPath = join(outAbs, "app/package.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  chmodSync(manifestPath, DATA_MODE);
};

// ---- verification ----------------------------------------------------------
const walkStage = (absDir, prefix, out) => {
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const abs = join(absDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkStage(abs, rel, out);
      continue;
    }
    const st = statSync(abs);
    out.push({ rel, abs, bytes: st.size, mode: st.mode & 0o777, irregular: !entry.isFile() });
  }
};

const verify = ({ files, manifest }, produced) => {
  if (!existsSync(outAbs)) {
    fail(`no stage at ${outRel} — run \`node scripts/stage-package.mjs\` first`);
  }
  const found = [];
  walkStage(outAbs, "", found);

  const expected = new Map(files.map((f) => [f.stage, f]));
  expected.set("app/package.json", { stage: "app/package.json", mode: DATA_MODE, generated: true });
  // WP8b: what the producer's verifier vouched for (signature, every hash, the sources) is expected too —
  // and ONLY that: a file under plugins/bundled or identity it did not name is UNEXPECTED below.
  for (const rel of produced.files ?? [])
    expected.set(rel, { stage: rel, mode: DATA_MODE, generated: true });
  const present = new Map(found.map((f) => [f.rel, f]));

  const problems = [...(produced.problems ?? []).map((p) => `BUNDLED  ${p}`)];
  for (const key of [...expected.keys()].sort()) {
    if (!present.has(key)) problems.push(`MISSING  ${key}`);
  }
  for (const f of found) {
    // The §7.3 test runs on EVERY file found, allowlisted or not. An unexpected file is exactly
    // the case where knowing WHICH forbidden class it belongs to matters most, so classification
    // must not be short-circuited by the allowlist check.
    const classes = neverShipClasses(f.rel, f.rel.split("/").at(-1), f.irregular);
    if (classes.length > 0) {
      problems.push(`FORBIDDEN  ${f.rel} [${classes.join(",")}]`);
      for (const w of whyOf(classes)) problems.push(`             ${w}`);
    }
    if (!expected.has(f.rel)) {
      problems.push(`UNEXPECTED  ${f.rel} — not on the §7.3 allowlist`);
      continue; // mode/path checks below are about an expected file being staged wrongly
    }
    const want = expected.get(f.rel).mode;
    if (MODES_ENFORCEABLE && f.mode !== want) {
      problems.push(
        `MODE  ${f.rel} is ${f.mode.toString(8)}, expected ${want.toString(8)} (§13.2)`,
      );
    }
    if (leaksRepoPath(f.abs)) {
      problems.push(
        `LEAKS BUILD PATH  ${f.rel} — the build machine's repo path is inlined (§13.2)`,
      );
    }
  }

  // TC-S2, tooling (a) — field-native's binaries (NATIVE_BINARIES) ship as a SET or not at all.
  // All absent is a declared optional gap above (a preview package with no native plane, warned
  // about loudly and fatal under --require-complete). Some staged without the rest is not a gap:
  // the floor resolves its other binaries beside itself, so a floor without its cell boots a native
  // plane whose terminal unit is permanently Degraded. The half-state is reachable from a target
  // predating a binary — one that still holds field-native and has never built the newer one —
  // which is exactly the case that must fail here rather than pack silently. Asserted against the
  // STAGE, so --verify catches it on a stage this process did not build.
  const nativeStages = NATIVE_BINARIES.map((binary) => `bin/${nativeFile(binary.name)}`);
  const nativeStaged = nativeStages.filter((stage) => present.has(stage));
  if (nativeStaged.length > 0 && nativeStaged.length < nativeStages.length) {
    const absent = nativeStages.filter((stage) => !present.has(stage));
    problems.push(
      `SET  ${nativeStaged.join(", ")} staged without ${absent.join(", ")} — field-native's ` +
        `binaries resolve one another as siblings, and these would find none (TC-S2); rebuild ` +
        `them all with \`pnpm --filter @vibefield/desktop build:native-release\``,
    );
  }

  // BP-1b's gate (scripts/host-links.mjs; LANDED "BP-1b"): every staged Mach-O loads only `/usr/lib`, `/System` or the
  // bundle's own paths, and the native binaries start (`--version`), so a package built against a host library refuses
  // here, on every host, rather than at its first boot on a Mac without that library. macOS only: otool reads the load
  // commands. The build job runs the same gate on the packaged app (Electron's helpers included).
  if (process.platform === "darwin") {
    problems.push(...auditHostLinks(outAbs));
    if (nativeStaged.length === nativeStages.length)
      for (const p of launchCheck(join(outAbs, "bin"))) problems.push(`LAUNCH  ${p}`);
  }

  // The manifest is generated, so its contents are an assertion rather than a copy check.
  const manifestPath = join(outAbs, "app/package.json");
  if (existsSync(manifestPath)) {
    let staged;
    try {
      staged = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (e) {
      problems.push(`app/package.json is not valid JSON — ${e.message}`);
    }
    if (staged) {
      if (staged.main !== "shell/main/index.cjs") {
        problems.push(
          `app/package.json main is ${String(staged.main)}, expected shell/main/index.cjs`,
        );
      }
      if (staged.version !== manifest.version) {
        problems.push(
          `app/package.json version is ${String(staged.version)}, expected ${manifest.version}`,
        );
      }
      for (const forbidden of ["scripts", "dependencies", "devDependencies"]) {
        if (forbidden in staged) problems.push(`app/package.json carries \`${forbidden}\` (§7.3)`);
      }
    }
  }
  return { found, problems };
};

// ---- run -------------------------------------------------------------------
const plan = resolvePlan();
for (const rel of BUNDLED_PLUGINS) {
  if (!existsSync(join(repoRoot, rel, "dist")))
    fail(`required input missing: ${rel}/dist (for plugins/bundled) — run \`pnpm build\` first`);
}
let smokeTrust = false;
if (!verifyOnly) {
  stage(plan);
  const desktopVersion = plan.manifest.version;
  const produced = runProducer("stage", [
    "--app-version",
    desktopVersion,
    ...(devTrustRoot !== undefined ? ["--dev-trust-root", resolve(devTrustRoot)] : []),
  ]);
  smokeTrust = produced.trust === "smoke";
  if (!produced.ok)
    fail(`bundled plugins were not produced: ${(produced.problems ?? []).join("; ")}`);
}
const bundled = runProducer("verify", requireReleaseKey ? ["--require-release-key"] : []);
const { found, problems } = verify(plan, bundled);

const n = (v) => v.toLocaleString("en-US");
const mb = (v) => `${(v / 1024 / 1024).toFixed(2)} MB`;
const totalBytes = found.reduce((s, f) => s + f.bytes, 0);

console.log(`${verifyOnly ? "verifying" : "staged"} ${outRel}\n`);
for (const f of found) {
  const exec = MODES_ENFORCEABLE && (f.mode & 0o111) !== 0 ? " *" : "";
  console.log(`  ${f.rel.padEnd(58)} ${n(f.bytes).padStart(12)}${exec}`);
}
console.log(
  `  ${`── ${found.length} files`.padEnd(58)} ${n(totalBytes).padStart(12)}   (${mb(totalBytes)})`,
);

// Skips are the load-bearing report line: this is where `dist/testing/smoke.cjs` and any future
// source map get named as dropped, rather than quietly not appearing.
if (plan.skipped.length > 0) {
  console.log(`\nexcluded by §7.3 (present in the build tree, never staged):`);
  for (const s of plan.skipped) console.log(`  ${s.stage}  [${s.classes.join(",")}]`);
}
// Nothing under `dist/testing` is ever walked — it is not on the allowlist at all — so the skip
// list above cannot mention it. State the exclusion positively instead of letting silence carry
// it, and check it, so this line can never become a comfortable lie.
const smokeAbs = join(repoRoot, "packages/electron-shell/dist/testing/smoke.cjs");
if (existsSync(smokeAbs)) {
  const staged = found.some((f) => f.rel.includes("testing") || f.rel.endsWith("smoke.cjs"));
  console.log(
    `\n§7.3 smoke harness: packages/electron-shell/dist/testing/smoke.cjs exists ` +
      `(${n(statSync(smokeAbs).size)} bytes) and is ${staged ? "*** PRESENT IN THE STAGE ***" : "absent from the stage"}`,
  );
  if (staged) problems.push("the smoke harness reached the stage (§7.3)");
}

// The bundled report line (WP8 W5): what shipped, and which keys signed it — DEV in capitals.
console.log(
  `\nplugins/bundled: ${bundled.plugins?.length ?? 0} plugin(s) (${(bundled.plugins ?? []).join(", ") || "none"}), ` +
    `index ${bundled.ok ? "signed and verified" : "NOT VERIFIED"}, KEY CLASS: ${(bundled.keyClass ?? "unknown").toUpperCase()}${smokeTrust ? ", smoke trust-root" : ""}`,
);
if (bundled.keyClass === "dev")
  console.warn(
    smokeTrust
      ? "  DEV-KEYED: the trust-root and the bundled index were signed by keys `smoke:update` minted for its run, " +
          "held only in its process — this build trusts that run's fixture origin and nothing else"
      : "  DEV-KEYED: the trust-root and the bundled index were signed by keys minted for this stage only — " +
          "a release stage needs VIBEFIELD_BUNDLED_INDEX_SECRET and James's trust-root (TD-1)",
  );

if (plan.missing.length > 0) {
  const bar = "─".repeat(78);
  console.warn(`\n${bar}`);
  console.warn(`  STAGE INCOMPLETE — ${plan.missing.length} optional input(s) not staged`);
  console.warn(bar);
  for (const m of plan.missing) {
    console.warn(`  ${m.stage}${m.kind === "dir" ? "/" : ""} — ${m.optional}`);
    console.warn(`      produce it with: ${m.produce}`);
  }
  console.warn(bar);
  console.warn(
    `  Not fatal: WP4 only owes a stage that boots, and these land in later slices.\n` +
      `  A RELEASE build must not be cut from this stage.`,
  );
  console.warn(`${bar}\n`);
  if (requireComplete) {
    problems.push(
      `release requires a complete stage; ${plan.missing.length} declared optional input(s) are absent`,
    );
  }
}

if (problems.length > 0) {
  console.error(`stage verify FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const state =
  plan.missing.length > 0 ? `INCOMPLETE — ${plan.missing.length} optional gap(s)` : "complete";
console.log(
  `stage verify OK — ${found.length} files, ${n(totalBytes)} bytes (${mb(totalBytes)}); ${state}`,
);
