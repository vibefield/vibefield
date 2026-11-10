// OB custody (C2; CUSTODY-SPEC §2.3, fieldd's side of the order) — NO CHILD OF FIELDD IS GIVEN FD 0.
//
// A fieldd handed custody is handed its secrets as one line on its stdin (custody-handoff.ts). `bin.ts` reads that
// line to its newline before it starts anything; what is left to hold is that nothing fieldd starts is ever given
// fieldd's own stdin, so that no child can be the one that reads the line first, or reads anything a spawner wrote
// after it. fd 0 itself is not closed (libuv does not close a stdio descriptor, and closing it by hand frees the
// number for whatever this process opens next): the rule is the children's, and it is held here.
//
// These rows READ fieldd's source (with the TypeScript parser, so a comment or a string is never taken for code):
//   · every `stdio` written anywhere in `src` names fd 0 as "ignore" or as a pipe of the child's own;
//   · no file takes `fork` (its default hands the child the parent's stdio), and none reaches the module in a way
//     these rows cannot count (a namespace or default import, `require`, `import()`);
//   · the files that make processes, and every call that does, are the ones listed below. A call that names no
//     `stdio` has Node's default for `spawn` and `execFile`: three pipes of the child's own.
// A new call, a new file or a changed `stdio` fails the last-but-one row until a person has read it and listed it.
//
// What these rows cannot see: a process made inside another package that runs in fieldd's process (the agent
// runtime's adapters, the files engine, trust's `codesign`), and a seam whose default a caller replaces (the
// supervisors' `spawnProcess` option, `McpService`'s `spawn`, the flow host's `spawn`: tests' seams, whose
// production value is the module's own function here). The floor's own children are field-native's row.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const CHILD_PROCESS = new Set(["node:child_process", "child_process"]);
/** How fieldd's files spell a call that makes a process: the module's functions, by every name one is imported or
 * kept under here. A name this list lacks is a call these rows do not count, so a new alias is added HERE. */
const MAKERS = new Set([
  "spawn",
  "nodeSpawn",
  "execFile",
  "execFileAsync",
  "fork",
  "exec",
  "execSync",
  "spawnSync",
  "execFileSync",
]);
/** The two members a class keeps the module's `spawn` in (`this.#spawn`, `this.spawnProcess`). */
const SEAMS = new Set(["#spawn", "spawnProcess"]);

/** What one file does with the child-process module. */
interface Census {
  /** the functions it imports from the module, by the module's own names (types left out) */
  imports: string[];
  /** every call that makes a process, in source order: how the callee is spelled, then what the call's own options
   * say of fd 0 ("ignore", "pipe", "default" when it names no `stdio`, "passed" when its options are not written
   * at the call) */
  calls: string[];
}

/** fieldd's process makers, as read on 2026-11-10 at this commit. `bin.ts`'s "spawn passed" is the sealed floor's:
 * its options are native-bootstrap.ts's `SealedSpawnOptions`, whose `stdio` is written there (a pipe of its own). */
const SITES: Record<string, Census> = {
  "agent-gateway.ts": { imports: ["execFile"], calls: ["execFile default"] },
  "bin.ts": { imports: ["spawn"], calls: ["spawn passed", "spawn ignore"] },
  "flows/supervisor.ts": { imports: ["spawn"], calls: ["nodeSpawn ignore"] },
  "plugin-settings.ts": {
    imports: ["execFile"],
    calls: ["execFileAsync default", "execFileAsync default", "execFileAsync default"],
  },
  "process-service.ts": {
    imports: ["spawn"],
    calls: ["spawn pipe", "spawn ignore", "spawn ignore"],
  },
  "rosettad-supervisor.ts": {
    imports: ["spawn"],
    calls: ["this.spawnProcess ignore", "this.spawnProcess ignore"],
  },
  "shell-absence.ts": { imports: ["spawn"], calls: ["spawn ignore"] },
  "transcripts/supervisor.ts": { imports: ["spawn"], calls: ["this.#spawn ignore"] },
  "workspace/host/git.ts": { imports: ["execFile"], calls: ["execFile default"] },
  "workspace/supervisor.ts": { imports: ["spawn"], calls: ["this.#spawn ignore"] },
};

/** Every source file under `src`, by its path from there, with `/` between its parts. */
function sourceFiles(): string[] {
  const names = readdirSync(SRC, { recursive: true, encoding: "utf8" });
  const paths = names.map((name) => name.split("\\").join("/"));
  return paths.filter((path) => SOURCE.test(path)).sort();
}

function parse(file: string): ts.SourceFile {
  const text = readFileSync(join(SRC, file), "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Visit a node and everything under it, in source order. */
function each(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => each(child, visit));
}

/** A property's name as written, without its quotes. */
function keyOf(name: ts.PropertyName, source: ts.SourceFile): string {
  return name.getText(source).replace(/^["']|["']$/g, "");
}

/** What a `stdio` value says of fd 0: "ignore", "pipe", or `UNSAFE` and the text when it is anything else. */
function stdinOf(value: ts.Node | undefined, source: ts.SourceFile): string {
  const text = value === undefined ? "" : value.getText(source);
  const said = /^(?:"(ignore|pipe)"|\[\s*"(ignore|pipe)")/.exec(text);
  return said?.[1] ?? said?.[2] ?? `UNSAFE ${text}`;
}

/** Every `stdio` a file writes, as a value or as a type, by what each says of fd 0. */
function stdioOf(source: ts.SourceFile): string[] {
  const found: string[] = [];
  each(source, (node) => {
    if (ts.isPropertyAssignment(node) && keyOf(node.name, source) === "stdio") {
      found.push(stdinOf(node.initializer, source));
    } else if (ts.isPropertySignature(node) && keyOf(node.name, source) === "stdio") {
      found.push(stdinOf(node.type, source));
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "stdio") {
      found.push("UNSAFE (a variable)");
    }
  });
  return found;
}

/** The functions a file imports from the child-process module, and whether it reaches the module some other way. */
function importsOf(source: ts.SourceFile): { names: string[]; uncounted: boolean } {
  const names: string[] = [];
  let uncounted = false;
  each(source, (node) => {
    if (ts.isImportDeclaration(node)) {
      const from = node.moduleSpecifier;
      if (!ts.isStringLiteral(from) || !CHILD_PROCESS.has(from.text)) return;
      const clause = node.importClause;
      if (clause === undefined || clause.isTypeOnly) return;
      const bindings = clause.namedBindings;
      // a default or a namespace import carries every function the module has
      if (clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
        uncounted = true;
        return;
      }
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
      }
      return;
    }
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const loads =
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === "require");
    const [asked] = node.arguments;
    if (!loads || asked === undefined || !ts.isStringLiteral(asked)) return;
    if (CHILD_PROCESS.has(asked.text)) uncounted = true;
  });
  return { names: names.sort(), uncounted };
}

/** How a callee spells a function that makes a process, or undefined when it is not one. */
function makerOf(callee: ts.Expression, source: ts.SourceFile): string | undefined {
  if (ts.isParenthesizedExpression(callee)) return makerOf(callee.expression, source);
  if (ts.isIdentifier(callee)) return MAKERS.has(callee.text) ? callee.text : undefined;
  // `(opts.spawn ?? nodeSpawn)(…)`: a seam with the module's function as its default
  if (ts.isBinaryExpression(callee)) {
    return makerOf(callee.right, source) ?? makerOf(callee.left, source);
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.getText(source);
    const onThis = callee.expression.kind === ts.SyntaxKind.ThisKeyword;
    return onThis && SEAMS.has(name) ? `this.${name}` : undefined;
  }
  return undefined;
}

/** Every call in a file that makes a process, in source order (`Census.calls`). */
function callsOf(source: ts.SourceFile): string[] {
  const calls: string[] = [];
  each(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const maker = makerOf(node.expression, source);
    if (maker === undefined) return;
    const written = node.arguments.filter(ts.isObjectLiteralExpression);
    const third = node.arguments[2];
    // options that are a name and not an object written here: the call itself says nothing of fd 0
    const named = written.length === 0 && third !== undefined && ts.isIdentifier(third);
    let stdin = named ? "passed" : "default";
    for (const options of written) {
      for (const property of options.properties) {
        if (property.name === undefined || keyOf(property.name, source) !== "stdio") continue;
        stdin = ts.isPropertyAssignment(property)
          ? stdinOf(property.initializer, source)
          : "UNSAFE (not written at the call)";
      }
    }
    calls.push(`${maker} ${stdin}`);
  });
  return calls;
}

/** Is this call `import("./daemon")`: the daemon's module graph, and with it everything that starts anything? */
function loadsDaemon(call: ts.CallExpression): boolean {
  const [asked] = call.arguments;
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword || asked === undefined) return false;
  return ts.isStringLiteral(asked) && asked.text === "./daemon";
}

describe("no child of fieldd is given fd 0 (CUSTODY-SPEC §2.3)", () => {
  const sources = sourceFiles().map((file) => ({ file, source: parse(file) }));

  it("reads fieldd's source: the files are there", () => {
    // the rows below would be empty truths over an empty list
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((one) => one.file)).toContain("bin.ts");
  });

  it("every stdio written in fieldd names fd 0 as ignored or as a pipe of the child's own", () => {
    const written: string[] = [];
    for (const { file, source } of sources) {
      for (const stdin of stdioOf(source)) written.push(`${file}: ${stdin}`);
    }
    // not an empty truth: the entry's own two spawns write one each
    expect(written).toContain("bin.ts: ignore");
    expect(written).toContain("native-bootstrap.ts: pipe");
    const unsafe = written.filter((one) => !/: (?:ignore|pipe)$/.test(one));
    expect(unsafe).toEqual([]);
  });

  it("no file takes fork, and none reaches the module in a way these rows cannot count", () => {
    const refused: string[] = [];
    for (const { file, source } of sources) {
      const { names, uncounted } = importsOf(source);
      // `fork`'s default hands the child the parent's stdin, stdout and stderr
      if (names.includes("fork")) refused.push(`${file}: imports fork`);
      if (uncounted) refused.push(`${file}: a namespace, default or dynamic import of the module`);
    }
    expect(refused).toEqual([]);
  });

  it("the files that make processes, and every call that does, are the listed ones", () => {
    const found: Record<string, Census> = {};
    for (const { file, source } of sources) {
      const { names } = importsOf(source);
      if (names.length === 0) continue;
      found[file] = { imports: names, calls: callsOf(source) };
    }
    expect(found).toEqual(SITES);
    // and of the listed calls, none says anything of fd 0 but ignore, a pipe, the default, or options passed in
    const said = Object.values(SITES).flatMap((site) => site.calls);
    const unsafe = said.filter((call) => !/ (?:ignore|pipe|default|passed)$/.test(call));
    expect(unsafe).toEqual([]);
    // "passed" is the sealed floor's alone, and its options are written in native-bootstrap.ts
    const passed: string[] = [];
    for (const [file, site] of Object.entries(found)) {
      if (site.calls.includes("spawn passed")) passed.push(file);
    }
    expect(passed).toEqual(["bin.ts"]);
  });

  it("the entry reads the hand-off before it loads the daemon and before either spawn of its own", () => {
    const entry = sources.find((one) => one.file === "bin.ts")?.source;
    if (entry === undefined) throw new Error("bin.ts is not under src");
    let read = -1;
    const later: number[] = [];
    each(entry, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = node.expression;
      const at = node.getStart(entry);
      if (ts.isIdentifier(callee) && callee.text === "readCustodyHandoff") {
        read = at;
      } else if (makerOf(callee, entry) !== undefined || loadsDaemon(node)) {
        later.push(at);
      }
    });
    expect(read).toBeGreaterThan(0);
    // the daemon's graph, and the floor's two spawns (handed nothing, and handed custody)
    expect(later).toHaveLength(3);
    expect(Math.min(...later)).toBeGreaterThan(read);
  });
});
