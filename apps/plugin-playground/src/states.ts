// Where "every declared state" (§24.2) comes from, and what makes a fixture
// legal before anything draws it.
//
// P8d decision, 2026-08-13: states are AUTHORING-TIME, never manifest —
// `<plugin>/playground/states.ts`, default-exporting
// `Record<type, Record<stateName, props>>`. Absent file ⇒ one `default` state
// per declared object kind, built from the manifest's own prop defaults (DK-8:
// the widget rows these once fixtured retired with `contributes.widgets`).
//
// An invalid fixture is its OWN refusal class. A state whose props contradict
// the declared schema tells you nothing about the kind when it fails to draw —
// the fixture is what is broken, and saying `state-invalid` instead of
// `state-spawn-failed` is the difference between a diagnosis and a symptom.
import type { ObjectContribution } from "@vibefield/contracts";
import { defaultProps, validateStateProps } from "@vibefield/plugin-sdk/testing";
import { pointer, type Refusal, refusal } from "./verdict";

/** The authored shape: object type → state name → the props that state draws. */
export type StatesFile = Record<string, Record<string, Record<string, unknown>>>;

export const STATES_RELATIVE_PATH = "playground/states.ts";

/** The one state synthesized for a kind with no authored fixture. */
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
 * the props are the kind's business and get validated against its declared
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
      expected: "export default { '<object.type>': { '<state>': { ...props } } }",
    });
  }
  if (!isPlainObject(declared)) {
    return no(
      `${STATES_RELATIVE_PATH} default-exports a ${Array.isArray(declared) ? "array" : typeof declared}`,
      { expected: "export default { '<object.type>': { '<state>': { ...props } } }" },
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

/** What a fixture is judged against: a declared row's type and props. */
export type StateRow = Pick<ObjectContribution, "type" | "props">;

/** The `default` state for a kind with no authored fixture: its declared prop
 * defaults, stated explicitly so the report shows what was actually judged
 * rather than implying the engine filled something in off-screen. (The SDK's
 * `defaultProps` — the kind harness synthesizes an object's `default` the same way.) */
export function synthesizeDefaultState(row: StateRow): Record<string, unknown> {
  return defaultProps(row);
}

/**
 * Validate one state's props against the row's DECLARED prop schema, before
 * anything judges it. Unknown prop names refuse too: the engine silently drops
 * them, so a typo'd fixture would otherwise read as the defaults and pass — the
 * worst possible answer for someone iterating on a state.
 *
 * ONE function judges every fixture (DK-7): the SDK's `validateStateProps`, which
 * the kind harness runs over an object's fixtures before it drives them.
 */
export function validateState(
  row: StateRow,
  stateName: string,
  props: Record<string, unknown>,
): Refusal | null {
  return validateStateProps(row, stateName, props);
}
