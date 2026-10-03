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

export type RefusalCode =
  // --- plugin-level: the run never reached a state ---
  /** no `vibefield.plugin.json` at the given path */
  | "manifest-missing"
  /** the manifest exists and the contracts schema refused it */
  | "manifest-invalid"
  /** the manifest declares widgets but no renderer source exists to bind them */
  | "renderer-entry-missing"
  /** the renderer module could not be imported (syntax, bad import, throw at top level) */
  | "renderer-import-failed"
  /** `activate` threw, or bound a type the manifest does not declare */
  | "activation-failed"
  // --- widget-level: the state list for one type could not be built ---
  /** NOT EMITTED since DK-5: a widget row binds no face on the desk (the host
   * compiles it faceless since DK-2), so an unbound widget is the expected one */
  | "widget-unbound"
  /** the host could not build the prefab from this declaration (§12.2) */
  | "widget-unbuildable"
  /** `playground/states.ts` exists but its default export is not the declared shape */
  | "states-invalid"
  /** the states file names a widget type this manifest does not declare */
  | "states-unknown-type"
  /** a declared type's state record is empty — say so rather than silently pass zero rows */
  | "states-empty"
  // --- state-level: the row itself ---
  /** the fixture's props violate the manifest's declared prop schema */
  | "state-invalid"
  /** NOT EMITTED since DK-5 (nothing mounts — no entity is spawned for a face) */
  | "state-spawn-failed"
  /** NOT EMITTED since DK-5 (the "React mounts in happy-dom" verdict retired) */
  | "state-render-failed";

/** NOT EMITTED since DK-5: a GL widget was skipped because no GL island could
 * mount in a DOM-only harness, and nothing mounts now. DK-7 retires the class
 * with the kind-conformance harness. */
export type NoteCode = "skipped-gl";

export interface StateVerdict {
  readonly kind: "state";
  readonly plugin: string;
  readonly type: string;
  readonly state: string;
  readonly status: VerdictStatus;
  readonly code?: RefusalCode | NoteCode;
  readonly pointer?: string;
  readonly expected?: string;
  readonly detail?: string;
  readonly durationMs?: number;
  /** console.error calls captured during this mount. REPORTED, never gating —
   * React's dev channel carries version-dependent warnings that are not the
   * plugin's contract, and a verdict that flips with a React upgrade is not a
   * verdict. An author who wants them gone can still see every one. */
  readonly consoleErrors?: readonly string[];
}

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
 * DK-5 — an OBJECT KIND as this harness speaks of it: listed from the manifest,
 * with the export its binding names, the states its fixture declares (or the one
 * synthesized `default`), and the refusal this build answers — `null`, because
 * the desk draws object kinds (the field `inspect` carries too, so an agent
 * branches on the field, never on a code's absence). DK-7's kind-conformance
 * harness judges those states (`resolve`/`record`/`hit`, no DOM) on this row.
 */
export interface ObjectVerdict {
  readonly kind: "object";
  readonly plugin: string;
  readonly type: string;
  /** the renderer module's export that draws the kind (`binding.kind`) */
  readonly binding: string;
  readonly states: number;
  readonly refusal: RefusalCode | null;
}

/** A refusal that costs ONE widget its state rows while its peers still run —
 * §11.4's containment law applied to the verdict table. */
export interface WidgetVerdict {
  readonly kind: "widget";
  readonly plugin: string;
  readonly type: string;
  readonly status: "refused";
  readonly code: RefusalCode;
  readonly pointer?: string;
  readonly expected?: string;
  readonly detail: string;
}

export interface RunSummary {
  readonly kind: "summary";
  readonly plugin: string;
  readonly widgets: number;
  /** the manifest's object kinds, each listed on its own row (DK-5) */
  readonly objects: number;
  readonly states: number;
  readonly passed: number;
  readonly skipped: number;
  readonly refused: number;
  readonly exit: 0 | 1;
}

export type Verdict = StateVerdict | ObjectVerdict | PluginVerdict | WidgetVerdict | RunSummary;

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
