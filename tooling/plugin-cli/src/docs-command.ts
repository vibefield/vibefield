// Writing the generated reference, and proving it is current.
//
// The freshness law is the canonical manifests' law, applied to docs: the
// committed bytes must equal what the generator produces right now. `pnpm gen`
// writes them, `gen:check` diffs them, and `--check` here gives the same answer
// without git — which is what the kit's own suite uses, so a stale-docs failure
// is reproducible in a test rather than only in the gate.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateDocs } from "./docs-generate";
import { pass, refuse, type Verdict } from "./verdict";

export interface DocsResult {
  readonly verdicts: Verdict[];
  readonly written: string[];
}

export function writeDocs(outDir: string): DocsResult {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const files = generateDocs();
  const written: string[] = [];
  for (const [name, content] of files) {
    writeFileSync(join(dir, name), content);
    written.push(name);
  }
  // A file the generator no longer produces is a stale page an agent could
  // still read, so it goes — the directory is generated output, not a folder
  // people keep things in.
  for (const existing of readdirSync(dir)) {
    if (!existing.endsWith(".md") || files.has(existing)) continue;
    writeFileSync(join(dir, existing), "");
    written.push(`${existing} (emptied — no longer generated)`);
  }
  return {
    verdicts: [pass("docs", `${files.size} file(s) written to ${dir}`)],
    written,
  };
}

export function checkDocsFresh(outDir: string): Verdict[] {
  const dir = resolve(outDir);
  const files = generateDocs();
  const verdicts: Verdict[] = [];
  for (const [name, content] of files) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      verdicts.push(
        refuse("docs", "docs-stale", `${name} has never been generated into ${dir}`, {
          pointer: path,
        }),
      );
      continue;
    }
    const committed = readFileSync(path, "utf8");
    if (committed !== content)
      verdicts.push(
        refuse("docs", "docs-stale", `${name} is not what the current schemas generate`, {
          pointer: `${path}:${firstDifferingLine(committed, content)}`,
        }),
      );
  }
  if (verdicts.length === 0) verdicts.push(pass("docs", `${files.size} file(s) are current`));
  return verdicts;
}

function firstDifferingLine(a: string, b: string): number {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    if (left[i] !== right[i]) return i + 1;
  return 1;
}
