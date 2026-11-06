import { canonicalJson, clipWords, FLOW_LIMITS, oneLineWords } from "@vibefield/contracts";
import { nestsWithin } from "./protocol";

// CP-4a2b (13a's D12, slice 9; Q-A2 (a), J4 (a), ruled 2026-11-05) — a step's form, checked by
// fieldd: the form a script's `agent()` names in its `schema` option, and the answer its step's agent gave. The unit
// alone, pure: no I/O, no clock, and no import from the runs (steps.ts, runs.ts), which wire it in slice 9.
// - A form is D12's subset: `type`, `properties`, `required`, `items` and `enum`, and nothing else. There is no
//   `pattern`, `format`, `$ref` or regex anywhere, so no ReDoS road. Three bounds hold it, each refused before its
//   step starts: FLOW_LIMITS.FORM_BYTES_MAX of canonical JSON (string lengths and the whole size), FORM_DEPTH_MAX deep
//   (a form's own nesting: a scalar's form is 1, each `properties` or `items` level 1 more), and FORM_ENUM_MAX values
//   in one `enum`, which the byte bound alone would admit at hundreds of short values.
// - The subset's own shape: `type` one of FORM_TYPES (one word, never a list); `properties` an object of forms;
//   `required` a list of names; `items` one form (never a list); `enum` 1..FORM_ENUM_MAX JSON scalars. A value it
//   cannot read is `malformed`, naming its keyword.
// - An answer is read from its last fenced `json` block, else its whole text, and bounded at RESULT_MAX_BYTES before any
//   parse: past it the answer is a miss. A match gives the parsed value back whole (the runs spread an object's fields
//   beside `text`, Q-A1 (a)); `properties` holds the fields it names, and fields it does not name pass.
// - A miss is said in fieldd's words for the first place the answer missed, depth first in the form's own order: JSON
//   types and places alone ("field 2 of 3", "item 4"), never a property name, an enum value or the agent's text
//   (MT-L6), cut at FORM_WORDS_MAX. They are the ‹fieldd's check› of DESIGN.md §9's repair line.
// - Both walks are linear: each form node and each answer value is visited once, over an explicit stack, so nothing
//   recurses on the answer's nesting, and the form's is held to FORM_DEPTH_MAX before canonical JSON reads it.

/** The keywords a form may use (D12's subset). There is no `pattern`, `format`, `$ref` or regex anywhere. */
export const FORM_KEYWORDS = ["type", "properties", "required", "items", "enum"] as const;
export type FormKeyword = (typeof FORM_KEYWORDS)[number];

/** The JSON types a form's `type` may name. */
export const FORM_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;
export type FormType = (typeof FORM_TYPES)[number];

/** fieldd's check words for an answer's miss, at most this many characters (DESIGN.md §9, "The repair turn"). */
export const FORM_WORDS_MAX = 120;

/** A keyword a refusal names is said as a label is: one line, cut at 64 characters (DESIGN.md §9, "A flow's lines"). */
export const FORM_KEYWORD_WORDS_MAX = 64;

/** An `enum`'s values: JSON scalars. */
export type FormScalar = string | number | boolean | null;

/** A form checkForm admitted. */
export interface FlowForm {
  readonly type?: FormType;
  readonly properties?: Readonly<Record<string, FlowForm>>;
  readonly required?: readonly string[];
  readonly items?: FlowForm;
  readonly enum?: readonly FormScalar[];
}

/** Why a form is refused at the call, before its step starts (DESIGN.md §9, "A form the run can't check"): a keyword
 * outside the subset (said on one line, cut at FORM_KEYWORD_WORDS_MAX); one of the three bounds; or a value the subset
 * cannot read, by its keyword (none: the form itself is no schema object). */
export type FormRefusal =
  | { readonly kind: "keyword"; readonly keyword: string }
  | { readonly kind: "too-large"; readonly bound: "bytes" | "depth" | "enum" }
  | { readonly kind: "malformed"; readonly keyword?: FormKeyword };

export type FormCheck =
  | { readonly ok: true; readonly form: FlowForm }
  | { readonly ok: false; readonly refusal: FormRefusal };

/** An answer against its form: the parsed value, or fieldd's words for the first place it missed. */
export type FormMatch =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly miss: string };

/** The JSON nesting a form within FORM_DEPTH_MAX can reach: each level is a form and its `properties` object, and the
 * deepest may hold an `enum` or a `required` list. */
const FORM_JSON_DEPTH_MAX = 2 * FLOW_LIMITS.FORM_DEPTH_MAX;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isKeyword = (key: string): key is FormKeyword =>
  (FORM_KEYWORDS as readonly string[]).includes(key);
const isType = (word: unknown): word is FormType =>
  typeof word === "string" && (FORM_TYPES as readonly string[]).includes(word);
const isScalar = (value: unknown): value is FormScalar =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

const refused = (refusal: FormRefusal): FormCheck => ({ ok: false, refusal });
const malformed = (keyword: FormKeyword): FormCheck => refused({ kind: "malformed", keyword });

/** A script's `schema` as a form, or why it is refused: the nesting first (canonical JSON recurses), then the bytes,
 * then one walk that holds each node's keywords, their shapes, the depth and each enum's width. */
export function checkForm(schema: unknown): FormCheck {
  if (!isObject(schema)) return refused({ kind: "malformed" });
  if (!nestsWithin(schema, FORM_JSON_DEPTH_MAX))
    return refused({ kind: "too-large", bound: "depth" });
  let bytes: number;
  try {
    bytes = Buffer.byteLength(canonicalJson(schema));
  } catch {
    // a value JSON cannot carry (a script's form arrives as JSON, so only a caller's own object reaches here)
    return refused({ kind: "malformed" });
  }
  if (bytes > FLOW_LIMITS.FORM_BYTES_MAX) return refused({ kind: "too-large", bound: "bytes" });
  const stack: [Record<string, unknown>, number][] = [[schema, 1]];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [node, depth] = next;
    if (depth > FLOW_LIMITS.FORM_DEPTH_MAX) return refused({ kind: "too-large", bound: "depth" });
    for (const key of Object.keys(node))
      if (!isKeyword(key))
        return refused({ kind: "keyword", keyword: oneLineWords(key, FORM_KEYWORD_WORDS_MAX) });
    const { type, properties, required, items } = node;
    const choices = node["enum"];
    if (type !== undefined && !isType(type)) return malformed("type");
    if (
      required !== undefined &&
      !(Array.isArray(required) && required.every((r) => typeof r === "string"))
    )
      return malformed("required");
    if (choices !== undefined) {
      if (!Array.isArray(choices) || choices.length === 0 || !choices.every(isScalar))
        return malformed("enum");
      if (choices.length > FLOW_LIMITS.FORM_ENUM_MAX)
        return refused({ kind: "too-large", bound: "enum" });
    }
    if (items !== undefined) {
      if (!isObject(items)) return malformed("items");
      stack.push([items, depth + 1]);
    }
    if (properties !== undefined) {
      if (!isObject(properties)) return malformed("properties");
      const children = Object.values(properties);
      for (const child of children) if (!isObject(child)) return malformed("properties");
      for (let i = children.length - 1; i >= 0; i--)
        stack.push([children[i] as Record<string, unknown>, depth + 1]);
    }
  }
  return { ok: true, form: schema as FlowForm };
}

/** A place in an answer, from its root: the k-th of n fields its form names, or the i-th item of a list. */
type Place =
  | { readonly up: Place; readonly field: number; readonly of: number }
  | { readonly up: Place; readonly item: number }
  | undefined;

const placeWords = (place: Place): string => {
  const steps: string[] = [];
  for (let at = place; at !== undefined; at = at.up)
    steps.push("item" in at ? `item ${at.item}` : `field ${at.field} of ${at.of}`);
  return steps.length === 0 ? "the answer" : `the answer at ${steps.reverse().join(", ")}`;
};

/** What a JSON value is, in the words a miss says it. */
const kindWords = (value: unknown): string =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "an array"
      : typeof value === "object"
        ? "an object"
        : typeof value === "string"
          ? "a string"
          : typeof value === "number"
            ? "a number"
            : "a boolean";

const TAKES: Readonly<Record<FormType, string>> = {
  object: "an object",
  array: "an array",
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "a boolean",
  null: "null",
};

const fits = (type: FormType, value: unknown): boolean => {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
};

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
};

const OPENER = "```json";
const FENCE = "```";

/** The text an answer's JSON is read from: the body of its last ```json opener (from the line after it) up to the
 * next ``` after it, else the whole text (no opener, or the last one never closes). One lastIndexOf and two indexOf. */
const candidateOf = (text: string): string => {
  const open = text.lastIndexOf(OPENER);
  if (open === -1) return text;
  const body = text.indexOf("\n", open + OPENER.length);
  if (body === -1) return text;
  const close = text.indexOf(FENCE, body + 1);
  return close === -1 ? text : text.slice(body + 1, close);
};

const MISS_TOO_LONG = "the answer's fields are longer than a flow may keep";
const MISS_NO_JSON = "the answer holds no JSON the form can read";

const missed = (words: string): FormMatch => ({
  ok: false,
  miss: clipWords(words, FORM_WORDS_MAX),
});

/** A step's answer text against its form: the candidate bounded before its parse, then one walk, depth first in the
 * form's own order, that says the first place it missed. */
export function matchAnswer(form: FlowForm, text: string): FormMatch {
  const candidate = candidateOf(text);
  if (Buffer.byteLength(candidate) > FLOW_LIMITS.RESULT_MAX_BYTES) return missed(MISS_TOO_LONG);
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return missed(MISS_NO_JSON);
  }
  const stack: { form: FlowForm; value: unknown; place: Place }[] = [
    { form, value, place: undefined },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { form: node, value: at, place } = next;
    if (node.type !== undefined && !fits(node.type, at))
      return missed(
        `${placeWords(place)} is ${kindWords(at)} where the form takes ${TAKES[node.type]}`,
      );
    if (node.enum !== undefined && !node.enum.some((choice) => choice === at))
      return missed(`${placeWords(place)} is not one of the form's ${node.enum.length} choices`);
    if (Array.isArray(at)) {
      if (node.items !== undefined)
        for (let i = at.length - 1; i >= 0; i--)
          stack.push({ form: node.items, value: at[i], place: { up: place, item: i + 1 } });
      continue;
    }
    if (!isObject(at)) continue;
    const required = node.required ?? [];
    for (let i = 0; i < required.length; i++)
      if (!Object.hasOwn(at, required[i] as string))
        return missed(
          `${placeWords(place)} is missing a required field (the ${ordinal(i + 1)} of ${required.length})`,
        );
    if (node.properties === undefined) continue;
    const fields = Object.entries(node.properties);
    for (let i = fields.length - 1; i >= 0; i--) {
      const [name, child] = fields[i] as [string, FlowForm];
      if (Object.hasOwn(at, name))
        stack.push({
          form: child,
          value: at[name],
          place: { up: place, field: i + 1, of: fields.length },
        });
    }
  }
  return { ok: true, value };
}
