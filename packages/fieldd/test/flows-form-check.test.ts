import { canonicalJson, FLOW_LIMITS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForm,
  type FlowForm,
  FORM_TYPES,
  FORM_WORDS_MAX,
  matchAnswer,
} from "../src/flows/form-check";

// CP-4a2b (13a's D12, slice 9's F1–F8; Q-A2 (a), J4 (a)) — a step's form, the unit alone. A form is D12's subset (type,
// properties, required, items, enum) under three bounds: FORM_BYTES_MAX of canonical JSON, FORM_DEPTH_MAX deep, and
// FORM_ENUM_MAX values in one enum. A form's top is `type` object (F9; ruled 2026-11-06), so every form these
// rows admit is an object's, and the types they test are its fields'. An answer is read from its last fenced `json`
// block, else its whole text, bounded at RESULT_MAX_BYTES before any parse, and a miss is said in fieldd's words: JSON
// types and places alone, never a property name, an enum value or the agent's text (MT-L6), at most FORM_WORDS_MAX
// characters.

afterEach(() => {
  vi.restoreAllMocks();
});

/** The form, admitted; a test fails loudly when it is refused. */
const admitted = (schema: unknown): FlowForm => {
  const checked = checkForm(schema);
  if (!checked.ok) throw new Error(`refused: ${JSON.stringify(checked.refusal)}`);
  return checked.form;
};

/** An answer's miss words, or "ok". */
const missOf = (form: FlowForm, text: string): string => {
  const matched = matchAnswer(form, text);
  return matched.ok ? "ok" : matched.miss;
};

const fenced = (json: string) => `Here it is.\n\`\`\`json\n${json}\n\`\`\`\nDone.`;

/** A form `depth` deep through `properties` (a scalar leaf is depth 1). */
const deepByProperties = (depth: number): Record<string, unknown> =>
  depth === 1
    ? { type: "string" }
    : { type: "object", properties: { a: deepByProperties(depth - 1) } };

describe("CP-4a2b — a step's form, checked by fieldd (13a's D12; Q-A2 (a), J4 (a))", () => {
  it("F1: admits each keyword of the subset under an object's top, and an answer matches or misses by each", () => {
    // type: each JSON type a form may name, as a field's (the top is an object's, F9)
    const answers: Record<(typeof FORM_TYPES)[number], [string, string]> = {
      object: ['{"a":1}', "[1]"],
      array: ["[1,2]", '{"a":1}'],
      string: ['"x"', "1"],
      number: ["1.5", '"1.5"'],
      integer: ["2", "2.5"],
      boolean: ["true", "null"],
      null: ["null", "false"],
    };
    for (const type of FORM_TYPES) {
      const form = admitted({ type: "object", properties: { v: { type } }, required: ["v"] });
      const [good, bad] = answers[type];
      expect(matchAnswer(form, `{"v":${good}}`), type).toEqual({
        ok: true,
        value: { v: JSON.parse(good) },
      });
      expect(missOf(form, `{"v":${bad}}`), type).toMatch(
        /^the answer at field 1 of 1 is (a|an|null) .*where the form takes /,
      );
    }
    // the top's own type: an answer that is no object misses at the answer itself
    expect(missOf(admitted({ type: "object" }), "[1]")).toBe(
      "the answer is an array where the form takes an object",
    );
    // properties and required: the value comes back whole; a missing field is said by its place in `required`
    const form = admitted({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } },
      required: ["a", "b", "c"],
    });
    expect(matchAnswer(form, fenced('{"a":"x","b":2,"c":true,"extra":[1]}'))).toEqual({
      ok: true,
      value: { a: "x", b: 2, c: true, extra: [1] },
    });
    expect(missOf(form, '{"a":"x","c":true}')).toBe(
      "the answer is missing a required field (the 2nd of 3)",
    );
    expect(missOf(form, '{"a":"x","b":"2","c":true}')).toBe(
      "the answer at field 2 of 3 is a string where the form takes a number",
    );
    // items
    const list = admitted({
      type: "object",
      properties: { n: { type: "array", items: { type: "number" } } },
    });
    expect(missOf(list, '{"n":[1,2,3]}')).toBe("ok");
    expect(missOf(list, '{"n":[1,2,"3"]}')).toBe(
      "the answer at field 1 of 1, item 3 is a string where the form takes a number",
    );
    // enum
    const choice = admitted({ type: "object", properties: { c: { enum: ["red", "green", 3] } } });
    expect(missOf(choice, '{"c":"green"}')).toBe("ok");
    expect(missOf(choice, '{"c":3}')).toBe("ok");
    expect(missOf(choice, '{"c":"blue"}')).toBe(
      "the answer at field 1 of 1 is not one of the form's 3 choices",
    );
    // no JSON at all
    expect(missOf(form, "I could not do it.")).toBe("the answer holds no JSON the form can read");
  });

  it("F1b: refuses a keyword's value it cannot read, and a form that is no schema object", () => {
    expect(checkForm("string")).toEqual({ ok: false, refusal: { kind: "malformed" } });
    expect(checkForm([{ type: "string" }])).toEqual({ ok: false, refusal: { kind: "malformed" } });
    for (const [schema, keyword] of [
      [{ type: "strng" }, "type"],
      [{ type: ["string", "null"] }, "type"],
      [{ properties: [] }, "properties"],
      [{ properties: { a: 1 } }, "properties"],
      [{ required: "a" }, "required"],
      [{ required: ["a", 1] }, "required"],
      [{ items: [{ type: "string" }] }, "items"],
      [{ enum: [] }, "enum"],
      [{ enum: [{ a: 1 }] }, "enum"],
    ] as const)
      expect(checkForm(schema), keyword).toEqual({
        ok: false,
        refusal: { kind: "malformed", keyword },
      });
  });

  it("F2: refuses `pattern`, `$ref`, `format` and any other keyword, at any depth, naming it", () => {
    for (const keyword of ["pattern", "$ref", "format", "description", "additionalProperties"])
      expect(checkForm({ type: "string", [keyword]: "x" }), keyword).toEqual({
        ok: false,
        refusal: { kind: "keyword", keyword },
      });
    expect(
      checkForm({ type: "object", properties: { a: { type: "string", pattern: "^(a+)+$" } } }),
    ).toEqual({ ok: false, refusal: { kind: "keyword", keyword: "pattern" } });
    // a keyword is said on one line, cut as a label is
    const long = `x\n${"y".repeat(200)}`;
    const refused = checkForm({ [long]: 1 });
    expect(refused.ok).toBe(false);
    const said = (refused as { refusal: { keyword: string } }).refusal.keyword;
    expect(said.length).toBeLessThanOrEqual(64);
    expect(said).not.toContain("\n");
    expect(said.endsWith("…")).toBe(true);
  });

  it("F3: holds FORM_BYTES_MAX of canonical JSON: at its edge admitted, one byte past refused", () => {
    const field = (text: string) => ({
      type: "object",
      properties: { a: { type: "string", enum: [text] } },
    });
    const at = (bytes: number) => {
      const schema = field("a".repeat(bytes - canonicalJson(field("")).length));
      expect(Buffer.byteLength(canonicalJson(schema))).toBe(bytes);
      return schema;
    };
    expect(checkForm(at(FLOW_LIMITS.FORM_BYTES_MAX)).ok).toBe(true);
    expect(checkForm(at(FLOW_LIMITS.FORM_BYTES_MAX + 1))).toEqual({
      ok: false,
      refusal: { kind: "too-large", bound: "bytes" },
    });
  });

  it("F4: holds FORM_DEPTH_MAX: a form that deep admitted, one level deeper refused, by properties or items", () => {
    expect(checkForm(deepByProperties(FLOW_LIMITS.FORM_DEPTH_MAX)).ok).toBe(true);
    expect(checkForm(deepByProperties(FLOW_LIMITS.FORM_DEPTH_MAX + 1))).toEqual({
      ok: false,
      refusal: { kind: "too-large", bound: "depth" },
    });
    // by items, under the top's one field: the top is level 1, its field's lists 2 on, a number at the bottom
    let items: Record<string, unknown> = { type: "number" };
    for (let depth = 2; depth < FLOW_LIMITS.FORM_DEPTH_MAX; depth++)
      items = { type: "array", items };
    expect(checkForm({ type: "object", properties: { a: items } }).ok).toBe(true);
    expect(checkForm({ type: "object", properties: { a: { type: "array", items } } })).toEqual({
      ok: false,
      refusal: { kind: "too-large", bound: "depth" },
    });
  });

  it("F5: holds FORM_ENUM_MAX values in one enum: at its edge admitted, one more refused", () => {
    const form = (n: number) => ({
      type: "object",
      properties: { a: { enum: Array.from({ length: n }, (_, i) => i) } },
    });
    expect(checkForm(form(FLOW_LIMITS.FORM_ENUM_MAX)).ok).toBe(true);
    expect(checkForm(form(FLOW_LIMITS.FORM_ENUM_MAX + 1))).toEqual({
      ok: false,
      refusal: { kind: "too-large", bound: "enum" },
    });
  });

  it("F6: a JSON block past RESULT_MAX_BYTES is a miss, with no parse; so is a whole text past it", () => {
    const form = admitted({ type: "object" });
    const big = `[${"1,".repeat(FLOW_LIMITS.RESULT_MAX_BYTES / 2)}1]`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(FLOW_LIMITS.RESULT_MAX_BYTES);
    const parse = vi.spyOn(JSON, "parse");
    expect(missOf(form, fenced(big))).toBe("the answer's fields are longer than a flow may keep");
    expect(missOf(form, big)).toBe("the answer's fields are longer than a flow may keep");
    expect(parse).not.toHaveBeenCalled();
  });

  it("F7: reads the last fenced json block, else the whole text, and says a miss by types and places alone", () => {
    const form = admitted({
      type: "object",
      properties: {
        SECRETNAME1: { enum: ["SECRETVALUE1", "SECRETVALUE2"] },
        SECRETNAME2: { type: "array", items: { type: "integer" } },
      },
      required: ["SECRETNAME1", "SECRETNAME2"],
    });
    const good = '{"SECRETNAME1":"SECRETVALUE2","SECRETNAME2":[1,2]}';
    // the last block wins over an earlier one; the whole text when there is none, or the last opener never closes
    expect(missOf(form, `${fenced('{"x":1}')}\n${fenced(good)}`)).toBe("ok");
    expect(missOf(form, good)).toBe("ok");
    expect(missOf(form, '{"SECRETNAME1":"SECRETVALUE1","SECRETNAME2":[1],"n":"```json"}')).toBe(
      "ok",
    );
    // every miss names no property, no enum value and none of the agent's text
    const misses = [
      missOf(form, '{"SECRETNAME1":"AGENTTEXT","SECRETNAME2":[1]}'),
      missOf(form, '{"SECRETNAME1":"SECRETVALUE1"}'),
      missOf(form, '{"SECRETNAME1":"SECRETVALUE1","SECRETNAME2":[1,"AGENTTEXT"]}'),
      missOf(form, '{"SECRETNAME1":"SECRETVALUE1","SECRETNAME2":[1,2.5]}'),
      missOf(form, '"AGENTTEXT"'),
      missOf(form, "AGENTTEXT"),
    ];
    for (const miss of misses) {
      expect(miss).not.toBe("ok");
      expect(miss).not.toMatch(/SECRET|AGENTTEXT/);
      expect(miss.length).toBeLessThanOrEqual(FORM_WORDS_MAX);
    }
    // a place deep in the form is cut to FORM_WORDS_MAX, never past it: the 9th of 9 fields, 7 levels down
    const wide = (depth: number): Record<string, unknown> => {
      const properties: Record<string, unknown> = {};
      for (let i = 0; i < 8; i++) properties[`p${i}`] = { type: "string" };
      properties["p8"] = depth === 1 ? { type: "string" } : wide(depth - 1);
      return { type: "object", properties };
    };
    const deep = admitted(wide(FLOW_LIMITS.FORM_DEPTH_MAX - 1));
    let answer: unknown = 1;
    for (let depth = 1; depth < FLOW_LIMITS.FORM_DEPTH_MAX; depth++) answer = { p8: answer };
    const cut = missOf(deep, JSON.stringify(answer));
    expect(cut.length).toBe(FORM_WORDS_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("F8: checks a 64 KiB answer in linear time (a generous bound here; the older test Mac measures it in M-r2's mint)", () => {
    const choices = Array.from({ length: FLOW_LIMITS.FORM_ENUM_MAX }, (_, i) => `c${i}`);
    const form = admitted({
      type: "object",
      properties: { list: { type: "array", items: { enum: choices } } },
    });
    const items: string[] = [];
    for (let size = 11; size < FLOW_LIMITS.RESULT_MAX_BYTES - 8; size += 6) items.push('"c63"');
    const answer = `{"list":[${items.join(",")}]}`;
    expect(Buffer.byteLength(answer)).toBeLessThanOrEqual(FLOW_LIMITS.RESULT_MAX_BYTES);
    const openers = "```json\n".repeat(FLOW_LIMITS.RESULT_MAX_BYTES / 8);
    const started = performance.now();
    expect(missOf(form, answer)).toBe("ok");
    expect(missOf(form, openers)).toBe("the answer holds no JSON the form can read");
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("F9: refuses a top that is not type object, one with no type among them; a form under it may be any", () => {
    const top = { ok: false, refusal: { kind: "top" } };
    for (const type of FORM_TYPES.filter((type) => type !== "object"))
      expect(checkForm({ type }), type).toEqual(top);
    expect(checkForm({ type: "array", items: { type: "number" } })).toEqual(top);
    expect(checkForm({ enum: ["red", "green"] })).toEqual(top);
    expect(checkForm({})).toEqual(top);
    expect(checkForm({ properties: { a: { type: "string" } }, required: ["a"] })).toEqual(top);
    // an object's top is admitted, and each form under it is any type of the subset
    expect(checkForm({ type: "object" }).ok).toBe(true);
    expect(
      checkForm({
        type: "object",
        properties: { a: { type: "array", items: { type: "string" } }, b: { enum: [1] } },
      }).ok,
    ).toBe(true);
    // the top's own keywords and their shapes are read first: one outside the subset, then one written wrong
    expect(checkForm({ type: "string", pattern: "x" })).toEqual({
      ok: false,
      refusal: { kind: "keyword", keyword: "pattern" },
    });
    expect(checkForm({ type: "strng" })).toEqual({
      ok: false,
      refusal: { kind: "malformed", keyword: "type" },
    });
    expect(checkForm({ properties: [] })).toEqual({
      ok: false,
      refusal: { kind: "malformed", keyword: "properties" },
    });
    // and a form that is no object at all is malformed, with no keyword
    expect(checkForm("object")).toEqual({ ok: false, refusal: { kind: "malformed" } });
  });
});
