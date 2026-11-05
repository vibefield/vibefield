import { describe, expect, it } from "vitest";
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
