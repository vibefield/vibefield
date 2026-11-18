import { z } from "zod";
import { Sha256Hex } from "./artifacts";

// EY-0 — the pages room's record (track EY; `draft/tool-plane/EY-0-PLAN.md` §2.2, §2.6, §2.7).
// The pages room lets an agent use a browser page on the desk. Main's broker runs the pages
// engine, a pinned browser engine, for it. This module holds the room's words and the shapes of
// two records: the script set recorded from the pin, and the record of the pin itself.
//
// Unserved and unwired until EY-1 (main: the broker, the bridge) and EY-2 (fieldd: the room).
// The data is `pages-record.ts`, written by the lab's converter and never by hand. Only that data
// names the engine's package. TS-only, like tools.ts: field-native reads none of it.

// ── the room's words ──

/** The service a pages UNAVAILABLE names in its details. */
export const PAGES_SERVICE = "pages";

/** The states a pages UNAVAILABLE names. `no-window`: the app's window is down, so no page can
 * answer. It is not `gone`: a grant is kept across a quit and bound again (EY-D9 B).
 *
 * Two `no-window`s, told apart. This one is the door's, about the app's window. The bridge also
 * says `no-window`, for a closed read or act window (BU:344, BU:1030). That word is main's, never
 * reaches the door, and gets another name at EY-1. */
export const PAGES_UNAVAILABLE_STATES = ["no-window"] as const;
export type PagesUnavailableState = (typeof PAGES_UNAVAILABLE_STATES)[number];

/** What a `needs-you` fact needs from the person (EYD's facts table). `confirm` is the send ask:
 * a form an agent submits on a page with the person's sign-ins waits for their tap (BU-13 A). */
export const PAGES_NEEDS = [
  "sign-in",
  "permission",
  "file",
  "download",
  "dialog",
  "password",
  "confirm",
] as const;
export type PagesNeed = (typeof PAGES_NEEDS)[number];
export const PagesNeed = z.enum(PAGES_NEEDS);

// The engine's own error codes (`tab_gone`, `tab_locked`, `outcome_unknown`, `page_wedged`;
// BU:225-226) are never the plane's facts. Way (b) prints what the pinned command line prints
// (BU:284). EY-2 maps the codes to facts for way (a).

// ── the script set recorded from the pin (§2.6; SITTINGS §4, "The recorded set's shape") ──
// A script call passes as the engine's own only when its script is in this set. Any other script
// is agent script: allowed on the agent's own signed-out page, refused on a signed-in page without
// BU-3's grant. The set holds no engine text. Each body, and each fixed part of a template, is
// kept as its SHA-256 and its length, so the bridge matches by hash. Both are over the text's
// UTF-8 bytes. Every object in the set is strict, so a record that carries text fails its parse.

/** The format of both records. A record of another format is never read as this one. */
export const PAGES_RECORD_V1 = 1 as const;

/** The most entries any list in the two records holds. */
export const PAGES_RECORD_LIST_MAX = 256;

/** The methods that carry script, each by the parameter named beside it (SITTINGS §4). */
export const PAGES_SCRIPT_METHODS = [
  "Runtime.evaluate", // expression
  "Runtime.callFunctionOn", // functionDeclaration
  "Runtime.compileScript", // expression
  "Page.addScriptToEvaluateOnNewDocument", // source
  "Page.createIsolatedWorld", // worldName
  "Runtime.addBinding", // name
] as const;
export type PagesScriptMethod = (typeof PAGES_SCRIPT_METHODS)[number];
export const PagesScriptMethod = z.enum(PAGES_SCRIPT_METHODS);

/** The class of the commands a script was recorded under. A read script may run in a read window
 * or an act window. An act script runs only in an act window (SITTINGS §4, "Mutations by
 * window"). */
export const PAGES_COMMAND_CLASSES = ["read", "act"] as const;
export type PagesCommandClass = (typeof PAGES_COMMAND_CLASSES)[number];
export const PagesCommandClass = z.enum(PAGES_COMMAND_CLASSES);

/** An entry's id in the set: lowercase letters, digits and dashes (`x001`, `find-css`). A nested
 * template is named by its id. */
export const PagesRecordId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** A command as the record pass ran it: its words, with `[flag]` where it varied (`get url`,
 * `snapshot -i [flag]`). Printable ASCII. */
export const PagesCommandLabel = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[ -~]+$/);

/** A place in the pinned source: a Rust file and a line (`element.rs:964`, `a11y/mod.rs:214`). */
export const PagesCallSite = z
  .string()
  .max(128)
  .regex(/^[a-z0-9_]+(?:\/[a-z0-9_]+)*\.rs:[1-9][0-9]*$/);

/** The length of kept text, in UTF-8 bytes. */
const PagesTextLength = z.number().int().positive();

/** One part of a template. A `fixed` part is kept text. Every other kind is a gap the engine
 * fills, read from its value's first character to its last:
 * - `json-string`: one JSON string, its quotes included;
 * - `finite-number`: one JSON number whose value is finite;
 * - `json-value`: one JSON value of any type;
 * - `template`: the template `id` names, matched in this place. Its own method and class are not
 *   read there.
 *
 * Anything that fills a gap with something else is agent script. */
export const PagesTemplatePartV1 = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), sha256: Sha256Hex, length: PagesTextLength }).strict(),
  z.object({ kind: z.literal("json-string") }).strict(),
  z.object({ kind: z.literal("finite-number") }).strict(),
  z.object({ kind: z.literal("json-value") }).strict(),
  z.object({ kind: z.literal("template"), id: PagesRecordId }).strict(),
]);
export type PagesTemplatePartV1 = z.infer<typeof PagesTemplatePartV1>;

/** An exact body: a call's whole script, kept as its hash and length. With it: the method that
 * sent it, the class of its commands, and every command the record pass saw send it. */
export const PagesScriptBodyV1 = z
  .object({
    id: PagesRecordId,
    sha256: Sha256Hex,
    length: PagesTextLength,
    method: PagesScriptMethod,
    commandClass: PagesCommandClass,
    commands: z.array(PagesCommandLabel).min(1).max(PAGES_RECORD_LIST_MAX),
  })
  .strict();
export type PagesScriptBodyV1 = z.infer<typeof PagesScriptBodyV1>;

/** A template: a call's script as typed parts, matched left to right over the whole script. A
 * fixed part is matched by its length and its hash, and a gap is read to its own end. Two gaps
 * never meet, even across a nested template's edges: a fixed part, or the script's end, follows
 * every gap. `method` is absent on a template that only fills another's gap. `callSite` is where
 * the pinned source writes it. */
export const PagesScriptTemplateV1 = z
  .object({
    id: PagesRecordId,
    method: PagesScriptMethod.optional(),
    commandClass: PagesCommandClass,
    callSite: PagesCallSite,
    parts: z.array(PagesTemplatePartV1).min(1).max(PAGES_RECORD_LIST_MAX),
  })
  .strict();
export type PagesScriptTemplateV1 = z.infer<typeof PagesScriptTemplateV1>;

/** A release of the engine, never a prerelease: main pins releases. */
export const PagesEngineVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

/** The first value that appears twice, or undefined. */
function firstRepeat(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/** Why a set's templates cannot match exactly, or undefined: a nested template the set does not
 * hold, a template inside itself, or two gaps that meet. */
function templatesProblem(templates: readonly PagesScriptTemplateV1[]): string | undefined {
  const byId = new Map(templates.map((template) => [template.id, template] as const));
  for (const template of templates) {
    for (const part of template.parts) {
      if (part.kind === "template" && !byId.has(part.id)) {
        return `template ${template.id} names ${part.id}, which the set does not hold`;
      }
    }
  }
  const state = new Map<string, "open" | "done">();
  const holdsItself = (id: string): boolean => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "open") return true;
    state.set(id, "open");
    for (const part of byId.get(id)?.parts ?? []) {
      if (part.kind === "template" && holdsItself(part.id)) return true;
    }
    state.set(id, "done");
    return false;
  };
  for (const template of templates) {
    if (holdsItself(template.id)) return `template ${template.id} is inside itself`;
  }
  const edgeIsGap = (part: PagesTemplatePartV1, edge: "first" | "last"): boolean => {
    if (part.kind === "fixed") return false;
    if (part.kind !== "template") return true;
    const parts = byId.get(part.id)?.parts ?? [];
    const end = edge === "first" ? parts[0] : parts.at(-1);
    return end !== undefined && edgeIsGap(end, edge);
  };
  for (const template of templates) {
    const { parts } = template;
    for (let index = 1; index < parts.length; index += 1) {
      const before = parts[index - 1];
      const after = parts[index];
      if (before && after && edgeIsGap(before, "last") && edgeIsGap(after, "first")) {
        return `template ${template.id} has two gaps that meet before part ${index}`;
      }
    }
  }
  return undefined;
}

/** The script set recorded from the pin, on Path 2: the product ships Path 2 (BU-7 B), and Path
 * 1's set stays in the lab. `engineVersion` is the release it was recorded from, the engine
 * record's `version`. `recordedCalls` counts the agent's calls of every record pass merged into
 * the set. Before it wrote this form, the converter matched against it every script call the last
 * pass kept and every form the set holds. `unmatchedCallSites` are the required
 * call sites no recorded call reached. Each is stated unreachable from the command line
 * (EY-S1-R1), so the set holds no template for it. */
export const PagesScriptSetV1 = z
  .object({
    v: z.literal(PAGES_RECORD_V1),
    engineVersion: PagesEngineVersion,
    recordedCalls: z.number().int().positive(),
    unmatchedCallSites: z.array(PagesCallSite).max(PAGES_RECORD_LIST_MAX),
    exact: z.array(PagesScriptBodyV1).min(1).max(PAGES_RECORD_LIST_MAX),
    templates: z.array(PagesScriptTemplateV1).min(1).max(PAGES_RECORD_LIST_MAX),
  })
  .strict()
  .superRefine((set, ctx) => {
    const problems: string[] = [];
    const ids = [...set.exact, ...set.templates].map((entry) => entry.id);
    const sameId = firstRepeat(ids);
    if (sameId !== undefined) problems.push(`the id ${sameId} is used twice`);
    const sameBody = firstRepeat(set.exact.map((body) => `${body.method} ${body.sha256}`));
    if (sameBody !== undefined) problems.push(`the body ${sameBody} is kept twice`);
    for (const body of set.exact) {
      const sameCommand = firstRepeat(body.commands);
      if (sameCommand !== undefined) problems.push(`${body.id} lists ${sameCommand} twice`);
    }
    const templates = templatesProblem(set.templates);
    if (templates !== undefined) problems.push(templates);
    for (const message of problems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });
export type PagesScriptSetV1 = z.infer<typeof PagesScriptSetV1>;

// ── the record of the pin (§2.7; the first place of the EL8 row) ──

/** One tool of the engine's core profile, as the pinned tool list writes it: the engine's own name
 * for it and its `readOnlyHint`. */
export const PagesEngineToolV1 = z
  .object({ engineName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), readOnlyHint: z.boolean() })
  .passthrough();
export type PagesEngineToolV1 = z.infer<typeof PagesEngineToolV1>;

/** The record of the pin:
 * - `package` and `version`: the engine's npm package and its release;
 * - `tagCommit`: the full commit of the release's source tag;
 * - `npmIntegrity`: the package tarball's npm integrity;
 * - `binarySha256`: each platform binary's SHA-256, darwin-arm64 now (others join by addition);
 * - `mcpToolsSha256`: the SHA-256 of the tag's tool list, `mcp-tools.json`;
 * - `core`: the core profile's tools, in the profile's own order.
 *
 * EY-0 records the pin. The install, and the preflight row that holds it to this record, land at
 * EY-1. The catalog's pages rows are held to `core` by a test. */
export const PagesEngineRecordV1 = z
  .object({
    v: z.literal(PAGES_RECORD_V1),
    package: z
      .string()
      .max(214)
      .regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/),
    version: PagesEngineVersion,
    tagCommit: z.string().regex(/^[0-9a-f]{40}$/),
    npmIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
    binarySha256: z.object({ "darwin-arm64": Sha256Hex }).catchall(Sha256Hex),
    mcpToolsSha256: Sha256Hex,
    core: z.array(PagesEngineToolV1).min(1).max(PAGES_RECORD_LIST_MAX),
  })
  .passthrough()
  .superRefine((record, ctx) => {
    const sameName = firstRepeat(record.core.map((tool) => tool.engineName));
    if (sameName !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["core"],
        message: `${sameName} is listed twice`,
      });
    }
  });
export type PagesEngineRecordV1 = z.infer<typeof PagesEngineRecordV1>;
