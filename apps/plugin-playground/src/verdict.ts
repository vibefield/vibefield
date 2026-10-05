import type { KindNoteCode, KindRefusalCode } from "@vibefield/plugin-sdk/testing";

// The verdict vocabulary (P8-D8, thinking-p8 §2.1: "refusals are an interface,
// not prose"). An agent iterates against `{code, pointer, expected}`; the human
// line is `detail` and is never the only thing said.
//
// Every code below is a STABLE kebab-case class. Adding one is additive;
// renaming one breaks every caller that branched on it, so treat this list the
// way the contracts package treats a wire shape.

/** What happened to one row. `note` is neither — it is the honest answer when
 * this harness cannot decide, and it is counted separately so it can never be
 * read as a pass. */
export type VerdictStatus = "pass" | "note" | "refused";

export interface Refusal {
  /** stable class — branch on this, never on `detail` */
  readonly code: RefusalCode;
  /** JSON pointer into the failing artifact (the states export, or the manifest) */
  readonly pointer?: string;
  /** the passing shape, stated concretely */
  readonly expected?: string;
  /** the human line */
  readonly detail: string;
}

// DK-10: refusals.md QUOTES this union between the markers — the playground's codes were in no doc.
// docs:begin playground-codes
export type RefusalCode =
  // --- plugin-level: the run never reached a state ---
  /** no `vibefield.plugin.json` at the given path */
  | "manifest-missing"
  /** the manifest exists and the contracts schema refused it */
  | "manifest-invalid"
  /** the manifest declares object kinds but no renderer source exists to export them */
  | "renderer-entry-missing"
  /** the renderer module could not be imported (syntax, bad import, throw at top level) */
  | "renderer-import-failed"
  /** `activate` threw, or bound a type the manifest does not declare */
  | "activation-failed"
  // --- type-level: the fixtures for one declared type could not be read ---
  /** `playground/states.ts` exists but its default export is not the declared shape */
  | "states-invalid"
  /** the states file names a type this manifest does not contribute */
  | "states-unknown-type"
  /** a declared type's state record is empty — say so rather than silently pass zero rows */
  | "states-empty"
  // --- state-level: one fixture's props (`validateState`; the kind harness says it on its rows) ---
  /** the fixture's props violate the manifest's declared prop schema */
  | "state-invalid";

/** `--still` (DK-11): what the playground says of each state's STILL — one object of the kind on a bare mat, drawn on
 * Dawn through ICE's `createStill` by day and by night, its WGSL compiled (src/still.ts). */
export type StillCode =
  /** the still could not be drawn: the type could not be built as the host builds it, or `createStill` rejected — a kind
   * refused at create (a WGSL error is the compiler's own line), a GPU error, a throw in its world half */
  | "still-failed"
  /** drawn twice, the bytes differ — its look reads a wall clock or a random */
  | "still-unsteady"
  /** nothing of it was drawn: its box is the bare mat's */
  | "still-blank"
  /** pixels moved past its rect grown by its `reach` — the desk culls and pads it by its reach */
  | "still-past-reach"
  /** its bytes are not the golden's (`test/still.golden.json`; the golden names the host that blessed it) */
  | "still-golden-mismatch"
  /** `test/still.golden.json` is not a golden `--still --bless` writes */
  | "still-golden-invalid"
  /** (a note) no golden holds it yet — `--still --bless` once, on your machine */
  | "still-unblessed"
  /** (a note) the kind harness refused the kind, so its stills were not drawn */
  | "still-not-drawn";
// docs:end playground-codes

/**
 * Codes RETIRED by name — never emitted again. DK-8: `widget-unbuildable` (the host could not build
 * a WIDGET row's faceless prefab) retired with `contributes.widgets` itself — the manifest refuses
 * the contribution by name, so no run reaches a widget row. DK-7 (the plan's Phase 3 input (3): each
 * of the four "not emitted" codes re-aimed at a measured state or retired):
 *  - `widget-unbound` — a widget row binds no face: the host compiles it faceless (DK-2), so an
 *    unbound widget is the expected one; an OBJECT row whose export is missing is the harness's
 *    `object-export-missing`.
 *  - `skipped-gl` (a note) — nothing is GL: the desk draws object kinds, and the harness drives every
 *    kind with no device; what it cannot do — compile — is its note `object-wgsl-not-compiled`.
 * RE-AIMED: `state-spawn-failed` (a kind's world half threw or answered no shape at a driven state)
 * and `state-render-failed` (its pass's prepare or drawRange threw) — the harness's codes, said on
 * `kind` rows (`KindRefusalCode`).
 */
export const RETIRED_CODES = ["widget-unbound", "skipped-gl", "widget-unbuildable"] as const;

/** A note a row can carry: the kind harness's honest absences. */
export type NoteCode = KindNoteCode;

/** A refusal that stopped the run before (or instead of) any state row. */
export interface PluginVerdict {
  readonly kind: "plugin";
  readonly plugin: string;
  readonly status: "refused";
  readonly code: RefusalCode;
  readonly pointer?: string;
  readonly expected?: string;
  readonly detail: string;
}

/**
 * An OBJECT KIND's row (DK-7, the playground v2): what the kind-conformance harness
 * (`@vibefield/plugin-sdk/testing`) made of it — the export its binding names, the count of states
 * it DROVE (each fixture × every declared mode × every zoom the desk's LOD names, and once at rest
 * by night), and `refusal`: the first refusal it said of the kind, or `null` — a FIELD an agent
 * branches on, never a code's absence. The harness's verdicts follow it, one `kind` row each.
 */
export interface ObjectVerdict {
  readonly kind: "object";
  readonly plugin: string;
  readonly type: string;
  /** the renderer module's export that draws the kind (`binding.kind`) */
  readonly binding: string;
  /** the count of states the harness drove */
  readonly states: number;
  readonly refusal: KindRefusalCode | null;
}

/** One verdict of the kind-conformance harness on an object kind (DK-7): its `declaration`, its
 * `program`, one of its fixtures (a playground state, driven over every mode and zoom) or its
 * `dispose`. Its code is the harness's (`KIND_EXPECTED` says what each would have passed). */
export interface KindRow {
  readonly kind: "kind";
  readonly plugin: string;
  readonly type: string;
  /** `declaration` · `program` · `dispose` · a fixture's name */
  readonly subject: string;
  readonly status: VerdictStatus;
  readonly code: KindRefusalCode | KindNoteCode | "ok";
  readonly pointer?: string;
  readonly expected?: string;
  readonly detail: string;
}

/** A refusal that costs ONE declared type its rows while its peers still run —
 * §11.4's containment law applied to the verdict table. DK-8: this row was `kind: "widget"` while
 * widget rows were judged (it was said of object types too); the widget rows retired with
 * `contributes.widgets`, and the row is named for what it is about — a TYPE. */
export interface TypeVerdict {
  readonly kind: "type";
  readonly plugin: string;
  readonly type: string;
  readonly status: "refused";
  readonly code: RefusalCode;
  readonly pointer?: string;
  readonly expected?: string;
  readonly detail: string;
}

/** The two lights a still is drawn in (ICE's `light` and `dark`). */
export type StillTheme = "day" | "night";

/** A line said on the console while a still was drawn, and who said it: `ice-core` is strata's dev access check on ICE
 * core's own `Tray` systems, said at every engine a still makes — never the kind's. */
export interface StillSaid {
  readonly by: "ice-core" | "unattributed";
  readonly line: string;
  readonly times: number;
}

/**
 * One STILL (DK-11, `--still`): a state of an object kind drawn on Dawn through ICE's `createStill` — one object on a bare mat
 * — by day or by night, its WGSL compiled; judged drawn, inside its reach, steady, and held to the plugin's golden. A row about
 * the kind as a whole (not drawn, not built) has the state `—` and no theme.
 */
export interface StillVerdict {
  readonly kind: "still";
  readonly plugin: string;
  readonly type: string;
  /** the fixture's name, or `—` for a row about the kind as a whole */
  readonly state: string;
  readonly theme?: StillTheme;
  readonly status: VerdictStatus;
  readonly code: StillCode | "ok";
  readonly expected?: string;
  readonly detail: string;
  /** the still, device px, and the sha-256 of its RGBA — present once drawn */
  readonly width?: number;
  readonly height?: number;
  readonly sha256?: string;
  /** where its PNG was written */
  readonly png?: string;
  /** what was said on the console while it was drawn, each line attributed */
  readonly said?: readonly StillSaid[];
}

export interface RunSummary {
  readonly kind: "summary";
  readonly plugin: string;
  /** the manifest's object kinds, each judged by the kind harness (DK-7) */
  readonly objects: number;
  /** every state the kind harness drove (DK-8: widget states retired with `contributes.widgets`) */
  readonly states: number;
  readonly passed: number;
  readonly skipped: number;
  readonly refused: number;
  /** `--still` only: the still rows said (each state by day and by night) */
  readonly stills?: number;
  readonly exit: 0 | 1;
}

export type Verdict =
  | ObjectVerdict
  | KindRow
  | StillVerdict
  | PluginVerdict
  | TypeVerdict
  | RunSummary;

export interface RunResult {
  readonly verdicts: readonly Verdict[];
  readonly summary: RunSummary;
}

/** RFC 6901 escaping, so a pointer stays a pointer for whatever parses it. */
export function pointer(...segments: readonly string[]): string {
  return segments.map((s) => `/${s.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

export function refusal(
  code: RefusalCode,
  detail: string,
  extra: { pointer?: string; expected?: string } = {},
): Refusal {
  return {
    code,
    detail,
    ...(extra.pointer !== undefined ? { pointer: extra.pointer } : {}),
    ...(extra.expected !== undefined ? { expected: extra.expected } : {}),
  };
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
