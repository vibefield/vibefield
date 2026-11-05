import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_LIMITS, FlowRead, flowRefusalOf } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { readFlow } from "../src/flows/static-read";

// CP-4a1 (step0-cp4.md §5.1 commit 5; CP4-Q3 (a), CP4-S4, CP4-S11) — the static read: what a flow's bytes say, read
// with acorn and never run. A proposal's card shows this, never the spark's own summary: meta (name, phases, input)
// as plain values, each agent call with its agent, model, phase and label, "chosen as it runs" where computed, "in a
// loop" where it sits in one, each gate, `unlisted` where the script reaches agents it cannot list, and refusals in
// words. No budget: `meta.budget` is never read, whatever it holds.

const HERE = dirname(fileURLToPath(import.meta.url));
const script = (name: string): string =>
  readFileSync(join(HERE, "fixtures", "flows", `${name}.flow.js`), "utf8");
const contracts = (name: string): unknown =>
  JSON.parse(readFileSync(join(HERE, "..", "..", "contracts", "fixtures", `${name}.json`), "utf8"));

/** A whole flow around a body, with a meta and a default export the read takes. */
const flow = (body: string, meta = '{ name: "Inline" }'): string =>
  `export const meta = ${meta};\nexport default async function (input) {\n${body}\n}\n`;

const refusalsOf = (read: FlowRead) =>
  read.refusals.map((r) => [flowRefusalOf(r), r.words, r.line]);

describe("the static read of the fixture flows (CP4-Q3 (a))", () => {
  it("S1 · reads release-check exactly as the contracts fixture says, the same bytes on both sides (EL9)", () => {
    const { text } = contracts("flows-script.valid") as { text: string };
    expect(script("release-check")).toBe(text);
    const read = readFlow(text);
    expect(read).toEqual(contracts("flow-read.valid"));
    // and from bytes, as the library hands them
    expect(readFlow(Buffer.from(text, "utf8"))).toEqual(read);
  });

  it("S2 · reads v2's review loop: a computed label in a loop, a send to the session you named, a phase, a gate", () => {
    expect(readFlow(script("review-until-clean"))).toEqual({
      meta: {
        name: "Review until clean",
        phases: ["Review", "Ship"],
        input: { target: "session" },
      },
      calls: [
        {
          line: 18,
          agent: "codex",
          model: "gpt-5.5",
          phase: "Review",
          label: "review · round … of 3",
          computed: true,
          inLoop: true,
        },
        { line: 28, phase: "Review", label: "fix", inLoop: true, in: true },
        { line: 32, phase: "Ship", label: "ship", in: true },
      ],
      gates: [{ line: 31, question: "Push 0.7.25?", choices: ["Push", "Hold"] }],
      unlisted: false,
      refusals: [],
    });
  });

  it("S3 · says what it cannot name: agents chosen as it runs, a spread option, a computed gate, and `agent` handed on — never the budget", () => {
    const read = readFlow(script("computed-names"));
    expect(read).toEqual({
      meta: { name: "Computed names" },
      calls: [
        { line: 11, label: "review by …", computed: true, inLoop: true },
        { line: 13, label: "summary", computed: true },
      ],
      gates: [{ line: 16, computed: true }],
      unlisted: true,
      refusals: [],
    });
    expect(JSON.stringify(read)).not.toMatch(/budget|usd/);
  });

  it("S4 · refuses, in words with their lines: a computed name, a default that is no function, a gate of five", () => {
    const read = readFlow(script("refused"));
    expect(read.meta).toBeUndefined();
    expect(refusalsOf(read)).toEqual([
      ["meta", "its meta is not plain values: name is computed", 2],
      ["default", "its default export is not a function", 3],
      ["choices", "an ask offers 5 choices; a gate takes at most 4", 5],
    ]);
    expect(read.gates).toEqual([{ line: 5, question: "Which one?" }]);
    expect(FlowRead.safeParse(read).success).toBe(true);
  });
});

describe("what the read refuses, and what it never does", () => {
  it("S5 · a file that does not parse, or is past 64 KiB, is refused whole and never parsed", () => {
    const broken = readFlow(
      'export const meta = { name: "Broken" ;\nexport default async function () {}\n',
    );
    expect(broken.meta).toBeUndefined();
    expect(broken.calls).toEqual([]);
    expect(refusalsOf(broken)).toHaveLength(1);
    expect(flowRefusalOf(broken.refusals[0]!)).toBe("syntax");
    expect(broken.refusals[0]?.words).toMatch(/^it does not parse as a module: /);
    expect(broken.refusals[0]?.line).toBe(1);
    // a CommonJS file is no module flow: `require` would never resolve in its compartment, and `module` is unread
    expect(flowRefusalOf(readFlow("module.exports = {};\n").refusals[0]!)).toBe("meta");
    const big = flow(`// ${"x".repeat(FLOW_LIMITS.SCRIPT_MAX_BYTES)}`);
    expect(refusalsOf(readFlow(big))).toEqual([
      [
        "size",
        `it is ${Buffer.byteLength(big)} bytes; a flow's script is at most 64 KiB (65536 bytes)`,
        undefined,
      ],
    ]);
  });

  it("S6 · reads without running: nothing the script would do at its top level happens", () => {
    const marker = "__vf_static_read_ran";
    const read = readFlow(
      `globalThis.${marker} = true;\nthrow new Error("ran");\n${flow('await agent("x", { label: "one" });')}`,
    );
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    expect(read.calls).toEqual([{ line: 5, label: "one" }]);
  });

  it("S7 · meta: plain values only where it is read; `export { meta }` counts; budget and other fields are never read", () => {
    const named = readFlow(
      'const meta = { name: "Named", phases: [`One`], input: { a: "text" } };\nexport { meta };\nexport default async function () {}\n',
    );
    expect(named.meta).toEqual({ name: "Named", phases: ["One"], input: { a: "text" } });
    expect(named.refusals).toEqual([]);
    // a budget of any shape, and fields this build does not read, are passed over unread
    const budget = readFlow(
      flow("", '{ name: "Budgeted", budget: { usd: limit() }, owner: process.env.USER }'),
    );
    expect(budget.meta).toEqual({ name: "Budgeted" });
    expect(budget.refusals).toEqual([]);
    const cases: [string, string][] = [
      ["{ phases: [] }", "its meta names no flow"],
      ['{ ...base, name: "x" }', "its meta is not plain values: a field is computed"],
      ['{ name: "x", phases: names }', "its meta is not plain values: phases is computed"],
      ['{ name: "x", phases: "Review" }', "its meta's phases are not a list of names"],
      ['{ name: "x", input: { "a b": "text" } }', "its meta's input is not names and kinds"],
      ['{ name: "x", input: { a: 1 } }', "its meta's input is not names and kinds"],
      [`{ name: "${"n".repeat(65)}" }`, "its name is longer than 64 characters"],
      ['{ name: "" }', "its meta's name is not words"],
      ["makeMeta()", "its meta is not plain values"],
    ];
    for (const [meta, words] of cases) {
      const read = readFlow(flow("", meta));
      expect(read.meta, meta).toBeUndefined();
      expect(
        read.refusals.map((r) => r.words),
        meta,
      ).toEqual([words]);
    }
    const phases = JSON.stringify(Array.from({ length: 17 }, (_, i) => `p${i}`));
    expect(readFlow(flow("", `{ name: "x", phases: ${phases} }`)).refusals[0]?.words).toBe(
      "it lists more than 16 phases",
    );
    expect(readFlow("export default async function () {}\n").refusals.map((r) => r.words)).toEqual([
      "it exports no meta",
    ]);
  });

  it("S8 · the default export runs: a function there, or a top-level function it names; anything else is refused", () => {
    const meta = 'export const meta = { name: "x" };\n';
    for (const ok of [
      "export default async function () {}\n",
      "export default async () => {};\n",
      "async function run() {}\nexport default run;\n",
      "const run = async () => {};\nexport default run;\n",
    ])
      expect(readFlow(meta + ok).refusals, ok).toEqual([]);
    expect(readFlow(meta).refusals.map((r) => r.words)).toEqual([
      "it exports no default function to run",
    ]);
    expect(
      readFlow(`${meta}const run = 1;\nexport default run;\n`).refusals.map((r) => r.words),
    ).toEqual(["its default export is not a function"]);
  });

  it("S9 · a gate offers one to four choices of its own, each one line of at most 40 characters, none twice", () => {
    expect(readFlow(flow('await ask("Go?", ["a", "b", "c", "d"]);')).gates).toEqual([
      { line: 3, question: "Go?", choices: ["a", "b", "c", "d"] },
    ]);
    const refused: [string, string][] = [
      ['await ask("Go?", []);', "an ask offers no choice"],
      ['await ask("Go?", ["a", "a"]);', "an ask offers the same choice twice"],
      [`await ask("Go?", ["${"c".repeat(41)}"]);`, "an ask's choice is longer than 40 characters"],
      ['await ask("Go?", ["a\\nb"]);', "an ask's choice is not one line of words"],
      [
        'await ask("Go?", ["a", "b", "c", "d", "e", "f"]);',
        "an ask offers 6 choices; a gate takes at most 4",
      ],
    ];
    for (const [body, words] of refused) {
      const read = readFlow(flow(body));
      expect(
        read.refusals.map((r) => [flowRefusalOf(r), r.words, r.line]),
        body,
      ).toEqual([["choices", words, 3]]);
    }
    // a long question is said cut, never refused
    const long = readFlow(flow(`await ask("${"q".repeat(600)}", ["Yes"]);`));
    expect(long.gates[0]?.question).toHaveLength(500);
    expect(long.gates[0]?.question?.endsWith("…")).toBe(true);
    // choices it cannot see are chosen as it runs
    expect(readFlow(flow('await ask("Go?", [...input.choices]);')).gates).toEqual([
      { line: 3, question: "Go?", computed: true },
    ]);
  });
});

describe("unlisted, computed, loops and phases", () => {
  it("S10 · the API reached around the read sets unlisted; a call itself never does", () => {
    for (const body of [
      'await globalThis.agent("x");',
      'await this["ask"]("Go?", ["Yes"]);',
      'await globalThis[input.name]("x");',
      'await self.agent("x");',
      'await eval("agent(\\"x\\")");',
      'await new Function("return agent")()("x");',
      'await agent.call(null, "x");',
      "await Promise.all([1, 2].map(agent));",
      'const { agent: a } = { agent }; await a("x");',
    ])
      expect(readFlow(flow(body)).unlisted, body).toBe(true);
    for (const body of [
      'await agent("x", { agent: "codex" });',
      'await ask("Go?", ["Yes"]);',
      'const helper = { agent: "codex" }; log(helper.agent);',
      'log("agent");',
    ])
      expect(readFlow(flow(body)).unlisted, body).toBe(false);
  });

  it("S11 · an option it cannot read makes the call chosen as it runs; one written plainly is shown, cut to the wire's bound", () => {
    const calls = readFlow(
      flow(
        [
          'await agent("a");',
          'await agent("b", opts);',
          'await agent("c", { agent: pick(), model: "m" });',
          'await agent("d", { ["agent"]: "codex", label: "d" });',
          "await agent(...input.args);",
          'await agent("e", { agent: "", label: "  " });',
          `await agent("f", { agent: "${"a".repeat(65)}", label: "${"l".repeat(130)}" });`,
        ].join("\n"),
      ),
    ).calls;
    expect(calls).toEqual([
      { line: 3 },
      { line: 4, computed: true },
      { line: 5, model: "m", computed: true },
      { line: 6, label: "d", computed: true },
      { line: 7, computed: true },
      { line: 8 },
      { line: 9, agent: `${"a".repeat(63)}…`, label: `${"l".repeat(119)}…` },
    ]);
  });

  it("S12 · in a loop: a loop's body, test and update, and an iteration method's callback; never a loop's list or init, run once", () => {
    const calls = readFlow(
      flow(
        [
          'for (let i = 0; i < 3; i++) await agent("for");',
          'while (await agent("while-test")) {}',
          'do { await agent("do"); } while (false);',
          'for (const x of await agent("of-list")) await agent("of-body");',
          'for (const k in input) await agent("in-body");',
          'await Promise.all(input.items.map((x) => agent("map")));',
          'input.items.forEach(async function () { await agent("forEach"); });',
          'await agent("after");',
        ].join("\n"),
      ),
    ).calls.map((c) => [c.line, c.inLoop ?? false]);
    expect(calls).toEqual([
      [3, true],
      [4, true],
      [5, true],
      [6, false],
      [6, true],
      [7, true],
      [8, true],
      [9, true],
      [10, false],
    ]);
  });

  it("S13 · a call takes the phase it sits in: the innermost, named plainly; a computed phase names none", () => {
    const calls = readFlow(
      flow(
        [
          'await phase("Outer", async () => {',
          '  await agent("o");',
          '  await phase("Inner", () => agent("i"));',
          "});",
          'await phase(input.name, () => agent("c"));',
          'await phase("Named", stepFn);',
          'await agent("none");',
        ].join("\n"),
      ),
    ).calls;
    expect(calls).toEqual([
      { line: 4, phase: "Outer" },
      { line: 5, phase: "Inner" },
      { line: 7 },
      { line: 9 },
    ]);
  });

  it("S14 · past what the read lists, it says so: the 65th agent call, the 17th gate", () => {
    const many = readFlow(flow(Array.from({ length: 65 }, () => 'await agent("x");').join("\n")));
    expect(many.calls).toHaveLength(64);
    expect(many.unlisted).toBe(true);
    const gates = readFlow(
      flow(Array.from({ length: 17 }, () => 'await ask("Go?", ["Yes"]);').join("\n")),
    );
    expect(gates.gates).toHaveLength(16);
    expect(gates.unlisted).toBe(true);
    const enough = readFlow(flow(Array.from({ length: 64 }, () => 'await agent("x");').join("\n")));
    expect(enough.calls).toHaveLength(64);
    expect(enough.unlisted).toBe(false);
  });
});
