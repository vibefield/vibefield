import { OBJECT_LIMITS } from "@vibefield/contracts";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { RpcCallError } from "../../../native-link";
import type { DeskKindTool } from "../../../objects/kinds";

// OB-3b (§5.2, §5.5 step 3) — a tool's input, held to its kind's JSON Schema BEFORE the window sees it. A kind's tools are
// nested inside `object_read` and `object_act`, so a harness cannot constrain them; fieldd does, and the refusal teaches:
// the path, and the shape it expected, so the model can mend the call (MT §8).

const refuse = (fact: string, text: string, more: Record<string, unknown> = {}): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", text, false, { fact, ...more });

/** Expected shapes past this length are named by their keyword instead: the refusal is for reading. */
const EXPECTED_CHARS = 600;

const ajv = new Ajv({ allErrors: false, strict: false, verbose: true });
const compiled = new WeakMap<DeskKindTool, ValidateFunction>();

const compile = (tool: DeskKindTool): ValidateFunction => {
  const known = compiled.get(tool);
  if (known !== undefined) return known;
  const validate = ajv.compile(tool.input);
  compiled.set(tool, validate);
  return validate;
};

const pathOf = (err: ErrorObject): string => {
  const parts = err.instancePath
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  const { missingProperty, additionalProperty } = err.params as {
    missingProperty?: string;
    additionalProperty?: string;
  };
  if (missingProperty !== undefined) parts.push(missingProperty);
  if (additionalProperty !== undefined) parts.push(additionalProperty);
  return parts.reduce((path, part) => {
    if (/^\d+$/.test(part)) return `${path}[${part}]`;
    return path === "" ? part : `${path}.${part}`;
  }, "");
};

const expectedOf = (err: ErrorObject): unknown => {
  const shape = JSON.stringify(err.parentSchema ?? null);
  return shape.length <= EXPECTED_CHARS
    ? err.parentSchema
    : { keyword: err.keyword, ...err.params };
};

/** Throws `bad-input` (with `path` and `expected`) unless `input` fits the tool's schema and the wire's bound. A schema
 * that will not compile is the kind's fault and answers `failed`: nothing unchecked reaches the window. */
export function checkToolInput(tool: DeskKindTool, input: unknown): void {
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > OBJECT_LIMITS.TOOL_BYTES)
    throw refuse(
      "bad-input",
      `input is over ${OBJECT_LIMITS.TOOL_BYTES} bytes; send less at a time`,
      { path: "input", expected: { maxBytes: OBJECT_LIMITS.TOOL_BYTES } },
    );
  let validate: ValidateFunction;
  try {
    validate = compile(tool);
  } catch {
    throw refuse(
      "failed",
      `This object's ${tool.name} tool declares an input VibeField can't read.`,
    );
  }
  if (validate(input)) return;
  const err = validate.errors?.[0];
  if (err === undefined) throw refuse("bad-input", "input is not what this tool takes");
  const path = pathOf(err);
  const expected = expectedOf(err);
  throw refuse(
    "bad-input",
    `${path === "" ? "input" : `input.${path}`}: ${err.message ?? "not what this tool takes"}. Expected ${JSON.stringify(expected)}.`,
    { path, expected },
  );
}
