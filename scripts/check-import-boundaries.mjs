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
import { fileURLToPath } from "node:url";

// This script's own home, so manifest-derived rules (R5) read the REAL packages
// no matter which tree is being scanned — the self-test scans a temp fixture dir.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

// A spike module: a `spike/` directory or a `spike-`-prefixed file. These are
// built only under VITE_SPIKE and packaged never, so they are not the
// "production" R8 speaks of — a spike page reaching its own implementation is
// the arrangement R8 exists to protect, not a breach of it. Named the same way
// isTestPath is, and trusted the same way: by convention, not by proof.
function isSpikePath(relPath) {
  if (basename(relPath).startsWith("spike-")) return true;
  return relPath.split("/").some((seg) => seg === "spike");
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
// browser-safe `/logging` seam, its exported `/spike` implementation consumed by
// the shell's test-only spike page, and `/design-system`, the browser-safe catalog
// entry mounted by Studio and the catalog-only renderer host.
//
// KNOWN DEBT (2026-08-07): this set is a SECOND source of truth for what each
// package publishes — the first is the `exports` map in its own package.json,
// which is what `declared public entries only` in the rule description actually
// means. They drifted the moment a legitimately-declared entry was added, and
// the wall failed a correct import on main. Deriving this from the workspace's
// package.json `exports` keys would make the rule enforce the declaration rather
// than a copy of it, exactly as registries-as-code does for ports and scopes.
// R5's public entries are DERIVED FROM THE MANIFESTS, never restated here
// (2026-08-10). This used to be one hardcoded set of subpath names shared by all
// three packages, which made the wall a SECOND SOURCE OF TRUTH about what each
// package publishes — and on 2026-08-06 that cost the repo 22 hours of red
// preflight on main for an import that was correct by `exports` (`11765bc`
// added the entry and its import together; the wall knew nothing about it).
//
// A union list is also wrong in the other direction: it let any of the six names
// through for ANY of the three packages, and it still carried `host`, which no
// package exports today. Per-package derivation fixes both — a subpath is public
// exactly when its own package.json says so.
const R5_PACKAGES = ["electron-shell", "field-app", "fieldd-supervisor"];
const R5_DEEP_IMPORT = new RegExp(`^@vibefield/(${R5_PACKAGES.join("|")})/(.+)$`);

/** The first path segment of every subpath `pkg` publishes, or `null` when the
 * package exports a wildcard (everything under it is public by declaration).
 * Read from the REPO's manifests, not the scanned tree: the self-test scans a
 * temp fixture directory, and the question "what does this package publish" is
 * always about the real package. */
function declaredEntries(pkg) {
  const manifest = join(REPO_ROOT, "packages", pkg, "package.json");
  let json;
  try {
    json = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    // A checkout where this cannot be read is broken in a way that would make
    // every R5 verdict a guess. Say so instead of quietly allowing or denying.
    throw new Error(`R5 cannot read ${manifest}: ${error.message}`);
  }
  const entries = new Set();
  for (const key of Object.keys(json.exports ?? {})) {
    if (key === ".") continue; // the bare entry is not a deep import
    const first = key.replace(/^\.\//, "").split("/")[0];
    if (first.includes("*")) return null; // wildcard: the package publishes its subtree
    entries.add(first);
  }
  return entries;
}

const R5_ENTRIES = new Map(R5_PACKAGES.map((pkg) => [pkg, declaredEntries(pkg)]));

function isDeepPackageImport(spec) {
  const m = R5_DEEP_IMPORT.exec(spec);
  if (m === null) return false;
  const entries = R5_ENTRIES.get(m[1]);
  if (entries === null) return false;
  return !entries.has(m[2].split("/")[0]);
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
          "@vibefield/design-kit",
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
      !isTestPath(p) &&
      !isSpikePath(p),
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
    // DK-8 (ICE K-L1/K-L4): ICE is walled by EVERY name it answers to — the
    // published `@vibecook/ice` and each of its entries (`/desk/objects`, the
    // built-ins' entry, first of all: a kind never imports another kind), and
    // the workspace-internal `@ice/*` names ICE's own packages build with
    // (unresolvable here, so refused as written, never by luck of resolution).
    enforce: true,
    description:
      "plugins import only the plugin SDK (no host/platform/Electron under plugins/, examples/plugins/; no ICE by any name — @vibecook/ice and every entry of it, /desk/objects first, nor the workspace-internal @ice/*)",
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
          "@vibefield/design-kit",
          "electron",
          "ws",
        ],
        prefixes: ["node:", "@ice/"],
      }),
  },
  {
    id: "R11",
    // ENFORCED since LOG-L3: first-party runtime diagnostics must enter a
    // process-owned sink. LOG-L4 removed the former plugin adapter exceptions.
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
      ].includes(p),
    linePattern: /\bconsole\.(?:debug|info|log|warn|error|trace)\s*\(/g,
  },
  {
    id: "R12",
    // Pino is the private Node implementation, never a product/package API.
    enforce: true,
    description: "Pino imports stay inside @vibefield/logging",
    applies: (p) => SOURCE_EXT.test(p) && !under(p, "packages/logging"),
    importTest: (s) => importsModule(s, "pino"),
  },
  {
    id: "R13",
    // Textual first version: catches invalid literal first arguments on the
    // first-party event-first Logger. PluginLogger is message-first, so plugin
    // code and the plugin host/SDK are outside this rule.
    enforce: true,
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
    enforce: true,
    stripComments: true,
    description: "physical log stream names come only from contracts registries.ts",
    applies: (p) =>
      SOURCE_EXT.test(p) && p !== "packages/contracts/src/registries.ts" && !isTestPath(p),
    linePattern:
      /["'`](?:system\/(?:desktop|renderer|utility|fieldd|field-native)|plugins\/(?:renderer|service|utility)|(?:desktop|renderer|utility|fieldd|field-native|service)\.ndjson)["'`]/g,
  },
  {
    id: "R15",
    // ENFORCED since LOG-L4: plugin-origin runtime evidence must use ctx.logger
    // and a provenance-aware plugins/{renderer,service,utility} route.
    enforce: true,
    description: "plugin-origin runtime console.* bypasses provenance-aware plugin sinks",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      !isTestPath(p) &&
      !/(^|\/)scripts\//.test(p) &&
      (underAny(p, ["plugins", "examples/plugins"]) ||
        ["packages/field-app/src/plugin-host/renderer-harness.ts"].includes(p)),
    linePattern: /\bconsole\.(?:debug|info|log|warn|error|trace)\s*\(/g,
  },
  {
    id: "R16",
    enforce: true,
    // AMENDED 2026-08-11 (WIN-10). The description used to read "filesystem
    // authority only, never network/process authority", and the second half
    // became transitively untrue: making the audit root private on Windows means
    // setting a DACL, Node exposes no API for one, and `@vibefield/logging`'s
    // `createPrivateDir` therefore spawns `icacls`. That is filesystem authority
    // wearing a process — a fixed argv, an absolute System32 binary, applied to
    // audit's own root — and refusing it would leave the audit chain readable by
    // any local account, which is the worse EL7 failure by a distance.
    //
    // The MECHANICAL rule below is unchanged and still the real enforcement:
    // audit may not import child_process (or any network module) ITSELF. What is
    // amended is the claim, so the wall states the authority audit actually has
    // rather than one it lost quietly. The exception is exactly one helper; a
    // second one is a decision, not a precedent.
    description:
      "@vibefield/audit has filesystem authority only — no network, and no process authority " +
      "beyond @vibefield/logging's private-fs DACL helper (WIN-10)",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/audit/src"),
    importTest: (s) =>
      matchesForbid(s, {
        modules: ["electron", "undici", "ws"],
        prefixes: [
          "node:child_process",
          "node:dgram",
          "node:http",
          "node:https",
          "node:http2",
          "node:net",
          "node:tls",
          "node:worker_threads",
        ],
      }),
  },
  {
    id: "R17",
    enforce: true,
    description:
      "audit writer authority stays in fieldd; other production packages may import verifier only",
    applies: (p) =>
      SOURCE_EXT.test(p) && !underAny(p, ["packages/audit", "packages/fieldd"]) && !isTestPath(p),
    importTest: (s) => importsModule(s, "@vibefield/audit") && s !== "@vibefield/audit/verify",
  },
  {
    id: "R18",
    // LSF-1: the common runtime is the seam beneath plugin/document/ICE and
    // Electron adapters. Keeping its production source on contracts + relative
    // imports makes that independence executable rather than aspirational.
    enforce: true,
    description:
      "@vibefield/live-surfaces stays independent of Electron, Node, ICE, plugins, and field-app",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/live-surfaces/src"),
    importTest: (s) =>
      s.startsWith("node:") ||
      s.startsWith("@vibecook/") ||
      (s.startsWith("@vibefield/") && s !== "@vibefield/contracts") ||
      ["electron", "react", "react-dom", "ws"].includes(s),
  },
  {
    id: "R19",
    // SNAP-D1: the screenshot host library is Node-only spine code, like the
    // supervisor (R3) — Electron main composes it and a vitest drives it with a
    // scripted fake helper, which only works while nothing in it needs Electron.
    enforce: true,
    description: "no electron import under packages/screenshot/src",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/screenshot/src"),
    importTest: (s) => importsModule(s, "electron"),
  },
  {
    id: "R20",
    // AR-0 (2026-09-12): the agent runtime is puppeteer, consumed IN fieldd (D2)
    // through four packages — the runtime, its composition root
    // (builtin-providers, the door to every official adapter), the core
    // contracts, and record. AR-L1 "VibeField knows no vendor": an adapter
    // import is a product branching on a provider, and native-observation is
    // the adapters' private half. Tests may reach further (puppeteer-testing);
    // production may not.
    // MV-3a (2026-10-03, MV-D22): the monitor BACKEND runs beside the runtime in
    // fieldd (`@vibefield/puppeteer-monitor`), and the model it emits is the
    // monitor-view contract's (`@vibefield/puppeteer-view-sdk/model`, types
    // only); both join the door. The view-sdk's other subpaths (`/host`,
    // `/react`, `/toolkit`) are a window's, never a daemon's — the subpath law
    // is the SDK's own wall checker's (L16), not this one's.
    enforce: true,
    description:
      "fieldd imports puppeteer only through its runtime door (runtime · builtin-providers · core · record · monitor · view-sdk) + @vibefield/rosetta-protocol — never an adapter or native-observation",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/fieldd/src"),
    importTest: (s) =>
      s.startsWith("@vibefield/puppeteer-") &&
      !PUPPETEER_FIELDD_DOOR.some((m) => importsModule(s, m)),
  },
  {
    id: "R21",
    // The renderer sees the AGENT VIEW (core types, the monitor state model,
    // the react bindings) and never the runtime: spawning, providers, and
    // recording are fieldd's (D2/A4). puppeteer-react is admitted by the wall
    // ahead of its link: row — the row waits on the react-peer answer in
    // pnpm-workspace.yaml's sibling block.
    // MV-3a (2026-10-03, MV-D18): the monitor-view contract and its host
    // (`@vibefield/puppeteer-view-sdk`) join the door — the window's replica
    // reads the model, the view host mounts one view.
    enforce: true,
    description:
      "field-app imports puppeteer only through its view door (core · monitor · react · views · view-sdk) + @vibefield/rosetta-protocol — never runtime, providers, record, an adapter, or native-observation",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/field-app/src"),
    importTest: (s) =>
      s.startsWith("@vibefield/puppeteer-") &&
      !PUPPETEER_FIELD_APP_DOOR.some((m) => importsModule(s, m)),
  },
  {
    id: "R22",
    // Everyone else: contracts stays dependency-free, plugins see only the SDK
    // (R10), Electron main carries no product logic (A4), and the spine
    // libraries never learn what an agent is. Both sibling families together.
    enforce: true,
    description:
      "no puppeteer or rosetta import outside packages/fieldd and packages/field-app (D2: the runtime lives in fieldd; A4/R10 elsewhere)",
    applies: (p) => SOURCE_EXT.test(p) && !underAny(p, ["packages/fieldd", "packages/field-app"]),
    importTest: (s) => s.startsWith("@vibefield/puppeteer-") || s.startsWith("@vibefield/rosetta-"),
  },
  {
    id: "R24",
    // FS-1a (L5; thinking-files-service.md §4): mille's engine — the native
    // walker, watcher and ignore parser behind its root entry and `/node` —
    // runs in ONE process, fieldd's files worker, and never in the daemon,
    // Electron main or the renderer. So the root entry and every other entry of
    // `@vibecook/mille` are imported only under the worker's own directory;
    // the renderer (field-app) may take the client halves that load nothing
    // native — `@vibecook/mille/port` and `@vibecook/mille/remote` (FS-1b's
    // WebSocket channel) — and `@vibecook/mille-ui` (FS-1b's tree), nothing
    // else; fieldd's and field-app's tests may dial the worker with the same
    // two clients; no other package imports any mille package (the
    // per-platform binaries are loaded by an explicit path, never imported).
    // There is no `/browser` entry to admit: mille at the pin exports none and
    // nothing imports one (2026-10-07: this comment named `/port` alone, and
    // CLAUDE.md and the agent-plane pages named a "browser client" — each
    // corrected at its source).
    enforce: true,
    description:
      "@vibecook/mille only under packages/fieldd/src/workspace/host (the files worker); field-app only @vibecook/mille/port + @vibecook/mille/remote + @vibecook/mille-ui; nothing else imports mille",
    applies: (p) => SOURCE_EXT.test(p),
    // the one wall whose verdict depends on WHERE the import is: the loop
    // hands every importTest the file's repo-relative path as well
    importTest: (s, p) => {
      if (!(importsModule(s, "@vibecook/mille") || s.startsWith("@vibecook/mille-"))) return false;
      if (under(p, MILLE_WORKER_DIR)) return !importsModule(s, "@vibecook/mille");
      // Integration witnesses may dial the worker using only the same
      // native-free clients as the renderer; the engine stays behind the wall.
      if (isTestPath(p) && underAny(p, ["packages/fieldd", "packages/field-app"]))
        return !(s === "@vibecook/mille/port" || s === "@vibecook/mille/remote");
      if (under(p, "packages/field-app/src"))
        return !(
          s === "@vibecook/mille/port" ||
          s === "@vibecook/mille/remote" ||
          importsModule(s, "@vibecook/mille-ui")
        );
      return true;
    },
  },
  {
    id: "R25",
    // DK-17 (the desk migration's retire table, §6; the plan's §9 Phase 5 witnesses): what the desk
    // replaced is GONE, and bringing it back fails here — three.js and its React bindings anywhere
    // (the desk is one WebGPU renderer; ICE has no `/r3f` or `/ground` since 0.14.0), the retired
    // plugins' packages, and every module the retirements deleted, by name, from any depth.
    enforce: true,
    description:
      "the desk's retirements (DK-17): no three, @react-three/*, @vibecook/ice/r3f|ground or retired plugin package anywhere, and no import of a module the retire table deleted",
    applies: (p) => SOURCE_EXT.test(p),
    importTest: (s, p) => retiredImport(s, p),
  },
  {
    id: "R26",
    // P2 (2026-10-09; the History lead's ruling (a) on the live peek): the watch-only
    // terminal pane DK-17 retired from the canvas (`0afeed47`, DK-D19: nothing of the
    // terminal on the canvas) returned as the Peek's own — GV-D8 draws the live session's
    // real pane inside search's popup — under the Peek's names
    // (`frame/peek-pane/LivePeekPane`, `watch-only`). A new name alone would read as
    // routing around R25; this row makes it a narrower door: only the Peek
    // (`field-app/src/frame/peek*`, `frame/Peek*`) and the pane's own module and tests
    // may import it — never the desk, the canvas, Godview or anything else.
    enforce: true,
    description:
      "the Peek's watch-only pane (frame/peek-pane/*) is imported only by the Peek (field-app src/frame/[Pp]eek*), its own module and field-app's tests",
    applies: (p) => SOURCE_EXT.test(p),
    importTest: (s, p) => peekPaneImport(s) && !peekPaneMayImport(p),
  },
  {
    id: "R27",
    // WP12 D2 (build-wp12-updater.md): the ONE trust verifier (TD-2/TD-3) is Node-only spine code — fieldd, the kit,
    // the stager and Electron MAIN (the UpdateProvider) verify with it; it is node:crypto, so browser-compatible code
    // never imports it. R2 already keeps the kit (`@vibefield/plugin-*`) out of main; this keeps the verifier out of
    // every browser bundle.
    enforce: true,
    description:
      "@vibefield/trust (node:crypto) is imported only by Node hosts — never by field-app, design-kit, plugin-sdk, plugin-runtime, live-surfaces, or electron-shell's preload/renderer-host",
    applies: (p) =>
      SOURCE_EXT.test(p) &&
      underAny(p, [
        "packages/field-app",
        "packages/design-kit",
        "packages/plugin-sdk",
        "packages/plugin-runtime",
        "packages/live-surfaces",
        "packages/electron-shell/src/preload",
        "packages/electron-shell/src/renderer-host",
      ]),
    importTest: (s) => importsModule(s, "@vibefield/trust"),
  },
  {
    id: "R28",
    // WP12 D2: the verifier's own dependencies stay contracts + node: — no Electron (main composes it, vitest drives
    // it bare) and no kit (the kit depends on IT, never the reverse).
    enforce: true,
    description: "packages/trust/src imports only @vibefield/contracts, node:* and its own files",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/trust/src"),
    importTest: (s) =>
      !(
        s.startsWith("node:") ||
        s === "@vibefield/contracts" ||
        s.startsWith("./") ||
        s.startsWith("../")
      ),
  },
  {
    id: "R29",
    // CP-1b (the compose plane, version 2; CO): fieldd's compose code composes fieldd's own services (the runtime's
    // runs, the index, the projects, the audit) and reaches past none of them: no puppeteer package and no rosetta
    // package, so a spark's verbs cannot branch on a vendor (AR-L1) or read a vendor's transcript. R20 already keeps
    // the adapters out of all of fieldd; this keeps even the runtime door out of compose/. The flow host (CP-4) gets
    // its own rule. MT-0 (2026-10-30, the tool plane; thinking-tool-plane.md §3, §13): compose/ became tool-plane/, so
    // the rule is re-aimed at the whole plane, every room in it.
    enforce: true,
    description:
      "packages/fieldd/src/tool-plane imports no @vibefield/puppeteer-* and no @vibefield/rosetta-* package: it composes fieldd's own services",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/fieldd/src/tool-plane"),
    importTest: (s) => s.startsWith("@vibefield/puppeteer-") || s.startsWith("@vibefield/rosetta-"),
  },
  {
    id: "R30",
    // MT-0 (the tool plane, thinking-tool-plane.md §13; MT-L5: policy in fieldd, mechanism where the kind lives): a
    // room is an adapter over fieldd's own services. Pixels and input are main's, reached through internal shell.*
    // doors, and a plugin acts through its declared methods, so no room imports Electron, a plugin's package or the
    // window's code. R10 keeps the SDK a door, never a way in.
    enforce: true,
    description:
      "packages/fieldd/src/tool-plane/rooms imports no electron, no @vibefield/plugin-* or plugins/ package, and no field-app or electron-shell",
    applies: (p) => SOURCE_EXT.test(p) && under(p, "packages/fieldd/src/tool-plane/rooms"),
    importTest: (s) =>
      importsModule(s, "electron") ||
      s.startsWith("@vibefield/plugin-") ||
      importsModule(s, "@vibefield/field-app") ||
      importsModule(s, "@vibefield/electron-shell") ||
      /(?:^|\/)plugins\//.test(s),
  },
];

// P2 (R26) — the Peek's watch-only pane, by its directory or its module names.
function peekPaneImport(spec) {
  if (/(?:^|\/)peek-pane(?:\/|$)/.test(spec)) return true;
  const last = (spec.split("/").pop() ?? "").replace(/\.(?:[cm]?[jt]sx?)$/, "");
  return last === "LivePeekPane";
}
// Who may: the Peek (`src/frame/peek*` / `Peek*`), the pane's own directory, field-app's tests.
function peekPaneMayImport(rel) {
  if (under(rel, "packages/field-app/src/frame/peek-pane")) return true;
  if (/^packages\/field-app\/src\/frame\/[Pp]eek[^/]*$/.test(rel)) return true;
  return isTestPath(rel) && under(rel, "packages/field-app");
}

// DK-17 (R25) — the retire table's deletions as import specifiers.
const RETIRED_PACKAGES = {
  modules: [
    "three",
    "@vibecook/ice/r3f",
    "@vibecook/ice/ground",
    "@vibefield/design-kit/gl",
    "@vibefield/design-kit/card-appearance",
    "@vibefield/design-kit/visuals",
    "@vibefield/plugin-note",
    "@vibefield/plugin-field-tools",
    "@vibefield/plugin-widgetlab",
  ],
  prefixes: ["@react-three/"],
};
// A deleted module by its own name — the specifier's last segment, its extension dropped — so a
// re-import from any directory fails. Each name is distinct in the tree (a test of this file's
// `--enforce` run holds the live tree clean).
const RETIRED_MODULE_NAMES = new Set([
  // the R3F ground and its catalog specimen's old name (row 1)
  "InfiniteCanvasGround",
  "InfiniteCanvasGroundPreview",
  // the magnet grid's glyph (row 2)
  "use-magnet-grid-glyph",
  "MagnetGridSection",
  // the tray island and its tile list (row 4)
  "WidgetTray",
  "tray-catalog",
  // the field's `c` override and tool switcher (row 5)
  "field-keymap",
  // the design kit's card dressing (row 6)
  "CardShell",
  "GlCardChrome",
  "GlLiftGroup",
  "use-drag-lift",
  "chrome-projection",
  "card-appearance",
  "CardsSection",
  // the browser's page widget (row 9)
  "BrowserPageView",
  "BrowserPageWidget",
  // the terminal widget and its mirror (row 11). *2026-10-09 (P2):* a watch-only pane
  // returned as the Peek's own (GV-D8), off the canvas, under the Peek's names and walled
  // to `frame/peek*` (R26); DK-D19 holds — the canvas's names below stay retired.
  "TerminalMirrorSurface",
  "TerminalMirrorPreview",
  "TerminalMirrorWidget",
  "SessionPickerView",
  "watch-only-runtime",
  // the explorer's silhouettes (row 12)
  "doc-thumbnail-scene",
  "doc-thumbnail-worker",
  // HN (Cards in Hand, 2026-10-29): the clipboard tray's store and fly-in (into the hand,
  // HN-1), @'s list and the line's send (into Chat's thread and a card's play, LN-D3), Send
  // to…'s face (into the desk's Copy, HN-D3), and the smokes' rows of the send and Send to…
  // — `frame/draft` and `desk/send/send-to` are generic names, held by their paths below
  "clipboard-store",
  "tray-flight",
  "at-list",
  "line-send",
  "send-face",
  "smoke-line-send",
  "smoke-send-to",
]);
// A deleted DIRECTORY or a generic name, held by its path where it lived.
function retiredRelative(spec, rel) {
  if (!spec.startsWith(".")) return false;
  const segs = spec.split("/");
  // field-app: the cursor halo (row 3), the widget faces' wrapper (row 8), the terminal widget and mirror (row 11)
  if (under(rel, "packages/field-app")) {
    if (segs.includes("cursor")) return true;
    if (/(?:^|\/)plugin-host\/faces(?:\.tsx?)?$/.test(spec)) return true;
    if (/(?:^|\/)terminal\/(?:mirror|widget)(?:\/|$)/.test(spec)) return true;
    if (under(rel, "packages/field-app/src/plugin-host") && /^\.\/faces(?:\.tsx?)?$/.test(spec))
      return true;
    // HN: the line's draft (LN-D3) and Send to…'s directory (HN-D3)
    if (/(?:^|\/)frame\/draft(?:\.tsx?)?$/.test(spec)) return true;
    if (under(rel, "packages/field-app/src/frame") && /^\.\/draft(?:\.tsx?)?$/.test(spec))
      return true;
    if (/(?:^|\/)send\/send-(?:to|face)(?:\.tsx?)?$/.test(spec)) return true;
  }
  // design-kit: the `/gl` entry, the preview silhouettes and the card gradient (row 6)
  if (under(rel, "packages/design-kit")) {
    if (/^\.\/(?:gl|preview|visuals)(?:\.tsx?)?$/.test(spec)) return true;
  }
  return false;
}
function retiredImport(spec, rel) {
  if (matchesForbid(spec, RETIRED_PACKAGES)) return true;
  const last = spec.split("/").pop() ?? "";
  if (RETIRED_MODULE_NAMES.has(last.replace(/\.(?:[cm]?[jt]sx?|css)$/, ""))) return true;
  return retiredRelative(spec, rel);
}

// FS-1a (R24) — the files worker's directory: the one place mille's engine is
// imported (packages/fieldd/src/workspace/host/main.ts is its entry).
const MILLE_WORKER_DIR = "packages/fieldd/src/workspace/host";

// AR-0 walls (R20/R21): the packages each plane may import — the SAME sets the
// sibling block in pnpm-workspace.yaml and packages/*/package.json declare.
const PUPPETEER_FIELDD_DOOR = [
  "@vibefield/puppeteer-runtime",
  "@vibefield/puppeteer-builtin-providers",
  "@vibefield/puppeteer-core",
  "@vibefield/puppeteer-record",
  // MV-3a (2026-10-03): the monitor backend beside the runtime, and the model
  // it emits (the monitor-view contract's `/model`).
  "@vibefield/puppeteer-monitor",
  "@vibefield/puppeteer-view-sdk",
];
const PUPPETEER_FIELD_APP_DOOR = [
  "@vibefield/puppeteer-core",
  "@vibefield/puppeteer-monitor",
  "@vibefield/puppeteer-react",
  // AR-5 (2026-09-13): the Godview views as a package (PU-5) — the swarm on
  // WebGPU, list, rain, the bar, the usage column, the find sheet, behind ports.
  "@vibefield/puppeteer-views",
  // MV-3a (2026-10-03): the monitor-view contract, its React adapter and host.
  "@vibefield/puppeteer-view-sdk",
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
              if (r.importTest(spec, rel)) {
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
      file: "plugins/comment-pad/src/uses-runtime.ts",
      body: 'import { PluginRegistry } from "@vibefield/plugin-runtime";\n',
    },
    {
      id: "R10",
      file: "examples/plugins/desk-clock/src/uses-electron.ts",
      body: 'import { app } from "electron";\nimport { UiButton } from "@vibefield/design-kit";\n',
    },
    // DK-8: ICE's workspace-internal names are walled as written — a kind that
    // reaches for `@ice/objects` (a built-in) or `@ice/desk` is refused by name.
    {
      id: "R10",
      file: "examples/plugins/desk-clock/src/uses-ice-internal.ts",
      body: 'import { paperKind } from "@ice/objects";\nimport { defineObject } from "@ice/desk";\n',
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
      file: "plugins/comment-pad/src/raw-console.ts",
      body: 'console.info("plugin-origin");\n',
    },
    {
      id: "R16",
      file: "packages/audit/src/network-writer.ts",
      body: 'import { request } from "node:https";\n',
    },
    {
      id: "R17",
      file: "packages/electron-shell/src/main/audit-writer.ts",
      body: 'import { AuditLedgerWriter } from "@vibefield/audit";\n',
    },
    {
      id: "R18",
      file: "packages/live-surfaces/src/uses-electron.ts",
      body: 'import { sharedTexture } from "electron";\n',
    },
    {
      id: "R19",
      file: "packages/screenshot/src/uses-electron.ts",
      body: 'import { clipboard } from "electron";\n',
    },
    // AR-0 walls. R20: an adapter import in fieldd is a product branching on a
    // provider (AR-L1). R21: the renderer never touches the runtime. R22: the
    // sibling families exist for the two agent planes only.
    {
      id: "R20",
      file: "packages/fieldd/src/uses-adapter.ts",
      body: 'import { claude } from "@vibefield/puppeteer-adapter-claude";\nimport { obs } from "@vibefield/puppeteer-native-observation";\n',
    },
    {
      id: "R21",
      file: "packages/field-app/src/uses-runtime.ts",
      body: 'import { createAgentRuntime } from "@vibefield/puppeteer-runtime";\n',
    },
    {
      id: "R22",
      file: "packages/contracts/src/uses-puppeteer.ts",
      body: 'import type { AgentEvent } from "@vibefield/puppeteer-core";\n',
    },
    {
      id: "R22",
      file: "packages/electron-shell/src/main/uses-rosetta.ts",
      body: 'import { RosettaClient } from "@vibefield/rosetta-protocol";\n',
    },
    // FS-1a (R24) — mille's engine outside the files worker: in the daemon's
    // own process, in Electron main, the root entry in the renderer, a
    // platform binary imported by name, and mille-ui outside field-app.
    {
      id: "R24",
      file: "packages/fieldd/src/workspace/doors.ts",
      body: 'import { createFileExplorerHost } from "@vibecook/mille";\n',
    },
    {
      id: "R24",
      file: "packages/electron-shell/src/main/uses-mille.ts",
      body: 'import { createFramedStreamHostChannel } from "@vibecook/mille/node";\n',
    },
    {
      id: "R24",
      file: "packages/field-app/src/uses-mille-root.ts",
      body: 'import { FileExplorer } from "@vibecook/mille";\n',
    },
    {
      id: "R24",
      file: "packages/fieldd/src/workspace/host/uses-binary.ts",
      body: 'const native = require("@vibecook/mille-darwin-arm64");\n',
    },
    {
      id: "R24",
      file: "packages/plugin-sdk/src/uses-mille-ui.ts",
      body: 'import { FileTree } from "@vibecook/mille-ui";\n',
    },
    // DK-17 (R25) — what the desk replaced, imported again: three and its React bindings from any
    // package (a test or a plugin too), ICE's retired entries, a retired plugin, and the deleted
    // modules by name from any depth.
    {
      id: "R25",
      file: "packages/field-app/src/uses-three.ts",
      body: 'import * as THREE from "three";\nexport const t = THREE;\n',
    },
    {
      id: "R25",
      file: "examples/plugins/desk-clock/test/uses-fiber.test.ts",
      body: 'import { Canvas } from "@react-three/fiber";\nimport { Html } from "@react-three/drei";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/uses-r3f.ts",
      body: 'const ground = () => import("@vibecook/ice/ground");\nimport { GLViews } from "@vibecook/ice/r3f";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/field/uses-card.tsx",
      body: 'import { CardShell } from "../../../design-kit/src/CardShell";\nimport { GlLiftGroup } from "@vibefield/design-kit/gl";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/design-system/uses-ground.tsx",
      body: 'import { InfiniteCanvasGroundPreview } from "./InfiniteCanvasGroundPreview";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/field/uses-keymap.ts",
      body: 'import { useFieldKeymapOverrides } from "./field-keymap";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/hud/uses-tray.tsx",
      body: 'import { WidgetTray } from "./WidgetTray.tsx";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/design-system/uses-mirror.tsx",
      body: 'import { TerminalMirrorSurface } from "../terminal/mirror";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/field/uses-halo.ts",
      body: 'import { installHalo } from "../cursor";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/plugin-host/uses-faces.ts",
      body: 'import { withPluginFace } from "./faces";\n',
    },
    {
      id: "R25",
      file: "packages/design-kit/src/uses-visuals.ts",
      body: 'import { gradientCss } from "./visuals";\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/uses-note.ts",
      body: 'import { notePlugin } from "@vibefield/plugin-note";\n',
    },
    // HN (R25) — Cards in Hand's deletions imported again, one road each: the line's draft
    // from its own directory and from another, @'s list, Send to…'s act by its path, the
    // clipboard tray's store from a test, and a smoke's Send to… rows.
    {
      id: "R25",
      file: "packages/field-app/src/frame/uses-draft.tsx",
      body: 'import { normalizeDraft } from "./draft";\nexport const d = normalizeDraft;\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/field/desk/uses-chip.ts",
      body: 'import { chipMessage } from "../../frame/draft";\nexport const c = chipMessage;\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/design-system/uses-at-list.tsx",
      body: 'import { atList } from "../frame/at-list";\nexport const a = atList;\n',
    },
    {
      id: "R25",
      file: "packages/field-app/src/field/desk/bar/uses-send-to.ts",
      body: 'import { sendSelection } from "../send/send-to";\nexport const s = sendSelection;\n',
    },
    {
      id: "R25",
      file: "packages/field-app/test/uses-clipboard-store.test.tsx",
      body: 'import { ClipboardStore } from "../src/hud/edge-tray/clipboard-store";\nexport const t = ClipboardStore;\n',
    },
    {
      id: "R25",
      file: "packages/electron-shell/src/testing/uses-send-rows.ts",
      body: 'import { sendToRows } from "./smoke-send-to";\nexport const r = sendToRows;\n',
    },
    // P2 (R26) — the Peek's watch-only pane, reached from anywhere but the Peek: the desk,
    // Godview's deck, History, the canvas — by its directory or its module's name.
    {
      id: "R26",
      file: "packages/field-app/src/field/desk/uses-peek-pane.tsx",
      body: 'import { LivePeekPane } from "../../frame/peek-pane/LivePeekPane";\nexport const p = LivePeekPane;\n',
    },
    {
      id: "R26",
      file: "packages/field-app/src/godview/uses-peek-pane.tsx",
      body: 'import { watchOnlyRuntime } from "../frame/peek-pane/watch-only";\nexport const w = watchOnlyRuntime;\n',
    },
    {
      id: "R26",
      file: "packages/field-app/src/frame/uses-pane.tsx",
      body: 'import { LivePeekPane } from "./peek-pane/LivePeekPane";\nexport const p = LivePeekPane;\n',
    }, // WP12 D2 (R27/R28): the verifier is Node-only, and its own imports are contracts + node: only.
    {
      id: "R27",
      file: "packages/field-app/src/uses-trust.ts",
      body: 'import { verifySignedBytes } from "@vibefield/trust";\nexport const v = verifySignedBytes;\n',
    },
    {
      id: "R27",
      file: "packages/electron-shell/src/preload/uses-trust.ts",
      body: 'import { verifyTrustRoot } from "@vibefield/trust";\nexport const v = verifyTrustRoot;\n',
    },
    {
      id: "R28",
      file: "packages/trust/src/uses-electron.ts",
      body: 'import { app } from "electron";\nexport const a = app;\n',
    },
    {
      id: "R28",
      file: "packages/trust/src/uses-kit.ts",
      body: 'import { canonicalJson } from "@vibefield/plugin-build";\nexport const c = canonicalJson;\n',
    },
    {
      id: "R29",
      file: "packages/fieldd/src/tool-plane/uses-runtime.ts",
      body: 'import { createRuntime } from "@vibefield/puppeteer-runtime";\nexport const r = createRuntime;\n',
    },
    {
      id: "R29",
      file: "packages/fieldd/src/tool-plane/rooms/compose/uses-rosetta.ts",
      body: 'import { RosettaClient } from "@vibefield/rosetta-protocol";\nexport const c = RosettaClient;\n',
    },
    {
      id: "R30",
      file: "packages/fieldd/src/tool-plane/rooms/compose/uses-electron.ts",
      body: 'import { BrowserWindow } from "electron";\nexport const w = BrowserWindow;\n',
    },
    {
      id: "R30",
      file: "packages/fieldd/src/tool-plane/rooms/pages/uses-plugin.ts",
      body: 'import { definePlugin } from "@vibefield/plugin-sdk";\nexport const p = definePlugin;\n',
    },
  ];
  const cleans = [
    // MT-0: a room's own imports (contracts, fieldd's services) pass R29 and R30, so neither overfires on the plane.
    {
      file: "packages/fieldd/src/tool-plane/rooms/compose/clean-room.ts",
      body: 'import type { ComposeProject } from "@vibefield/contracts";\nimport { RpcCallError } from "../../../native-link";\nexport const ok: ComposeProject[] = [];\nexport const e = RpcCallError;\n',
    },
    // react + a DECLARED entry import + plain code: proves R1/R2/R9 don't
    // overfire and R5 accepts what the manifest publishes.
    //
    // The entry named here must be real (2026-08-10). This fixture used to
    // import `@vibefield/field-app/host` — a subpath NO package exports — and
    // passed anyway, because R5 graded against a hardcoded union list rather
    // than the manifests. It was the same second-source-of-truth that made main
    // red on a correct import; a fixture asserting a fictional entry is how the
    // wall's own test stopped being evidence about the wall.
    {
      file: "packages/field-app/src/clean.ts",
      body: 'import React from "react";\nimport { getRendererLogger } from "@vibefield/field-app/logging";\nexport const ok = 1;\n',
    },
    // Cross-package entry names do NOT leak: `main` is electron-shell's export,
    // and importing it from field-app's name was clean under the union list.
    {
      file: "packages/fieldd/src/uses-shell-main.ts",
      body: 'import { start } from "@vibefield/electron-shell/main";\nexport const s = start;\n',
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
      file: "plugins/comment-pad/src/clean-sdk.ts",
      body: 'import { defineRendererPlugin } from "@vibefield/plugin-sdk";\nimport type { Scope } from "@vibefield/contracts";\nimport React from "react";\nexport const ok = 1;\n',
    },
    // R10 exempts authoring-time subtrees: emit scripts and tests are Node-side
    // by design, never part of the renderer artifact graph (§11.3 scope).
    {
      file: "plugins/comment-pad/scripts/emit-something.ts",
      body: 'import { writeFileSync } from "node:fs";\nexport const emit = () => writeFileSync;\n',
    },
    {
      file: "plugins/comment-pad/test/uses-node.test.ts",
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
      file: "plugins/comment-pad/scripts/emit-manifest.ts",
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
    {
      file: "packages/audit/src/private-writer.ts",
      body: 'import { open } from "node:fs/promises";\nexport const writer = open;\n',
    },
    {
      file: "packages/electron-shell/src/main/audit-reader.ts",
      body: 'import { verifyAuditSegment } from "@vibefield/audit/verify";\nexport const verify = verifyAuditSegment;\n',
    },
    {
      file: "packages/live-surfaces/src/clean-core.ts",
      body: 'import type { LiveSurfaceDemandV1 } from "@vibefield/contracts";\nexport type Demand = LiveSurfaceDemandV1;\n',
    },
    // R19 allows node builtins and contracts under packages/screenshot — it is
    // the supervisor's shape, not live-surfaces': a child process IS its job.
    {
      file: "packages/screenshot/src/clean-spawn.ts",
      body: 'import { spawn } from "node:child_process";\nimport { ScreenshotHelperEvent } from "@vibefield/contracts";\nexport const s = spawn;\nexport const e = ScreenshotHelperEvent;\n',
    },
    // AR-0 doors: fieldd through the runtime door, the renderer through the view
    // door, both with the rosetta client — clean under R20/R21/R22.
    {
      file: "packages/fieldd/src/clean-runtime-door.ts",
      body: 'import { createBuiltinAgentRuntime } from "@vibefield/puppeteer-builtin-providers";\nimport type { AgentRuntime } from "@vibefield/puppeteer-runtime";\nimport { PROTOCOL_VERSION } from "@vibefield/rosetta-protocol";\nexport const r = createBuiltinAgentRuntime;\nexport type R = AgentRuntime;\nexport const v = PROTOCOL_VERSION;\n',
    },
    // FS-1a (R24) — the two doors mille has: the worker takes any entry, the
    // renderer the native-free client and the tree.
    {
      file: "packages/fieldd/src/workspace/host/clean-engine.ts",
      body: 'import { createFileExplorerHost } from "@vibecook/mille";\nimport { createFramedStreamHostChannel } from "@vibecook/mille/node";\nexport const h = createFileExplorerHost;\nexport const c = createFramedStreamHostChannel;\n',
    },
    {
      file: "packages/fieldd/test/clean-mille-client.test.ts",
      body: 'import { connectWebSocketChannel } from "@vibecook/mille/remote";\nexport const connect = connectWebSocketChannel;\n',
    },
    {
      file: "packages/field-app/src/clean-mille-client.ts",
      body: 'import { connectFileExplorer } from "@vibecook/mille/port";\nimport { FileTree } from "@vibecook/mille-ui";\nimport { connectWebSocketChannel } from "@vibecook/mille/remote";\nexport const remote = connectWebSocketChannel;\nexport const c = connectFileExplorer;\nexport const t = FileTree;\n',
    },
    // HN (R25) — what stands beside Cards in Hand's retired names: the hand's store, lab door
    // and sources, the snapshot's state, the line's model and door, and the smokes' shell
    // markers and Copy rows.
    {
      file: "packages/field-app/src/frame/clean-hand.ts",
      body: 'import { noteCapture } from "./capture-state";\nimport { installCardsLab } from "./cards/cards-lab";\nimport { dealCard } from "./cards/cards-sources";\nimport { cardsStore } from "./cards/cards-store";\nimport { sayOnLine } from "./line-door";\nimport { createActOf } from "./line-model";\nexport const h = [noteCapture, installCardsLab, dealCard, cardsStore, sayOnLine, createActOf];\n',
    },
    {
      file: "packages/electron-shell/src/testing/clean-rows.ts",
      body: 'import { deskCopyRows } from "./smoke-desk-copy";\nimport { judgeCardPlay } from "./smoke-shell-marker";\nexport const r = [deskCopyRows, judgeCardPlay];\n',
    },
    // DK-17 (R25) — what stands beside the retired names: the desk's own entries, the kit's
    // primitives and glyphs, the kept canvas palette, the account's faces, the renamed specimen.
    {
      file: "packages/field-app/src/design-system/clean-desk.tsx",
      body: 'import { Desk } from "@vibecook/ice/react";\nimport { DESK_ENGINE } from "@vibecook/ice/desk/objects";\nimport { UiButton } from "@vibefield/design-kit/primitives";\nimport { FieldGlyph } from "@vibefield/design-kit/glyphs";\nimport { defaultCanvasAppearance } from "../field/canvas-appearance";\nimport { faceTilt } from "../account/faces";\nimport { DeskPreview } from "./DeskPreview";\nimport { useTerminalPool } from "../terminal/pool";\nexport const x = [Desk, DESK_ENGINE, UiButton, FieldGlyph, defaultCanvasAppearance, faceTilt, DeskPreview, useTerminalPool];\n',
    },
    {
      file: "packages/design-kit/src/clean-kit.ts",
      body: 'import { UiButton } from "./primitives";\nimport { glyphSvg } from "./glyphs";\nexport const y = [UiButton, glyphSvg];\n',
    },
    {
      file: "packages/field-app/src/clean-view-door.ts",
      body: 'import type { AgentMonitorState } from "@vibefield/puppeteer-core";\nimport { createMonitorStore } from "@vibefield/puppeteer-monitor";\nimport type { SessionRow } from "@vibefield/rosetta-protocol";\nexport type S = AgentMonitorState;\nexport const m = createMonitorStore;\nexport type Row = SessionRow;\n',
    },
    // MV-3a doors: the backend and the model's types in fieldd; the replica and
    // the monitor-view contract in the renderer — clean under R20/R21.
    {
      file: "packages/fieldd/src/clean-monitor-door.ts",
      body: 'import { createMonitorBackend } from "@vibefield/puppeteer-monitor";\nimport type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";\nexport const b = createMonitorBackend;\nexport type Row = MonitorAgentRow;\n',
    },
    // P2 (R26): the Peek mounts its pane, the pane's module reaches its facade, the
    // pane's tests reach both.
    {
      file: "packages/field-app/src/frame/PeekClean.tsx",
      body: 'import { LivePeekPane } from "./peek-pane/LivePeekPane";\nexport const p = LivePeekPane;\n',
    },
    {
      file: "packages/field-app/src/frame/peek-pane/clean-pane.tsx",
      body: 'import { watchOnlyRuntime } from "./watch-only";\nexport const w = watchOnlyRuntime;\n',
    },
    {
      file: "packages/field-app/test/peek-pane-clean.test.tsx",
      body: 'import { LivePeekPane } from "../src/frame/peek-pane/LivePeekPane";\nexport const p = LivePeekPane;\n',
    },
    {
      file: "packages/field-app/src/clean-model-door.ts",
      body: 'import { createMonitorReplica } from "@vibefield/puppeteer-monitor/replica";\nimport type { FrameScheduler } from "@vibefield/puppeteer-view-sdk/model";\nimport { frameScheduler } from "@vibefield/puppeteer-view-sdk/host";\nexport const r = createMonitorReplica;\nexport type F = FrameScheduler;\nexport const f = frameScheduler;\n',
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
    const EXPECTED_PENDING = new Set();
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

    const r15Gated = found.some((v) => v.id === "R15" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r15Gated ? "PASS" : "FAIL"}  R15 detected and GATED (enforced since LOG-L4)`);
    if (!r15Gated) ok = false;

    for (const id of ["R16", "R17"]) {
      const gated = found.some((v) => v.id === id && ENFORCE_BY_ID.get(v.id) === true);
      console.log(`  ${gated ? "PASS" : "FAIL"}  ${id} detected and GATED (LOG-L6)`);
      if (!gated) ok = false;
    }
    for (const id of ["R20", "R21", "R22"]) {
      const gated = found.some((v) => v.id === id && ENFORCE_BY_ID.get(v.id) === true);
      console.log(`  ${gated ? "PASS" : "FAIL"}  ${id} detected and GATED (AR-0)`);
      if (!gated) ok = false;
    }
    const r24Gated = found.some((v) => v.id === "R24" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r24Gated ? "PASS" : "FAIL"}  R24 detected and GATED (FS-1a)`);
    if (!r24Gated) ok = false;
    const r25Gated = found.some((v) => v.id === "R25" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r25Gated ? "PASS" : "FAIL"}  R25 detected and GATED (DK-17)`);
    if (!r25Gated) ok = false;
    const r26Gated = found.some((v) => v.id === "R26" && ENFORCE_BY_ID.get(v.id) === true);
    console.log(`  ${r26Gated ? "PASS" : "FAIL"}  R26 detected and GATED (P2)`);
    if (!r26Gated) ok = false;
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
