import { z } from "zod";
import { Sha256Hex } from "./artifacts";
import { LiveSurfaceUrlV1 } from "./live-surfaces";
import { ObjectRef } from "./objects";
import { isAbsoluteDesktopPath } from "./paths";

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
 * reaches the door, and gets another name at EY-1. Dated 2026-11-19 (EY-1): the bridge's is
 * `outside-window`.
 *
 * EY-1 (2026-11-19) adds the engine's four, which main's shell provider maps its broker to:
 * - `engine-starting`: the run's engine is still starting;
 * - `engine-stopped`: the run's engine has stopped;
 * - `engine-refused`: main refused an engine that did not prove it is the pinned one;
 * - `not-installed`: this build carries no engine.
 *
 * EY-2 (2026-11-19) adds the room's two, as the desk room answers its own: `no-answer`, an act whose answer never
 * came (retryable); `bad-answer`, main's answer fit no arm of the control result. */
export const PAGES_UNAVAILABLE_STATES = [
  "no-window",
  "engine-starting",
  "engine-stopped",
  "engine-refused",
  "not-installed",
  "no-answer",
  "bad-answer",
] as const;
export type PagesUnavailableState = (typeof PAGES_UNAVAILABLE_STATES)[number];

/** EY-1 (N5) — the words main's shell provider gives a pages call's RESOURCE_EXHAUSTED, in place of
 * a preview's image budget: the engine's answer passed the control call's output bound
 * (`SURFACE_AUTHORITY_LIMITS.CONTROL_OUTPUT_MAX_BYTES`), so main sends none of it. Asking for less
 * (a part of the page, a filter, a smaller still) is the way through. */
export const PAGES_OUTPUT_EXHAUSTED_MESSAGE = "the page's answer is larger than one call may carry";

/** EY-1 — the most panes a run may hold at once that its calls made (BU-6's per-run cap, inside
 * the desk's own; a made pane counts from its making, BU-19). 5 is the lab's; EY-1's desk smoke
 * row measures it. */
export const PAGES_RUN_PANES_MAX = 5;

/** EY-1 (7b, 2026-11-19) — the size and density of a run's pane made with no page to open it from (the run form's
 * open): a person's new browser pane, a laptop's page at its density (the browser pane's default device; a row in
 * its tests holds the two equal). A tab or a pop-up takes its opener's. */
export const PAGES_MADE_VIEWPORT = { width: 1280, height: 800 } as const;
export const PAGES_MADE_DEVICE_SCALE = 2;

/** EY-1 (F2, 2026-11-24) — the device a run's made page is born on: the browser pane's default device as the desk
 * says it to a page (its density, a pointer device's layout, no fingers, and no agent named, so the engine's own),
 * less the colour scheme, which is the desk's and is told live. fieldd places every made pane with no device named,
 * so its pane is the default device, and the desk tells an adopted pane that device as its lane first goes live. A
 * page born on the same one takes that word as no switch: it is not reloaded and its window is not made anew, so
 * what its run typed and the refs it holds stand through the adopt. A row in the pane's tests holds this to the
 * pane's default device, as it holds the size. A tab and a pop-up are born on it too, whatever device their opener is
 * seen as: their panes are placed the same way. */
export const PAGES_MADE_EMULATION = {
  deviceScaleFactor: PAGES_MADE_DEVICE_SCALE,
  mobile: false,
  touchPoints: 0,
} as const;

/** EY-1 (1f, C1) — the declared prop on the browser pane's kind that names the run a made pane belongs to.
 * fieldd's pages room writes it at its place (with `made`), and the window reads it at every mint, so the pane
 * re-mints into that run's own session (`run:<run>`) while the run lives. Once the run has ended there is no mint, and
 * the pane shows its closed still: the desk's signed-in profile is never the answer for a pane that has this prop. Set
 * by VibeField alone, never by an agent or a plugin: fieldd's verbs and the window's applier refuse it on any other
 * write. The browser pane's manifest declares it, so it rides the object's undo.
 *
 * Erratum (2026-11-24, PI-6): "fieldd's verbs and the window's applier refuse it on any other write" is not what they
 * do. Neither names this prop: both refuse a place of a kind whose tools are a ROOM's when it carries no `made`
 * (fieldd's canvas_place by the kind's room, the applier's room check), and the browser pane is that kind. A kind with
 * no room that declared the prop would carry it through both doors, and the undo of a remove respawns the pane with it
 * (as the sentence above allows). What keeps a run's session closed to any such carrier is main's rule: it mints into
 * `run:<run>` only for a live run, under a reuse key a window adopted into that run (authority.ts `#holdRunSession`);
 * and the window mints nothing on a run it cannot read (desk-live, PI-2). The promise rests on the doors' room rule and
 * main's adopted-key rule, not on a refusal of the prop. */
export const PAGES_PANE_RUN_PROP = "agentRun";

/** PI-1 (2026-11-24) — the declared prop on the browser pane's kind that holds a run's pane's ADDRESS. A reader that does
 * not know PAGES_PANE_RUN_PROP (an older build, another device on one) reads the pane's `url` alone and would open it
 * live in the desk's signed-in profile, so a run's address never rides `url`: the window's applier writes the address
 * the pages room placed the pane with here (and leaves `url` at the kind's default, no page), and the pane writes its
 * page's own moves here. Such a reader does not declare it and drops it. The browser pane's manifest declares it in
 * `url`'s own cell, so an undo of the pane's other props never re-asserts it. */
export const PAGES_PANE_ADDRESS_PROP = "runAddress";

/** EY-1 (1f, C1) — its value: fieldd's key for the run. Contracts holds no run key's form beyond a bounded string
 * (`runtimeRunId`), and the window names a session from this one, so it is held to letters, digits, `_` and `-`:
 * never a `:`, a `/`, a `.` or a space. */
export const PagesPaneRun = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** S2b (2026-11-24) — the longest address the browser pane's `url` prop holds (its manifest declares it, and a fieldd
 * row reads the manifest and holds the two equal). fieldd's pages room places a made pane beside its run with the
 * address the page was asked to open, or the made pane's own; one longer than this, or one that is not http or https,
 * is placed as `about:blank`, and the page itself stays where main opened it. */
export const PAGES_PANE_URL_MAX = 2048;

/** EY-1 (1f, 2026-11-19) — the memory profile a made pane lives in: `${PAGES_RUN_PROFILE_PREFIX}${run}`, the run
 * its PAGES_PANE_RUN_PROP names. A PagesPaneRun never holds a `:`, so the ref splits back to its run at the prefix
 * and is never a run key itself. Main mints a run's made page into it and reads a page's run back from it; the
 * window names the pane's session from it at every mint. The desk's own profile (BROWSER_DESK_PROFILE_REF) never
 * begins with it. */
export const PAGES_RUN_PROFILE_PREFIX = "run:";

/** EY-2 — the most one still may hold: main holds the engine's file to it, and the answer's `bytes` with it.
 * It bounds an AGENT's still: the broker passes it to main's check of the written file, never
 * SCREENSHOT_STILL.MAX_BYTES (registries.ts), which bounds the person's own screenshot. The two are equal
 * today and kept apart on purpose. Provisional (2026-11-19): EY-1's still row measures it. */
export const PAGES_STILL_MAX_BYTES = 64 * 1024 * 1024;

/** EY-2 — the most a run's stills may hold in all, in fieldd's own folder for the run (LAYOUT.PAGES_STILLS_DIR):
 * the room refuses browser_screenshot once they pass it. Four stills at the bound for one. Provisional (2026-11-19):
 * EY-1's still row measures it. */
export const PAGES_RUN_STILLS_MAX_BYTES = 4 * PAGES_STILL_MAX_BYTES;

/** EY-2 — how long a run's stills are kept: its folder is removed once its newest still is older than this, swept at
 * fieldd's start and once a day. Provisional (2026-11-19). */
export const PAGES_STILLS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** The pin's SOURCE BUILD (recorded 2026-11-24): the pin's own tag built from source with a patch laid on it. It is the
 * only identity main starts. The release binary always opens a loopback port that relays any command to the engine
 * for any local process; the source build is started with that listener off.
 * - `tagCommit`: the commit it is built from, the record's own `tagCommit`;
 * - `patchSha256`: the SHA-256 of the patch laid on that tree (a unified diff);
 * - `binarySha256`: each platform's built binary, by `<platform>-<arch>`. A platform absent here has no engine, and
 *   pages answer `not-installed` there. */
export const PagesEngineSourceBuildV1 = z
  .object({
    tagCommit: z.string().regex(/^[0-9a-f]{40}$/),
    patchSha256: Sha256Hex,
    binarySha256: z.record(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9_]+)+$/), Sha256Hex),
  })
  .passthrough();
export type PagesEngineSourceBuildV1 = z.infer<typeof PagesEngineSourceBuildV1>;

/** Which of the record's two identities may be started: the source build, and no other. A record that says anything
 * else is not a record. */
export const PAGES_ENGINE_STARTS = "sourceBuild" as const;

/** The record of the pin:
 * - `package` and `version`: the engine's npm package and its release;
 * - `tagCommit`: the full commit of the release's source tag;
 * - `npmIntegrity`: the package tarball's npm integrity;
 * - `binarySha256`: each platform's RELEASE binary (the npm package's), darwin-arm64 now (others join by addition).
 *   Preflight holds the install to it, the tool list was read from that release, and it is NEVER started;
 * - `sourceBuild`: the pin built from source with the switch patch (`PagesEngineSourceBuildV1`);
 * - `starts`: which identity may be started (`PAGES_ENGINE_STARTS`: the source build);
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
    sourceBuild: PagesEngineSourceBuildV1,
    starts: z.literal(PAGES_ENGINE_STARTS),
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
    // the two identities are of ONE pin and are never the same bytes
    if (record.sourceBuild.tagCommit !== record.tagCommit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBuild", "tagCommit"],
        message: "the source build is of another commit than the pin's tag",
      });
    }
    const released = new Set(Object.values(record.binarySha256));
    for (const [platform, sum] of Object.entries(record.sourceBuild.binarySha256)) {
      if (released.has(sum)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceBuild", "binarySha256", platform],
          message: `the source build for ${platform} is a release binary's bytes`,
        });
      }
    }
  });
export type PagesEngineRecordV1 = z.infer<typeof PagesEngineRecordV1>;

// ── EY-2 — the pages rows' bounds (2a, 2026-11-19) ──────────────────────────────────────────────

/** EY-2 (2026-11-19) — every `command.action` the pages rows send in a control call: fieldd's room builds each
 * from its row (rooms/pages/command.ts), and its own `rebind` is a run-form action (SHELL_SURFACES_RUN_ACTIONS), not a
 * row's. Main's broker passes these and the run form's own, and refuses any other: an allow list. Of these,
 * `tab_list` and `close` are run-form actions main answers itself, never the engine's. Sorted, each once. */
export const PAGES_DAEMON_ACTIONS = [
  "back",
  "check",
  "click",
  "close",
  "evaluate",
  "fill",
  "forward",
  "gettext",
  "navigate",
  "press",
  "read",
  "reload",
  "screenshot",
  "scroll",
  "select",
  "snapshot",
  "tab_close",
  "tab_list",
  "tab_new",
  "title",
  "type",
  "uncheck",
  "url",
  "wait",
  "waitforloadstate",
] as const;
export type PagesDaemonAction = (typeof PAGES_DAEMON_ACTIONS)[number];

/** EY-2 — the longest wait a call may ask for: the control call's deadline
 * (`SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS`, 30 s) less 5 s for the broker's switch to the
 * page, the window and the answer. It bounds wait_ms's `ms`, every `waitTimeoutMs` and a typing's
 * whole time. A number, because shell.ts imports this module; a test holds it to the deadline. */
export const PAGES_WAIT_MAX_MS = 25_000;

/** EY-2 — the pages rows' bounds. Each string is bounded here, and the whole command again, as
 * JSON's bytes, at the control call (`SURFACE_AUTHORITY_LIMITS.CONTROL_COMMAND_MAX_BYTES`). */
export const PAGES_TOOL_LIMITS = {
  /** a part of a page: a snapshot's `@eN` or a CSS selector */
  REF_CHARS: 1_024,
  /** type's and wait_for_text's text, read's filter, and each value a select chooses */
  TEXT_CHARS: 2_000,
  /** fill's text and eval's script: 16 384 characters of up to 3 UTF-8 bytes each stay under the
   * command's 64 KiB */
  LONG_TEXT_CHARS: 16_384,
  /** type's pause between keys */
  TYPE_DELAY_MS_MAX: 200,
  KEY_CHARS: 64,
  LABEL_CHARS: 64,
  SELECT_VALUES_MAX: 64,
  SNAPSHOT_DEPTH_MAX: 256,
  SCROLL_PX_MAX: 16_384,
  /** the pages a list names, or a close closes or gives back: the run's own and those handed to
   * it */
  LIST_PAGES_MAX: 64,
} as const;

// ── EY-2 — the pages rows' inputs and outputs (2a, 2026-11-19) ──────────────────────────────────
// Each row takes the pinned engine's own arguments, less those the room drops: the engine's
// shared ones (its session, domains, TLS trust, restore and timeouts are the broker's), read's
// fetch (`url`, `llms`, `requireMd`, `readTimeoutMs`), type's `clear` (fill replaces), click's
// `newTab` and `human`, screenshot's `path` and `screenshotDir` (fieldd names the run's folder),
// open's launch flags (`headed`, `webgpu`, `webmcp`) and close's `all`. A page is a desk object,
// `page` (an ObjectRef); a part of it is `ref`, a snapshot's `@eN` or a CSS selector, as the
// engine's `selector` takes it, and snapshot's part is `within`. Every answer names the page it
// answered, and an act names the panes it made.

const PagesRef = z.string().min(1).max(PAGES_TOOL_LIMITS.REF_CHARS);
const PagesText = z.string().min(1).max(PAGES_TOOL_LIMITS.TEXT_CHARS);
const PagesWaitTimeout = z.number().int().min(1).max(PAGES_WAIT_MAX_MS);
const PagesFilePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsoluteDesktopPath, "expected an absolute desktop path");

/** A row that names no page: the run's own (the tab list, the close) or fieldd's (the profiles). */
export const PagesNoInput = z.object({}).passthrough();
/** A row on the page as a whole. */
export const PagesPageInput = z.object({ page: ObjectRef }).passthrough();
/** A row on a part of the page. */
export const PagesRefInput = z.object({ page: ObjectRef, ref: PagesRef }).passthrough();

/** On a page the run has, it goes there; with none, the run's own new pane. No `url`: a blank
 * page. */
export const PagesOpenInput = z
  .object({ page: ObjectRef.optional(), url: LiveSurfaceUrlV1.optional() })
  .passthrough();

/** The page's text, read from its tab: `raw` skips only the extraction. */
export const PagesReadInput = z
  .object({
    page: ObjectRef,
    filter: PagesText.optional(),
    outline: z.boolean().optional(),
    raw: z.boolean().optional(),
  })
  .passthrough();

export const PagesSnapshotInput = z
  .object({
    page: ObjectRef,
    compact: z.boolean().optional(),
    delta: z.boolean().optional(),
    depth: z.number().int().min(0).max(PAGES_TOOL_LIMITS.SNAPSHOT_DEPTH_MAX).optional(),
    full: z.boolean().optional(),
    includeUrls: z.boolean().optional(),
    interactive: z.boolean().optional(),
    /** the engine's `selector`: the part the snapshot keeps to */
    within: PagesRef.optional(),
  })
  .passthrough();

/** An empty text clears the field. */
export const PagesFillInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef,
    text: z.string().max(PAGES_TOOL_LIMITS.LONG_TEXT_CHARS),
  })
  .passthrough();

/** A typing's whole time, its pause times its length, stays within PAGES_WAIT_MAX_MS. */
export const PagesTypeInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef,
    text: PagesText,
    delayMs: z.number().int().min(0).max(PAGES_TOOL_LIMITS.TYPE_DELAY_MS_MAX).optional(),
  })
  .passthrough()
  .refine(
    (input) => (input.delayMs ?? 0) * input.text.length <= PAGES_WAIT_MAX_MS,
    "a typing's whole time, delayMs times the text's length, is within PAGES_WAIT_MAX_MS",
  );

export const PagesPressInput = z
  .object({
    page: ObjectRef,
    key: z.string().min(1).max(PAGES_TOOL_LIMITS.KEY_CHARS),
  })
  .passthrough();

export const PagesSelectInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef,
    values: z
      .array(z.string().max(PAGES_TOOL_LIMITS.TEXT_CHARS))
      .min(1)
      .max(PAGES_TOOL_LIMITS.SELECT_VALUES_MAX),
  })
  .passthrough();

export const PagesScrollInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef.optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    amount: z.number().int().min(0).max(PAGES_TOOL_LIMITS.SCROLL_PX_MAX).optional(),
  })
  .passthrough();

export const PagesWaitMsInput = z
  .object({
    page: ObjectRef,
    ms: z.number().int().min(0).max(PAGES_WAIT_MAX_MS),
  })
  .passthrough();

export const PagesWaitForRefInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef,
    waitTimeoutMs: PagesWaitTimeout.optional(),
  })
  .passthrough();

export const PagesWaitForTextInput = z
  .object({
    page: ObjectRef,
    text: PagesText,
    waitTimeoutMs: PagesWaitTimeout.optional(),
  })
  .passthrough();

export const PagesWaitForLoadInput = z
  .object({
    page: ObjectRef,
    state: z.enum(["load", "domcontentloaded", "networkidle"]),
    waitTimeoutMs: PagesWaitTimeout.optional(),
  })
  .passthrough();

/** A still of the page, or of a part of it (`ref`). fieldd names its file, in the run's folder. */
export const PagesScreenshotInput = z
  .object({
    page: ObjectRef,
    ref: PagesRef.optional(),
    annotate: z.boolean().optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    fullPage: z.boolean().optional(),
    ifChanged: z.boolean().optional(),
    quality: z.number().int().min(0).max(100).optional(),
    threshold: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const PagesTabNewInput = z
  .object({
    url: LiveSurfaceUrlV1.optional(),
    label: z.string().min(1).max(PAGES_TOOL_LIMITS.LABEL_CHARS).optional(),
  })
  .passthrough();

export const PagesEvalInput = z
  .object({
    page: ObjectRef,
    script: z.string().min(1).max(PAGES_TOOL_LIMITS.LONG_TEXT_CHARS),
  })
  .passthrough();

/** A pane a call made, as the run's own desk object: fieldd mints it from the control result's
 * `made`, so a model never sees a surface. */
export const PagesMadePage = z
  .object({
    page: ObjectRef,
    url: LiveSurfaceUrlV1,
    by: z.enum(["open", "tab", "popup"]),
  })
  .passthrough();
export type PagesMadePage = z.infer<typeof PagesMadePage>;

/** A read's answer: the engine's, bounded by the room, and the page it read. */
export const PagesReadOutput = z.object({ page: ObjectRef, result: z.unknown() }).passthrough();

/** An act's answer: the engine's, the page it acted on, and the panes it made. */
export const PagesActOutput = z
  .object({
    page: ObjectRef,
    result: z.unknown(),
    made: z.array(PagesMadePage).max(PAGES_RUN_PANES_MAX).optional(),
  })
  .passthrough();

/** A still's answer: its file, never its bytes (the MCP answer links the file). No `file`:
 * `ifChanged` found the page as it was. */
export const PagesScreenshotOutput = z
  .object({ page: ObjectRef, file: PagesFilePath.optional() })
  .passthrough();

/** The new tab's answer: its page, and the pane it made. */
export const PagesTabNewOutput = z
  .object({
    page: ObjectRef,
    made: z.array(PagesMadePage).min(1).max(PAGES_RUN_PANES_MAX),
  })
  .passthrough();

const PagesListedPage = z
  .object({
    page: ObjectRef,
    url: LiveSurfaceUrlV1,
    title: z.string().max(512).optional(),
    handed: z.boolean(),
    /** the page the engine is on */
    current: z.boolean(),
  })
  .passthrough();

/** The run's pages: its own and those handed to it. */
export const PagesTabListOutput = z
  .object({ pages: z.array(PagesListedPage).max(PAGES_TOOL_LIMITS.LIST_PAGES_MAX) })
  .passthrough();

/** A close's answer: the run's own pages it closed, and the handed pages it gave back, their panes
 * left open. */
export const PagesClosedOutput = z
  .object({
    closed: z.array(ObjectRef).max(PAGES_TOOL_LIMITS.LIST_PAGES_MAX),
    returned: z.array(ObjectRef).max(PAGES_TOOL_LIMITS.LIST_PAGES_MAX),
  })
  .passthrough();

/** fieldd's answer to browser_tools_profiles: the pages rows the caller holds, and the command
 * its pane offers for the engine's other verbs (its words wait for A-3). */
export const PagesProfilesOutput = z
  .object({
    rows: z.array(z.string().regex(/^browser_[a-z_]{1,48}$/)).max(64),
    command: z.string().min(1).max(1_024).optional(),
  })
  .passthrough();
