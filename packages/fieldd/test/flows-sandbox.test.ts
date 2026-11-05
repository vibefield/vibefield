import { flowRefusalOf } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { readFlow } from "../src/flows/static-read";
import { bytesOf, runOnHost } from "./flows-run-harness";

// CP-4a2a (the review bth-1142Z, "None survived, per area", its suggested H2b rows written out; cp-landing 12:22Z) —
// the sandbox, held from INSIDE the compartment on the real host: each row's script asserts what SES does there and
// returns what it found, and the row reads the run's end. Every row must THROW, or prove powerless. These pin what
// lockdown and the compartment already do (no source changes with them): a row that goes red is a finding.

const flow = (body: string, head = ""): Uint8Array =>
  bytesOf(
    `${head}export const meta = { name: "Sandbox" };\nexport default async function () {\n${body}\n}\n`,
  );

/** A script's `tries`: each attempt's outcome, "threw" or what it gave, as plain data. */
const ATTEMPTS = [
  "const tries = {};",
  "const attempt = (name, f) => {",
  "  try {",
  "    const v = f();",
  "    tries[name] = typeof v === 'function' ? 'a function' : String(v);",
  "  } catch (error) {",
  "    tries[name] = 'threw';",
  "  }",
  "};",
].join("\n");

describe("H2b · the sandbox, from inside the compartment", () => {
  /** Run `attempts` (each a name and an expression that should throw) inside the compartment: what each did. */
  const tried = async (attempts: readonly (readonly [string, string])[]) =>
    runOnHost(
      flow(
        [
          ATTEMPTS,
          ...attempts.map(
            ([name, expression]) => `attempt(${JSON.stringify(name)}, () => ${expression});`,
          ),
          "return tries;",
        ].join("\n"),
      ),
    );
  const threwAll = (names: readonly string[]) => ({
    kind: "done",
    value: Object.fromEntries(names.map((name) => [name, "threw"])),
  });

  it("H2b-1 · the API's own constructor throws: agent's, ask's, log's and phase's (lockdown's inert %Function%)", async () => {
    const names = ["agent", "ask", "log", "phase"];
    const heard = await tried(
      names.map((name) => [name, `${name}.constructor('return process')()`]),
    );
    expect(heard.end).toEqual(threwAll(names));
  });

  it("H2b-2 · the async function constructor throws (%AsyncFunction%)", async () => {
    const heard = await tried([["async", "(async function () {}).constructor('return process')"]]);
    expect(heard.end).toEqual(threwAll(["async"]));
  });

  it("H2b-3 · the generator function constructor throws (%GeneratorFunction%)", async () => {
    const heard = await tried([
      ["generator", "Object.getPrototypeOf(function* () {}).constructor('return process')"],
    ]);
    expect(heard.end).toEqual(threwAll(["generator"]));
  });

  it("H2b-4 · the async generator function constructor throws (%AsyncGeneratorFunction%)", async () => {
    const heard = await tried([
      [
        "async generator",
        "Object.getPrototypeOf(async function* () {}).constructor('return process')",
      ],
    ]);
    expect(heard.end).toEqual(threwAll(["async generator"]));
  });

  it("H2b-5 · the endowments are frozen functions of the shared prototype, with no caller, arguments or prototype", async () => {
    const heard = await runOnHost(
      flow(
        [
          "const own = {};",
          "for (const [name, f] of Object.entries({ agent, ask, log, phase }))",
          "  own[name] = [",
          "    Object.getPrototypeOf(f) === Function.prototype,",
          "    Object.isFrozen(f),",
          "    Object.getOwnPropertyNames(f).filter((key) => ['caller', 'arguments', 'prototype'].includes(key)),",
          "  ];",
          "return own;",
        ].join("\n"),
      ),
    );
    const each = [true, true, []];
    expect(heard.end).toEqual({
      kind: "done",
      value: { agent: each, ask: each, log: each, phase: each },
    });
  });

  it("H2b-6 · V8's stack hooks are SES's tamed ones and powerless: no stack text, and a script's prepareStackTrace never sees a call site", async () => {
    // The review read both as absent. Under ses 2.3.0 on V8 they are its tamed methods (tame-v8-error-constructor.js):
    // what a row can prove is that they give a script nothing. Measured by this row's probe on the real host: both are
    // functions, `stack` and a captured stack are "", and the script's prepareStackTrace is called with no site.
    const heard = await runOnHost(
      flow(
        [
          "const sites = [];",
          "Error.prepareStackTrace = (error, each) => {",
          "  for (const site of each) sites.push([typeof site.getThis, typeof site.getFunction, String(site.getFileName())]);",
          "  return 'prepared';",
          "};",
          "const stack = new Error('x').stack;",
          "const held = {};",
          "Error.captureStackTrace(held);",
          "return [typeof Error.prepareStackTrace, typeof Error.captureStackTrace, stack, held.stack, sites];",
        ].join("\n"),
      ),
    );
    expect(heard.end).toEqual({ kind: "done", value: ["function", "function", "", "", []] });
  });

  it("H2b-7 · a nested Compartment gets no powers", async () => {
    const heard = await runOnHost(
      flow(
        "const inner = new Compartment();\nreturn [inner.evaluate('typeof process'), inner.evaluate('typeof agent'), inner.evaluate('typeof require')];",
      ),
    );
    expect(heard.end).toEqual({ kind: "done", value: ["undefined", "undefined", "undefined"] });
  });

  it("H2b-8 · a thenable default is handed the host's own resolver, whose constructor is inert: the run throws, never a live Function", async () => {
    // fed to the host directly (startFlowHost rewrites it; only the static read would refuse it)
    const heard = await runOnHost(
      bytesOf(
        'export const meta = { name: "Thenable" };\nexport default { then(r) { r(r.constructor); } };\n',
      ),
    );
    expect(heard.end).toMatchObject({ kind: "threw" });
    expect(heard.calls).toEqual([]);
  });

  it("H2b-9 · top-level arguments is SES's evaluator's own, holding only the source; its callee throws", async () => {
    const heard = await runOnHost(
      flow(
        [
          ATTEMPTS,
          "attempt('callee', () => TOP.callee);",
          "return [TOP.length, typeof TOP[0], TOP[0].includes('export default') || TOP[0].includes('__vibefieldFlowDefault'), tries.callee];",
        ].join("\n"),
        "const TOP = arguments;\n",
      ),
    );
    expect(heard.end).toEqual({ kind: "done", value: [1, "string", true, "threw"] });
  });
});

describe("S19 · one refuser: the read refuses exactly what the sandbox refuses (CP-4a2b, Q-B3 (a); §13b.9's S5)", () => {
  // Each case is read, then run on the real host. The read's real-call refusal and the sandbox's own censor
  // (SES_*_REJECTED, ses 2.3.0) must agree on the shape and on its line, and a case neither refuses runs to `done`. The
  // EL8 coupling: a ses bump that moves its censor re-lights these rows.
  const CENSOR = {
    import: "SES_IMPORT_REJECTED",
    eval: "SES_EVAL_REJECTED",
    "html-comment": "SES_HTML_COMMENT_REJECTED",
  } as const;
  type Shape = keyof typeof CENSOR;
  const REAL_CALLS: readonly string[] = Object.keys(CENSOR);
  /** name, body (its first line is the file's third), and the refusal both must give, or null where both admit it */
  const CASES: readonly (readonly [string, string, readonly [Shape, number] | null])[] = [
    ["a dynamic import()", 'const m = await import("node:fs");\nreturn m;', ["import", 3]],
    [
      "an import() in a template's substitution",
      'return `${await import("node:fs")}`;',
      ["import", 3],
    ],
    ["a direct eval(…)", 'return eval("1 + 1");', ["eval", 3]],
    [
      "a member written `o. eval(…)`",
      "const o = { eval: (x) => x };\nreturn o. eval(5);",
      ["eval", 4],
    ],
    ["`<!--` in code", "let a = 1, b = 2;\nreturn a <!--b;", ["html-comment", 4]],
    ["`-->` in code, mid-line", "let a = 3, b = 1;\nreturn a-->b;", ["html-comment", 4]],
    ["a parenthesized eval, `(eval)(…)`", 'return (eval)("1 + 1");', null],
    ["an indirect eval, `(0, eval)(…)`", 'return (0, eval)("2 + 2");', null],
    ["a method named eval, `o.eval(…)`", "const o = { eval: (x) => x };\nreturn o.eval(5);", null],
    [
      "a person's words in a string",
      'return await agent("replace the import() and eval( <!-- -->");',
      null,
    ],
    ["String.raw's alias", "const raw = String.raw;\nreturn raw`import( and eval( -->`;", null],
    ["a regex and a comment", "// import( eval( <!--\nreturn /import\\(|-->/.source;", null],
  ];

  it.each(CASES)("%s", async (_name, body, refused) => {
    const bytes = flow(body);
    const read = readFlow(bytes)
      .refusals.filter((r) => REAL_CALLS.includes(flowRefusalOf(r) ?? ""))
      .map((r) => [flowRefusalOf(r), r.line]);
    const heard = await runOnHost(bytes);
    if (refused === null) {
      expect(read).toEqual([]);
      expect(heard.end).toMatchObject({ kind: "done" });
      return;
    }
    const [shape, line] = refused;
    expect(read).toEqual([[shape, line]]);
    expect(heard.end).toMatchObject({ kind: "threw" });
    expect((heard.end as { message?: string }).message).toMatch(
      new RegExp(`:${line}\\b.*${CENSOR[shape]}`),
    );
    expect(heard.calls).toEqual([]);
  });
});

describe("H2c · WebAssembly, SharedArrayBuffer and Atomics are pinned undefined in the compartment (CP-4a2b, Q-B4 (a); §13b.11)", () => {
  // SES 2.3.0 omits all three from every compartment (VF-PM accepted the finding 16:36Z), so H2c-n and H2c-i are green
  // at red: they hold what SES does today. The pin is VibeField's own, so a ses bump cannot re-admit them, and H2c-own
  // is its witness. Typed arrays, ArrayBuffer, DataView, TextEncoder and Compartment stay: their one harm is memory,
  // which the host's cap holds and H25, H27, H28 and H2b-7 prove (H2c-0 pins that they are still there).
  const PINNED = ["WebAssembly", "SharedArrayBuffer", "Atomics"] as const;

  it.each(PINNED)("H2c-n · `typeof %s` is undefined inside the compartment", async (name) => {
    const heard = await runOnHost(flow(`return typeof ${name};`));
    expect(heard.end).toEqual({ kind: "done", value: "undefined" });
  });

  it("H2c-own · each is the compartment's OWN property, its value undefined: the pin, which a ses bump cannot undo", async () => {
    const heard = await runOnHost(
      flow(
        [
          `return ${JSON.stringify(PINNED)}.map((name) => {`,
          "  const own = Object.getOwnPropertyDescriptor(globalThis, name);",
          "  return [name, own !== undefined && 'value' in own && own.value === undefined];",
          "});",
        ].join("\n"),
      ),
    );
    expect(heard.end).toEqual({ kind: "done", value: PINNED.map((name) => [name, true]) });
  });

  it("H2c-i · none is reached another way: through eval, Function or a nested compartment, an instance's buffer, or the compartment's whole object graph", async () => {
    const heard = await runOnHost(
      flow(
        [
          ATTEMPTS,
          "attempt('eval', () => (0, eval)('typeof WebAssembly'));",
          "attempt('Function', () => Function('return typeof Atomics')());",
          "attempt('nested', () => new Compartment().evaluate('typeof SharedArrayBuffer'));",
          "const tag = (v) => Object.prototype.toString.call(v);",
          "attempt('typed', () => tag(new Uint8Array(8).buffer));",
          "attempt('encoded', () => tag(new TextEncoder().encode('x').buffer));",
          "attempt('view', () => tag(new DataView(new ArrayBuffer(8)).buffer));",
          // every object and function reachable from globalThis by descriptors alone (no getter is called), bounded
          "const seen = new Set();",
          "const queue = [globalThis];",
          "const hits = [];",
          "for (let i = 0; i < queue.length && seen.size < 50000; i++) {",
          "  const v = queue[i];",
          "  if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) continue;",
          "  seen.add(v);",
          "  const own = (key) => Object.getOwnPropertyDescriptor(v, key)?.value;",
          "  if (['WebAssembly', 'Atomics'].includes(own(Symbol.toStringTag))) hits.push(own(Symbol.toStringTag));",
          "  if (typeof v === 'function' && own('name') === 'SharedArrayBuffer') hits.push('SharedArrayBuffer');",
          "  queue.push(Object.getPrototypeOf(v));",
          "  for (const key of Reflect.ownKeys(v)) {",
          "    const d = Object.getOwnPropertyDescriptor(v, key);",
          "    if (d !== undefined) queue.push(...('value' in d ? [d.value] : [d.get, d.set]));",
          "  }",
          "}",
          "return [tries, hits, seen.size];",
        ].join("\n"),
      ),
    );
    expect(heard.end).toMatchObject({ kind: "done" });
    const [tries, hits, walked] = (heard.end as { value: [unknown, unknown, number] }).value;
    expect(tries).toEqual({
      eval: "undefined",
      Function: "undefined",
      nested: "undefined",
      typed: "[object ArrayBuffer]",
      encoded: "[object ArrayBuffer]",
      view: "[object ArrayBuffer]",
    });
    expect(hits).toEqual([]);
    // the walk saw the whole graph (about 900 objects under ses 2.3.0), never a stub of it, and ended inside its bound
    expect(walked).toBeGreaterThan(500);
    expect(walked).toBeLessThan(50_000);
  });

  it("H2c-0 · what stays is still there: a typed array, TextEncoder, DataView and a nested Compartment, the memory rows' road", async () => {
    const heard = await runOnHost(
      flow(
        "return [new Uint8Array(4).fill(1).length, new TextEncoder().encode('xy').length, new DataView(new ArrayBuffer(2)).byteLength, typeof Compartment];",
      ),
    );
    expect(heard.end).toEqual({ kind: "done", value: [4, 2, 2, "function"] });
  });
});
