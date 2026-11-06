// CP-4a2b (13a's D12, slice 9; Q-A2 (a), J4 (a), ruled 2026-11-05) — a step's form, checked by
// fieldd: the form a script's `agent()` names in its `schema` option, and the answer its step's agent gave. The unit
// alone, pure: no I/O, no clock, and no import from the runs (steps.ts, runs.ts), which wire it in slice 9.
// - SKELETON (the red): every export is its surface alone, and each call throws until the green builds it.

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

/** Why a form is refused at the call, before its step starts (DESIGN.md §9, "A form the run can't check"). */
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

const NOT_BUILT = "CP-4a2b slice 9: the form check is not built";

/** A script's `schema` as a form, or why it is refused. */
export function checkForm(_schema: unknown): FormCheck {
  throw new Error(NOT_BUILT);
}

/** A step's answer text against its form. */
export function matchAnswer(_form: FlowForm, _text: string): FormMatch {
  throw new Error(NOT_BUILT);
}
