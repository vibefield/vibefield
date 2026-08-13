// Where "every declared widget state" (§24.2) comes from, and what makes a
// fixture legal before anything mounts it.
//
// P8d decision, 2026-08-13: states are AUTHORING-TIME, never manifest —
// `<plugin>/playground/states.ts`, default-exporting
// `Record<widgetType, Record<stateName, props>>`. Absent file ⇒ one `default`
// state per declared widget, built from the manifest's own prop defaults.
//
// An invalid fixture is its OWN refusal class. A state whose props contradict
// the declared schema tells you nothing about the widget when it fails to
// render — the fixture is what is broken, and saying `state-invalid` instead of
// `state-render-failed` is the difference between a diagnosis and a symptom.
import type { JsonShape, PropSpec, WidgetContribution } from "@vibefield/contracts";
import { pointer, type Refusal, refusal } from "./verdict";

/** The authored shape: widget type → state name → the props that state renders. */
export type StatesFile = Record<string, Record<string, Record<string, unknown>>>;

export const STATES_RELATIVE_PATH = "playground/states.ts";

/** The one state synthesized for a widget with no authored fixture. */
export const DEFAULT_STATE = "default";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A tagged result, not a union of the two payloads: `StatesFile` is an index
 * signature, so `"code" in result` narrows nothing and a caller reaching for
 * `.pointer` would type-check against the states file itself. */
export type StatesRead =
  | { readonly ok: true; readonly states: StatesFile }
  | ({ readonly ok: false } & Refusal);

/**
 * Read the loaded module's default export as a states file.
 *
 * Deliberately strict about the OUTER two levels and tolerant about the props:
 * the props are the widget's business and get validated against its declared
 * schema below, but a states file whose shape is wrong cannot be interpreted at
 * all and must say so at the level that is wrong.
 */
export function readStatesModule(mod: Record<string, unknown>): StatesRead {
  const no = (detail: string, extra: { pointer?: string; expected?: string } = {}): StatesRead => ({
    ok: false,
    ...refusal("states-invalid", detail, extra),
  });
  const declared = mod.default;
  if (declared === undefined) {
    return no(`${STATES_RELATIVE_PATH} has no default export`, {
      expected: "export default { '<widget.type>': { '<state>': { ...props } } }",
    });
  }
  if (!isPlainObject(declared)) {
    return no(
      `${STATES_RELATIVE_PATH} default-exports a ${Array.isArray(declared) ? "array" : typeof declared}`,
      { expected: "export default { '<widget.type>': { '<state>': { ...props } } }" },
    );
  }
  for (const [type, states] of Object.entries(declared)) {
    if (!isPlainObject(states)) {
      return no(`states for ${type} are not an object`, {
        pointer: pointer(type),
        expected: "{ '<state>': { ...props } }",
      });
    }
    for (const [name, props] of Object.entries(states)) {
      if (!isPlainObject(props)) {
        return no(`state ${type}/${name} is not a prop object`, {
          pointer: pointer(type, name),
          expected: "{ ...props } — a plain object of declared prop names",
        });
      }
    }
  }
  return { ok: true, states: declared as StatesFile };
}

/** The `default` state for a widget with no authored fixture: its declared prop
 * defaults, stated explicitly so the report shows what was actually rendered
 * rather than implying the engine filled something in off-screen. */
export function synthesizeDefaultState(decl: WidgetContribution): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(decl.props)) {
    if ("default" in spec && spec.default !== undefined) props[name] = spec.default;
  }
  return props;
}

function describeShape(shape: JsonShape): string {
  switch (shape.kind) {
    case "array":
      return `${describeShape(shape.item)}[]`;
    case "object":
      return `{ ${Object.keys(shape.fields).join(", ")} }`;
    case "enum":
      return `one of ${shape.options.join(" | ")}`;
    default:
      return shape.kind;
  }
}

/** `p.json` inner-shape validation (contracts JsonShape, mirrored from ICE's
 * props.ts). Returns the failing sub-path, or null. */
function checkJson(value: unknown, shape: JsonShape, path: readonly string[]): string[] | null {
  switch (shape.kind) {
    case "string":
      return typeof value === "string" ? null : [...path];
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : [...path];
    case "boolean":
      return typeof value === "boolean" ? null : [...path];
    case "enum":
      return typeof value === "string" && shape.options.includes(value) ? null : [...path];
    case "array": {
      if (!Array.isArray(value)) return [...path];
      for (const [i, item] of value.entries()) {
        const bad = checkJson(item, shape.item, [...path, String(i)]);
        if (bad !== null) return bad;
      }
      return null;
    }
    case "object": {
      if (!isPlainObject(value)) return [...path];
      for (const [field, inner] of Object.entries(shape.fields)) {
        const bad = checkJson(value[field], inner, [...path, field]);
        if (bad !== null) return bad;
      }
      return null;
    }
  }
}

function checkProp(
  spec: PropSpec,
  value: unknown,
  at: string,
  path: readonly string[],
): Refusal | null {
  const bad = (expected: string, sub: readonly string[] = path): Refusal =>
    refusal("state-invalid", `${at}: ${describeValue(value)} is not ${expected}`, {
      pointer: pointer(...sub),
      expected,
    });
  switch (spec.kind) {
    case "string":
      if (typeof value !== "string") return bad("a string");
      if (spec.maxLength !== undefined && value.length > spec.maxLength)
        return bad(`a string of at most ${spec.maxLength} characters`);
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("a finite number");
      if (spec.min !== undefined && value < spec.min) return bad(`a number >= ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) return bad(`a number <= ${spec.max}`);
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : bad("a boolean");
    case "enum":
      return typeof value === "string" && spec.options.includes(value)
        ? null
        : bad(`one of ${spec.options.join(" | ")}`);
    case "json": {
      const sub = checkJson(value, spec.inner, []);
      if (sub === null) return null;
      const full = [...path, ...sub];
      return refusal(
        "state-invalid",
        `${[at, ...sub].join(".")}: does not match the declared json shape`,
        { pointer: pointer(...full), expected: describeShape(spec.inner) },
      );
    }
    default:
      // entity/session/terminal/artifact/file refs have no engine constructor
      // (build-widget refuses them at prefab build), so no fixture can supply
      // one. Naming the kind beats letting the prefab build fail later.
      return refusal("state-invalid", `${at}: prop kind ${spec.kind} cannot be set by a fixture`, {
        pointer: pointer(...path),
        expected: "a prop of kind string | number | boolean | enum | json",
      });
  }
}

function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (v === null) return "null";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "object") return "an object";
  return String(v);
}

/**
 * Validate one state's props against the widget's DECLARED prop schema, before
 * anything is spawned or mounted. Unknown prop names refuse too: the engine
 * silently drops them, so a typo'd fixture would otherwise render the default
 * and pass — the worst possible answer for someone iterating on a state.
 */
export function validateState(
  decl: WidgetContribution,
  stateName: string,
  props: Record<string, unknown>,
): Refusal | null {
  const declaredNames = Object.keys(decl.props);
  for (const [name, value] of Object.entries(props)) {
    const path = [decl.type, stateName, name];
    const spec = decl.props[name];
    if (spec === undefined) {
      return refusal(
        "state-invalid",
        `${decl.type}/${stateName}: ${name} is not a declared prop of ${decl.type}`,
        {
          pointer: pointer(...path),
          expected:
            declaredNames.length > 0
              ? `one of ${declaredNames.join(", ")}`
              : `${decl.type} declares no props`,
        },
      );
    }
    const bad = checkProp(spec, value, `${decl.type}/${stateName}/${name}`, path);
    if (bad !== null) return bad;
  }
  return null;
}
