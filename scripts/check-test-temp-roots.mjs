#!/usr/bin/env node
// Item 195 (2026-11-06) — a test file that makes a temp root also removes one. Item 153 (M102,
// 2026-11-02) gave the suites `tempDir(prefix)` + `onTestFinished` package by package, from a list
// of `vf-*` dirs; plugin-build's four suites made 40 roots a verify under prefixes that list never
// held, and nothing noticed. This makes the rule a gate, beside the import walls in `check:walls`.
//
// A test-side file (under a `test/`, `tests/` or `__tests__/` directory, or named `*.test.*` or
// `*.spec.*`) that calls `mkdtemp` or `mkdtempSync` must also remove something: `rm`, `rmSync`,
// `rmdir`, `rmdirSync`, or the harnesses' `removeTempRoot` / `removeWhenTestEnds`. A root made
// under a provided run root (`mkdtemp(join(inject(…), …))`, which a global setup makes and removes)
// needs no removal of its own. Comment lines are not read.
//
// The grain is the file, as the leak was: a file that made roots and removed none. A file that
// removes one root of three passes here; item 153's leftover witness (a run under a fresh TMPDIR,
// then a count of what is left) is the measure for that.
//
// Item 345, the seam slice (2026-11-12, VF-PM 14:05:03Z) adds a second rule, the socket alias parent: a test that
// boots a pair gives the alias a parent of its run's own (`SOCKET_ALIAS_PARENT_ENV`, scripts/run-alias-parent.mjs), so
// no run leaves a link in the account's `/tmp/vf-<uid>/`. It reads, at the same file grain:
//   (a) a package whose test-side files start a floor (`FIELD_NATIVE_DATA_DIR`) or boot fieldd in-process (an import
//       of `bootstrap` from its src or @vibefield/fieldd) names `alias-parent-env` in its vitest config;
//   (b) a test-side file (TS, JS or Rust) that starts a pair (it spawns, and names `FIELD_NATIVE_DATA_DIR`,
//       `FIELDD_DATA_DIR` or `FIELDD_USER_ROOT`) from an environment that is not this process's (no `...process.env`;
//       every Rust file) names the variable or a harness helper that carries it (`runAliasParentEnv`,
//       `RunAliasParent`). A file that names those variables and spawns nothing (an env-shaping unit test) is read
//       as starting none;
//   (c) a test-side file that calls a keeper itself names its parent (`parent` for users' keeper, the variable for
//       boot-env's `ensureNativeSocketDir`);
//   (d) run-alias-parent.mjs's literal is registries.ts's `SOCKET_ALIAS_PARENT_ENV`.
// What it cannot read: an environment a helper builds from scratch through a variable, or a product path reached on a
// nested root through a config built by hand. fieldd's global setup counts the links a run leaves (the witness): that
// is the measure, this the cheap net.
//
// Usage: node scripts/check-test-temp-roots.mjs [--root <dir>] [--self-test]
//   exit 0 when every test file that makes a root removes one and the alias rule finds nothing; exit 1 with each
//   `file:line` that makes a root in a file that removes none, and each alias miss. --self-test runs both rules on
//   fixtures in temp dirs (removed after) and exits 1 on any miss. `--root` names a git work tree: the files read are
//   the ones git lists there (item 252).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { git, repoFiles } from "./repo-files.mjs";

// The import walls' skips (check-import-boundaries.mjs), and the state a checkout keeps for its
// machine alone (`.nx`, `.vibefield`).
const SKIP_DIRS = new Set([
  ".cache",
  ".git",
  ".idea",
  ".nx",
  ".pnpm-store",
  ".turbo",
  ".vibefield",
  ".vite",
  "build",
  "coverage",
  "dist",
  "draft",
  "node_modules",
  "out",
  "target",
]);
const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_SIDE = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAKES = /\bmkdtemp(?:Sync)?\s*\(/;
const UNDER_PROVIDED_ROOT = /\bmkdtemp(?:Sync)?\s*\(\s*join\(\s*inject\(/;
const REMOVES = /\b(?:rm|rmSync|rmdir|rmdirSync|removeTempRoot|removeWhenTestEnds)\s*\(/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** The test-side source files under `root`, as `/`-separated paths relative to it, sorted.
 * Item 252 (2026-11-08): they are the files git lists (`repo-files.mjs`), never a walk of the
 * tree, which read every ignored tree SKIP_DIRS did not name (SwiftPM's checkouts under the kit's
 * `.build/`). SKIP_DIRS still filters git's paths, so nothing is read that the walk skipped. */
function testSideFiles(root, source = SOURCE) {
  return repoFiles(root).filter((rel) => {
    const parts = rel.split("/");
    const name = parts.pop();
    if (parts.some((dir) => SKIP_DIRS.has(dir))) return false;
    return source.test(name) && !DECLARATION.test(name) && TEST_SIDE.test(rel);
  });
}

/** The test-side files read, how many make a temp root, and each line that makes one in a file that
 * removes none, as `{ file, line }`. */
function findUnremovedRoots(root) {
  const files = testSideFiles(root);
  let makers = 0;
  const misses = [];
  for (const file of files) {
    const code = readFileSync(join(root, file), "utf8")
      .split("\n")
      .map((text) => (COMMENT_LINE.test(text) ? "" : text));
    const made = [...code.entries()].filter(
      ([, text]) => MAKES.test(text) && !UNDER_PROVIDED_ROOT.test(text),
    );
    if (made.length === 0) continue;
    makers += 1;
    if (code.some((text) => REMOVES.test(text))) continue;
    for (const [i] of made) misses.push({ file, line: i + 1 });
  }
  return { read: files.length, makers, misses };
}

// --- item 345: the socket alias parent ---------------------------------------
const SOURCE_OR_RUST = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|rs)$/;
const PAIR_START = /\b(?:FIELD_NATIVE_DATA_DIR|FIELDD_DATA_DIR|FIELDD_USER_ROOT)\b/;
const FLOOR_START = /\bFIELD_NATIVE_DATA_DIR\b/;
const IN_PROCESS_BOOT =
  /import\s*\{[^}]*\bbootstrap\b[^}]*\}\s*from\s*["'](?:\.\.\/src(?:\/(?:daemon|index))?|@vibefield\/fieldd)["']/;
const SPREADS_ENV = /\.\.\.process\.env\b/;
const SPAWNS = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(|\bCommand::new\b/;
const NAMES_SEAM =
  /\b(?:SOCKET_ALIAS_PARENT_ENV|FIELD_SOCKET_ALIAS_PARENT|runAliasParentEnv|RunAliasParent)\b/;
const CALLS_KEEPER = /\b(ensureSocketDir|ensureSocketDirOutcome|ensureNativeSocketDir)\s*\(/;
const VITEST_CONFIGS = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.mjs",
  "vitest.config.js",
];
const ENV_LITERAL = /SOCKET_ALIAS_PARENT_ENV = "([^"]+)"/;

/** The package a test-side file belongs to: the path before its test (or src) directory. */
function packageOf(file) {
  return file.match(/^(.*?)\/(?:test|tests|__tests__|src)\//)?.[1] ?? dirname(file);
}

function readOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Rules (a)–(d) of the header's item 345 paragraph: the test-side files read, and each miss as one line. */
function findAliasParentMisses(root) {
  const files = testSideFiles(root, SOURCE_OR_RUST);
  const misses = [];
  const reaching = new Set();
  for (const file of files) {
    const code = readFileSync(join(root, file), "utf8")
      .split("\n")
      .map((text) => (COMMENT_LINE.test(text) ? "" : text))
      .join("\n");
    const rust = file.endsWith(".rs");
    if (!rust && (FLOOR_START.test(code) || IN_PROCESS_BOOT.test(code))) {
      reaching.add(packageOf(file));
    }
    const fromScratch = rust || !SPREADS_ENV.test(code);
    if (PAIR_START.test(code) && SPAWNS.test(code) && fromScratch && !NAMES_SEAM.test(code)) {
      misses.push(
        `${file}  starts a pair from an environment not this process's, naming no alias parent (b)`,
      );
    }
    const keeper = code.match(CALLS_KEEPER);
    if (keeper !== null) {
      const named =
        keeper[1] === "ensureNativeSocketDir" ? NAMES_SEAM.test(code) : /\bparent\b/.test(code);
      if (!named) misses.push(`${file}  calls ${keeper[1]} and names no parent (c)`);
    }
  }
  for (const pkg of [...reaching].sort()) {
    const configs = VITEST_CONFIGS.map((name) => readOrEmpty(join(root, pkg, name)));
    if (!configs.some((text) => text.includes("alias-parent-env"))) {
      misses.push(
        `${pkg}  starts a floor or boots fieldd in its tests; its vitest config names no alias-parent-env (a)`,
      );
    }
  }
  const literal = (rel) => readOrEmpty(join(root, rel)).match(ENV_LITERAL)?.[1];
  const registry = literal("packages/contracts/src/registries.ts");
  if (registry === undefined || literal("scripts/run-alias-parent.mjs") !== registry) {
    misses.push(
      "scripts/run-alias-parent.mjs  its SOCKET_ALIAS_PARENT_ENV is not registries.ts's (d)",
    );
  }
  return { read: files.length, misses };
}

// --- self-test ---------------------------------------------------------------
// Each positive must be named at its `line` (1-based, into `lines`); no clean may be named. Ten
// fixtures are test files (product.ts, the node_modules one and IGNORED's are never read), eight
// make a root.
const IMPORTS = ['import { mkdtempSync } from "node:fs";', 'import { tmpdir } from "node:os";'];
const POSITIVES = [
  {
    file: "tooling/a/test/leaks.test.ts",
    lines: [...IMPORTS, 'const root = () => mkdtempSync(join(tmpdir(), "a-"));'],
    line: 3,
  },
  {
    file: "tooling/b/test/fixtures.ts",
    lines: [
      ...IMPORTS,
      "export function fresh(): string {",
      '  return mkdtempSync(join(tmpdir(), "b-"));',
      "}",
    ],
    line: 4,
  },
  {
    file: "packages/c/src/thing.spec.ts",
    lines: [...IMPORTS, 'const dir = mkdtempSync(join(tmpdir(), "c-"));'],
    line: 3,
  },
  {
    file: "packages/d/test/promises.test.mjs",
    lines: ['import { mkdtemp } from "node:fs/promises";', 'const dir = await mkdtemp("/tmp/d-");'],
    line: 2,
  },
  // Item 252: untracked and not ignored, it is read before it is staged.
  {
    file: "tooling/l/test/twin.test.ts",
    lines: [...IMPORTS, 'const root = mkdtempSync(join(tmpdir(), "l-"));'],
    line: 3,
    untracked: true,
  },
];
// Item 252: rosetta's own sources as `swift package resolve` checks them out under the kit's
// ignored `.build/`. It leaks as twin.test.ts does, and it must never be read.
const IGNORED = [
  {
    file: "apps/ios/VibeFieldKit/.build/checkouts/rosetta/clients/ts/test/leaks.test.ts",
    lines: [...IMPORTS, 'const root = mkdtempSync(join(tmpdir(), "r-"));'],
  },
];
const CLEANS = [
  {
    file: "packages/e/test/temp-dir.ts",
    lines: [
      ...IMPORTS,
      "export const tempDir = (prefix: string) => {",
      "  const dir = mkdtempSync(join(tmpdir(), prefix));",
      "  onTestFinished(() => rmSync(dir, { recursive: true }));",
      "  return dir;",
      "};",
    ],
  },
  {
    file: "packages/f/test/hooks.test.ts",
    lines: [
      ...IMPORTS,
      'const dir = mkdtempSync(join(tmpdir(), "f-"));',
      "afterAll(async () => await rm(dir, { recursive: true }));",
    ],
  },
  {
    file: "packages/g/test/harness.ts",
    lines: ['const dir = mkdtempSync("/tmp/g-");', "afterEach(() => removeTempRoot(dir));"],
  },
  {
    file: "packages/h/test/run-root-bundle.ts",
    lines: ['const dir = mkdtempSync(join(inject("runRoot"), "h-"));'],
  },
  { file: "packages/i/src/product.ts", lines: ['const dir = mkdtempSync(join(tmpdir(), "i-"));'] },
  {
    file: "packages/j/test/comment.test.ts",
    lines: ["// `mkdtempSync(` hands back 0700 on unix", "/* mkdtemp(x) */", " * mkdtempSync(y)"],
  },
  {
    file: "packages/k/test/node_modules/dep/leaks.test.js",
    lines: ['const dir = mkdtempSync("/tmp/k-");'],
  },
];

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "vf-temp-roots-"));
  try {
    // Item 252: the fixture root is a git repository whose `.gitignore` ignores `.build/`, as the
    // repo's does SwiftPM's. Every fixture is tracked (`add -f`) but the untracked one.
    git(tmp, ["init", "-q"]);
    writeFileSync(join(tmp, ".gitignore"), ".build/\n");
    for (const { file, lines } of [...POSITIVES, ...CLEANS, ...IGNORED]) {
      const abs = join(tmp, file);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `${lines.join("\n")}\n`);
    }
    const tracked = [...POSITIVES, ...CLEANS].filter((c) => !c.untracked).map((c) => c.file);
    git(tmp, ["add", "-f", "--", ...tracked]);
    const { read, makers, misses } = findUnremovedRoots(tmp);
    let ok = read === 10 && makers === 8;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${read} test files read (10), ${makers} make one (8)`);
    const unread = !misses.some(({ file }) => IGNORED.some((c) => c.file === file));
    console.log(`  ${unread ? "PASS" : "FAIL"}  an ignored tree is never read`);
    if (!unread) ok = false;
    const named = new Set(misses.map(({ file, line }) => `${file}:${line}`));
    for (const { file, line } of POSITIVES) {
      const key = `${file}:${line}`;
      const hit = named.delete(key);
      console.log(`  ${hit ? "PASS" : "FAIL"}  names ${key}`);
      if (!hit) ok = false;
    }
    for (const key of named) {
      console.log(`  FAIL  names ${key}, which removes its root or is no test`);
      ok = false;
    }
    console.log(ok ? "\nself-test: all passed" : "\nself-test: FAILURES present");
    return ok;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Item 345: the alias rule's fixtures. Each positive is named by exactly its line; the cleans never.
const ALIAS_LITERAL = 'export const SOCKET_ALIAS_PARENT_ENV = "FIELD_SOCKET_ALIAS_PARENT";';
const ALIAS_FIXTURES = [
  ["packages/a1/test/floor.test.ts", ["spawn(bin, [], { env: { FIELD_NATIVE_DATA_DIR: dir } });"]],
  [
    "packages/a2/tests/child.rs",
    ["let mut command = Command::new(bin);", 'command.env("FIELD_NATIVE_DATA_DIR", dir);'],
  ],
  ["packages/a9/test/env-shape.test.ts", ['expect(env.FIELDD_DATA_DIR).toBe("/r/fieldd");']],
  ["packages/a3/test/keep.test.ts", ["ensureNativeSocketDir(root, logger);"]],
  ["packages/a4/test/boot.test.ts", ['import { bootstrap } from "../src/daemon";']],
  ["packages/a4/vitest.config.ts", ["export default {};"]],
  [
    "packages/a5/test/floor.test.ts",
    ["spawn(bin, [], { env: { ...process.env, FIELD_NATIVE_DATA_DIR: dir } });"],
  ],
  [
    "packages/a5/test/person.test.ts",
    ["spawn(bin, [], { env: { ...runAliasParentEnv(), FIELDD_USER_ROOT: r } });"],
  ],
  [
    "packages/a5/vitest.config.ts",
    ['export default { test: { setupFiles: ["./test/alias-parent-env.ts"] } };'],
  ],
  [
    "packages/a6/tests/child.rs",
    ['command.env("FIELD_NATIVE_DATA_DIR", dir).env(SOCKET_ALIAS_PARENT_ENV, parent.path());'],
  ],
  ["packages/a7/test/keep.test.ts", ["ensureSocketDir(root, { parent });"]],
  ["packages/a8/test/comment.test.ts", ["// FIELD_NATIVE_DATA_DIR, in a comment only"]],
  ["packages/contracts/src/registries.ts", [`${ALIAS_LITERAL.slice(0, -1)} as const;`]],
  ["scripts/run-alias-parent.mjs", [ALIAS_LITERAL]],
];
const ALIAS_EXPECTED = [
  "packages/a1  starts a floor or boots fieldd in its tests; its vitest config names no alias-parent-env (a)",
  "packages/a1/test/floor.test.ts  starts a pair from an environment not this process's, naming no alias parent (b)",
  "packages/a2/tests/child.rs  starts a pair from an environment not this process's, naming no alias parent (b)",
  "packages/a3/test/keep.test.ts  calls ensureNativeSocketDir and names no parent (c)",
  "packages/a4  starts a floor or boots fieldd in its tests; its vitest config names no alias-parent-env (a)",
];

function aliasSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "vf-alias-rule-"));
  try {
    git(tmp, ["init", "-q"]);
    for (const [file, lines] of ALIAS_FIXTURES) {
      mkdirSync(dirname(join(tmp, file)), { recursive: true });
      writeFileSync(join(tmp, file), `${lines.join("\n")}\n`);
    }
    git(tmp, ["add", "-f", "--", ...ALIAS_FIXTURES.map(([file]) => file)]);
    const named = findAliasParentMisses(tmp).misses.sort();
    let ok = JSON.stringify(named) === JSON.stringify([...ALIAS_EXPECTED].sort());
    const count = ALIAS_EXPECTED.length;
    console.log(`  ${ok ? "PASS" : "FAIL"}  the alias rule names exactly its ${count} misses`);
    if (!ok) for (const miss of named) console.log(`        named: ${miss}`);
    const drifted = `${ALIAS_LITERAL.replace("FIELD_", "FIELDD_")}\n`;
    writeFileSync(join(tmp, "scripts/run-alias-parent.mjs"), drifted);
    const drift = findAliasParentMisses(tmp).misses.some((miss) => miss.endsWith("(d)"));
    console.log(`  ${drift ? "PASS" : "FAIL"}  a harness literal off the registry's is named (d)`);
    ok &&= drift;
    console.log(ok ? "\nalias self-test: all passed" : "\nalias self-test: FAILURES present");
    return ok;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- entry -------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest() && aliasSelfTest() ? 0 : 1);

const at = args.indexOf("--root");
const root = resolve(at >= 0 ? (args[at + 1] ?? ".") : join(import.meta.dirname, ".."));
const { read, makers, misses } = findUnremovedRoots(root);
if (read === 0) {
  console.error(`check-test-temp-roots: FAIL — no test file under ${root}: git listed none`);
  process.exit(1);
}
if (misses.length > 0) {
  for (const { file, line } of misses) {
    console.error(`${file}:${line}  makes a temp root; the file removes none`);
  }
  console.error(
    `\ncheck-test-temp-roots: FAIL — ${misses.length} temp root(s) made in test files that ` +
      "remove none (item 195). Make the root through the package's tempDir (onTestFinished), " +
      "or remove it in a hook of the same file.",
  );
  process.exit(1);
}
const alias = findAliasParentMisses(root);
if (alias.misses.length > 0) {
  for (const miss of alias.misses) console.error(miss);
  const missed = alias.misses.length;
  console.error(
    `\ncheck-test-temp-roots: FAIL — ${missed} socket alias parent miss(es) (item 345). ` +
      "A test that boots a pair gives it the run's own parent: alias-parent-env.ts in the " +
      "package's vitest setupFiles, `...process.env` or `runAliasParentEnv()` in a spawn's " +
      "environment.",
  );
  process.exit(1);
}
console.log(
  `check-test-temp-roots: clean — ${makers} of ${read} test files make a temp root; all remove`,
);
console.log(`check-test-temp-roots: alias parent clean — ${alias.read} test files read (item 345)`);
