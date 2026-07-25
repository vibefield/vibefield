#!/usr/bin/env node
// Package census (WP1 / EDP slice 0; distribution spec §7.3 ASAR allowlist + §13.2
// stage-content checks): the inventory of what `pnpm build` actually produces, so a
// later slice can prove a package holds exactly this and nothing else. No packaging
// tool exists yet — this walks the build tree that will feed one, which is why the
// baseline lives here rather than beside a stage.
// Usage: node scripts/package-census.mjs [--json <path>] [--assert] [--strict] [--update]
//
// REPORT-FIRST, deliberately, matching .github/workflows/audit.yml's posture: that
// workflow keeps `continue-on-error` so a freshly disclosed advisory never blocks a solo
// dev's merge. Same reasoning here — a renamed renderer chunk is churn, not a defect, so
// manifest drift prints and exits 0. Only a §7.3 "must never ship" hit is fatal, because
// that class is a leak rather than churn. HARDENING IS A ONE-LINE FLIP — pass `--strict`
// (or default `strict` to true below) once WP4's staging allowlist makes drift meaningful.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
// Resolved from the script's own location, not cwd: the manifest path below is fixed in
// the repo, and census paths must be repo-relative so they compare across machines.
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(repoRoot, "apps/desktop/packaging/package-manifest.json");
const manifestRel = "apps/desktop/packaging/package-manifest.json";

// Sum of file sizes understates the installed footprint: filesystems hand out whole
// blocks. 4 KiB is the APFS/ext4 default, so this is an estimate that tracks the real
// number far better than a raw byte total does — the 300-byte index.html costs 4 KiB.
const BLOCK = 4096;
const installedOf = (bytes) => Math.ceil(bytes / BLOCK) * BLOCK;

// ---- workspace discovery ---------------------------------------------------
// Read the globs rather than hardcoding package dirs (contracts-first habit: the
// workspace file is the registry). Every entry is a single-level `dir/*` today; an
// unrecognized shape is reported loudly instead of silently narrowing the census.
const readWorkspaceGlobs = () => {
  const text = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const globs = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break; // the next top-level key ends the list
    const m = line.match(/^\s*-\s*"?([^"#]+?)"?\s*$/);
    if (m) globs.push(m[1]);
  }
  return globs;
};

const unsupportedGlobs = [];
const packageDirs = [];
for (const glob of readWorkspaceGlobs()) {
  if (!glob.endsWith("/*")) {
    unsupportedGlobs.push(glob);
    continue;
  }
  const parentRel = glob.slice(0, -2);
  const parentAbs = join(repoRoot, parentRel);
  if (!existsSync(parentAbs)) continue;
  for (const entry of readdirSync(parentAbs, { withFileTypes: true }).sort()) {
    if (!entry.isDirectory()) continue;
    const rel = `${parentRel}/${entry.name}`;
    if (existsSync(join(repoRoot, rel, "package.json"))) packageDirs.push(rel);
  }
}
packageDirs.sort();

// A build script that only re-invokes other packages' builds owns no output of its own
// (apps/desktop is the case: its renderer lands in electron-shell/dist). Distinguishing
// these keeps the census from reporting a correct delegation as an unbuilt package.
const isDelegating = (script) => script.split("&&").every((c) => /^\s*pnpm\b/.test(c));

// ---- walking a build tree --------------------------------------------------
// `dist` is the only output convention in this tree today; a package that declares a
// real build and yields no dist is flagged rather than assumed, so a package that
// starts emitting elsewhere surfaces as a finding instead of vanishing from the census.
const OUTPUT_DIR = "dist";

const walk = (absDir, relBase, out) => {
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const abs = join(absDir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile()) {
      out.push({ rel, name: entry.name, abs, bytes: statSync(abs).size });
    } else {
      // Dirent classification is lstat-based, so this is a symlink/socket/device. None
      // are legitimate build output and a symlink can point outside a future stage.
      out.push({ rel, name: entry.name, abs, bytes: 0, irregular: true });
    }
  }
};

// Vite emits `assets/<name>-<8-char hash>.<ext>` and the hash moves on every content
// change. Pinning it would make the manifest red after any edit, so the manifest stores
// the SHAPE (`main-[hash].js`) and the checker compares shapes: a new or deleted chunk
// diffs, a merely rebuilt one does not. Scoped to `assets/` because that is where the
// hashing happens — `service-harness.mjs` must never be mistaken for a hashed name.
//
// Shapes are NOT unique: this build emits two `main-*.js` chunks (a 306 KB entry and a
// 17 KB one). So a shape carries a COUNT, and the checker compares counts too — the
// first draft keyed the manifest by shape alone and silently dropped one of the pair,
// under-reporting the census by a file. A third `main-*.js` must read as drift.
const HASHED = /^(.*\/assets\/.*)-[A-Za-z0-9_-]{8}(\.[^./]+)$/;
const shapeOf = (rel) => rel.replace(HASHED, "$1-[hash]$2");

// ---- §7.3 "must never ship" classes ----------------------------------------
// Path-shaped tests only, and deliberately narrow ones: this list is the single fatal
// verdict in the tool, so a false positive here breaks builds. Anything ambiguous
// (a chunk named `tokens-*.js` is entirely plausible in a repo with design tokens)
// stays out rather than risking that.
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
    why: "§7.3 — `dist/testing`; a harness tree is development-only",
    hit: ({ segs }) => segs.some((s) => s.toLowerCase() === "testing"),
  },
  {
    id: "smoke-or-spike-entry",
    why: "§7.3 — smoke/spike entries; bundle-report.mjs already fails the renderer on `spike-`",
    hit: ({ segs }) => segs.some((s) => /^(smoke|spike)([-._]|$)/i.test(s)),
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
    why: "§7.3 + EDP-13 — Cargo `target` trees; a debug field-native can never appear in a package",
    hit: ({ segs }) => segs.some((s) => s === "target"),
  },
  {
    id: "renderer-dev-server",
    why: "§7.3 — renderer development-server code (the Vite client) must not reach a package",
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
    why: "§7.3/§13.2 — a second copy of Electron, or an unintended `node_modules`, inside the output",
    hit: ({ segs }) =>
      segs.some((s) => s === "node_modules") ||
      segs.some((s) => /^electron(\.exe|\.app)?$/i.test(s)),
  },
  {
    id: "irregular-entry",
    why: "§13.2 — symlinks/irregular entries can resolve outside a stage; output must be plain files",
    hit: ({ irregular }) => irregular === true,
  },
];

// §13.2's "no absolute workspace paths" is the one content-shaped check worth running
// here: a bundler that inlines a build-machine path leaks the developer's filesystem
// into a shipped artifact and breaks on every other machine. Matching the repo root
// keeps it machine-independent — CI checks CI's path, this checkout checks its own.
const rootBytes = Buffer.from(repoRoot, "utf8");
const leaksRepoPath = (abs) => {
  try {
    return readFileSync(abs).includes(rootBytes);
  } catch {
    return false;
  }
};

// §7.3 governs what a PACKAGE contains. `pnpm build` legitimately emits one forbidden
// tree — electron-shell's third esbuild target, which `pnpm smoke` loads — so a census of
// the BUILD tree would sit permanently red on a file that is doing its job. Acknowledged
// here in source rather than in the manifest: an exemption must be a reviewed edit, never
// something `--update` can absorb silently. WP4's staging allowlist is what must actually
// drop these; bundle-report.mjs says the same in its "shell bundles" note.
const ACKNOWLEDGED = [
  [
    "packages/electron-shell/dist/testing/",
    "smoke harness (`pnpm smoke`); staging must exclude it",
  ],
];
const acknowledgementFor = (repoRel) => ACKNOWLEDGED.find(([prefix]) => repoRel.startsWith(prefix));

// ---- census ----------------------------------------------------------------
const census = [];
const notBuilt = [];
const delegating = [];
const strayOutput = [];

for (const pkgRel of packageDirs) {
  const pkgJson = JSON.parse(readFileSync(join(repoRoot, pkgRel, "package.json"), "utf8"));
  const buildScript = pkgJson.scripts?.build;
  const distAbs = join(repoRoot, pkgRel, OUTPUT_DIR);
  const hasDist = existsSync(distAbs) && statSync(distAbs).isDirectory();

  if (!hasDist) {
    if (buildScript && isDelegating(buildScript)) delegating.push({ pkgRel, name: pkgJson.name });
    else if (buildScript) notBuilt.push({ pkgRel, name: pkgJson.name, buildScript });
    continue;
  }
  if (!buildScript) strayOutput.push({ pkgRel, name: pkgJson.name });

  const files = [];
  walk(distAbs, OUTPUT_DIR, files);
  for (const f of files) {
    f.repoRel = `${pkgRel}/${f.rel}`;
    f.shape = shapeOf(f.rel);
    f.segs = f.rel.split("/");
    f.classes = NEVER_SHIP.filter((c) => c.hit(f)).map((c) => c.id);
    if (!f.irregular && leaksRepoPath(f.abs)) f.classes.push("absolute-workspace-path");
    f.acknowledged = f.classes.length > 0 ? acknowledgementFor(f.repoRel) : undefined;
  }
  files.sort((a, b) => (a.shape < b.shape ? -1 : 1));
  const shapes = new Map();
  for (const f of files) {
    const group = shapes.get(f.shape) ?? { count: 0, bytes: [] };
    group.count += 1;
    group.bytes.push(f.bytes);
    shapes.set(f.shape, group);
  }
  for (const group of shapes.values()) group.bytes.sort((a, b) => b - a);
  census.push({ pkgRel, name: pkgJson.name, buildScript, files, shapes });
}

if (census.length === 0) {
  console.error(`no build output under any workspace package — run \`pnpm build\` first`);
  process.exit(1);
}

const allFiles = census.flatMap((p) => p.files);
const violations = allFiles.filter((f) => f.classes.length > 0 && !f.acknowledged);
const acknowledged = allFiles.filter((f) => f.classes.length > 0 && f.acknowledged);

// ---- report ----------------------------------------------------------------
const n = (v) => v.toLocaleString("en-US");
const mb = (v) => `${(v / 1024 / 1024).toFixed(2)} MB`;
let grandBytes = 0;
let grandInstalled = 0;
let grandFiles = 0;

console.log(`package census — repo-relative build output of \`pnpm build\`\n`);
for (const pkg of census) {
  const bytes = pkg.files.reduce((s, f) => s + f.bytes, 0);
  const installed = pkg.files.reduce((s, f) => s + installedOf(f.bytes), 0);
  grandBytes += bytes;
  grandInstalled += installed;
  grandFiles += pkg.files.length;
  console.log(`${pkg.pkgRel}  (${pkg.name})`);
  for (const f of pkg.files) {
    const tag = f.classes.length > 0 ? `  ← ${f.classes.join(",")}` : "";
    console.log(`  ${f.rel.padEnd(56)} ${n(f.bytes).padStart(12)}${tag}`);
  }
  console.log(
    `  ${`── ${pkg.files.length} files`.padEnd(56)} ${n(bytes).padStart(12)}` +
      `  (${mb(bytes)}, installed ${mb(installed)})`,
  );
  console.log("");
}
console.log(
  `TOTAL ${grandFiles} files across ${census.length} packages: ` +
    `${n(grandBytes)} bytes (${mb(grandBytes)}), installed ~${mb(grandInstalled)} @ ${BLOCK}B blocks`,
);

const collisions = census.flatMap((pkg) =>
  [...pkg.shapes]
    .filter(([, g]) => g.count > 1)
    .map(([shape, g]) => `${pkg.pkgRel}/${shape} ×${g.count}`),
);
if (collisions.length > 0) {
  console.log(
    `\nshapes covering more than one file (counted, never collapsed): ${collisions.join(", ")}`,
  );
}
if (delegating.length > 0) {
  const list = delegating.map((d) => d.pkgRel).join(", ");
  console.log(`\ndelegating builds (own no output; re-invoke other packages): ${list}`);
}
if (notBuilt.length > 0) {
  console.log(`\nDECLARED A BUILD BUT PRODUCED NO ${OUTPUT_DIR}/ — census is incomplete:`);
  for (const p of notBuilt) console.log(`  ${p.pkgRel}  (${p.name})`);
}
if (strayOutput.length > 0) {
  console.log(`\n${OUTPUT_DIR}/ present with no build script (stale output?):`);
  for (const p of strayOutput) console.log(`  ${p.pkgRel}  (${p.name})`);
}
if (unsupportedGlobs.length > 0) {
  console.log(`\nunrecognized pnpm-workspace globs (NOT censused): ${unsupportedGlobs.join(", ")}`);
}

// EDP-13: field-native is always a release-mode, architecture-specific, separately
// signed sidecar staged into resources/bin — never a TS build product. Its absence is
// the design, so it is stated rather than left looking like an oversight; Cargo's
// `target/` is excluded for the same reason (and is ~8.5 GB of debug artifacts).
console.log(
  `\nnot in this census, by design:\n` +
    `  packages/field-native — ships as a separately built release binary staged into\n` +
    `    resources/bin (EDP-13); Cargo \`target/\` is not a TS build product and is excluded.`,
);

if (acknowledged.length > 0) {
  console.log(`\nacknowledged non-shipping output (built on purpose, MUST NOT be staged):`);
  for (const f of acknowledged) {
    console.log(`  ${f.repoRel}  [${f.classes.join(",")}] — ${f.acknowledged[1]}`);
  }
}

// ---- --update: refresh the checked-in baseline -----------------------------
// Keys are inserted in sorted order so the JSON diffs cleanly; sizes are recorded as the
// baseline (the spec asks for an installed-size report) but are never an assertion —
// see the drift note below.
const sorted = (entries) => Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

// biome's JSON formatter puts a short array of primitives on one line; JSON.stringify
// always expands them. Emitting biome's shape directly keeps `--update` from leaving a
// tree that `pnpm verify` rejects — a generator whose output the formatter rewrites is a
// churn loop, and churn loops end with someone disabling the check.
const collapseShortArrays = (json) =>
  json.replace(/^(\s*)("[^"]+": )\[\n([\s\S]*?)\n\s*\]/gm, (whole, indent, key, body) => {
    if (/[[\]{}]/.test(body)) return whole; // nested: biome keeps those expanded too
    const line = `${indent}${key}[${body
      .split(",\n")
      .map((s) => s.trim())
      .join(", ")}]`;
    return line.length <= 100 ? line : whole;
  });

if (args.includes("--update")) {
  const manifest = {
    note:
      "Baseline census of `pnpm build` output (WP1/EDP slice 0). Refresh deliberately with " +
      "`node scripts/package-census.mjs --update`; asset hashes are normalized to [hash].",
    spec: "electron-distribution-and-tray.md §7.3 (allowlist) + §13.2 (stage-content checks)",
    blockSizeBytes: BLOCK,
    packages: sorted(
      census.map((pkg) => [
        pkg.pkgRel,
        {
          name: pkg.name,
          files: sorted(
            [...pkg.shapes].map(([shape, group]) => {
              const classes = pkg.files.find((f) => f.shape === shape)?.classes ?? [];
              return [
                shape,
                {
                  count: group.count,
                  bytes: group.bytes,
                  ...(classes.length > 0 ? { neverShip: classes } : {}),
                },
              ];
            }),
          ),
          bytes: pkg.files.reduce((s, f) => s + f.bytes, 0),
          installedBytes: pkg.files.reduce((s, f) => s + installedOf(f.bytes), 0),
        },
      ]),
    ),
    totals: { files: grandFiles, bytes: grandBytes, installedBytes: grandInstalled },
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${collapseShortArrays(JSON.stringify(manifest, null, 2))}\n`);
  console.log(`\nwrote ${manifestRel} — ${grandFiles} files, ${n(grandBytes)} bytes`);
}

// ---- --assert: drift + the fatal class -------------------------------------
if (args.includes("--assert")) {
  // Asserting against an unbuilt package would report every missing file as drift and
  // still exit 0 — a false green. Refuse instead, the way bundle-report.mjs refuses a
  // missing renderer: this is a precondition failure, not a verdict about contents.
  if (notBuilt.length > 0) {
    console.error(
      `\ncensus assert CANNOT RUN — ${notBuilt.map((p) => p.pkgRel).join(", ")} ` +
        "declared a build but produced no output; run `pnpm build` first",
    );
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`\nno baseline at ${manifestRel} — run with --update to write it first`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const observed = new Map();
  for (const pkg of census) {
    for (const [shape, group] of pkg.shapes) observed.set(`${pkg.pkgRel}/${shape}`, group);
  }
  const expected = new Map();
  for (const [pkgRel, pkg] of Object.entries(manifest.packages ?? {})) {
    for (const [shape, rec] of Object.entries(pkg.files ?? {})) {
      expected.set(`${pkgRel}/${shape}`, rec);
    }
  }
  const missing = [...expected.keys()].filter((k) => !observed.has(k)).sort();
  const unexpected = [...observed.keys()].filter((k) => !expected.has(k)).sort();
  // A shape both sides know can still drift by count: a second `workspace-*.js` chunk is
  // a new file, not a rebuilt one, and set-difference alone would call that clean.
  const miscounted = [];
  for (const [k, group] of observed) {
    const want = expected.get(k)?.count;
    if (typeof want === "number" && want !== group.count) miscounted.push([k, want, group.count]);
  }
  miscounted.sort();

  console.log(`\ncensus assert — against ${manifestRel}`);
  if (missing.length > 0) {
    console.log(`  expected but MISSING (${missing.length}):`);
    for (const k of missing) console.log(`    ${k}`);
  }
  if (unexpected.length > 0) {
    console.log(`  present but UNEXPECTED (${unexpected.length}):`);
    for (const k of unexpected) console.log(`    ${k}`);
  }
  if (miscounted.length > 0) {
    console.log(`  file COUNT changed for a known shape (${miscounted.length}):`);
    for (const [k, want, got] of miscounted)
      console.log(`    ${k}: expected ${want}, found ${got}`);
  }
  // Size deltas are information, never a verdict: every renderer edit moves bytes, and a
  // checker that fails on that gets disabled within a week. Growth is what a human wants
  // to see, so it is printed — with the threshold high enough to mean something.
  const grew = [];
  for (const [k, group] of observed) {
    const rec = expected.get(k);
    if (!Array.isArray(rec?.bytes)) continue;
    const before = rec.bytes.reduce((s, b) => s + b, 0);
    const after = group.bytes.reduce((s, b) => s + b, 0);
    if (before === 0) continue;
    if (Math.abs(after - before) / before >= 0.1) grew.push([k, before, after, after - before]);
  }
  if (grew.length > 0) {
    console.log(`  size moved >10% since the baseline (informational):`);
    for (const [k, before, after, delta] of grew.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))) {
      console.log(`    ${k}: ${n(before)} → ${n(after)} (${delta > 0 ? "+" : ""}${n(delta)})`);
    }
  }
  if (missing.length + unexpected.length + miscounted.length === 0) console.log("  no drift");

  if (violations.length > 0) {
    console.error(`\ncensus assert FAILED — §7.3 forbids this output from a package:`);
    for (const f of violations) {
      const why = NEVER_SHIP.filter((c) => f.classes.includes(c.id)).map((c) => c.why);
      if (f.classes.includes("absolute-workspace-path")) {
        why.push("§13.2 — the build-machine path is inlined in this artifact");
      }
      console.error(`  ${f.repoRel}  [${f.classes.join(",")}]`);
      for (const w of why) console.error(`      ${w}`);
    }
    process.exit(1);
  }

  const drift = missing.length + unexpected.length + miscounted.length;
  if (args.includes("--strict") && drift > 0) {
    console.error(
      `\ncensus assert FAILED (--strict) — ${missing.length} missing / ${unexpected.length} ` +
        `unexpected / ${miscounted.length} miscounted; run --update if the change was intended`,
    );
    process.exit(1);
  }
  console.log(
    `\ncensus assert OK — no §7.3 violation` +
      (drift > 0 ? `; ${drift} drift item(s) reported, non-fatal without --strict` : ""),
  );
}

const jsonPath = argValue("--json");
if (jsonPath) {
  const report = {
    generatedFor: "WP1 package census (EDP slice 0)",
    repoRelative: true,
    blockSizeBytes: BLOCK,
    packages: census.map((pkg) => ({
      dir: pkg.pkgRel,
      name: pkg.name,
      buildScript: pkg.buildScript,
      files: pkg.files.map((f) => ({
        path: f.rel,
        shape: f.shape,
        bytes: f.bytes,
        installedBytes: installedOf(f.bytes),
        neverShip: f.classes,
        acknowledged: f.acknowledged ? f.acknowledged[1] : undefined,
      })),
    })),
    delegating: delegating.map((d) => d.pkgRel),
    notBuilt: notBuilt.map((d) => d.pkgRel),
    strayOutput: strayOutput.map((d) => d.pkgRel),
    violations: violations.map((f) => ({ path: f.repoRel, classes: f.classes })),
    totals: { files: grandFiles, bytes: grandBytes, installedBytes: grandInstalled },
  };
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${jsonPath}`);
}
