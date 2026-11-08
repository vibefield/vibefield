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
// Usage: node scripts/check-test-temp-roots.mjs [--root <dir>] [--self-test]
//   exit 0 when every test file that makes a root removes one; exit 1 with each `file:line` that
//   makes a root in a file that removes none. --self-test runs the rule on fixtures in a temp dir
//   (removed after) and exits 1 on any miss. `--root` names a git work tree: the files read are the
//   ones git lists there (item 252).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function testSideFiles(root) {
  return repoFiles(root).filter((rel) => {
    const parts = rel.split("/");
    const name = parts.pop();
    if (parts.some((dir) => SKIP_DIRS.has(dir))) return false;
    return SOURCE.test(name) && !DECLARATION.test(name) && TEST_SIDE.test(rel);
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

// --- entry -------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

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
console.log(
  `check-test-temp-roots: clean — ${makers} of ${read} test files make a temp root; all remove`,
);
