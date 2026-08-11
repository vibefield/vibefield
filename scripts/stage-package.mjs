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
// Usage: node scripts/stage-package.mjs [--out <dir>] [--verify]
//   (no flag)  wipe and rebuild the stage, then verify what was produced
//   --verify   verify an EXISTING stage without touching it — the check CI runs against a stage
//              it did not just create, and the only form that can catch a stale or tampered one
//
// Node >=22 ESM, builtins only — no new dependencies, no glob library.
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
const nativeName = process.platform === "win32" ? "field-native.exe" : "field-native";
const fielddName = process.platform === "win32" ? "fieldd.exe" : "fieldd";
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
  throw new Error(`Truffle 0.7.12 has no desktop sidecar package for ${trufflePlatform}`);
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
    // The ghosttea bridge's utilityProcess entry (GT-1). A SEPARATE file
    // because utilityProcess.fork takes a path, and `.mjs` because the manifest
    // below omits `type` — a `.js` ESM bundle would be read as CJS inside the
    // asar and die on its first import.
    stage: "app/shell/main/bridge-entry.mjs",
    from: "packages/electron-shell/dist/main/bridge-entry.mjs",
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
    stage: `bin/${nativeName}`,
    from: `target/release/${nativeName}`,
    kind: "file",
    mode: EXEC_MODE,
    optional: "the field-native sidecar is absent — the packaged app will have no native plane",
    produce: "cargo build --release -p field-native",
  },
  {
    // AH-1b: field-native resolves this exact executable beside itself. The
    // platform packages are optional only so pnpm can install one lockfile on
    // every OS; for the active package target this input is REQUIRED.
    stage: `bin/${truffleSidecarName}`,
    from:
      `apps/desktop/node_modules/@vibecook/truffle-sidecar-${trufflePlatform}` +
      `/bin/${truffleSidecarName}`,
    kind: "file",
    mode: EXEC_MODE,
    produce: "pnpm install --frozen-lockfile",
  },
  {
    stage: "tray",
    from: "apps/desktop/packaging/tray",
    kind: "dir",
  },
  {
    // No producer exists yet, so there is no source path to name: inventing one here would bake a
    // guess into the allowlist. WP8 owns both the producer and this entry's `from`.
    stage: "plugins/bundled",
    from: null,
    kind: "dir",
    optional: "no bundled plugins — the packaged app ships with zero built-ins",
    produce: "WP8 — PA-34 bundled-plugin staging + signed index (ESP §10.4)",
  },
];

// The stage roots always exist, even when empty. electron-builder fails a build when an
// extraResources source is missing. Bundled plugins remain optional until WP8, while the tray is
// required and validated by the icon gate before staging. Empty plugin roots remain loud in the
// report instead of breaking electron-builder's extraResources copy.
const STAGE_ROOTS = ["app", "bin", "tray", "plugins/bundled"];

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

const walkSource = (absDir, stagePrefix, files, skipped) => {
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const abs = join(absDir, entry.name);
    const stage = `${stagePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walkSource(abs, stage, files, skipped);
      continue;
    }
    // Dirent classification is lstat-based, so a non-file here is a symlink/socket/device.
    const classes = neverShipClasses(stage, entry.name, !entry.isFile());
    if (classes.length > 0) {
      skipped.push({ stage, abs, classes });
      continue;
    }
    files.push({ stage, abs, mode: DATA_MODE });
  }
};

// Both modes derive expectations the same way, from the allowlist plus the build trees on disk.
// A stage is therefore only ever compared against what the current sources say it should be.
const resolvePlan = () => {
  const files = [];
  const skipped = [];
  const missing = [];
  for (const entry of PLAN) {
    const abs = entry.from ? join(repoRoot, entry.from) : null;
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
      walkSource(abs, entry.stage, files, skipped);
      if (files.length === before) missing.push(entry); // present but empty is the same gap
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

const verify = ({ files, manifest }) => {
  if (!existsSync(outAbs)) {
    fail(`no stage at ${outRel} — run \`node scripts/stage-package.mjs\` first`);
  }
  const found = [];
  walkStage(outAbs, "", found);

  const expected = new Map(files.map((f) => [f.stage, f]));
  expected.set("app/package.json", { stage: "app/package.json", mode: DATA_MODE, generated: true });
  const present = new Map(found.map((f) => [f.rel, f]));

  const problems = [];
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
if (!verifyOnly) stage(plan);
const { found, problems } = verify(plan);

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
