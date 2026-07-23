#!/usr/bin/env node
// Import-boundary checker for the electron-shell refactor (spec §8.3 "Automated
// enforcement"). Walks the repo's TS/JS source and flags imports and string
// literals that cross the package walls the refactor establishes (spec §8.1).
//
// Report-only by default (ALWAYS exit 0) so it runs across every migration slice
// while the pre-refactor layout still legitimately trips rules. `--enforce` flips
// it to a hard gate that exits 1 on ENFORCE-TRUE violations only; rules still
// marked `enforce: false` (pending a later slice) are reported but never gated
// (slice 2 wires the gate into preflight). `--self-test` proves each rule on
// synthetic fixtures.
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
// `/preload`, `/host` are the declared entries (spec §8.2), plus field-app's
// browser-safe `/logging` seam and exported `/spike` implementation consumed by
// the shell's test-only spike page.
const NEW_PACKAGE_ENTRIES = new Set(["main", "preload", "host", "logging", "spike"]);
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
    enforce: true,
    description: "no electron/node:* import under packages/field-app/src",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/field-app/src"),
    importTest: (s) => importsModule(s, "electron") || s.startsWith("node:"),
  },
  {
    id: "R2",
    enforce: true,
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
    enforce: true,
    description: "no electron import under packages/fieldd-supervisor/src",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/fieldd-supervisor/src"),
    importTest: (s) => importsModule(s, "electron"),
  },
  {
    id: "R4",
    // slice 3a moved the renderer to field-app — apps/desktop is packaging-only
    enforce: true,
    description: "no .ts/.tsx application source under apps/desktop (except *.config.ts and test/)",
    applies: (p) =>
      TS_ONLY.test(p) && under(p, "apps/desktop") && !isConfigFile(p) && !isTestPath(p),
    fileLevel: true,
  },
  {
    id: "R5",
    enforce: true,
    description: "no deep import across the three new packages (declared public entries only)",
    applies: (p) => SOURCE_EXT.test(p),
    importTest: isDeepPackageImport,
  },
  {
    id: "R6",
    enforce: true,
    description: "no raw vibefield: IPC channel string literal outside packages/contracts",
    applies: (p) => TS_ONLY.test(p) && !under(p, "packages/contracts"),
    linePattern: /["'`]vibefield:[^"'`]*/g,
  },
  {
    id: "R7",
    enforce: true,
    // Strip comment tails before matching (see stripCommentTails): a port named
    // in prose like ":9411 lane" is documentation, not a call site. Ports inside
    // string literals still match — those are real hardcoded endpoints.
    stripComments: true,
    description: "no hardcoded fieldd port 9410/9411 outside packages/contracts/src/registries.ts",
    applies: (p) => TS_ONLY.test(p) && p !== "packages/contracts/src/registries.ts",
    linePattern: /\b(?:9410|9411)\b/g,
  },
  {
    id: "R8",
    enforce: true,
    // Static-only (approved slice 2): the rule is about STATIC imports (spec §8.3
    // / ESR-12 §5.2.6). Dynamic `import()`/`require()` is the sanctioned escape
    // hatch for reaching the separate test-only build artifact (dist/testing/*,
    // which the production bundle never contains), so it is exempt FOR R8 ONLY —
    // R1/R5/R9 still catch dynamic imports.
    staticOnly: true,
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
    enforce: true,
    description:
      "no ws import under packages/field-app/src or apps/desktop/renderer/src (fieldd-client stays isomorphic)",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      (under(p, "packages/field-app/src") || under(p, "apps/desktop/renderer/src")),
    importTest: (s) => s === "ws",
  },
  {
    id: "R10",
    // Plugin-architecture spec §11.3, ENFORCED since slice P3 (the SDK is the
    // door): plugin RUNTIME code imports only @vibefield/plugin-sdk (+ contracts
    // types, react, PA-29 singleton bare specifiers). scripts/ (manifest emit —
    // plugin-build's Node-side caller) and test/ (vitest) are authoring-time
    // subtrees, never part of the renderer artifact graph, and stay exempt.
    enforce: true,
    description:
      "plugins import only the plugin SDK (no host/platform/ICE/Electron under plugins/, examples/plugins/)",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      underAny(p, ["plugins", "examples/plugins"]) &&
      !/(^|\/)(scripts|test)\//.test(p),
    importTest: (s) =>
      matchesForbid(s, {
        modules: [
          "@vibecook/ice",
          "@vibefield/electron-shell",
          "@vibefield/field-app",
          "@vibefield/fieldd",
          "@vibefield/fieldd-client",
          "@vibefield/fieldd-supervisor",
          "@vibefield/plugin-runtime",
          "@vibefield/shell-ui",
          "electron",
          "ws",
        ],
        prefixes: ["node:"],
      }),
  },
  {
    id: "R11",
    // ENFORCED since LOG-L3: first-party runtime diagnostics must enter a
    // process-owned sink. Plugin-origin console adapters remain visible under
    // pending R15 until LOG-L4 gives them provenance-aware plugin sinks.
    enforce: true,
    description: "no first-party runtime console.* outside explicit smoke/development adapters",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      under(p, "packages") &&
      !isTestPath(p) &&
      !/(^|\/)scripts\//.test(p) &&
      !under(p, "packages/field-app/src/spike") &&
      ![
        "packages/electron-shell/src/testing/smoke.ts",
        "packages/field-app/src/development-console.ts",
        "packages/field-app/src/plugin-host/renderer-harness.ts",
        "packages/fieldd/src/plugin-service-console.ts",
      ].includes(p),
    linePattern: /\bconsole\.(?:debug|info|log|warn|error|trace)\s*\(/g,
  },
  {
    id: "R12",
    // Pino is the private Node implementation, never a product/package API.
    enforce: false,
    description: "Pino imports stay inside @vibefield/logging",
    applies: (p) => SOURCE_EXT.test(p) && !under(p, "packages/logging"),
    importTest: (s) => importsModule(s, "pino"),
  },
  {
    id: "R13",
    // Textual first version: catches invalid literal first arguments on the
    // first-party event-first Logger. PluginLogger is message-first, so plugin
    // code and the plugin host/SDK are outside this rule.
    enforce: false,
    description: "first-party logger event literals use a dotted static namespace",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      under(p, "packages") &&
      !underAny(p, [
        "packages/field-app/src/plugin-host",
        "packages/plugin-runtime",
        "packages/plugin-sdk",
      ]) &&
      p !== "packages/fieldd/src/service-worker-harness.mjs" &&
      !isTestPath(p),
    linePattern:
      /\b(?:log|logger)\.(?:trace|debug|info|warn|error|fatal)\(\s*["'`](?![a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+["'`])[^"'`]*/g,
  },
  {
    id: "R14",
    enforce: false,
    stripComments: true,
    description: "physical log stream names come only from contracts registries.ts",
    applies: (p) =>
      SOURCE_EXT.test(p) && p !== "packages/contracts/src/registries.ts" && !isTestPath(p),
    linePattern:
      /["'`](?:system\/(?:desktop|renderer|utility|fieldd|field-native)|plugins\/(?:renderer|service|utility)|(?:desktop|renderer|utility|fieldd|field-native|service)\.ndjson)["'`]/g,
  },
  {
    id: "R15",
    // LOG-L3 separates the plugin-origin migration ledger from the now-blocking
    // first-party console wall. LOG-L4 replaces these adapters/calls with
    // provenance-aware plugins/{renderer,service,utility} routes and enforces it.
    enforce: false,
    description: "plugin-origin runtime console.* awaits provenance-aware LOG-L4 sinks",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      !isTestPath(p) &&
      !/(^|\/)scripts\//.test(p) &&
      (underAny(p, ["plugins", "examples/plugins"]) ||
        [
          "packages/field-app/src/plugin-host/renderer-harness.ts",
          "packages/fieldd/src/plugin-service-console.ts",
        ].includes(p)),
    linePattern: /\bconsole\.(?:debug|info|log|warn|error|trace)\s*\(/g,
  },
];

// Enforce map (spec §8.3 slice 2): --enforce gates ONLY on enforce-true rules.
// Pending rules (enforce:false) are still reported, marked "(pending)".
const ENFORCE_BY_ID = new Map(RULES.map((r) => [r.id, r.enforce]));

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

// Textual import extraction (spec allows a textual first version). Line-based;
// returns the unique specifiers on a line. Patterns are split by kind because R8
// is static-only: STATIC forms are `import/export ... from "x"` and the bare
// side-effect `import "x"`; DYNAMIC forms are `import("x")` and `require("x")`.
const STATIC_IMPORT_PATTERNS = [/\bfrom\s*["'`]([^"'`]+)["'`]/g, /\bimport\s+["'`]([^"'`]+)["'`]/g];
const DYNAMIC_IMPORT_PATTERNS = [
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
];
const IMPORT_PATTERNS = [...STATIC_IMPORT_PATTERNS, ...DYNAMIC_IMPORT_PATTERNS];

function matchSpecs(line, patterns) {
  const specs = new Set();
  for (const re of patterns) {
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

// All imports (static + dynamic) — the default for import-graph rules (R1/R5/R9
// must catch dynamic imports too).
function extractImports(line) {
  return matchSpecs(line, IMPORT_PATTERNS);
}

// Static imports only — for `staticOnly` rules (R8): a dynamic import()/require()
// is the sanctioned test-only escape hatch and MUST NOT trip R8.
function extractStaticImports(line) {
  return matchSpecs(line, STATIC_IMPORT_PATTERNS);
}

// R7-only comment stripping. R7 targets *hardcoded* ports; a port named in prose
// like ":9411 lane" is documentation, not a call site. Per-line approximation,
// deliberately not a tokenizer (spec §8.3: upgrade to real parsing only if this
// gets ambiguous):
//   - a line whose first non-space char is `*` is a block-comment body line and
//     is dropped whole;
//   - otherwise scan left-to-right tracking ' " ` string state (with backslash
//     escapes) and truncate at the first `//` or `/*` seen OUTSIDE a string.
// Ports inside STRING LITERALS survive (e.g. "ws://127.0.0.1:9410", whose `//`
// is inside the quotes) — those are real endpoints and MUST still trip R7.
// Multi-line string/template and block-comment state is not carried across lines.
function stripCommentTails(line) {
  if (line.trimStart().startsWith("*")) return "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) {
      return line.slice(0, i);
    }
  }
  return line;
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
        const allSpecs = extractImports(line);
        if (allSpecs.size > 0) {
          // staticOnly rules (R8) see only static specifiers; computed lazily and
          // reused. staticSpecs ⊆ allSpecs, so an all-dynamic line yields an empty
          // set and the staticOnly rule simply does not fire.
          let staticSpecs = null;
          for (const r of importRules) {
            let ruleSpecs;
            if (r.staticOnly) {
              if (staticSpecs === null) staticSpecs = extractStaticImports(line);
              ruleSpecs = staticSpecs;
            } else {
              ruleSpecs = allSpecs;
            }
            for (const spec of ruleSpecs) {
              if (r.importTest(spec)) {
                violations.push({ id: r.id, file: rel, line: lineNo, offender: spec });
              }
            }
          }
        }
      }

      for (const r of lineRules) {
        const target = r.stripComments ? stripCommentTails(line) : line;
        r.linePattern.lastIndex = 0;
        for (;;) {
          const m = r.linePattern.exec(target);
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

// Returns the enforce-true violation count — the number that gates --enforce.
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
    const tag = ENFORCE_BY_ID.get(v.id) ? "" : "  (pending)";
    console.log(`  ${v.id.padEnd(3)} ${loc}  ${v.offender}${tag}`);
  }

  const counts = new Map();
  for (const v of violations) counts.set(v.id, (counts.get(v.id) ?? 0) + 1);
  const files = new Set(violations.map((v) => v.file)).size;
  const enforced = violations.filter((v) => ENFORCE_BY_ID.get(v.id)).length;
  const pending = violations.length - enforced;

  console.log("");
  console.log("Import-boundary summary (spec §8.3):");
  for (const r of RULES) {
    const n = String(counts.get(r.id) ?? 0).padStart(3);
    console.log(`  ${r.id}: ${n}  [${r.enforce ? "enforce" : "pending"}] ${r.description}`);
  }
  console.log(
    `  total: ${violations.length} across ${files} file(s) — ${enforced} enforced, ${pending} pending`,
  );

  if (violations.length === 0) {
    console.log("\ncheck-import-boundaries: clean");
  } else if (enforce) {
    const pendingNote = pending > 0 ? ` (+${pending} pending, not gated)` : "";
    if (enforced > 0) {
      console.error(
        `\ncheck-import-boundaries: FAIL — ${enforced} enforced violation(s)${pendingNote} [--enforce]`,
      );
    } else {
      console.log(
        `\ncheck-import-boundaries: pass — 0 enforced violation(s)${pendingNote} [--enforce]`,
      );
    }
  } else {
    console.log(
      `\ncheck-import-boundaries: ${violations.length} violation(s) (report-only; exit 0)` +
        ` — ${enforced} enforced, ${pending} pending`,
    );
  }

  return enforced;
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
    // R8 staticOnly is R8-SCOPED, not global: a DYNAMIC import("electron") under
    // field-app still trips R1 (R1/R5/R9 keep full static+dynamic coverage).
    {
      id: "R1",
      file: "packages/field-app/src/dynamic-electron.ts",
      body: 'const e = () => import("electron");\n',
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
    // R7 real code on a line that ALSO carries a comment port: the real 9410 must
    // fire while the commented 9411 is stripped (proves stripCommentTails is surgical).
    {
      id: "R7",
      file: "packages/fieldd/src/port-real-plus-comment.ts",
      body: "const p = 9410; // not the 9411 lane\n",
    },
    // R8 (staticOnly) still fires on a STATIC import of a testing/ module.
    {
      id: "R8",
      file: "packages/field-app/src/imports-testing.ts",
      body: 'import { M } from "../testing/mock";\n',
    },
    { id: "R9", file: "packages/field-app/src/uses-ws.ts", body: 'import WebSocket from "ws";\n' },
    // R10 covers BOTH plugin roots (plugins/ and examples/plugins/).
    {
      id: "R10",
      file: "plugins/note/src/uses-runtime.ts",
      body: 'import { PluginRegistry } from "@vibefield/plugin-runtime";\n',
    },
    {
      id: "R10",
      file: "examples/plugins/widgetlab/src/uses-electron.ts",
      body: 'import { app } from "electron";\nimport { CardShell } from "@vibefield/shell-ui";\n',
    },
    {
      id: "R11",
      file: "packages/fieldd/src/raw-console.ts",
      body: 'console.warn("not persisted");\n',
    },
    {
      id: "R12",
      file: "packages/fieldd/src/imports-pino.ts",
      body: 'import pino from "pino";\n',
    },
    {
      id: "R13",
      file: "packages/fieldd/src/invalid-event.ts",
      body: 'log.info("ready", "fieldd ready");\n',
    },
    {
      id: "R14",
      file: "packages/fieldd/src/hardcoded-log-stream.ts",
      body: 'const stream = "system/fieldd";\n',
    },
    {
      id: "R15",
      file: "plugins/note/src/raw-console.ts",
      body: 'console.info("plugin-origin");\n',
    },
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
      body:
        "export const PRODUCT_PORT = 9410;\n" +
        'export const CHANNEL = "vibefield:connection";\n' +
        'export const LOG_STREAM = "system/fieldd";\n',
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
    // R8 staticOnly: a DYNAMIC import of a testing/ module under an R8 root (the
    // shell composition root's sanctioned smoke-bundle reach) must NOT fire R8.
    {
      file: "packages/electron-shell/src/main/dynamic-testing.ts",
      body: 'const t = () => import("../testing/smoke.cjs");\n',
    },
    // R7 comment stripping: a port named ONLY in a comment must not fire.
    // `//` line comment (with a `:9411` prose mention alongside a bare 9410).
    {
      file: "packages/fieldd/src/port-in-line-comment.ts",
      body: "// the :9411 lane; port 9410 is registry-pinned\nexport const a = 1;\n",
    },
    // single-line `/** ... */` JSDoc (the shape of daemon.ts's data-lane doc).
    {
      file: "packages/fieldd/src/port-in-jsdoc.ts",
      body: "/** bound to the :9411 lane */\nexport const b = 2;\n",
    },
    // multi-line block comment: `/*` opener + `*`-continuation body lines.
    {
      file: "packages/fieldd/src/port-in-block-comment.ts",
      body: "/*\n * the 9411 data lane and 9410 control port are pinned in registries.ts\n */\nexport const c = 3;\n",
    },
    // R10 allows the SDK, contracts types, and react under plugins/.
    {
      file: "plugins/note/src/clean-sdk.ts",
      body: 'import { defineRendererPlugin } from "@vibefield/plugin-sdk";\nimport type { Scope } from "@vibefield/contracts";\nimport React from "react";\nexport const ok = 1;\n',
    },
    // R10 exempts authoring-time subtrees: emit scripts and tests are Node-side
    // by design, never part of the renderer artifact graph (§11.3 scope).
    {
      file: "plugins/note/scripts/emit-something.ts",
      body: 'import { writeFileSync } from "node:fs";\nexport const emit = () => writeFileSync;\n',
    },
    {
      file: "plugins/note/test/uses-node.test.ts",
      body: 'import { readFileSync } from "node:fs";\nimport { PluginRegistry } from "@vibefield/plugin-runtime";\nexport const t = readFileSync;\n',
    },
    // LOG walls: sanctioned first-party console adapters, contained Pino, valid
    // event, and the single stream-name registry are all clean.
    {
      file: "packages/electron-shell/src/testing/smoke.ts",
      body: 'console.log("SMOKE");\n',
    },
    {
      file: "packages/field-app/src/development-console.ts",
      body: 'console.log("CANVAS_READY");\n',
    },
    {
      file: "plugins/note/scripts/emit-manifest.ts",
      body: 'console.log("generated manifest");\n',
    },
    {
      file: "packages/logging/src/pino-root.ts",
      body: 'import pino from "pino";\nexport const root = pino;\n',
    },
    {
      file: "packages/fieldd/src/valid-event.ts",
      body: 'log.info("fieldd.lifecycle.ready", "fieldd ready");\n',
    },
    {
      file: "packages/fieldd/src/service-worker-harness.mjs",
      body: 'logger.warn("plugin message first");\n',
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

    const found = runCheck(tmp);
    const byFile = new Map();
    for (const v of found) {
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

    // Enforce semantics: the expected table is EXPLICIT so rot stays visible
    // (the 2026-07-23 lesson: a loose "only X pending" assertion sat stale for
    // three slices). Every rule is enforced — R10's pending era ended when
    // slice P3 landed the SDK (2026-07-23); adding a new pending rule means
    // editing THIS set, a deliberate act.
    const EXPECTED_PENDING = new Set(["R12", "R13", "R14", "R15"]);
    const tableOk = RULES.every((r) => r.enforce === !EXPECTED_PENDING.has(r.id));
    console.log(
      `  ${tableOk ? "PASS" : "FAIL"}  enforce table: every rule enforced except {${[...EXPECTED_PENDING].join(", ")}}`,
    );
    if (!tableOk) ok = false;

    const r4Gated = found.some((v) => v.id === "R4" && ENFORCE_BY_ID.get(v.id));
    console.log(`  ${r4Gated ? "PASS" : "FAIL"}  R4 detected and gated by --enforce`);
    if (!r4Gated) ok = false;

    // R10 is enforced since P3: detected violations must also GATE --enforce.
    const r10Gated = found.some((v) => v.id === "R10" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r10Gated ? "PASS" : "FAIL"}  R10 detected and GATED (enforced since P3)`);
    if (!r10Gated) ok = false;

    const r11Gated = found.some((v) => v.id === "R11" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r11Gated ? "PASS" : "FAIL"}  R11 detected and GATED (enforced since LOG-L3)`);
    if (!r11Gated) ok = false;
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
      "  --enforce    exit 1 on enforce-true violations only; pending rules are\n" +
      "               reported but not gated (the gate slice 2 wires into preflight)\n" +
      "  --self-test  run rule fixtures in a temp dir; exit 1 on any self-test failure",
  );
  process.exit(0);
}

if (args.has("--self-test")) {
  process.exit(runSelfTest() ? 0 : 1);
}

const enforce = args.has("--enforce");
const violations = runCheck(resolve(import.meta.dirname, ".."));
const enforced = report(violations, { enforce });
process.exit(enforce && enforced > 0 ? 1 : 0);
