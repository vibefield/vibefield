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
//   (removed after) and exits 1 on any miss.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The test-side files read, how many make a temp root, and each line that makes one in a file that
 * removes none, as `{ file, line }`. */
function findUnremovedRoots(_root) {
  // item 195 (red): the skeleton reads nothing and names nothing
  return { read: 0, makers: 0, misses: [] };
}

// --- self-test ---------------------------------------------------------------
// Each positive must be named at its `line` (1-based, into `lines`); no clean may be named. Nine
// fixtures are test files (product.ts and the node_modules one are never read), seven make a root.
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
    for (const { file, lines } of [...POSITIVES, ...CLEANS]) {
      const abs = join(tmp, file);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `${lines.join("\n")}\n`);
    }
    const { read, makers, misses } = findUnremovedRoots(tmp);
    let ok = read === 9 && makers === 7;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${read} test files read (9), ${makers} make one (7)`);
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
  console.error(`check-test-temp-roots: FAIL — no test file under ${root}: the walk read nothing`);
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
