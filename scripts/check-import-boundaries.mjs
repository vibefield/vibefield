#!/usr/bin/env node
// Import-boundary checker for the electron-shell refactor (spec §8.3 "Automated
// enforcement"). Walks the repo's TS/JS source and flags imports and string
// literals that cross the package walls the refactor establishes (spec §8.1).
//
// Report-only by default (ALWAYS exit 0) so it runs across every migration slice
// while the pre-refactor layout still legitimately trips rules. `--enforce` flips
// it to a hard gate that exits 1 on any violation (slice 2 wires that into
// preflight). `--self-test` proves each rule on synthetic fixtures.
//
// Node >=22 ESM, builtins only — no new dependencies (spec: textual first version
// is allowed; upgrade to real TS/ESM parsing only if textual checks get ambiguous).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

// Extensions that carry imports; R6/R7 narrow to .ts/.tsx per spec wording.
const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs)$/;
const TS_ONLY = /\.tsx?$/;

// Directories never worth walking: dependencies, build outputs, VCS, the design
// corpus (spec: ignore draft/), and the Rust/pnpm caches.
const SKIP_DIRS = new Set([
  ".cache",
  ".git",
  ".idea",
  ".pnpm-store",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "draft",
  "node_modules",
  "out",
  "target",
]);

// --- path predicates ---------------------------------------------------------

function under(relPath, prefix) {
  return relPath === prefix || relPath.startsWith(`${prefix}/`);
}

function underAny(relPath, prefixes) {
  return prefixes.some((p) => under(relPath, p));
}

function basename(relPath) {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function isTestPath(relPath) {
  if (/\.(?:test|spec)\.[cm]?tsx?$/.test(basename(relPath))) return true;
  return relPath.split("/").some((seg) => seg === "test" || seg === "tests");
}

function isConfigFile(relPath) {
  return /\.config\.[cm]?tsx?$/.test(basename(relPath));
}

// --- import-specifier predicates ---------------------------------------------

// Exact package or a subpath of it ("react" or "react/jsx-runtime"), but not a
// same-prefix impostor ("reactive").
function importsModule(spec, mod) {
  return spec === mod || spec.startsWith(`${mod}/`);
}

function matchesForbid(spec, forbid) {
  if (forbid.modules?.some((m) => importsModule(spec, m))) return true;
  if (forbid.prefixes?.some((p) => spec.startsWith(p))) return true;
  return false;
}

// A cross-package deep import: reaching past a new package's public entries. Bare
// `@vibefield/field-app` (no subpath) is the public root and allowed; `/main`,
// `/preload`, `/host` are the declared entries (spec §8.2).
const NEW_PACKAGE_ENTRIES = new Set(["main", "preload", "host"]);
function isDeepPackageImport(spec) {
  const m = /^@vibefield\/(?:electron-shell|field-app|fieldd-supervisor)\/(.+)$/.exec(spec);
  if (m === null) return false;
  return !NEW_PACKAGE_ENTRIES.has(m[1].split("/")[0]);
}

// A specifier reaching into a testing/ or spike- module by path segment.
function importsTestingOrSpike(spec) {
  return spec.split("/").some((seg) => seg === "testing" || seg.startsWith("spike-"));
}

// --- rule table (spec §8.3) --------------------------------------------------
// Each rule has an id, a human description, an `applies(relPath)` predicate, and
// exactly one detector: `importTest(spec)` for import-graph rules, `linePattern`
// for raw text scans, or `fileLevel: true` for "this file may not exist here".
// Adding a wall in a later slice = appending one entry.
const RULES = [
  {
    id: "R1",
    description: "no electron/node:* import under packages/field-app/src",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/field-app/src"),
    importTest: (s) => importsModule(s, "electron") || s.startsWith("node:"),
  },
  {
    id: "R2",
    description:
      "no React/ICE/Three/Loro/plugin/field-app import under electron-shell src/main or src/preload",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      (under(p, "packages/electron-shell/src/main") ||
        under(p, "packages/electron-shell/src/preload")),
    // field-app's public entry is allowed only from renderer-host, never main/preload,
    // so the whole `@vibefield/field-app` package is forbidden in this scope.
    importTest: (s) =>
      matchesForbid(s, {
        modules: [
          "@vibecook/ice",
          "@vibefield/field-app",
          "@vibefield/shell-ui",
          "loro-crdt",
          "react",
          "react-dom",
          "three",
        ],
        prefixes: ["@react-three/", "@vibefield/plugin-"],
      }),
  },
  {
    id: "R3",
    description: "no electron import under packages/fieldd-supervisor/src",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/fieldd-supervisor/src"),
    importTest: (s) => importsModule(s, "electron"),
  },
  {
    id: "R4",
    description: "no .ts/.tsx application source under apps/desktop (except *.config.ts and test/)",
    applies: (p) =>
      TS_ONLY.test(p) && under(p, "apps/desktop") && !isConfigFile(p) && !isTestPath(p),
    fileLevel: true,
  },
  {
    id: "R5",
    description:
      "no deep import across the three new packages (only /main, /preload, /host entries)",
    applies: (p) => SOURCE_EXT.test(p),
    importTest: isDeepPackageImport,
  },
  {
    id: "R6",
    description: "no raw vibefield: IPC channel string literal outside packages/contracts",
    applies: (p) => TS_ONLY.test(p) && !under(p, "packages/contracts"),
    linePattern: /["'`]vibefield:[^"'`]*/g,
  },
  {
    id: "R7",
    description: "no hardcoded fieldd port 9410/9411 outside packages/contracts/src/registries.ts",
    applies: (p) => TS_ONLY.test(p) && p !== "packages/contracts/src/registries.ts",
    linePattern: /\b(?:9410|9411)\b/g,
  },
  {
    id: "R8",
    description:
      "no production static import of testing/spike- modules under apps/desktop, electron-shell, field-app",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      underAny(p, ["apps/desktop", "packages/electron-shell", "packages/field-app"]) &&
      !isTestPath(p),
    importTest: importsTestingOrSpike,
  },
  {
    id: "R9",
    description:
      "no ws import under packages/field-app/src or apps/desktop/renderer/src (fieldd-client stays isomorphic)",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      (under(p, "packages/field-app/src") || under(p, "apps/desktop/renderer/src")),
    importTest: (s) => s === "ws",
  },
];

// --- source walking & import extraction --------------------------------------

function collectFiles(root) {
  const out = [];
  const walk = (absDir) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(absDir, entry.name));
      } else if (entry.isFile()) {
        const name = entry.name;
        if (/\.d\.[cm]?ts$/.test(name)) continue; // ambient types are not product source
        const abs = join(absDir, name);
        // The checker embeds every forbidden pattern as rule/fixture data, so it
        // must never lint itself (otherwise R5's fixture string self-reports).
        if (abs === import.meta.filename) continue;
        if (SOURCE_EXT.test(name)) out.push(abs);
      }
    }
  };
  walk(root);
  return out;
}

// Textual import extraction (spec allows a textual first version). Catches
// `import/export ... from "x"`, side-effect `import "x"`, dynamic `import("x")`,
// and `require("x")`. Line-based; returns the unique specifiers on a line.
const IMPORT_PATTERNS = [
  /\bfrom\s*["'`]([^"'`]+)["'`]/g,
  /\bimport\s+["'`]([^"'`]+)["'`]/g,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
];

function extractImports(line) {
  const specs = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    for (;;) {
      const m = re.exec(line);
      if (m === null) break;
      specs.add(m[1]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return specs;
}

// --- the check ---------------------------------------------------------------

function runCheck(root) {
  const violations = [];
  for (const abs of collectFiles(root)) {
    const rel = relative(root, abs).split(sep).join("/");
    const applicable = RULES.filter((r) => r.applies(rel));
    if (applicable.length === 0) continue;

    for (const r of applicable) {
      if (r.fileLevel) violations.push({ id: r.id, file: rel, line: null, offender: rel });
    }

    const importRules = applicable.filter((r) => r.importTest);
    const lineRules = applicable.filter((r) => r.linePattern);
    if (importRules.length === 0 && lineRules.length === 0) continue;

    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;

      if (importRules.length > 0) {
        const specs = extractImports(line);
        if (specs.size > 0) {
          for (const spec of specs) {
            for (const r of importRules) {
              if (r.importTest(spec)) {
                violations.push({ id: r.id, file: rel, line: lineNo, offender: spec });
              }
            }
          }
        }
      }

      for (const r of lineRules) {
        r.linePattern.lastIndex = 0;
        for (;;) {
          const m = r.linePattern.exec(line);
          if (m === null) break;
          violations.push({ id: r.id, file: rel, line: lineNo, offender: m[0] });
          if (m.index === r.linePattern.lastIndex) r.linePattern.lastIndex += 1;
        }
      }
    }
  }
  return violations;
}

// --- reporting ---------------------------------------------------------------

function report(violations, { enforce }) {
  const sorted = [...violations].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id);
  });

  for (const v of sorted) {
    const loc = v.line === null ? v.file : `${v.file}:${v.line}`;
    console.log(`  ${v.id.padEnd(3)} ${loc}  ${v.offender}`);
  }

  const counts = new Map();
  for (const v of violations) counts.set(v.id, (counts.get(v.id) ?? 0) + 1);
  const files = new Set(violations.map((v) => v.file)).size;

  console.log("");
  console.log("Import-boundary summary (spec §8.3):");
  for (const r of RULES) {
    console.log(`  ${r.id}: ${String(counts.get(r.id) ?? 0).padStart(3)}  ${r.description}`);
  }
  console.log(`  total: ${violations.length} violation(s) across ${files} file(s)`);

  if (violations.length === 0) {
    console.log("\ncheck-import-boundaries: clean");
  } else if (enforce) {
    console.error(
      `\ncheck-import-boundaries: FAIL — ${violations.length} violation(s) [--enforce]`,
    );
  } else {
    console.log(
      `\ncheck-import-boundaries: ${violations.length} violation(s) (report-only; exit 0)`,
    );
  }
}

// --- self-test ---------------------------------------------------------------
// Builds a throwaway repo where each rule has exactly one file that MUST trip it
// and a set of clean files that MUST pass, then runs the real checker against it.
function runSelfTest() {
  const positives = [
    {
      id: "R1",
      file: "packages/field-app/src/uses-node.ts",
      body: 'import fs from "node:fs";\nimport { app } from "electron";\n',
    },
    {
      id: "R2",
      file: "packages/electron-shell/src/main/uses-react.ts",
      body: 'import React from "react";\nimport { Canvas } from "@react-three/fiber";\n',
    },
    {
      id: "R3",
      file: "packages/fieldd-supervisor/src/uses-electron.ts",
      body: 'import { app } from "electron";\n',
    },
    { id: "R4", file: "apps/desktop/renderer/src/product.tsx", body: "export const x = 1;\n" },
    {
      id: "R5",
      file: "packages/fieldd/src/deep-import.ts",
      body: 'import { z } from "@vibefield/field-app/dist/internal";\n',
    },
    {
      id: "R6",
      file: "packages/fieldd/src/raw-channel.ts",
      body: 'const c = "vibefield:connection";\n',
    },
    {
      id: "R7",
      file: "packages/fieldd/src/hardcoded-port.ts",
      body: 'const u = "ws://127.0.0.1:9410";\n',
    },
    { id: "R7", file: "packages/fieldd/test/port-in-test.test.ts", body: "const p = 9411;\n" },
    {
      id: "R8",
      file: "packages/field-app/src/imports-testing.ts",
      body: 'import { M } from "../testing/mock";\n',
    },
    { id: "R9", file: "packages/field-app/src/uses-ws.ts", body: 'import WebSocket from "ws";\n' },
  ];
  const cleans = [
    // react + a /host entry import + plain code: proves R1/R2/R9 don't overfire and
    // R5 accepts declared entries.
    {
      file: "packages/field-app/src/clean.ts",
      body: 'import React from "react";\nimport { host } from "@vibefield/field-app/host";\nexport const ok = 1;\n',
    },
    // the R7 single-file and R6 whole-package contract exclusions, together.
    {
      file: "packages/contracts/src/registries.ts",
      body: 'export const PRODUCT_PORT = 9410;\nexport const CHANNEL = "vibefield:connection";\n',
    },
    // R6 excludes ALL of contracts, not just registries.ts.
    {
      file: "packages/contracts/src/channels.ts",
      body: 'export const CH = "vibefield:prepare-close";\n',
    },
    // R4 exempts *.config.ts.
    { file: "apps/desktop/vite.config.ts", body: 'export default { root: "renderer" };\n' },
    // test files are exempt from R4 and R8.
    {
      file: "apps/desktop/test/uses-testing.test.ts",
      body: 'import { M } from "../testing/mock";\nexport const t = true;\n',
    },
  ];

  const tmp = mkdtempSync(join(tmpdir(), "vf-import-walls-"));
  let ok = true;
  try {
    for (const c of [...positives, ...cleans]) {
      const abs = join(tmp, c.file);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, c.body);
    }

    const byFile = new Map();
    for (const v of runCheck(tmp)) {
      if (!byFile.has(v.file)) byFile.set(v.file, new Set());
      byFile.get(v.file).add(v.id);
    }

    for (const c of positives) {
      const hit = byFile.get(c.file)?.has(c.id) ?? false;
      console.log(`  ${hit ? "PASS" : "FAIL"}  ${c.id} detected in ${c.file}`);
      if (!hit) ok = false;
    }
    for (const c of cleans) {
      const ids = byFile.get(c.file);
      const clean = ids === undefined || ids.size === 0;
      const extra = clean ? "" : ` (unexpected: ${[...ids].join(", ")})`;
      console.log(`  ${clean ? "PASS" : "FAIL"}  clean ${c.file}${extra}`);
      if (!clean) ok = false;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(ok ? "\nself-test: all passed" : "\nself-test: FAILURES present");
  return ok;
}

// --- entry -------------------------------------------------------------------

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "usage: node scripts/check-import-boundaries.mjs [--enforce] [--self-test]\n" +
      "  (default)    report every import-wall violation, always exit 0\n" +
      "  --enforce    exit 1 if any violation (the gate slice 2 wires into preflight)\n" +
      "  --self-test  run rule fixtures in a temp dir; exit 1 on any self-test failure",
  );
  process.exit(0);
}

if (args.has("--self-test")) {
  process.exit(runSelfTest() ? 0 : 1);
}

const enforce = args.has("--enforce");
const violations = runCheck(resolve(import.meta.dirname, ".."));
report(violations, { enforce });
process.exit(enforce && violations.length > 0 ? 1 : 0);
