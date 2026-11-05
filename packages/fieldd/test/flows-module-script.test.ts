import { describe, expect, it } from "vitest";
import { applyEdits, type FlowScript, flowScriptOf } from "../src/flows/module-script";
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

describe("what the two parsers read differently stays code (cp-landing 12:40Z; VF-PM 12:41Z, required)", () => {
  // acorn's MODULE goal reads `<!--` and `-->` as operators; V8's SCRIPT goal (SES's evaluate) reads them as comments.
  // A template that spans lines can then look like words to acorn while V8 would see a real `import(` on its middle
  // line. The rewrite touches only what acorn reads as words or comments, so the code-level pattern survives it and SES
  // refuses the script whole: nothing in it runs (no call reaches the handler, no import is made).
  const head =
    'export const meta = { name: "Differential" };\nexport default async function () {\n';
  const middle = '\nawait agent("reached"); import("node:fs")\n// `\nreturn "parsed";\n}\n';

  it("D1 · `<!--` mid-line before a line-spanning template: the rewrite leaves it, and SES refuses the script", async () => {
    const text = `${head}let a = 1, b = 2;\nconst c = a <!--b + \`${middle}`;
    const script = scriptOf(text);
    expect(script).toContain("const c = a <!--b + `");
    expect(sesWouldRefuse(script)).toContain(String(/(?:<!--|-->)/));
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toMatchObject({ kind: "threw" });
    expect((heard.end as { message?: string }).message).toMatch(/SES_HTML_COMMENT_REJECTED/);
    expect(heard.calls).toEqual([]);
  });

  it("D2 · `-->` at a line's start (alone, or after a comment holding a line break) is no module: refused before any host", async () => {
    for (const lead of ["const y = 1; let x = y\n", "let y = 1; let x = y /*\n*/ "]) {
      const text = `${head}${lead}--> \`${middle}`;
      expect(flowScriptOf(bytesOf(text))).toMatchObject({
        kind: "refused",
        reason: expect.stringMatching(/^it does not parse/),
      });
      const heard = await runOnHost(bytesOf(text));
      expect(heard.end).toMatchObject({ kind: "refused" });
      expect(heard.calls).toEqual([]);
    }
  });

  it("D3 · a real import() inside a template's substitution is code: SES refuses it; an indirect eval runs powerless", async () => {
    const inside = await runOnHost(
      bytesOf(flow('const t = `a ${import("node:fs")} b`;\nreturn t;')),
    );
    expect(inside.end).toMatchObject({ kind: "threw" });
    expect((inside.end as { message?: string }).message).toMatch(/:3\b.*SES_IMPORT_REJECTED/);
    const indirect = await runOnHost(
      bytesOf(flow('return [(0, eval)("typeof process"), (0, eval)("typeof agent")];')),
    );
    expect(indirect.end).toEqual({ kind: "done", value: ["undefined", "function"] });
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

/** Every line terminator ECMAScript counts (line feed, carriage return, U+2028, U+2029), as V8 and acorn count lines. */
const terminatorsIn = (text: string): number => text.match(/[\n\r\u2028\u2029]/g)?.length ?? 0;

describe("the re-read's residuals (bth-1322Z: N3, N4, N5)", () => {
  it("N3a · a string continued across a line (`\\` and a line feed) keeps that line: SES's later refusal names the file's", async () => {
    const continued = 'const s = "Replace the dynamic import() \\\nin loader.ts";';
    const said = await runOnHost(
      bytesOf(flow([continued, "await agent(s);", "return 'ran';"].join("\n"))),
    );
    expect(said.end).toEqual({ kind: "done", value: "ran" });
    expect(said.calls.map((call) => call.args[0])).toEqual([
      "Replace the dynamic import() in loader.ts",
    ]);
    // the continued string is lines 3 and 4, so the real call is line 5 of the file
    const text = flow([continued, 'import("node:fs");', "return s;"].join("\n"));
    expect(terminatorsIn(scriptOf(text))).toBe(terminatorsIn(text) + 2);
    const refused = await runOnHost(bytesOf(text));
    expect(refused.end).toMatchObject({ kind: "threw" });
    expect((refused.end as { message?: string }).message).toMatch(/:5\b.*SES_IMPORT_REJECTED/);
  });

  it("N3b · a raw U+2028 in a person's words stays raw: no line terminator is lost, and the words arrive byte-identical", async () => {
    const words = "A --> B\u2028C";
    const text = flow([`const s = "${words}";`, "await agent(s);", "return 'ran';"].join("\n"));
    const script = scriptOf(text);
    // the wrapper adds two line feeds; the string's own U+2028 is still one, raw
    expect(terminatorsIn(script)).toBe(terminatorsIn(text) + 2);
    expect(sesWouldRefuse(script)).toEqual([]);
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toEqual({ kind: "done", value: "ran" });
    expect(heard.calls.map((call) => call.args[0])).toEqual([words]);
    // SES counts line feeds alone (ses 2.3.0 transforms.js getLineNumber), so its own line does not move either way;
    // V8's and acorn's do, which the count above holds
    const later = await runOnHost(
      bytesOf(flow([`const s = "${words}";`, 'import("node:fs");'].join("\n"))),
    );
    expect((later.end as { message?: string }).message).toMatch(/:4\b.*SES_IMPORT_REJECTED/);
  });

  it("N4 · the rewrite is one pass: 87,200 comments cost about what 87,200 empty statements do", () => {
    // four times SCRIPT_MAX_BYTES, so a pass's cost per edit shows past the noise of a loaded host (measured on this
    // Mac, 13:34Z: copying the script once per edit costs ~94× a parse here, ~11× at 64 KiB; one pass costs ~1×)
    const count = 87_200;
    const comments = flow(`${"//\n".repeat(count)}return 1;`);
    const statements = flow(`${";\n".repeat(count)}return 1;`);
    const best = (text: string): number => {
      let least = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        scriptOf(text);
        least = Math.min(least, performance.now() - t0);
      }
      return least;
    };
    const parsed = best(statements);
    const rewritten = best(comments);
    // every comment is an edit, so the rewrite's cost over the parse's is the apply's alone
    expect(rewritten / Math.max(parsed, 1)).toBeLessThan(10);
  }, 120_000);

  it("N5a · a regex holding a pattern is the realm's own RegExp, whatever the script binds to the name", async () => {
    const text = flow(
      [
        "function RegExp() { return { shadowed: true }; }",
        "const r = /A --> B/i;",
        "return [typeof r.test, r.source, r.flags, r.test('a --> b')];",
      ].join("\n"),
    );
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toEqual({ kind: "done", value: ["function", "A --> B", "i", true] });
  });

  it("N5b · a script's own tag gets its strings and substitutions as written; only `.raw` shows the escapes", async () => {
    const text = flow(
      [
        "const tag = (strings, ...values) =>",
        "  [strings.length, values.length, strings.join('|'), strings.raw.join('|')];",
        "return tag`A --> B, then import(x) ${1} and eval(y)`;",
      ].join("\n"),
    );
    const heard = await runOnHost(bytesOf(text));
    expect(heard.end).toEqual({
      kind: "done",
      value: [
        2,
        1,
        "A --> B, then import(x) | and eval(y)",
        "A -\\u002d> B, then impor\\u0074(x) | and eva\\u006c(y)",
      ],
    });
  });
});

describe("the one-pass apply (the second re-read bth-1345Z, L3)", () => {
  it("L3a · edits that touch, or insert where another starts, apply in the text's order", () => {
    const edits = [
      { start: 4, end: 6, text: "EF" },
      { start: 1, end: 2, text: "B" },
      { start: 2, end: 4, text: "CD" },
      { start: 2, end: 2, text: "^" },
    ];
    expect(applyEdits("abcdef", edits)).toBe("aB^CDEF");
  });

  it("L3b · two edits that overlap are refused out loud, never applied by duplicating or dropping text", () => {
    // what the rewrite never makes today (tokens and comments never overlap, an export's span is skipped); a future
    // edit that did would otherwise hand on a different script without a word
    const crossed = [
      { start: 1, end: 4, text: "X" },
      { start: 2, end: 5, text: "Y" },
    ];
    expect(() => applyEdits("abcdef", crossed)).toThrow(/overlap/);
    const inside = [
      { start: 1, end: 4, text: "X" },
      { start: 3, end: 3, text: "^" },
    ];
    expect(() => applyEdits("abcdef", inside)).toThrow(/overlap/);
  });
});
