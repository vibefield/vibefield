// EY-1 (2026-11-19) — MAIN'S PROCESSES, COUNTED. The page engine is started by the pages broker
// alone. These rows hold that, and every other process main's own code makes, by READING main's
// source with the TypeScript parser (so a comment or a string is never taken for code):
//   · the files under src/main that take a function from the child-process module, and every call
//     of one, are the ones listed below, each with what the call says of the child's stdin;
//   · none takes `fork`, and none reaches the module in a way these rows cannot count (a namespace
//     or default import, `require`, `import()`); none takes Electron's `utilityProcess`;
//   · options not written at the call ("passed") are the pages broker's alone: the engine's spawn
//     and its bounded runner, whose options pages-broker-index.test.ts holds by value;
//   · `process.kill` is called only where listed, and never under pages/: the broker signals its
//     own child alone (engine-supervisor.ts), never a pid it read.
// A new call, a new file or a changed stdin fails these rows until a person has read and listed it.
//
// What these rows cannot see: a process made inside another package that runs in main's process
// (fieldd-supervisor's daemons, screenshot's helper, trust's codesign); a seam whose default a
// caller replaces (simctl's and simulator-setup's runners, display-awake's `run`, login-shell's
// `spawn` option, the broker's `spawn` and `exec`: each production default is a call counted
// here); and the helpers Electron starts for Chromium itself (GPU, network, utility, renderers),
// which no line of main's code starts. Under main's own launch with the keyed cdpUrl the engine
// opens no browser.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/main", import.meta.url));
const SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const CHILD_PROCESS = new Set(["node:child_process", "child_process"]);

/** What one file does with the child-process module. */
interface Census {
  /** the functions it imports from the module, by the module's own names (types left out) */
  imports: string[];
  /** every call of one, in source order: the callee, then what the call's options say of fd 0
   * ("ignore", "pipe", "default" when they name no `stdio`, "passed" when they are not written at
   * the call) */
  calls: string[];
}

/** Main's process makers, as read on 2026-11-19 at this commit. */
const SITES: Record<string, Census> = {
  "live-surfaces/ios-simulator-producer.ts": {
    imports: ["execFile"],
    calls: ["execFile default"],
  },
  "live-surfaces/macos-capture-helper.ts": { imports: ["spawn"], calls: ["spawn pipe"] },
  "live-surfaces/simctl.ts": { imports: ["execFile"], calls: ["execFile default"] },
  "live-surfaces/simulator-setup.ts": { imports: ["execFile"], calls: ["execFile default"] },
  "login-shell.ts": { imports: ["spawn"], calls: ["spawn ignore"] },
  // the page engine's one spawn, and the runner of its `--version` and of codesign
  "pages/broker/index.ts": {
    imports: ["execFile", "spawn"],
    calls: ["spawn passed", "execFile passed"],
  },
  "updates/display-awake.ts": { imports: ["execFile"], calls: ["execFile default"] },
};

/** Where main calls `process.kill`, and how many times. */
const SIGNALS: Record<string, number> = {
  // the old pair's census: a probe (signal 0), then the stop it may send
  "custody/old-pair.ts": 2,
  // the login shell's own process group, at its bound
  "login-shell.ts": 1,
};

/** Every source file under src/main, by its path from there, with `/` between its parts. */
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

/** The local names a file binds from a module, keyed by the module's own names (types left out),
 * and whether it reaches the module some way these rows cannot count. */
function bindingsOf(
  source: ts.SourceFile,
  modules: ReadonlySet<string>,
): { local: Map<string, string>; uncounted: boolean } {
  const local = new Map<string, string>();
  let uncounted = false;
  each(source, (node) => {
    if (ts.isImportDeclaration(node)) {
      const from = node.moduleSpecifier;
      if (!ts.isStringLiteral(from) || !modules.has(from.text)) return;
      const clause = node.importClause;
      if (clause === undefined || clause.isTypeOnly) return;
      const bindings = clause.namedBindings;
      // a default or a namespace import carries every function the module has
      if (clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
        uncounted = true;
        return;
      }
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        local.set(element.name.text, (element.propertyName ?? element.name).text);
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
    if (modules.has(asked.text)) uncounted = true;
  });
  return { local, uncounted };
}

/** What a `stdio` value says of fd 0: "ignore", "pipe", or `UNSAFE` and the text otherwise. */
function stdinOf(value: ts.Node, source: ts.SourceFile): string {
  const text = value.getText(source);
  const said = /^(?:"(ignore|pipe)"|\[\s*"(ignore|pipe)")/.exec(text);
  return said?.[1] ?? said?.[2] ?? `UNSAFE ${text}`;
}

/** Every call of an imported maker in a file, in source order (`Census.calls`). */
function callsOf(source: ts.SourceFile, local: ReadonlyMap<string, string>): string[] {
  const calls: string[] = [];
  each(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const maker = local.get(node.expression.text);
    if (maker === undefined) return;
    const written = node.arguments.filter(ts.isObjectLiteralExpression);
    let stdin = written.length === 0 && node.arguments.length >= 3 ? "passed" : "default";
    for (const options of written) {
      for (const property of options.properties) {
        if (property.name === undefined || property.name.getText(source) !== "stdio") continue;
        stdin = ts.isPropertyAssignment(property)
          ? stdinOf(property.initializer, source)
          : "UNSAFE (not written at the call)";
      }
    }
    calls.push(`${maker} ${stdin}`);
  });
  return calls;
}

/** How many times a file calls `process.kill`. */
function signalsOf(source: ts.SourceFile): number {
  let count = 0;
  each(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const { expression, name } = node.expression;
    if (ts.isIdentifier(expression) && expression.text === "process" && name.text === "kill") {
      count += 1;
    }
  });
  return count;
}

describe("main's processes, counted", () => {
  const sources = sourceFiles().map((file) => ({ file, source: parse(file) }));

  it("reads main's source: the files are there", () => {
    // the rows below would be empty truths over an empty list
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((one) => one.file)).toEqual(
      expect.arrayContaining(["index.ts", "pages/broker/index.ts", "login-shell.ts"]),
    );
  });

  it("no file takes fork or utilityProcess, and none reaches the module uncounted", () => {
    const refused: string[] = [];
    for (const { file, source } of sources) {
      const children = bindingsOf(source, CHILD_PROCESS);
      if ([...children.local.values()].includes("fork")) refused.push(`${file}: imports fork`);
      if (children.uncounted) refused.push(`${file}: a namespace, default or dynamic import`);
      const electron = bindingsOf(source, new Set(["electron"]));
      if ([...electron.local.values()].includes("utilityProcess")) {
        refused.push(`${file}: imports utilityProcess`);
      }
    }
    expect(refused).toEqual([]);
  });

  it("the files that make processes, and every call that does, are the listed ones", () => {
    const found: Record<string, Census> = {};
    for (const { file, source } of sources) {
      const { local } = bindingsOf(source, CHILD_PROCESS);
      if (local.size === 0) continue;
      found[file] = { imports: [...local.values()].sort(), calls: callsOf(source, local) };
    }
    expect(found).toEqual(SITES);
    const said = Object.values(SITES).flatMap((site) => site.calls);
    expect(said.filter((call) => !/ (?:ignore|pipe|default|passed)$/.test(call))).toEqual([]);
    // options passed in are the pages broker's alone, held by value in its own test
    const passed = Object.entries(found)
      .filter(([, site]) => site.calls.some((call) => call.endsWith(" passed")))
      .map(([file]) => file);
    expect(passed).toEqual(["pages/broker/index.ts"]);
  });

  it("process.kill is called only where listed, and never under pages/", () => {
    const found: Record<string, number> = {};
    for (const { file, source } of sources) {
      const count = signalsOf(source);
      if (count > 0) found[file] = count;
    }
    expect(found).toEqual(SIGNALS);
    expect(Object.keys(found).filter((file) => file.startsWith("pages/"))).toEqual([]);
  });
});
