import { describe, expect, it } from "vitest";
import { type FlowScript, flowScriptOf } from "../src/flows/module-script";
import { bytesOf, runOnHost } from "./flows-run-harness";

// CP-4a2a (the review bth-1142Z, findings 5, 6 and 10; cp-landing 12:22Z) — acorn's rewrite of the approved bytes
// (module-script.ts), held to what SES does with the script it evaluates:
// - finding 5: SES refuses a source whose TEXT holds `import(` (or `import //`, `import /*`), a direct-looking
//   `eval(`, `<!--` or `-->` anywhere, strings and comments included (ses 2.3.0 src/transforms.js and
//   compartment-evaluate.js). A person's words in a prompt ("replace the dynamic import()", "A --> B") must still run:
//   the rewrite re-escapes those strings, template parts and regex literals so their values stay byte-identical, and
//   blanks comment text keeping its newlines. A real `import()` or `eval(…)` call is refused with its line;
// - finding 6: a parenthesized default export is rewritten whole (acorn's `preserveParens`);
// - finding 10: a line break after `export` or `export default` is kept, so every later line keeps its number.
// R32 keeps acorn out of the tests, so a row reads the script as text and the values at the far end: the real host's
// handler receives the words.

/** SES's own three source tests, as ses 2.3.0 writes them. */
const SES_TESTS = [
  /(?:<!--|-->)/,
  /(^|[^.]|\.\.\.)\bimport(\s*(?:\(|\/[/*]))/,
  /(^|[^.])\beval(\s*\()/,
] as const;

const scriptOf = (text: string): string => {
  const read: FlowScript = flowScriptOf(bytesOf(text));
  if (read.kind !== "script") throw new Error(`refused: ${read.reason}`);
  return read.script;
};

const sesWouldRefuse = (script: string): string[] =>
  SES_TESTS.filter((test) => test.test(script)).map(String);

const flow = (body: string, head = ""): string =>
  `${head}export const meta = { name: "Words" };\nexport default async function () {\n${body}\n}\n`;

/** The prompt of every row: all four of SES's patterns, in a person's words. */
const WORDS =
  "Replace the dynamic import() in loader.ts, don't use eval( here, and keep <!-- notes --> as they are";

describe("SES's source tests meet a person's words (finding 5)", () => {
  it("M1 · a string holding import(, eval(, <!-- and --> is re-escaped, so SES finds none of them", () => {
    const script = scriptOf(flow(`return await agent(${JSON.stringify(WORDS)});`));
    expect(sesWouldRefuse(script)).toEqual([]);
    // single quotes, an escape already in the words, and `import //`
    const more = scriptOf(flow(`return await agent('it\\'s an import // and an import /* too');`));
    expect(sesWouldRefuse(more)).toEqual([]);
  });

  it("M2 · a template's parts are re-escaped, across ${} splits and under String.raw", () => {
    const script = scriptOf(
      flow(
        "const where = 'loader.ts';\nreturn await agent(`Replace import (x) in ${where}, then eval(\n) -->`) + String.raw`<!-- import( ${where}`;",
      ),
    );
    expect(sesWouldRefuse(script)).toEqual([]);
  });

  it("M3 · a comment's text is blanked and its newlines kept, so every later line keeps its number", () => {
    const text = flow(
      "// use eval( here, and import( there\n/* <!-- a\n   block --> b\n   import /* c */\nconst MARK = 'the marker';\nreturn MARK;",
    );
    const script = scriptOf(text);
    expect(sesWouldRefuse(script)).toEqual([]);
    const lineOf = (s: string) =>
      s.split("\n").findIndex((line) => line.includes("'the marker'")) + 1;
    expect(lineOf(script)).toBe(lineOf(text));
  });

  it("M4 · a regex literal holding a pattern keeps its source and flags", () => {
    const script = scriptOf(
      flow("return [/import\\(x/g.source, /<!--|-->/.flags, /eval\\(/u.test('eval(')];"),
    );
    expect(sesWouldRefuse(script)).toEqual([]);
  });

  it("M5 · a real import() or eval(…) call is left as written, and SES refuses it with its line (H2)", async () => {
    // acorn's tokens tell code from words: the call is not rewritten, so SES finds it, on the file's own line
    expect(
      sesWouldRefuse(scriptOf(flow("const m = await import('node:fs');\nreturn m;"))),
    ).toHaveLength(1);
    const imports = await runOnHost(bytesOf(flow("const m = await import('node:fs');\nreturn m;")));
    expect(imports.end).toMatchObject({ kind: "threw" });
    expect((imports.end as { message?: string }).message).toMatch(/:3\b.*SES_IMPORT_REJECTED/);
    const evals = await runOnHost(bytesOf(flow("\nreturn eval('1 + 1');")));
    expect(evals.end).toMatchObject({ kind: "threw" });
    expect((evals.end as { message?: string }).message).toMatch(/:4\b.*SES_EVAL_REJECTED/);
  });

  it("M6 · a prompt holding all four patterns runs, and its words arrive byte-identical at the agent", async () => {
    const text = flow(
      [
        `await agent(${JSON.stringify(WORDS)});`,
        "const where = 'loader.ts';",
        "await agent(`In ${where}: import (x) --> eval(y) <!-- z`);",
        "await agent(String.raw`a\\n import( ${where} <!--`);",
        "await agent(/import\\(x\\)|-->/.source);",
        "// a comment with eval( and <!-- in it",
        "return 'ran';",
      ].join("\n"),
    );
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toEqual({ kind: "done", value: "ran" });
    expect(heard.calls.map((call) => call.args[0])).toEqual([
      WORDS,
      "In loader.ts: import (x) --> eval(y) <!-- z",
      "a\\n import( loader.ts <!--",
      "import\\(x\\)|-->",
    ]);
  });
});

describe("the default export and the lines (findings 6 and 10)", () => {
  it("F6 · a parenthesized default export runs", async () => {
    const text = `export const meta = { name: "Parens" };\nexport default (async (input) => {\n  return "ran";\n});\n`;
    expect(scriptOf(text)).not.toContain(";)");
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toEqual({ kind: "done", value: "ran" });
  });

  it("F10 · `export` and `export default` on a line of their own keep every later line's number", () => {
    const text = [
      "export",
      "const meta = { name: 'Lines' };",
      "export default",
      "async function main() {",
      "  const MARK = 'line 5';",
      "  return MARK;",
      "}",
      "",
    ].join("\n");
    const script = scriptOf(text);
    const lineOf = (s: string) => s.split("\n").findIndex((line) => line.includes("'line 5'")) + 1;
    expect(lineOf(script)).toBe(5);
  });
});
