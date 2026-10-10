// THE KIND-CONFORMANCE HARNESS (DK-7 — the playground v2's engine, and `check`'s declaration row;
// `@vibefield/plugin-sdk/testing`). Given an object row's code half (its `ObjectBinding`, the export its
// `binding.kind` names) and its durable half (the manifest row), with NO device and NO DOM:
//
//  (a) the DECLARATION, as the host reads it before it calls `defineObject` (build-widget.ts): a desk
//      kind (`isObjectKind`, in a stratum the ground draws) whose registry name IS the row's type, a
//      tray entry that says how it hangs (`hang`) under a category of at most 64 characters, and a row
//      that provides `desk.object` — the key the desk places by;
//  (b) its PROGRAM: `create` run on a recording device (kind-gpu.ts) — the kit pieces it names exist
//      (`kitWgsl` refuses one that does not), its WGSL arrives as text and READS (its entry points,
//      its bindings against the layout its pipeline is made with, its overrides), and its bind groups
//      fill their layouts;
//  (c) its DECLARED STATES driven — idle, selected, held, open (when the kind opens), contained (when
//      the row provides `desk.containable`) — at the zooms the desk's bands and its hang name, for each
//      of its playground fixtures (their props validated against the row's declared props first),
//      through `resolve` → `record` → `hit` (it must hit its own box) → `frame` (selected) / `chip`
//      (contained) / its opening (open), each record through its pass's `prepare` → `drawRange` into a
//      pass that checks the draw list; then `dispose`.
//
// Its report is `{ states, verdicts }` — `states` the count of states it drove. It makes no pixel: the
// WGSL is READ, never compiled, and every report of a kind with shaders says so in a NOTE. The still
// that would compile and draw it needs a host-less desk on a given device, which ICE's published
// entries do not expose (`createOracleDesk` builds on its unpublished mat) — VibeField's ask I30.

import { createWorld, isHeldGlyph } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  FIT,
  isObjectKind,
  kindPalette,
  lod,
  type ObjectContext,
  type ObjectKind,
  type Palette,
  rectFrame,
  STRATA,
  type ThemeName,
  themeFrom,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@vibecook/ice/desk";
import { DEFAULT_GRID, lampOf, MatUniforms } from "@vibecook/ice/desk/kit";
import type { JsonShape, ObjectContribution, PropSpec } from "@vibefield/contracts";
import { PLUGIN_LIMITS, TRAY_ACCESSORIES } from "@vibefield/contracts";
import { type GpuProblem, holdGpuConstants, type RecordingGpu, recordingGpu } from "./kind-gpu";

// --- the vocabulary -------------------------------------------------------------------------------

/** What happened to one row: `note` is neither — the honest answer where the harness cannot decide. */
export type KindVerdictStatus = "pass" | "note" | "refused";

/** Every refusal the harness can say — STABLE kebab-case classes an agent branches on. */
export type KindRefusalCode =
  // the declaration
  | "object-export-missing"
  | "object-kind-invalid"
  | "object-kind-misnamed"
  | "object-tray-hang-missing"
  | "object-tray-category-invalid"
  | "object-provides-no-desk-object"
  | "object-tool-invalid"
  | "object-tool-inert"
  // the program
  | "object-create-failed"
  | "object-kit-piece-unknown"
  | "object-wgsl-not-text"
  | "object-wgsl-unread"
  | "object-wgsl-binding-unlaid"
  | "object-bind-group-mismatch"
  | "object-dispose-failed"
  // a fixture, and the states driven from it
  | "state-invalid"
  | "state-spawn-failed"
  | "state-hit-missed"
  | "state-render-failed"
  | "state-draw-ill-formed";

/** The harness's honest absences: never a pass, never a refusal. */
export type KindNoteCode = "object-wgsl-not-compiled" | "object-create-not-run-here";

export interface KindVerdict {
  readonly status: KindVerdictStatus;
  readonly code: KindRefusalCode | KindNoteCode | "ok";
  /** what the row is about: `declaration`, `program`, a fixture by name, or `dispose` */
  readonly subject: string;
  /** the human line */
  readonly detail: string;
  /** a JSON pointer — into the manifest (the declaration) or the states file (a fixture) */
  readonly pointer?: string;
  /** the passing shape, stated concretely */
  readonly expected?: string;
}

/** A state a kind is put in. */
export type KindMode = "idle" | "selected" | "held" | "open" | "contained";

/** What the harness drives: every fixture in every mode at every zoom, and each once more at rest by night. */
export interface KindPlan {
  readonly fixtures: readonly string[];
  readonly modes: readonly KindMode[];
  readonly zooms: readonly number[];
  readonly states: number;
}

export interface KindReport {
  readonly type: string;
  /** the count of states the harness drove */
  readonly states: number;
  readonly plan: KindPlan;
  readonly verdicts: readonly KindVerdict[];
}

/** What each refusal means and what would have passed — the `expected` a verdict carries by default. */
export const KIND_EXPECTED: Readonly<Record<KindRefusalCode | KindNoteCode, string>> = {
  "object-export-missing":
    "export the binding under that name from the renderer module: `export const <name>: ObjectBinding = { kind }` (@vibefield/plugin-sdk/desk)",
  "object-kind-invalid":
    "type it `ObjectKind` from @vibefield/plugin-sdk/desk: name · stratum (pads, sheets or things) · create · resolve · record · hit · reach",
  "object-kind-misnamed": "name the kind exactly as the row's type — one id, no second namespace",
  "object-tray-hang-missing":
    "say how the specimen hangs: `tray.hang` with w and h (> 0, CSS px), an accessory (hook, shelf, clip, rail) and 1–8 pegs",
  "object-tray-category-invalid": `a tray category of 1–${PLUGIN_LIMITS.ID_MAX} characters — the pegboard's chip`,
  "object-provides-no-desk-object":
    "provide `desk.object` (DESK_OBJECT) — the desk places by what a row provides, never by its type",
  "object-tool-invalid":
    'each of `open.tools` a HeldToolDef as ICE defines it: an id unique within the tools, a label, `kind: "action"` with its op `run(api)` or `kind: "mode"`, and a glyph that is a name of the bar\'s set or `{ path }` (SVG path data in the bar\'s 24-unit box)',
  "object-tool-inert":
    'give the tool its kind — `kind: "action"` runs `run(api)` once when chosen, `kind: "mode"` makes it the active tool; a tool with no kind is DECLARED ONLY: the bar shows it dim and nothing ever runs it',
  "object-create-failed":
    "a create that resolves a KindPass (spawn · prepare · drawRange · dispose) from the device, format and mat it is handed",
  "object-kit-piece-unknown":
    "name only the kit's pieces in kitWgsl: view, portal, sdf, light (lamp, gobo, night, noise), ruler, book",
  "object-wgsl-not-text":
    "import the kind's .wgsl files (plugin-build inlines each as its text) and compose them with kitWgsl",
  "object-wgsl-unread":
    "name the entry points the WGSL declares (`@vertex fn vs`, `@fragment fn fs` by default) and override only what it declares (`override NAME`)",
  "object-wgsl-binding-unlaid":
    "carry every binding the WGSL uses in the pipeline's layout, at its @group/@binding, as the same kind of resource",
  "object-bind-group-mismatch":
    "fill every binding of the layout exactly once, each with the resource it asks for (a buffer made for that use, a texture view, a sampler)",
  "object-dispose-failed": "a dispose that lets go of what the pass made, and never throws",
  "state-invalid": "props the row declares, each of its declared kind",
  "state-spawn-failed":
    "a world half that lays every state out: resolve and record (and rung, frame, chip, the opening) answer without throwing, in finite numbers",
  "state-hit-missed":
    "a hit that answers a part (`content`) somewhere in the object's own box — what is picked is what is drawn",
  "state-render-failed":
    "a pass whose prepare answers how many of the records it was handed will draw (0 … n) and whose drawRange draws them, neither throwing",
  "state-draw-ill-formed":
    "set the pipeline your create made, and a bind group of its layout at every index, before each draw",
  "object-wgsl-not-compiled":
    "`vibefield-plugin try <dir>` compiles it: the app makes the kind on its device and draws it, and a WGSL error comes back as the compiler's own line (file:line:column) — a headless still of it is not in the kit yet",
  "object-create-not-run-here":
    "nothing to do here: the product makes the pass on a real device; this harness's ceiling is a recording one",
};

// --- (a) the declaration --------------------------------------------------------------------------

const KIND_MEMBERS: readonly (readonly [string, string])[] = [
  ["name", "string"],
  ["stratum", "string"],
  ["create", "function"],
  ["resolve", "function"],
  ["record", "function"],
  ["hit", "function"],
  ["reach", "number"],
];

const refused = (
  code: KindRefusalCode,
  subject: string,
  detail: string,
  extra: { readonly pointer?: string | undefined; readonly expected?: string | undefined } = {},
): KindVerdict => ({
  status: "refused",
  code,
  subject,
  detail,
  ...(extra.pointer !== undefined ? { pointer: extra.pointer } : {}),
  expected: extra.expected ?? KIND_EXPECTED[code],
});

const noted = (code: KindNoteCode, subject: string, detail: string): KindVerdict => ({
  status: "note",
  code,
  subject,
  detail,
  expected: KIND_EXPECTED[code],
});

const passed = (subject: string, detail: string): KindVerdict => ({
  status: "pass",
  code: "ok",
  subject,
  detail,
});

function hangProblem(hang: unknown): string | undefined {
  if (typeof hang !== "object" || hang === null) return "has no hang";
  const h = hang as Record<string, unknown>;
  const size = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!size(h.w) || !size(h.h)) return `hangs ${String(h.w)} × ${String(h.h)} — not a size`;
  if (!(TRAY_ACCESSORIES as readonly unknown[]).includes(h.accessory))
    return `hangs by "${String(h.accessory)}", no accessory the pegboard has`;
  const pegs = h.pegs;
  if (!Array.isArray(pegs) || pegs.length < 1 || pegs.length > 8) return "hangs on no pegs (1–8)";
  for (const peg of pegs)
    if (!Array.isArray(peg) || peg.length !== 2 || !peg.every((n) => Number.isFinite(n)))
      return "hangs on a peg that is not a pair of numbers";
  return undefined;
}

/**
 * The held bar's tools (`open.tools`, ICE's `HeldToolDef`) as ICE takes them at definition — an id unique within the
 * tools, a label, a known kind, an action with its op, a glyph it can draw — and the one mistake ICE takes SILENTLY
 * (DK-10): a tool with an op but no `kind` is DECLARED ONLY, shown dim and never run. The ten-minute bar's third agent
 * wrote exactly that Roll tool — the docs said "an action or a mode" and never named the field — and nothing caught it.
 */
function toolProblems(kind: ObjectKind, type: string, at: string): KindVerdict[] {
  const tools = (kind.open as { readonly tools?: unknown } | undefined)?.tools;
  if (tools === undefined) return [];
  const subject = "declaration";
  const pointer = `${at}/binding/kind`;
  if (!Array.isArray(tools))
    return [
      refused("object-tool-invalid", subject, `${type}'s open.tools is not a list`, { pointer }),
    ];
  const out: KindVerdict[] = [];
  const ids = new Set<string>();
  tools.forEach((tool: unknown, index: number) => {
    const t = (typeof tool === "object" && tool !== null ? tool : {}) as Record<string, unknown>;
    const id = typeof t["id"] === "string" ? t["id"] : "";
    const which = `${type}'s tool ${index} ("${id || "no id"}")`;
    const invalid = (why: string): void => {
      out.push(refused("object-tool-invalid", subject, `${which} ${why}`, { pointer }));
    };
    if (id.length === 0) invalid("has no id");
    else if (ids.has(id)) invalid("has an id another of its tools has");
    ids.add(id);
    if (typeof t["label"] !== "string" || t["label"].length === 0) invalid("has no label");
    const toolKind = t["kind"];
    if (toolKind === undefined) {
      if (typeof t["run"] === "function")
        out.push(
          refused(
            "object-tool-inert",
            subject,
            `${which} has an op (run) but no kind — ICE takes a tool with no kind as DECLARED ONLY: the bar shows it dim and never runs it`,
            {
              pointer,
              expected: `give it \`kind: "action"\` (an op run once) or \`kind: "mode"\``,
            },
          ),
        );
    } else if (toolKind !== "action" && toolKind !== "mode")
      invalid(`has kind "${String(toolKind)}" — a tool is an "action" or a "mode"`);
    else if (toolKind === "action" && typeof t["run"] !== "function")
      invalid("is an action with no op — give it run(api)");
    if (t["glyph"] !== undefined && !isHeldGlyph(t["glyph"]))
      invalid("has a glyph that is neither a name of the bar's set nor { path } with path data");
  });
  return out;
}

/** The kind a binding holds when it is a desk kind, else undefined. */
export function kindOfBinding(binding: unknown): ObjectKind | undefined {
  if (typeof binding !== "object" || binding === null) return undefined;
  const kind = (binding as { readonly kind?: unknown }).kind;
  return isObjectKind(kind) && (STRATA as readonly string[]).includes(kind.stratum)
    ? kind
    : undefined;
}

/**
 * (a) The declaration, as the host reads it before it calls `defineObject` — the row `check`'s activation
 * runs (the plan's DK-6 input (e)) and the first the playground says of every kind. `at` is the row's JSON
 * pointer in the manifest (`/contributes/objects/0`), so each verdict points into it.
 */
export function checkKindDeclaration(
  binding: unknown,
  row: ObjectContribution,
  at = "",
): KindVerdict[] {
  const subject = "declaration";
  const name = row.binding.kind;
  if (typeof binding !== "object" || binding === null || !("kind" in binding))
    return [
      refused(
        "object-export-missing",
        subject,
        binding === undefined
          ? `the renderer module exports no \`${name}\` for ${row.type}`
          : `\`${name}\` holds no ObjectBinding for ${row.type} — an object with a \`kind\``,
        { pointer: `${at}/binding/kind` },
      ),
    ];
  const kind = (binding as { readonly kind: unknown }).kind;
  if (!isObjectKind(kind)) {
    const k = (typeof kind === "object" && kind !== null ? kind : {}) as Record<string, unknown>;
    const missing = KIND_MEMBERS.filter(([member, type]) => typeof k[member] !== type).map(
      ([member]) => member,
    );
    return [
      refused(
        "object-kind-invalid",
        subject,
        `\`${name}\`.kind holds no desk kind for ${row.type} (ICE isObjectKind — missing or mistyped: ${missing.join(", ") || "its members"})`,
        { pointer: `${at}/binding/kind` },
      ),
    ];
  }
  if (!(STRATA as readonly string[]).includes(kind.stratum))
    return [
      refused(
        "object-kind-invalid",
        subject,
        `\`${name}\`.kind lies in no stratum the ground draws ("${kind.stratum}"; ${STRATA.join(", ")})`,
        { pointer: `${at}/binding/kind` },
      ),
    ];
  const out: KindVerdict[] = [];
  if (kind.name !== row.type)
    out.push(
      refused(
        "object-kind-misnamed",
        subject,
        `${row.type}'s kind is named "${kind.name}" — a kind's registry name IS its type`,
        { pointer: `${at}/binding/kind`, expected: `name the kind "${row.type}"` },
      ),
    );
  const tray = row.tray as { readonly category?: unknown; readonly hang?: unknown } | undefined;
  if (tray !== undefined) {
    const problem = hangProblem(tray.hang);
    if (problem !== undefined)
      out.push(
        refused("object-tray-hang-missing", subject, `${row.type}'s tray entry ${problem}`, {
          pointer: `${at}/tray/hang`,
        }),
      );
    const category = tray.category;
    if (
      typeof category !== "string" ||
      category.length < 1 ||
      category.length > PLUGIN_LIMITS.ID_MAX
    )
      out.push(
        refused(
          "object-tray-category-invalid",
          subject,
          `${row.type}'s tray category is ${typeof category === "string" ? `${category.length} characters` : String(category)}`,
          { pointer: `${at}/tray/category` },
        ),
      );
  }
  const provides = row.provides ?? [];
  if (!provides.includes(DESK_OBJECT))
    out.push(
      refused(
        "object-provides-no-desk-object",
        subject,
        `${row.type} provides ${provides.length === 0 ? "nothing" : provides.join(" + ")} — the desk places only what provides ${DESK_OBJECT}`,
        { pointer: `${at}/provides` },
      ),
    );
  out.push(...toolProblems(kind, row.type, at));
  if (out.length > 0) return out;
  const hang = row.tray?.hang;
  const hangs =
    row.tray === undefined || hang === undefined
      ? "hangs nowhere (no tray entry)"
      : `hangs on "${row.tray.category}" by a ${hang.accessory} (${hang.w} × ${hang.h})`;
  return [
    passed(
      subject,
      `\`${name}\` is a desk kind named by its type, lying in the ${kind.stratum}; ${hangs}; provides ${provides.join(" + ")}`,
    ),
  ];
}

// --- the fixtures' props --------------------------------------------------------------------------

/** RFC 6901 escaping, so a pointer stays a pointer for whatever parses it. */
const pointerOf = (...segments: readonly string[]): string =>
  segments.map((s) => `/${s.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A fixture's props refused against the declared schema. */
export interface PropRefusal {
  readonly code: "state-invalid";
  readonly detail: string;
  readonly pointer: string;
  readonly expected: string;
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

/** `p.json` inner-shape validation (contracts JsonShape, mirrored from ICE's props.ts): the failing sub-path, or null. */
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

function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (v === null) return "null";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "object") return "an object";
  return String(v);
}

function checkProp(
  spec: PropSpec,
  value: unknown,
  at: string,
  path: readonly string[],
): PropRefusal | null {
  const bad = (expected: string, sub: readonly string[] = path): PropRefusal => ({
    code: "state-invalid",
    detail: `${at}: ${describeValue(value)} is not ${expected}`,
    pointer: pointerOf(...sub),
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
      return {
        code: "state-invalid",
        detail: `${[at, ...sub].join(".")}: does not match the declared json shape`,
        pointer: pointerOf(...path, ...sub),
        expected: describeShape(spec.inner),
      };
    }
    default:
      // entity/session/terminal/artifact/file refs have no engine constructor, so no fixture can
      // supply one. Naming the kind beats letting a later step fail on it.
      return {
        code: "state-invalid",
        detail: `${at}: prop kind ${spec.kind} cannot be set by a fixture`,
        pointer: pointerOf(...path),
        expected: "a prop of kind string | number | boolean | enum | json",
      };
  }
}

/**
 * One fixture's props against a row's DECLARED prop schema (a widget's or an object's — they declare
 * props alike), before anything draws it. Unknown names refuse too: the engine drops them silently, so
 * a typo'd fixture would otherwise draw the defaults and pass. The playground's widget states and the
 * harness's object fixtures are judged by this one function.
 */
export function validateStateProps(
  decl: { readonly type: string; readonly props: Readonly<Record<string, PropSpec>> },
  stateName: string,
  values: Readonly<Record<string, unknown>>,
): PropRefusal | null {
  const declaredNames = Object.keys(decl.props);
  for (const [name, value] of Object.entries(values)) {
    const path = [decl.type, stateName, name];
    const spec = decl.props[name];
    if (spec === undefined)
      return {
        code: "state-invalid",
        detail: `${decl.type}/${stateName}: ${name} is not a declared prop of ${decl.type}`,
        pointer: pointerOf(...path),
        expected:
          declaredNames.length > 0
            ? `one of ${declaredNames.join(", ")}`
            : `${decl.type} declares no props`,
      };
    const bad = checkProp(spec, value, `${decl.type}/${stateName}/${name}`, path);
    if (bad !== null) return bad;
  }
  return null;
}

/** The props a new object has: each declared prop's default, stated explicitly. */
export function defaultProps(decl: {
  readonly props: Readonly<Record<string, PropSpec>>;
}): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(decl.props))
    if ("default" in spec && spec.default !== undefined) props[name] = spec.default;
  return props;
}

// --- (c) the plan ---------------------------------------------------------------------------------

/**
 * The zooms every kind is driven at — the ones the desk's own LOD names (ICE `lod`, its decade
 * lattice: the mat picks one band per decade of zoom, `k0`): the middle of every band between the
 * desk's scale-free ends, the ends themselves (`ZOOM_MIN`, `ZOOM_MAX` — a record must stay finite at
 * both), and the arrival band's two ends (`FIT`: where the desk lands a board, ½ … 1). A row's hang
 * adds the zoom its specimen is drawn at on the pegboard (`hangZoom`).
 */
export const DESK_ZOOMS: readonly number[] = deskZooms();

function deskZooms(): number[] {
  const zooms = new Set<number>([ZOOM_MIN, ZOOM_MAX, FIT.minZoom, FIT.maxZoom]);
  const bands = new Set<number>();
  for (let d = Math.floor(Math.log10(ZOOM_MIN)); d <= Math.ceil(Math.log10(ZOOM_MAX)); d += 1) {
    const zoom = 10 ** (d + 0.5);
    if (zoom < ZOOM_MIN || zoom > ZOOM_MAX) continue;
    const band = lod({ camX: 0, camY: 0, zoom, width: 1, height: 1 }).k0;
    if (bands.has(band)) continue;
    bands.add(band);
    zooms.add(zoom);
  }
  return [...zooms].sort((a, b) => a - b);
}

/** The zoom a pegboard specimen is drawn at: its hang fitted to its size (ICE kernel `specimenFit`). */
export function hangZoom(row: ObjectContribution): number | undefined {
  const hang = row.tray?.hang;
  if (hang === undefined || !(row.size.w > 0) || !(row.size.h > 0)) return undefined;
  const zoom = Math.min(hang.w / row.size.w, hang.h / row.size.h);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : undefined;
}

/** What the harness drives for a row: `opens` — does its kind open (`kind.open`) — and its fixtures' names. */
export function kindPlan(
  row: ObjectContribution,
  opts: { readonly opens: boolean; readonly fixtures: readonly string[] },
): KindPlan {
  const modes: KindMode[] = ["idle", "selected", "held"];
  if (opts.opens) modes.push("open");
  if ((row.provides ?? []).includes(CONTAINABLE)) modes.push("contained");
  const hang = hangZoom(row);
  const zooms = [...new Set([...DESK_ZOOMS, ...(hang === undefined ? [] : [hang])])].sort(
    (a, b) => a - b,
  );
  const fixtures = [...opts.fixtures];
  return { fixtures, modes, zooms, states: fixtures.length * (modes.length * zooms.length + 1) };
}

// --- (b) + (c) the run ----------------------------------------------------------------------------

export interface KindConformanceInput {
  /** the export the row's `binding.kind` names — unknown, so a broken one is judged rather than type-refused */
  readonly binding: unknown;
  /** the manifest row — the object's durable half */
  readonly row: ObjectContribution;
  /** the row's JSON pointer in the manifest, for the declaration's verdicts (`/contributes/objects/0`) */
  readonly at?: string | undefined;
  /** its playground fixtures (`playground/states.ts`'s entry for its type); absent: one `default` from the declared defaults */
  readonly states?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  /** drive only this fixture (the playground's `--state <type>:<name>`) */
  readonly only?: string | undefined;
  /** the palette a kind's `theme` is handed, per theme; absent: the desk's roles from VibeField's tokens */
  readonly palette?: Partial<Record<ThemeName, Palette>> | undefined;
  /** how long its `create` may run on the recording device before its states are driven without it (2000 ms) */
  readonly createBudgetMs?: number | undefined;
}

/** The desk's palette roles (DESIGN.md §2 — `--vf-canvas-bg`, `--vf-select`), as ICE's own palette names them. */
const DESK_PALETTE: Readonly<Record<ThemeName, Palette>> = {
  light: {
    canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" },
    select: { token: "--vf-select", css: "#4a90d9" },
  },
  dark: {
    canvasBg: { token: "--vf-canvas-bg", css: "#171717" },
    select: { token: "--vf-select", css: "#4a90d9" },
  },
};

/** The view a state is drawn under: a 1200 × 800 attachment at dpr 2, the object at its centre. */
const VIEW = { width: 1200, height: 800, dpr: 2 } as const;
/** How much smaller a mini mat's inside draws its objects than the desk around it (contained). */
const INSIDE = 0.25;
/** How long a create may run on the recording device before the harness stops waiting on it. */
const CREATE_BUDGET_MS = 2000;
/** The swap chain's format a pass is made for. */
const FORMAT = "bgra8unorm";
/** How many of the box's points `hit` is asked at: its centre and a grid across it. */
const HIT_GRID = 5;

const FLUX: Readonly<Record<KindMode, ObjectContext["flux"]>> = {
  idle: { lift: 0, hover: 0, ring: 0, fade: 1 },
  // the selection is the desk's marks around the kind's frame (the kinds' own ring is retired)
  selected: { lift: 0, hover: 1, ring: 0, fade: 1 },
  // lifted off the desk by the hand that drags it
  held: { lift: 1, hover: 1, ring: 0, fade: 1 },
  open: { lift: 0, hover: 0, ring: 0, fade: 1 },
  contained: { lift: 0, hover: 0, ring: 0, fade: 1 },
};

const zoomText = (z: number): string =>
  z >= 1e4 || z < 1e-3 ? z.toExponential(0) : String(Number(z.toFixed(3)));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const finite = (...values: readonly unknown[]): boolean =>
  values.every((v) => typeof v === "number" && Number.isFinite(v));

/** A shape answer well-formed: every named member a finite number, its half extents positive. */
function shapeProblem(shape: unknown, members: readonly string[]): string | undefined {
  if (typeof shape !== "object" || shape === null) return `${String(shape)}`;
  const s = shape as Record<string, unknown>;
  const bad = members.filter((m) => !finite(s[m]));
  if (bad.length > 0) return `${bad.map((m) => `${m} ${String(s[m])}`).join(", ")}`;
  if ("hx" in s && !((s.hx as number) > 0 && (s.hy as number) > 0))
    return `half extents ${String(s.hx)} × ${String(s.hy)}`;
  if ("w" in s && !((s.w as number) > 0 && (s.h as number) > 0))
    return `size ${String(s.w)} × ${String(s.h)}`;
  return undefined;
}

function chipProblem(chip: unknown): string | undefined {
  if (chip === null) return undefined; // nothing to chip: legal
  const base = shapeProblem(chip, ["cx", "cy", "hx", "hy", "angle", "radius", "height"]);
  if (base !== undefined) return base;
  const c = chip as { readonly finish?: unknown; readonly colour?: unknown };
  const finishes = Array.isArray(c.finish) ? c.finish : [c.finish];
  if (finishes.length === 0 || !finishes.every((f) => typeof f === "string" && f.length > 0))
    return `finish ${JSON.stringify(c.finish)} — a finish the kit names ("paper", "vinyl") or its container's`;
  if (!Array.isArray(c.colour) || c.colour.length !== 3 || !finite(...c.colour))
    return `colour ${JSON.stringify(c.colour)} — an RGB triple`;
  return undefined;
}

interface KindPassLike {
  spawn(mat: unknown): KindPassLike;
  prepare(encoder: unknown, slot: unknown, records: readonly unknown[], extra?: unknown): unknown;
  drawRange(pass: unknown, first: number, end: number): void;
  dispose(): void;
}

const isPass = (value: unknown): value is KindPassLike => {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return ["spawn", "prepare", "drawRange", "dispose"].every((m) => typeof p[m] === "function");
};

/** A mat as a pass binds it, made on the recording device: the slot's view block, its silhouette, the noise, the glyphs. */
function stubMat(device: unknown): unknown {
  const d = device as {
    createBuffer(desc: unknown): unknown;
    createTexture(desc: unknown): { createView(desc?: unknown): unknown };
  };
  const tex = (label: string) =>
    d.createTexture({ label, size: [1, 1, 1], format: "r8unorm", usage: 4 | 2 });
  return {
    view: d.createBuffer({
      label: "harness/mat view block",
      size: MatUniforms.size,
      usage: 64 | 8,
    }),
    silhouette: tex("harness/mat silhouette").createView(),
    noiseTexture: tex("harness/mat noise"),
    glyphTexture: tex("harness/mat glyphs"),
    glyphs: {
      scale: 1,
      cellW: 1,
      cellH: 1,
      advance: 1,
      baseline: 1,
      cap: 1,
      width: 1,
      height: 1,
      count: 0,
    },
    assetVersion: 0,
  };
}

/** A gpu problem as the harness says it. */
const CODE_OF: Readonly<Record<GpuProblem["code"], KindRefusalCode>> = {
  "wgsl-not-text": "object-wgsl-not-text",
  "wgsl-unread": "object-wgsl-unread",
  "binding-unlaid": "object-wgsl-binding-unlaid",
  "bind-group-mismatch": "object-bind-group-mismatch",
  "draw-ill-formed": "state-draw-ill-formed",
};

/** A pass made on the recording device, and what its making said. */
interface Made {
  readonly pass: KindPassLike | undefined;
  /** the pass, when nothing a device would refuse was asked while it was made — the one states draw through */
  readonly drawable: KindPassLike | undefined;
  readonly verdicts: KindVerdict[];
}

/** (b) The program: `create` on the recording device, its WGSL read, its layouts and groups held to it. */
async function makePass(kind: ObjectKind, gpu: RecordingGpu, budgetMs: number): Promise<Made> {
  const verdicts: KindVerdict[] = [];
  let pass: KindPassLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = new Promise<"budget">((resolve) => {
      timer = setTimeout(() => resolve("budget"), budgetMs);
    });
    const made = await Promise.race([
      Promise.resolve().then(() =>
        kind.create(gpu.device as never, FORMAT as never, stubMat(gpu.device) as never),
      ),
      budget,
    ]);
    if (made === "budget")
      verdicts.push(
        noted(
          "object-create-not-run-here",
          "program",
          `its create did not finish within ${budgetMs} ms on a recording device (no GPU here) — its states are driven without its pass`,
        ),
      );
    else if (!isPass(made))
      verdicts.push(
        refused(
          "object-create-failed",
          "program",
          "its create resolved no pass (a KindPass: spawn · prepare · drawRange · dispose)",
        ),
      );
    else pass = made;
  } catch (error) {
    const message = messageOf(error);
    const piece = /kitWgsl: no piece "([^"]+)"/.exec(message);
    verdicts.push(
      piece !== null
        ? refused(
            "object-kit-piece-unknown",
            "program",
            `its program names the kit piece "${piece[1]}", which the kit does not carry — ${message}`,
          )
        : error instanceof ReferenceError
          ? // a name this environment does not define (a browser global in Node — `OffscreenCanvas`,
            // `document`): the harness's ceiling, not the kind's fault — the product's renderer has it
            noted(
              "object-create-not-run-here",
              "program",
              `its create reached for what this environment does not define (${message}) — its states are driven without its pass`,
            )
          : refused(
              "object-create-failed",
              "program",
              `its create threw on a recording device that answers every call as WebGPU would, short of compiling: ${message}`,
            ),
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const problems = gpu.take();
  for (const p of problems) verdicts.push(refused(CODE_OF[p.code], "program", p.detail));
  if (pass !== undefined && problems.length === 0) {
    if (gpu.modules.length === 0)
      verdicts.push(
        passed(
          "program",
          "its create made a pass that compiles no shader — a kind that draws nothing",
        ),
      );
    else {
      const reads = gpu.modules.flatMap((m) => (m.read === undefined ? [] : [m.read]));
      const entries = [
        ...new Set(reads.flatMap((r) => r.entryPoints.map((e) => `${e.stage} ${e.name}`))),
      ];
      const characters = gpu.modules.reduce(
        (n, m) => n + (typeof m.code === "string" ? m.code.length : 0),
        0,
      );
      const made = gpu.made();
      verdicts.push(
        passed(
          "program",
          `its WGSL arrived as text and reads: ${characters} characters, ${entries.join(" + ")}; ${made.pipelines} pipeline(s) whose stages statically use ${made.bindings} binding(s), each laid in its layout; ${made.groups} bind group(s) filling their layouts`,
        ),
      );
    }
  }
  if (gpu.modules.length > 0)
    verdicts.push(
      noted(
        "object-wgsl-not-compiled",
        "program",
        "its WGSL was READ — its entry points, bindings and overrides — never compiled: an unresolved name or a type error passes here. `vibefield-plugin try <dir>` compiles and draws it on the host's device",
      ),
    );
  return { pass, drawable: problems.length === 0 ? pass : undefined, verdicts };
}

/**
 * (b) alone — the program row `check`'s activation runs beside the declaration: the binding's kind made
 * on a recording device, its WGSL read, then let go. Empty for a binding that holds no desk kind (the
 * declaration says why).
 */
export async function checkKindProgram(
  binding: unknown,
  opts: { readonly createBudgetMs?: number | undefined } = {},
): Promise<KindVerdict[]> {
  const kind = kindOfBinding(binding);
  if (kind === undefined) return [];
  const release = holdGpuConstants();
  try {
    const made = await makePass(kind, recordingGpu(), opts.createBudgetMs ?? CREATE_BUDGET_MS);
    try {
      made.pass?.dispose();
    } catch (error) {
      made.verdicts.push(
        refused(
          "object-dispose-failed",
          "dispose",
          `its pass's dispose threw: ${messageOf(error)}`,
        ),
      );
    }
    return made.verdicts;
  } finally {
    release();
  }
}

/**
 * Run the harness over one object row (the module doc): its declaration, its program, its declared
 * states, its dispose. Never throws for the kind's faults — each is a verdict.
 */
export async function runKindConformance(input: KindConformanceInput): Promise<KindReport> {
  const { row } = input;
  const verdicts: KindVerdict[] = checkKindDeclaration(input.binding, row, input.at ?? "");
  const kind = kindOfBinding(input.binding);
  if (kind === undefined)
    return {
      type: row.type,
      states: 0,
      plan: { fixtures: [], modes: [], zooms: [], states: 0 },
      verdicts,
    };

  // the fixtures: each validated against the declared props before anything draws it
  const fixtures: [string, Record<string, unknown>][] = [];
  for (const [name, props] of Object.entries(input.states ?? { default: {} })) {
    if (input.only !== undefined && input.only !== name) continue;
    const bad = validateStateProps({ type: row.type, props: row.props }, name, props);
    if (bad !== null)
      verdicts.push(
        refused(bad.code, name, bad.detail, { pointer: bad.pointer, expected: bad.expected }),
      );
    else fixtures.push([name, { ...defaultProps(row), ...props }]);
  }
  const plan = kindPlan(row, {
    opens: kind.open !== undefined,
    fixtures: fixtures.map(([n]) => n),
  });

  const release = holdGpuConstants();
  try {
    const gpu = recordingGpu();
    const made = await makePass(kind, gpu, input.createBudgetMs ?? CREATE_BUDGET_MS);
    verdicts.push(...made.verdicts);
    const desk = deskFor(kind, made.drawable, input.palette);
    for (const [index, [fixture, props]] of fixtures.entries())
      verdicts.push(...driveFixture(kind, desk, gpu, plan, row.size, fixture, props, index + 1));

    // dispose — the inside's pass, the pass, and the kind's state on the desk
    const disposals: string[] = [];
    for (const [what, p] of [
      ["its inside's pass", desk.inside()],
      ["its pass", made.pass],
    ] as const) {
      try {
        p?.dispose();
      } catch (error) {
        disposals.push(`${what}'s dispose threw: ${messageOf(error)}`);
      }
    }
    const local = desk.local as { forget?: (e: unknown) => void; dispose?: () => void } | undefined;
    try {
      for (const [index] of fixtures.entries()) local?.forget?.(index + 1);
      local?.dispose?.();
    } catch (error) {
      disposals.push(`its local's forget/dispose threw: ${messageOf(error)}`);
    }
    for (const d of disposals) verdicts.push(refused("object-dispose-failed", "dispose", d));
    return { type: row.type, states: plan.states, plan, verdicts };
  } finally {
    release();
  }
}

/** What one run keeps across a kind's fixtures, as one desk keeps it: the looks, the kind's state, a mini mat's inside. */
interface Desk {
  readonly drawable: KindPassLike | undefined;
  readonly palette: Readonly<Record<ThemeName, Palette>>;
  readonly local: unknown;
  readonly localError: string | undefined;
  look(theme: ThemeName): { readonly look?: unknown; readonly error?: string };
  /** the pass a mini mat's inside draws through — the drawable's `spawn`, made the first time it is asked */
  inside(): KindPassLike | undefined;
  insideFor(gpu: RecordingGpu): KindPassLike | string;
  world(): unknown;
}

function deskFor(
  kind: ObjectKind,
  drawable: KindPassLike | undefined,
  palette: Partial<Record<ThemeName, Palette>> | undefined,
): Desk {
  const themes = { ...DESK_PALETTE, ...(palette ?? {}) };
  const looks = new Map<ThemeName, { look?: unknown; error?: string }>();
  let local: unknown;
  let localError: string | undefined;
  try {
    local = kind.local?.({ pass: () => drawable } as never);
  } catch (error) {
    localError = `its local(host) threw: ${messageOf(error)}`;
  }
  let inside: KindPassLike | undefined;
  let insideError: string | undefined;
  let world: unknown;
  return {
    drawable,
    palette: themes,
    local,
    localError,
    look(theme) {
      let had = looks.get(theme);
      if (had === undefined) {
        try {
          had = { look: kind.theme?.(kindPalette(themes[theme]), theme) };
        } catch (error) {
          had = { error: `its theme(palette, "${theme}") threw: ${messageOf(error)}` };
        }
        looks.set(theme, had);
      }
      return had;
    },
    inside: () => inside,
    insideFor(gpu) {
      if (inside === undefined && insideError === undefined && drawable !== undefined) {
        try {
          const spawned = drawable.spawn(stubMat(gpu.device));
          if (isPass(spawned)) inside = spawned;
          else insideError = "its spawn(mat) — a mini mat's inside — answered no pass";
        } catch (error) {
          insideError = `its spawn(mat) — a mini mat's inside — threw: ${messageOf(error)}`;
        }
      }
      return inside ?? insideError ?? "no pass to spawn from";
    },
    world() {
      world ??= createWorld();
      return world;
    },
  };
}

/** (c) One fixture driven through every planned state; its refusals said once per code, at the first state, with how many. */
function driveFixture(
  kind: ObjectKind,
  desk: Desk,
  gpu: RecordingGpu,
  plan: KindPlan,
  size: { readonly w: number; readonly h: number },
  fixture: string,
  props: Readonly<Record<string, unknown>>,
  entity: number,
): KindVerdict[] {
  const seen = new Map<
    KindRefusalCode,
    { readonly at: string; readonly detail: string; count: number }
  >();
  const fail = (code: KindRefusalCode, at: string, detail: string): void => {
    const had = seen.get(code);
    if (had !== undefined) had.count += 1;
    else seen.set(code, { at, detail, count: 1 });
  };
  const states: [KindMode, number, ThemeName][] = [];
  for (const mode of plan.modes) for (const zoom of plan.zooms) states.push([mode, zoom, "light"]);
  states.push(["idle", 1, "dark"]);
  for (const [mode, zoom, theme] of states) {
    const at = `${fixture}/${mode}@${zoomText(zoom)}${theme === "dark" ? " by night" : ""}`;
    const look = desk.look(theme);
    const unmade = look.error ?? desk.localError;
    if (unmade !== undefined) {
      fail("state-spawn-failed", at, unmade);
      continue;
    }
    const groundTheme = themeFrom(theme, desk.palette[theme]);
    const z = mode === "contained" ? zoom * INSIDE : zoom;
    const view = { camX: -VIEW.width / (2 * z), camY: -VIEW.height / (2 * z), zoom: z, ...VIEW };
    const grid =
      mode === "open"
        ? {
            ...DEFAULT_GRID,
            mat: { ...DEFAULT_GRID.mat, gobo: { ...DEFAULT_GRID.mat.gobo, opacity: 0 } },
          }
        : DEFAULT_GRID;
    const rect = { cx: 0, cy: 0, w: size.w, h: size.h };
    const local = desk.local;
    const ctx = {
      entity,
      rect,
      props,
      flux: FLUX[mode],
      look: look.look,
      theme: groundTheme,
      lamp: lampOf(grid.mat.plane),
      view,
      grid,
      dt: 0,
      ...(local !== undefined ? { local } : {}),
      ...(mode === "open" ? { held: { e: 1, open: true, grow: 1, snap: true } } : {}),
    } as unknown as ObjectContext;

    // the world half
    let call = "resolve";
    let geometry: unknown;
    let record: unknown;
    try {
      geometry = kind.resolve(ctx);
      call = "record";
      record = kind.record(geometry, ctx);
      if (kind.rung !== undefined) {
        call = "rung";
        const rung = kind.rung({
          entity,
          rect,
          props,
          zoom: z,
          dpr: VIEW.dpr,
          local,
          px: 0,
        } as never);
        if (!finite(rung)) throw new Error(`answered ${String(rung)}, not a rung`);
      }
      if (mode === "selected") {
        call = "frame";
        const bad = shapeProblem(
          kind.frame !== undefined ? kind.frame(geometry) : rectFrame(rect),
          ["cx", "cy", "hx", "hy", "angle", "r"],
        );
        if (bad !== undefined) throw new Error(`answered ${bad} — the marks go round it`);
      }
      if (mode === "contained" && kind.chip !== undefined) {
        call = "chip";
        const bad = chipProblem(kind.chip(geometry, ctx));
        if (bad !== undefined) throw new Error(`answered ${bad}`);
      }
      if (mode === "open" && kind.open !== undefined) {
        const opening = kind.open;
        call = "open.extent";
        const bad = shapeProblem(opening.extent({ rect, props }), ["cx", "cy", "w", "h"]);
        if (bad !== undefined) throw new Error(`answered ${bad}`);
        if (opening.openness !== undefined) {
          call = "open.openness";
          const o = opening.openness({ entity, local } as never);
          if (!finite(o)) throw new Error(`answered ${String(o)}`);
        }
        if (typeof opening.readout === "function") {
          call = "open.readout";
          const word = opening.readout({
            world: desk.world(),
            entity,
            props: () => props,
            local,
          } as never);
          if (word !== undefined && typeof word !== "string")
            throw new Error(`answered ${String(word)}, not a word`);
        }
      }
    } catch (error) {
      fail("state-spawn-failed", at, `its ${call} threw: ${messageOf(error)}`);
      continue;
    }
    if (mode !== "open") {
      const missed = hitsItsBox(kind, geometry, rect);
      if (missed !== undefined) fail("state-hit-missed", at, missed);
    }

    // the record through its pass, into a pass that checks the draw list
    if (desk.drawable === undefined) continue;
    const target = mode === "contained" ? desk.insideFor(gpu) : desk.drawable;
    if (typeof target === "string") {
      fail("state-render-failed", at, target);
      continue;
    }
    const slot = {
      view,
      fadeIn: grid.fadeIn,
      cfg: grid.mat,
      frame: undefined,
      present: undefined,
      light: groundTheme.matLight,
      lit: undefined,
      select: groundTheme.select,
      theme: groundTheme,
      target: mode === "open" ? "hand" : "frame",
    };
    try {
      call = "prepare";
      const count = target.prepare(gpu.encoder(), slot, [record], {
        live: () => -1,
        keys: [entity],
      });
      if (!(Number.isInteger(count) && (count as number) >= 0 && (count as number) <= 1))
        throw new Error(`answered ${String(count)} for one record`);
      call = "drawRange";
      target.drawRange(gpu.pass(), 0, count as number);
    } catch (error) {
      fail("state-render-failed", at, `its ${call} threw: ${messageOf(error)}`);
    }
    for (const p of gpu.take()) fail(CODE_OF[p.code], at, p.detail);
  }
  const out: KindVerdict[] = [];
  for (const [code, s] of seen)
    out.push(
      refused(
        code,
        fixture,
        `${s.at}: ${s.detail}${s.count > 1 ? ` (and at ${s.count - 1} more of its ${states.length} states)` : ""}`,
      ),
    );
  if (out.length > 0) return out;
  const calls = [
    "resolve",
    "record",
    "hit",
    "frame",
    ...(plan.modes.includes("contained") && kind.chip !== undefined ? ["chip"] : []),
    ...(plan.modes.includes("open") ? ["the opening"] : []),
    ...(desk.drawable !== undefined ? ["prepare", "drawRange"] : []),
  ];
  return [
    passed(
      fixture,
      `${states.length} states (${plan.modes.join(", ")} × ${plan.zooms.length} zooms, and at rest by night) through ${calls.join(" · ")}`,
    ),
  ];
}

/** Undefined when `hit` picks the object somewhere in its own box; else what went wrong. */
function hitsItsBox(
  kind: ObjectKind,
  geometry: unknown,
  rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number },
): string | undefined {
  const points: [number, number][] = [[rect.cx, rect.cy]];
  for (let i = 0; i < HIT_GRID; i += 1)
    for (let j = 0; j < HIT_GRID; j += 1)
      points.push([
        rect.cx + rect.w * ((i + 0.5) / HIT_GRID - 0.5),
        rect.cy + rect.h * ((j + 0.5) / HIT_GRID - 0.5),
      ]);
  for (const [x, y] of points) {
    let answer: unknown;
    try {
      answer = kind.hit(geometry, x, y);
    } catch (error) {
      return `its hit threw: ${messageOf(error)}`;
    }
    if (answer === null || answer === undefined) continue;
    if (typeof answer !== "string")
      return `its hit answered ${String(answer)} — a part's name, or null`;
    return undefined;
  }
  return `its hit missed every one of ${points.length} points across its own ${rect.w} × ${rect.h} box`;
}
