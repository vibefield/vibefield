// `vibefield-plugin docs` — the plugin-authoring reference, generated from the
// contracts (§5.4 item 7; P8-D8 promoted it from "nice" to load-bearing, because
// the ten-minute bar is measured with an agent whose ONLY input is these files).
//
// Everything structural is DERIVED: field tables walk the zod objects, limits
// come from PLUGIN_LIMITS, the vocabularies come from the enums, the invariants
// come from running the schema, the refusal catalog comes from the kit's own
// table, and every example is validated before it is written. What remains
// hand-written is the connective prose — and the ctx table's present-iff rules,
// which are anchored to the SDK's source by test.
//
// Byte-stability is a requirement, not an accident: `pnpm gen:docs` emits these
// files and `gen:check` diffs them, so a clock, a version stamp, or an
// unordered map anywhere in here would make the gate flap.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BehaviorContribution,
  CONTRACTS_VERSION,
  CommandContribution,
  HOST_SINGLETON_MODULE_SPECIFIERS,
  McpContribution,
  OBJECT_RETIRED_FIELDS,
  ObjectContribution,
  PLUGIN_CAPABILITY_ELIGIBILITY,
  PLUGIN_LIMITS,
  PluginCapabilityContribution,
  PluginManifestV1Shape,
  PropSpec,
  ServiceContribution,
  ServiceMethodContribution,
  SettingsContribution,
  SurfaceContribution,
  TRAY_ACCESSORIES,
  TrayEntryContribution,
} from "@vibefield/contracts";
import { kitWgsl } from "@vibefield/plugin-sdk/desk";
import { KIND_EXPECTED } from "@vibefield/plugin-sdk/testing";
import {
  type CtxFaceRow,
  invariantRows,
  RENDERER_CTX_FACES,
  SERVICE_CTX_FACES,
} from "./docs-anchors";
import { contributionSlice, jsonBlock, loadExamples } from "./docs-examples";
import { catalogRows } from "./refusals";
import { type FieldDoc, fieldsOf, variantsOf } from "./schema-walk";
import { R10_ALLOWED_DOOR, R10_FORBIDDEN_MODULES } from "./wall";

// DK-6 — THE WORKED EXAMPLE IS QUOTED, NEVER RETYPED: the object docs show the example plugin's code
// (examples/plugins/desk-clock — ICE's desk clock through the SDK's `/desk` door) and the SDK's own
// `ObjectBinding`, read from their sources at generation between `// docs:begin <name>` and
// `// docs:end <name>` marker lines. Change the code and the docs regenerate with it; `gen:check` fails
// until they do. A marker that went missing throws here, at generation, never a silently stale page.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** The example plugin the object docs quote, repository-relative. */
export const EXAMPLE_PLUGIN_DIR = "examples/plugins/desk-clock";

/** A repository file's text, as committed (trailing newline dropped). */
function repoFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8").trimEnd();
}

/** The lines between a file's `// docs:begin <name>` and `// docs:end <name>` markers, dedented. */
export function quotedRegion(rel: string, name: string): string {
  const lines = repoFile(rel).split("\n");
  const begin = lines.findIndex((line) => line.trim() === `// docs:begin ${name}`);
  const end = lines.findIndex((line, i) => i > begin && line.trim() === `// docs:end ${name}`);
  if (begin === -1 || end === -1)
    throw new Error(`${rel}: no "// docs:begin ${name}" … "// docs:end ${name}" region to quote`);
  const body = lines.slice(begin + 1, end);
  const indent = Math.min(
    ...body
      .filter((line) => line.trim().length > 0)
      .map((line) => /^ */.exec(line)?.[0].length ?? 0),
  );
  return body.map((line) => line.slice(indent)).join("\n");
}

/** The example plugin's one object row, as its emitted manifest carries it. */
function exampleObjectRow(): unknown {
  const manifest = JSON.parse(repoFile(`${EXAMPLE_PLUGIN_DIR}/vibefield.plugin.json`)) as {
    contributes: { objects: unknown[] };
  };
  const row = manifest.contributes.objects[0];
  if (row === undefined) throw new Error(`${EXAMPLE_PLUGIN_DIR}: its manifest declares no object`);
  return row;
}

// DK-10 — ICE'S OWN DECLARATIONS, QUOTED. The shapes a kind hands the desk (its opening, its held tools and their
// glyphs, its chip, the frame its marks go round) and what it is handed (its flux) are ICE's types, re-exported through
// the SDK's `/desk` door. The ten-minute bar's agents guessed each from the clock's code — the third wrote a held tool
// ICE shows dim and never runs. They are quoted from the installed ICE's own published declarations, doc comments and
// all, at generation: a declaration that moved throws here, never a silently stale page.

/** One of the installed ICE's published type declaration files (`dist/types/packages/<rel>`) — the package the SDK's
 * `/desk` door re-exports, resolved as the SDK resolves it. */
function iceTypesFile(rel: string): string {
  const fromSdk = createRequire(join(REPO_ROOT, "packages", "plugin-sdk", "package.json"));
  const pkg = dirname(dirname(fromSdk.resolve("@vibecook/ice")));
  return readFileSync(join(pkg, "dist", "types", "packages", rel), "utf8");
}

/** One exported declaration of ICE's — the doc comment above it and its whole body — quoted from its `.d.ts`. */
export function quotedDeclaration(rel: string, name: string): string {
  const lines = iceTypesFile(rel).split("\n");
  const head = new RegExp(`^export (?:declare )?(?:interface|type|const|function) ${name}\\b`);
  const start = lines.findIndex((line) => head.test(line));
  if (start === -1) throw new Error(`ICE ${rel}: no exported declaration of ${name} to quote`);
  let first = start;
  if ((lines[start - 1] ?? "").trim().endsWith("*/")) {
    first = start - 1;
    while (first > 0 && !(lines[first] ?? "").trim().startsWith("/**")) first -= 1;
  }
  let depth = 0;
  let braced = false;
  let end = start;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        braced = true;
      } else if (ch === "}") depth -= 1;
    }
    end = i;
    if (braced ? depth === 0 : line.trimEnd().endsWith(";")) break;
  }
  return lines.slice(first, end + 1).join("\n");
}

/** A program with nothing of its own — what `kitWgsl` composes then is the kit's pieces alone. */
const NO_ENTRY = { entry: { label: "docs/none", text: "" } };

/** The kit's WGSL pieces, in the kit's compose order (`kitWgsl`'s `KitWgslPiece`). */
export const KIT_PIECES = ["view", "portal", "sdf", "light", "ruler", "book"] as const;

/** What one kit piece declares at module scope — its structs, constants, module vars and functions with their
 * signatures — read from the kit's own text (`kitWgsl([piece], NO_ENTRY)`). */
export function kitPieceDeclarations(piece: (typeof KIT_PIECES)[number]): string[] {
  const composed = kitWgsl([piece], NO_ENTRY);
  const out = (composed.structs ?? []).map((struct) => `struct ${struct.name}`);
  for (const module of composed.modules ?? []) {
    const text = module.text;
    for (const m of text.matchAll(/^struct\s+([A-Za-z_]\w*)/gm)) out.push(`struct ${m[1]}`);
    for (const m of text.matchAll(/^(const|override)\s+([A-Za-z_]\w*)/gm))
      out.push(`${m[1]} ${m[2]}`);
    for (const m of text.matchAll(/^(?:@[^\n]*?\s)?var(?:<[^>]*>)?\s+([A-Za-z_]\w*)/gm))
      out.push(`var ${m[1]}`);
    for (const m of text.matchAll(/^fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/gm))
      out.push(
        `fn ${m[1]}(${(m[2] ?? "").replace(/\s+/g, " ").trim()})${m[3] !== undefined ? ` -> ${m[3].trim()}` : ""}`,
      );
  }
  return out;
}

/** The view block's fields a kind reads, and what each holds (ICE `mat/layout.ts`'s own comments, said for a kind). */
export const VIEW_BLOCK_FIELDS: readonly (readonly [string, string])[] = [
  [
    "cam",
    "the camera: `xy` the world point at the canvas's top-left (world units), `z` the zoom — CSS px per world unit, `mat_zoom(u)` — and `w` the device ratio, `mat_dpr(u)`",
  ],
  [
    "view",
    "`xy` the canvas size, CSS px; `z` the grain's time, seconds; `w` the OBJECTS' presentation opacity — what every kind multiplies its alpha by",
  ],
  ["box", "this slot's box on the attachment, CSS px (`x, y, w, h`) — what a kind culls against"],
  [
    "portals",
    "the portal chain `portal_cover` reads: each container face's centre and half extents, CSS px",
  ],
  ["clips", "each face's corner radius and on (0/1 — a 0 ends the chain), beside `portals`"],
  [
    "night",
    "`x` the night's amount — 0 the day's light exactly, 1 full night — what a kind mixes its day and night colours by",
  ],
];

/** The view block's fields a kind reads — each held to the kit's own `MatUniforms` at generation (a renamed field throws). */
function viewBlockFields(): readonly (readonly [string, string])[] {
  const struct = kitWgsl(["view"], NO_ENTRY).structs?.[0] as
    | { name?: string; slots?: Record<string, unknown> }
    | undefined;
  const fields = new Set(Object.keys(struct?.slots ?? {}));
  for (const [field] of VIEW_BLOCK_FIELDS)
    if (!fields.has(field))
      throw new Error(`the kit's ${struct?.name ?? "view block"} has no field ${field} any more`);
  return VIEW_BLOCK_FIELDS;
}

const BANNER = [
  "<!-- GENERATED by `vibefield-plugin docs` — do not edit by hand.",
  "     Regenerate with `pnpm gen:docs`; `pnpm verify` fails on stale output. -->",
].join("\n");

/**
 * One table cell, made safe for markdown without becoming unreadable as PLAIN
 * TEXT — which matters more than usual here, because the primary reader is an
 * agent looking at the raw file.
 *
 * Two hazards, both seen in real schema messages: a `|` inside a cell ends the
 * cell (the activation rule's `onStartup | onObject:…` did exactly that), and an
 * angle-bracketed placeholder like `<name>` is swallowed as an HTML tag when the
 * page is rendered. So a cell carrying markdown-significant characters is
 * wrapped in a code span — unless it already carries one, in which case the
 * author formatted it deliberately and it is left alone.
 */
export function cell(text: string): string {
  const wrapped =
    !text.includes("`") && /[<>*_[\]]/.test(text) && text.length > 0 ? `\`${text}\`` : text;
  return wrapped.replaceAll(/(?<!\\)\|/g, "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map((row) => line(row.map(cell))),
  ].join("\n");
}

function fieldTable(fields: FieldDoc[]): string {
  return table(
    ["field", "type", "required", "rules"],
    fields.map((f) => [
      `\`${f.name}\``,
      f.type,
      f.required ? "yes" : "no",
      f.constraints.join("; ") || "—",
    ]),
  );
}

function section(title: string, body: string[]): string {
  return [`## ${title}`, "", ...body].join("\n");
}

const FENCE = "```";

function fence(language: string, content: string): string {
  return [`${FENCE}${language}`, content, FENCE].join("\n");
}

function ctxTable(rows: readonly CtxFaceRow[]): string {
  return table(
    ["face", "type", "present"],
    rows.map((r) => [`\`${r.face}\``, r.type, r.presence]),
  );
}

function document(title: string, blocks: string[]): string {
  return `${[BANNER, "", `# ${title}`, "", ...blocks].join("\n").trimEnd()}\n`;
}

// --- README --------------------------------------------------------------------

function readme(): string {
  const examples = loadExamples();
  return document("Authoring a VibeField plugin", [
    "A plugin is a directory with a manifest, one built entry module, and nothing else",
    "the host has to be told about. The manifest is the contract: it DECLARES what the",
    "plugin contributes, and code BINDS implementations to those declarations at",
    "activation. Anything a plugin can do, it declares first.",
    "",
    "These files are generated from the contracts themselves, so they describe the",
    `schema this app actually enforces (contracts ${CONTRACTS_VERSION}).`,
    "",
    section("The files", [
      table(
        ["file", "what it answers"],
        [
          ["`manifest.md`", "every manifest field, its rules, and the cross-field invariants"],
          ["`contributions.md`", "each contribution kind's shape, with a worked example"],
          [
            "`objects.md`",
            "an object kind on the desk: its durable half, its tray entry, the export that draws it, what the kind receives",
          ],
          ["`context.md`", "`activate(ctx)`, which faces exist when, and the lifecycle"],
          [
            "`cli.md`",
            "the kit's commands: emit, build, check, judge, and `try` — your object ON THE DESK; then pack and dev-link",
          ],
          ["`refusals.md`", "every refusal code the kit can emit, and what fixes it"],
        ],
      ),
      "",
    ]),
    section("The shortest real plugin", [
      "An OBJECT on the desk: the manifest DECLARES it, the renderer module EXPORTS it,",
      "and its kind DRAWS it — files you write, two the tools produce:",
      "",
      "```",
      "my-plugin/",
      "  src/manifest.ts           # TS authors the manifest (the object's durable half)",
      "  src/renderer.ts           # the entry: activate + the object's export",
      "  src/kind.ts               # the kind: create · resolve · record · hit",
      "  src/pass.ts               # its pass, on the host's device",
      "  src/shaders.wgsl          # its own WGSL — plugin-build inlines it as text",
      "  scripts/emit-manifest.ts  # writes the canonical JSON",
      "  vibefield.plugin.json     # EMITTED — never hand-edited",
      "  dist/renderer.js          # BUILT — the artifact the manifest names",
      "  package.json              # build + gen:manifest scripts",
      "```",
      "",
      "The manifest, complete and minimal — one object kind (`objects.md` says every field):",
      "",
      fence("json", jsonBlock(examples.objects.manifest)),
      "",
      `*(${examples.objects.source})*`,
      "",
      "`engines.app` is the app versions the plugin runs on — the scaffold's `>=0.0.0` takes any,",
      "the example's `^0.1.0` the 0.1 line. A kind asks for NO capability (`capabilities: []`) to",
      "draw, or to write its own objects —",
      "a menu act's or a held tool's write goes through the desk's gate, one transaction each.",
      "Capabilities gate what `ctx.client` asks of the product (`manifest.md`).",
      "",
      "The renderer module it names — the kind is a static EXPORT that `binding.kind` names, never",
      `a registration (quoted whole from \`${EXAMPLE_PLUGIN_DIR}/src/renderer.ts\`, the worked`,
      "example in `objects.md`):",
      "",
      fence("ts", repoFile(`${EXAMPLE_PLUGIN_DIR}/src/renderer.ts`)),
      "",
      "The manifest is AUTHORED in TypeScript and EMITTED to that JSON — re-emit it after",
      "every edit of `manifest.ts` (`vibefield-plugin emit-manifest <dir>`, or `pnpm gen:manifest`",
      "with an install) and never edit the JSON by hand: `check` refuses JSON that is not canonical",
      "(`manifest-stale`), but a canonical JSON that went stale reads as any other:",
      "",
      fence(
        "ts",
        [
          "// src/manifest.ts — typed against the contract: a type error where TypeScript runs, and emit-manifest refuses it either way",
          'import type { PluginManifestV1 } from "@vibefield/contracts";',
          "",
          "export const manifest: PluginManifestV1 = {",
          "  manifestVersion: 1,",
          '  id: "com.example.clock",',
          '  version: "0.1.0",',
          '  title: "Example Clock",',
          '  engines: { app: "^0.1.0", contracts: "^0.1.0" },',
          '  entries: { renderer: "./dist/renderer.js" },',
          '  activation: ["onObject:com.example.clock"],',
          "  capabilities: [],",
          "  contributes: { objects: [/* … */] },",
          "};",
        ].join("\n"),
      ),
      "",
      fence(
        "ts",
        [
          "// scripts/emit-manifest.ts — the one writer of the canonical artifact",
          'import { dirname, join } from "node:path";',
          'import { fileURLToPath } from "node:url";',
          'import { emitManifest } from "@vibefield/plugin-build";',
          'import { manifest } from "../src/manifest";',
          "",
          "emitManifest(",
          "  manifest,",
          '  join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),',
          ");",
        ].join("\n"),
      ),
      "",
      "The package.json that wires it together — the build script is the whole build:",
      "",
      fence(
        "json",
        jsonBlock({
          name: "@example/plugin-clock",
          private: true,
          type: "module",
          scripts: {
            build: "plugin-build",
            "gen:manifest": "tsx scripts/emit-manifest.ts",
            test: "vitest run",
          },
          dependencies: {
            "@vibefield/contracts": "workspace:*",
            "@vibefield/plugin-sdk": "workspace:*",
          },
          devDependencies: {
            "@vibefield/plugin-build": "workspace:*",
            "@webgpu/types": "^0.1.74",
          },
        }),
      ),
      "",
      "And the loop — the kit's own commands, from the plugin's directory:",
      "",
      fence(
        "sh",
        [
          "vibefield-plugin emit-manifest .  # src/manifest.ts → vibefield.plugin.json  (pnpm gen:manifest)",
          "plugin-build .                    # dist/renderer.js, its .wgsl inlined      (pnpm build)",
          "vibefield-plugin check .          # the whole suite, against the BUILT module",
          "plugin-playground .               # its kind driven through every declared state",
          "plugin-playground . --still       # each state DRAWN on Dawn, held to test/still.golden.json",
          "vibefield-plugin try .            # ON THE DESK: drawn — or why not — with stills",
        ].join("\n"),
      ),
      "",
      "NOTHING NEEDS INSTALLING for these, outside a checkout's workspace too: the kit's",
      "commands bind the SDK to the copy they run from, as the app's import map does. In a",
      "checkout of VibeField they are also its root scripts (`pnpm plugin <command> <dir>`,",
      "`pnpm playground <dir>`); only a plugin's own `pnpm` scripts (`gen:manifest`, `test`,",
      "`typecheck`) need an install, which only the checkout's workspace gives (`plugins/*`).",
      "",
      "Do not hand-author this layout: the scaffolder emits it working, and prints the next",
      "commands for where it landed. Start every new plugin with",
      "",
      fence(
        "sh",
        [
          'create-plugin --id vendor.name --title "My Plugin" --dir <dir>',
          "# outside a workspace — nothing to install, then:",
          "plugin-build <dir>                 # its kind's .wgsl inlined",
          "vibefield-plugin check <dir>       # a fresh scaffold is check-clean from birth",
          "plugin-playground <dir>            # its kind judged over every declared state",
          "vibefield-plugin try <dir>         # its object drawn on the desk",
          "# in a checkout, under plugins/: pnpm install, then pnpm --filter <package> build,",
          "#   pnpm plugin check plugins/<name>, pnpm playground plugins/<name>, pnpm plugin try plugins/<name>",
        ].join("\n"),
      ),
      "",
      "The scaffold ships `manifest.ts` + its emit script, one working OBJECT KIND — its",
      "kind, its pass, its record and its `.wgsl` — `playground/states.ts` starter states, the",
      "manifest contract and the kind's state test, a README with the ten-minute path, and the",
      "build preset — every file already in the shape `check` demands.",
      "",
    ]),
    section("The rules that catch people first", [
      "- **Every contributed id is owned by the plugin id.** An object's type is `<id>` or",
      "  `<id>.<name>`; commands and surfaces are `<id>.<name>`; behaviors are",
      "  `<id>:<name>`; custom",
      "  capabilities are `x.<id>.<name>`.",
      "- **Declare, then export or bind.** An object's code half is the export its row's",
      "  `binding.kind` names, a desk kind whose registry name IS the type — `check` refuses",
      "  one missing, not a desk kind, or named otherwise. Commands, surfaces and behaviors",
      "  register in `activate`, which throws for an id the manifest does not declare, and",
      "  `check` refuses a declaration nothing binds.",
      "- **The manifest is emitted, not written.** `vibefield.plugin.json` is canonical",
      "  key-sorted JSON; its hash is the plugin's identity. Edit `src/manifest.ts` and",
      "  re-emit (`vibefield-plugin emit-manifest`); `check` refuses JSON that is not",
      "  canonical (`manifest-stale`).",
      "- **On the desk means `try`.** `check` and the playground READ a kind's WGSL (only",
      "  `plugin-playground --still` compiles and draws it, off the desk, on Dawn), and",
      "  nothing a person can do lays a plugin's kind yet (the pegboard that",
      "  hangs your tray entry is still to come). `vibefield-plugin try <dir>` lays one on a",
      "  fresh board in the app and says whether it is DRAWN — its WGSL compiled on the device,",
      "  picked where it lies — with stills by day and by night (`cli.md`).",
      "- **The SDK is the only door.** Plugin code imports `@vibefield/plugin-sdk`",
      "  (plus `/ui`, `/canvas`, `/behavior`, and `/desk` for a kind), `@vibefield/contracts` types, and",
      "  `react`. Nothing",
      "  else — no host packages, no Electron, no Node builtins.",
      "- **Absent APIs are absent, never stubbed.** If a face is missing from `ctx`,",
      "  the manifest did not ask for it. See `context.md`.",
      "",
    ]),
  ]);
}

// --- manifest ------------------------------------------------------------------

function manifestDoc(): string {
  const examples = loadExamples();
  const limits = Object.entries(PLUGIN_LIMITS).map(([key, value]) => [`\`${key}\``, String(value)]);
  return document("The manifest", [
    "`vibefield.plugin.json` is the installed contract. It is EMITTED from a typed",
    "`src/manifest.ts` by ONE writer — plugin-build's `emitManifest`, which the plugin's",
    "`gen:manifest` script calls with an install and `vibefield-plugin emit-manifest <dir>`",
    "calls with none — validated, defaulted and canonicalized (keys sorted, 2-space indent,",
    "one trailing newline), so the same manifest always produces the same bytes: the",
    "plugin's `manifestHash` and its packed artifact's sha256 both derive from them.",
    "`plugin-build` READS it and never writes it; re-emit after every edit of `manifest.ts`.",
    "",
    section("Top-level fields", [
      fieldTable(fieldsOf(PluginManifestV1Shape)),
      "",
      "`engines.app` and `engines.contracts` are semver ranges the host checks before",
      "a plugin loads; `engines.platforms` narrows to `darwin`/`linux`/`win32`.",
      "`entries` names BUILT `.js` artifacts, `./`-relative, inside the plugin",
      "directory. `host` applies only to `entries.service` and defaults to `worker`.",
      "",
    ]),
    section("Cross-field invariants", [
      "These are checked together, after the field rules. The message column is what",
      "the schema itself says — `check` prints it verbatim with a pointer.",
      "",
      table(
        ["rule", "pointer", "message"],
        invariantRows().map((r) => [r.topic, `\`${r.pointer}\``, r.message]),
      ),
      "",
    ]),
    section("Activation events", [
      "`activation` lists the events that make the host load the plugin:",
      "",
      "- `onStartup` — service entries only, requires the `background` capability and a",
      "  `backgroundReason` that says why in the user's words.",
      "- `onObject:<object type>`, `onCommand:<command id>`, `onSurface:<surface id>`,",
      "  `onService:<x.pluginId.method>` — each must name something this manifest",
      "  declares. `onObject:` activates the plugin no later than its type's first",
      "  instance appearing in the document — this build activates every enabled",
      "  renderer at its boot, so it has fired before any board opens — and it is",
      "  independent of the kind's pass, which the desk makes for every registered kind",
      "  at its mount, an instance on the board or not.",
      "- `onWidget:<type>` is RETIRED and refused by name (`onwidget-activation-retired`):",
      "  an object's activation event is `onObject:<type>`.",
      "",
      "An empty `activation` list is legal: the plugin is registered, and loads when",
      "something it contributes is first reached.",
      "",
    ]),
    section("Capabilities", [
      "`capabilities` is a REQUEST, and it is a ceiling rather than a grant: the host",
      "intersects it with what the entry kind may hold, what the user has revoked, and",
      "what the source policy allows. A capability the renderer may not hold is denied",
      "with `entry-kind` even when the manifest asks for it.",
      "",
      table(
        ["capability", "renderer", "service"],
        Object.entries(PLUGIN_CAPABILITY_ELIGIBILITY)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([capability, eligibility]) => [
            `\`${capability}\``,
            eligibility?.renderer === true ? "yes" : "—",
            eligibility?.service === true ? "yes" : "—",
          ]),
      ),
      "",
      "Anything absent from this table is not plugin-eligible at all. A plugin may also",
      "declare its OWN capabilities (`x.<pluginId>.<name>`) to gate calls into its",
      "dynamic service methods — see `contributions.md`.",
      "",
    ]),
    section("Limits", [
      "Every string and collection in a manifest is bounded (§7.1). The numbers:",
      "",
      table(["limit", "value"], limits),
      "",
    ]),
    section("A manifest that uses most of it", [
      fence("json", jsonBlock(examples.service.manifest)),
      "",
      `*(${examples.service.source})*`,
      "",
    ]),
  ]);
}

// --- contributions --------------------------------------------------------------

function contributionsDoc(): string {
  const examples = loadExamples();
  const objectSlice = contributionSlice(examples.objects, "objects");
  const commandSlice = contributionSlice(examples.commandsAndSurfaces, "commands");
  const surfaceSlice = contributionSlice(examples.commandsAndSurfaces, "surfaces");
  const settingsSlice = contributionSlice(examples.service, "settings");
  const servicesSlice = contributionSlice(examples.service, "services");
  const behaviorsSlice = contributionSlice(examples.service, "behaviors");
  const capabilitiesSlice = contributionSlice(examples.service, "capabilities");
  const mcpSlice = contributionSlice(examples.service, "mcp");

  const kindSection = (
    title: string,
    schema: unknown,
    slice: { source: string; value: unknown } | undefined,
    prose: string[],
  ): string =>
    section(title, [
      ...prose,
      "",
      fieldTable(fieldsOf(schema)),
      "",
      ...(slice === undefined
        ? []
        : [fence("json", jsonBlock(slice.value)), "", `*(${slice.source})*`, ""]),
    ]);

  return document("Contributions", [
    "`contributes` is where a plugin declares what it adds. Each kind below is a key",
    "under it; every one is optional, and the cross-field invariants in `manifest.md`",
    "decide which entry module and which capability each kind requires.",
    "",
    kindSection("Objects", ObjectContribution, objectSlice, [
      "An object is a kind the desk DRAWS — one WebGPU renderer, the kind's own GPU",
      "program — declared by its DURABLE half (the type, its props, its size) and bound",
      "by ONE export name; `tray` hangs it on the pegboard. `objects.md` is the deep end.",
    ]),
    kindSection("Commands", CommandContribution, commandSlice, [
      "A command is an invocable action the spine places (palette, context menus, HUD,",
      "godview). The spine owns ordering, args validation and provenance; the plugin",
      "binds a handler with `ctx.commands.register(id, handler)`.",
    ]),
    kindSection("Surfaces", SurfaceContribution, surfaceSlice, [
      "A surface is a React component the spine mounts in a named slot. The SLOT is",
      "manifest truth — a component cannot choose where it appears — and only a side",
      "panel is given a `requestClose()`. Bind with `ctx.surfaces.register(id, Component)`.",
    ]),
    kindSection("Settings", SettingsContribution, settingsSlice, [
      "Declared keys only. Each property carries a title, a scope (`user` syncs,",
      "`device` stays local, `secret` never leaves the keychain) and a JSON Schema the",
      "host validates writes against. Reading them from code requires `storage.self`,",
      "and the values arrive through `ctx.settings`.",
    ]),
    kindSection("Dynamic services", ServiceContribution, servicesSlice, [
      "A service entry may expose methods under its own `x.<pluginId>` namespace. Each",
      "method declares its kind, the capability a caller must hold, whether it is",
      "idempotent, and its JSON Schemas. The host validates both directions, so an",
      "invalid input never reaches the provider and an invalid output becomes",
      "`PLUGIN_SCHEMA_VIOLATION`.",
      "",
      "Method kinds:",
      "",
      ...(variantsOf(ServiceMethodContribution) ?? []).map(
        (v) => `- \`${v.discriminant}\` — ${v.fields.map((f) => `\`${f.name}\``).join(", ")}`,
      ),
    ]),
    kindSection("Canvas behaviors", BehaviorContribution, behaviorsSlice, [
      "A behavior is ICE execution code with a signed, complete descriptor. Define it",
      "through the React-free `/behavior` door, put `declareBehavior(handle)` under",
      "`contributes.behaviors`, then bind the SAME handle during renderer activation:",
      "`ctx.canvas.behaviors.bind(handle.name, handle)`. The host compares every",
      "descriptor field before publication; missing, duplicate, renamed, or drifted",
      "handles fail closed.",
      "",
      "All behavior declarations request `canvas.write`. A denied grant still permits",
      "the inert declaration/code bind, but the sealed binding is dormant and never",
      "registers with ICE. Ephemeral behaviors must declare `maxFacetBytes`: ICE",
      "enforces the canonical UTF-8 JSON bytes of the complete facet before a default or",
      "runtime write publishes. VibeField charges that claim plus 256 bytes per",
      "declaration; one plugin and the deterministic window-wide admitted set must fit",
      "48 KiB, leaving 16 KiB below the transport ceiling for core presence and encoding",
      "headroom. Plugins are admitted atomically in canonical plugin-id order; values are never",
      "silently truncated. A tick hook also requires `reason`, because frame cadence is",
      "a scarce power.",
      "",
      fence(
        "ts",
        [
          'import { declareBehavior, defineBehavior, p } from "@vibefield/plugin-sdk/behavior";',
          "",
          'export const Counter = defineBehavior("com.example.metrics:counter", {',
          '  store: "runtime",',
          "  schema: { count: p.number({ default: 0 }) },",
          "});",
          "export const counterContribution = declareBehavior(Counter);",
          "",
          'export const Presence = defineBehavior("com.example.metrics:presence", {',
          '  store: "ephemeral",',
          "  maxFacetBytes: 256,",
          '  schema: { mode: p.string({ default: "active" }) },',
          "});",
          "export const presenceContribution = declareBehavior(Presence);",
          "",
          '// manifest.ts: behaviors: [counterContribution], capabilities: ["canvas.write"]',
          "// renderer.ts: ctx.canvas.behaviors.bind(Counter.name, Counter)",
        ].join("\n"),
      ),
    ]),
    kindSection("Custom capabilities", PluginCapabilityContribution, capabilitiesSlice, [
      "A plugin that provides services can define the capabilities that gate them:",
      "`x.<pluginId>.<name>`, with a risk level the user sees when granting.",
    ]),
    kindSection("MCP", McpContribution, mcpSlice, [
      "`tools` project already-declared service methods to agents; `servers` declare",
      "external MCP servers whose transport settings come from DECLARED settings keys",
      "(a url from a `device`-scope key, a secret from a `secret`-scope one) — never",
      "from literals in the manifest.",
    ]),
  ]);
}

// --- objects ---------------------------------------------------------------------
//
// DK-0f (2026-10-02): the object door's reference, written for the ten-minute
// bar (DK-D30) — an agent reads these files and nothing else, so what a kind
// receives and must answer is spelled out here rather than pointed at. DK-6: the
// SDK's `/desk` door carries the kind's types, and the worked example is the
// repo's own plugin — ICE's desk clock ported (examples/plugins/desk-clock) —
// QUOTED from its source at generation (`quotedRegion`), never cited by path.

function objectsDoc(): string {
  const examples = loadExamples();
  const propVariants = variantsOf(PropSpec) ?? [];
  const slice = contributionSlice(examples.objects, "objects");
  const retired = Object.entries(OBJECT_RETIRED_FIELDS);
  return document("Objects", [
    "An OBJECT is a canvas face the desk DRAWS. One WebGPU renderer draws every object",
    "on the cutting mat straight from the document, and a KIND is the GPU program that",
    "draws its own objects — its WGSL, its pass, its geometry, its pick. Whatever a",
    "built-in kind can do, a plugin kind declares the same way (plugin parity): there",
    "is no React component and no DOM under the camera.",
    "",
    "The manifest owns the DURABLE half — the type name, prop names and group names",
    "outlive any implementation — and names ONE export of the renderer module that",
    "holds the kind. The host compiles the two halves into the object (`defineObject`);",
    "plugin code never does.",
    "",
    section("On the desk, today", [
      "Every door ACCEPTS the contract below: fieldd lists the plugin's kinds, `check`",
      "activates it like any plugin, and the renderer compiles each kind through",
      "`defineObject` before the desk's first frame. What no door does yet is LAY one: the",
      "pegboard that hangs your `tray` entry is not wired into the desk's chrome, so nothing",
      "a person can do puts your object on a board. `vibefield-plugin try <dir>` does it for",
      "you — the app, on a fresh profile with your plugin staged alone, lays one object of",
      "each of your kinds on a fresh board and says whether each is DRAWN (`cli.md`).",
      "",
    ]),
    section("Declaring", [
      "One entry per kind under `contributes.objects`:",
      "",
      fieldTable(fieldsOf(ObjectContribution)),
      "",
      "- `type` is the durable name, `<pluginId>` or `<pluginId>.<name>`.",
      "- `size` is what a new one spawns at, in world units; `minSize` bounds a resize",
      "  (`interaction.resizable`). There is no size mode: an object is its size.",
      "- `interaction`, `container`, `props`, `groups`, `behaviors` carry the canvas's",
      "  durable vocabulary — Props and Conflict groups, below, say each in full.",
      "- `provides` is what the DESK PLACES BY, never a type list: `desk.object` lies on",
      "  the desk (declare it, or nothing places the kind), `desk.containable` goes into",
      "  a mini mat (then declare `chip`, below), `desk.pinnable` pins to a calendar's",
      "  day. A container's own `container.accepts`/`provides` use the same keys.",
      "- `ports` are accepted and recorded; the desk draws no wire until the STRING",
      "  program lands — a kind with ports hangs and places like any other meanwhile.",
      "- `tray` hangs a specimen on the pegboard (next section); absent, the kind is",
      "  placeable but hangs nowhere.",
      "- `binding.kind` names the export (an identifier) that holds the kind — one name,",
      "  read by the host, never registered from `activate`.",
      "- `onObject:<type>` is an object's activation event — the plugin is activated no",
      "  later than the type's first instance appearing in the document, independent of",
      "  the kind's pass (the desk makes every registered kind's pass at its mount). The",
      "  retired `onWidget:<type>` is refused by name (`onwidget-activation-retired`).",
      "",
      "The old canvas face's view fields are RETIRED on an object and refused by name:",
      "",
      table(
        ["field", "where it went"],
        retired.map(([field, why]) => [`\`${field}\``, why]),
      ),
      "",
      ...(slice === undefined
        ? []
        : [fence("json", jsonBlock(slice.value)), "", `*(${slice.source})*`, ""]),
    ]),
    section("Props", [
      "Props are the object's durable data. Each is one of these kinds:",
      "",
      table(
        ["kind", "fields", "notes"],
        propVariants.map((v) => [
          `\`${v.discriminant}\``,
          v.fields.map((f) => `\`${f.name}\``).join(", ") || "—",
          v.discriminant === "json"
            ? "`inner` describes the nested shape; the value rides one string cell"
            : v.discriminant.endsWith("-ref")
              ? "an opaque host reference — the host resolves it, the plugin never parses it"
              : "—",
        ]),
      ),
      "",
      "Every kind also accepts `optional` and `mutable` (default true). A default must",
      "satisfy its own spec — an enum default outside `options`, a number outside",
      "`min`/`max`, a string over `maxLength` are all refused at emit.",
      "",
    ]),
    section("Conflict groups", [
      "Props that change together belong in a named group. The name is durable: the",
      "engine generates a component named `<object type>:<group name>` from it, and two",
      "editors writing different groups of the same object never conflict.",
      "",
      "- Omitting `groups` is the common case — ungrouped props join the engine's",
      "  default `props` group.",
      "- A group name matches `[a-z][a-z0-9-]*`, every member must be a declared prop,",
      "  and a prop belongs to at most one group.",
      "- An immutable prop (`mutable: false`) belongs to no group at all.",
      "",
      fence(
        "ts",
        [
          "props: {",
          '  title: { kind: "string", default: "" },',
          '  body: { kind: "string", default: "" },',
          '  color: { kind: "enum", options: ["amber", "slate"], default: "amber" },',
          "},",
          "groups: {",
          '  text: ["title", "body"],   // one editor typing',
          '  style: ["color"],          // another recolouring — no conflict',
          "},",
        ].join("\n"),
      ),
      "",
    ]),
    section("The tray entry", [
      "The pegboard tray hangs what the entry says, drawn by the kind itself — a",
      "specimen is the kind's stateless drawing of `tray.props` over the object's",
      "defaults.",
      "",
      fieldTable(fieldsOf(TrayEntryContribution)),
      "",
      "- `category` is the chip on the tray's bar: a plugin's own string is its own chip,",
      "  or name a built-in's (`paper`, `surfaces`, `things`) to join it.",
      "- `hang` is how it hangs, and every entry says it: its size on the board in CSS px,",
      `  the accessory (${TRAY_ACCESSORIES.map((a) => `\`${a}\``).join(", ")}) and the pegs in pitches from the hang point`,
      "  (a pitch is the board's hole spacing; the hang point is the specimen's top edge's centre,",
      "  its bottom edge's on a shelf — so a hook at `[0, -0.5]` sits half a pitch above it).",
      "  Size it from the specimen: the board draws the object at its natural size scaled",
      "  by the smaller of `hang.w / size.w` and `hang.h / size.h`, centred — so a hang of",
      "  the object's own aspect fills it (ICE's note hangs 120 × 120, its whiteboard",
      "  240 × 160).",
      "- `take` is what one lifted off the board is made with: absent, the object's",
      '  defaults; `"face"`, the specimen\'s props; a record, those props.',
      "- `local: true` draws the specimen with the kind's desk state (a note's writing);",
      "  absent, the specimen is the kind's stateless drawing.",
      "",
    ]),
    section("The binding — one export", [
      "The renderer module exports the kind under the name `binding.kind` names. The",
      "export is the object's CODE half, `ObjectBinding`, from the SDK's object door",
      "`@vibefield/plugin-sdk/desk` — the one door every name a kind is written against",
      "arrives through (below, verbatim from the SDK's source):",
      "",
      fence("ts", quotedRegion("packages/plugin-sdk/src/desk.ts", "object-binding")),
      "",
      "`activate(ctx)` stays the module's entry — commands, surfaces and behaviors bind",
      "there as before — but a kind is NOT registered from it. The host reads the export,",
      "compiles the prefab from the manifest's durable half, and registers the kind with",
      "the desk's renderer before the first frame: every kind's pass is created together",
      "at mount, which is why the binding is a static export and not a call.",
      "",
      "The kind, whole (`ObjectKind`, from the door):",
      "",
      table(
        ["member", "required", "what it is"],
        [
          [
            "`name`",
            "yes",
            "the kind's registry name — it IS the object's type (the host refuses any other: `check` says `object-kind-misnamed`)",
          ],
          [
            "`stratum`",
            "yes",
            "`pads` \\| `sheets` \\| `things` — the desk's paint order: beneath everything (the calendar) · flat on the mat, holding a desk of its own (the mini mat) · every other thing (the note, the whiteboard, the notebook, the clock) — a card or a token is a `things` kind",
          ],
          [
            "`create(device, format, mat)`",
            "yes",
            "→ `Promise<KindPass>`: the kind's PASS on the host's `GPUDevice` for the swap chain's `format`, on the root mat's pass (`MatPass` — the slot's view block, bound once, never written by a kind)",
          ],
          [
            "`reach`",
            "yes",
            "how far the drawing may reach PAST the rect, world units (shadow, lift, tilt): the desk culls the object only once its rect grown by `reach` leaves the view, and asks your `hit` anywhere within it — what `hit` answers is what is picked",
          ],
          [
            "`resolve(ctx)`",
            "yes",
            "the geometry `G` this frame, from the rect, the props and the flux",
          ],
          ["`record(G, ctx)`", "yes", "the record `R` the pass draws for that geometry"],
          [
            "`hit(G, wx, wy)`",
            "yes",
            'the CPU mirror of the pass: `"content"` or `"frame"` is the object itself (a tap selects, a drag moves), any other string is a PART, `null` a miss',
          ],
          [
            "`chip(G, ctx)`",
            "no",
            "its far impostor inside a container's face — needed to go into a mini mat (`desk.containable`)",
          ],
          ["`frame(G)`", "no", "the silhouette the desk's marks go round; absent, the rect"],
          [
            "`theme(palette, name)`",
            "no",
            "its look `L` from the host's palette, per theme — `ctx.look`",
          ],
          [
            "`local(host)`",
            "no",
            "its desk state (`KindLocal`: `tick` · `due` · `landed` · `forget`) — and the registered wake, below",
          ],
          [
            "`open`",
            "no",
            'what picking it up means (`OpenBinding`, quoted below): `extent` (the open rect), `pose` (`camera` \\| `eye`), `tools` (the held bar\'s, each a `HeldToolDef` — `kind: "action"` with its op `run`, or `kind: "mode"`; with NO kind it is declared only, dim and never run), `readout` (its word in hand)',
          ],
          [
            "`rezoom` / `rung(ctx)`",
            "no",
            "the record reads the zoom continuously / only through a rung (a raster's band)",
          ],
          [
            "`face(G)` · `faceLaw` · `insideGrid`",
            "no",
            "a CONTAINER kind: the window its inside shows through, its chip law, its inside's grid",
          ],
          ["`reads`", "no", "components and tags beyond its props the builder journals for it"],
          [
            "`composite` · `card`",
            "no",
            "a layered kind (its own target, laid once) · a CARD MATERIAL (quoted below): its objects drawn by the desk's one flat-card pipeline with its own WGSL — an option ON TOP of its own pass, never instead of one",
          ],
        ],
      ),
      "",
      "The pass (`KindPass`): `spawn(mat)` makes another slot's pass on the shared",
      "pipelines; `prepare(encoder, slot, records, extra)` uploads this frame's records in",
      "paint order and returns the count that will draw; `drawRange(pass, first, end)`",
      "draws a run; `dispose()`. Optional: `records()`/`dropped()` (counters the host",
      "reports), `idle(ms)`/`idleAt(ms)` (let device targets go when nothing drew),",
      "`drawOver`, `endHold`, `tune`/`setLaw`, `cardResources`/`cardSlot`.",
      "",
    ]),
    section("The worked example — ICE's desk clock as a plugin", [
      `\`${EXAMPLE_PLUGIN_DIR}\` is ICE's worked third-party kind, ported to a VibeField plugin through`,
      "`@vibefield/plugin-sdk/desk` alone — the PARITY WITNESS: the product draws it beside the",
      "desk's six built-ins, from a plugin. Its law, hands, zone and wakes are ICE's verbatim; the",
      "code below is QUOTED from its source when these docs are generated, so it is the code that",
      "ships.",
      "",
      "Its manifest row — the durable half (`src/manifest.ts`, emitted to `vibefield.plugin.json`):",
      "",
      fence("json", jsonBlock(exampleObjectRow())),
      "",
      "The export that row's `binding.kind` names (`src/object.ts`) — the kind and its",
      "selection-menu act:",
      "",
      fence("ts", quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/object.ts`, "binding")),
      "",
      "The renderer module (`src/renderer.ts`), whole — the kind is an export, never a",
      "registration:",
      "",
      fence("ts", repoFile(`${EXAMPLE_PLUGIN_DIR}/src/renderer.ts`)),
      "",
      "The kind, whole (`src/kind.ts`): its program on the root's mat, the case resolved under",
      "the desk's lamp, its hands recorded at the time it shows, its round pick, its chip inside a",
      "container's face, the frame the desk's marks go round, its look, its desk state and its",
      "opening — every name from the SDK's door:",
      "",
      fence("ts", quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/kind.ts`, "kind")),
      "",
      "Its WGSL ships as `.wgsl` FILES (`src/clock.wgsl`, `src/clock-pass.wgsl`): plugin-build",
      "inlines each into the renderer bundle as its text, and the program composes them after the",
      "kit's pieces by name (`src/shaders.ts`):",
      "",
      fence("ts", quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/shaders.ts`, "program")),
      "",
      "Its registered wake (`src/local.ts`): the desk asks `due` after every step and gets the",
      "wall clock's next boundary a drawn clock needs — a frame a second with its seconds hand, a",
      "minute without, none at all with no clock drawn:",
      "",
      fence("ts", quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/local.ts`, "due")),
      "",
      "The rest is its own: `src/pass.ts` (instanced, a persistent record store, the slot's one",
      "view block bound and never written), `src/layout.ts` (its GPU record, declared once),",
      "`src/law.ts` (pure: the time it shows, the hands, the zone, the wake's arithmetic),",
      "`src/theme.ts` (its look from the palette), `src/glyphs.ts` (its act's and tools' own",
      "drawings) — and `test/imports.test.ts`, its wall: it names `@vibefield/plugin-sdk`, `/desk`,",
      "its own modules and its `.wgsl`, never `@vibecook/ice` and never `/desk/objects`.",
      "",
    ]),
    section("What the kind receives", [
      "Everything a kind needs ARRIVES; a kind never reads the world or the DOM itself,",
      "so the same kind draws for the app, a test's fake world and the Node oracle alike.",
      "",
      "- **`create(device, format, mat)`** — the host's one `GPUDevice` (the renderer's",
      "  realm, the host's device, at today's trust — see `context.md`), the swap chain's",
      "  `GPUTextureFormat`, and the root mat's `MatPass`: the slot's view block (camera,",
      "  light, frame — written once per frame per slot, bound once) and the mat's own",
      '  silhouette. Kit WGSL pieces compose in by name (`kitWgsl(["view", "portal",',
      '  "sdf", "light"])`): a kind multiplies by `portal_cover` and fades inside a',
      "  container's face with no code of its own.",
      "- **`resolve(ctx)` / `record(G, ctx)` / `chip(G, ctx)`** — one `ObjectContext` per",
      "  entity per frame: `entity`; `rect` (centred `cx, cy, w, h`, world units — the",
      "  builder converts from the document's top-left once); `props` (the group fields,",
      "  cached from the change journal, never re-read per frame); `flux` (`lift` 0..1 in a",
      "  hand, `hover`, `fade` 1 alive … 0 gone, `ring` always 0); `look` (your `theme()`",
      "  result); `theme`; `lamp` (the desk's one light, world units); `view` (camera + box",
      "  + dpr); `grid`; `dt` (seconds); `asset?` (a still the host pinned); `local?` (your",
      "  desk state); `inside?` (a container's content bounds, view and chips); `held?`",
      "  (the carry amount, whether to open, the eye kind's rise).",
      "- **`local(host)`** — a `KindHost`: `pass()` your root pass; `use(key)` the SERVICES",
      "  lent on this desk — the host's text raster (`TEXT_RASTER`), picture decoder",
      "  (`PICTURE_DECODER`) and blob store (`BLOB_STORE`), and what any object's DOM half",
      "  lends — always through this registry, never a host object directly; `children`",
      "  (an object's data children, a board's strokes); `drawn`, `budget`, `rasters`,",
      "  `remake`, `wake` (the desk's own doors — never lent, never replaced).",
      "- **`drivers(host)`** — a `KindDriverHost`: the `world`, the document's doors",
      "  (`docs` — facts are written ONLY through them, at a gesture's end), your `local`",
      "  and `look`, `isKind`/`kind(name)`/`provides(key)` predicates (ask after a",
      "  capability, never another kind's name), the builder's word (`geometryOf`,",
      "  `heldToWorld`, `hand`), `refused`, `wake`. A driver is `follow(now)` once a frame",
      "  before the kinds' clocks, `idle()` when it has nothing to follow, `dispose()`.",
      "- **`host.lend` / `host.text` / `host.mount`** — the DOM half, in the layer's order:",
      "  `lend` services only a browser makes (handed what is lent so far and a `wake`);",
      "  `text` the object's TEXT PARTS that lease the desk's ONE editor (a part with `tap`",
      "  is routed every tap; one without is leased by your own half at event time);",
      "  `mount` a screen-space half handed an `ObjectDomHost` (`container`, `world`,",
      "  `docs`, `use`, `editor`, `object`, `driver`, `look`, the builder's word, `wake`).",
      "- **`menu[].run(api)`** — a `MenuActionApi`: `api.entities` (the selected objects of",
      "  your type, in selection order), `api.props(e)`, `api.setProps(e, patch)`,",
      "  `api.transact(fn)`. **A held tool's `run(api)`** — a `HeldToolApi`: the object in",
      "  hand is `api.entity`, so `api.props()` and `api.setProps(patch)` take no entity;",
      "  plus `api.transact(fn)`, `api.undo()`, `api.redo()`. Every write is ONE",
      "  transaction, one undo step (`{ undoable: false }` opts out).",
      "",
    ]),
    section("Reading props", [
      "`ctx.props` is FLAT: every prop the row declares, by its name, whatever conflict group it",
      "rides in, as the document holds it now (cached from the change journal — read it each",
      "frame, never keep it). Read each with its type and a default, through the door:",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/kinds/world.d.ts", "numberProp"),
          quotedDeclaration("desk/src/kinds/world.d.ts", "stringProp"),
        ].join("\n"),
      ),
      "",
      "A colour prop reads through `rgb` (the CSS syntaxes `cssColor` parses, to sRGB 0..1). A",
      "free-string colour prop can hold anything, and `rgb` never throws on what it cannot parse (a",
      "named colour like `red` among them): it answers the desk's missing ink, `MISSING_INK`, and says",
      "the string ONCE on the console — the object drawn and picked, plainly not the colour asked for,",
      "and never a strike against the kind. `rgb(s, { strict: true })` throws, for a kind that would",
      "rather fail on a typo of its own.",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/theme.d.ts", "RGB"),
          quotedDeclaration("desk/src/theme.d.ts", "cssColor"),
          quotedDeclaration("desk/src/theme.d.ts", "rgb"),
        ].join("\n"),
      ),
      "",
      'A boolean is `typeof v === "boolean" ? v : fallback` — the worked example\'s own `flagProp`',
      "(its `src/kind.ts`) is exactly that. A menu act's `api.props(e)` and a held tool's",
      "`api.props()` hand the same flat record; `setProps(patch)` writes the props you name.",
      "",
    ]),
    section("The kit's WGSL — what your shader is composed after", [
      "A kind's program is `kitWgsl(pieces, own)`: the kit's pieces you name, composed BEFORE",
      "your own structs, modules and entry into ONE WGSL module (`object-kit-piece-unknown`",
      "refuses a piece it does not carry). What each piece declares is in scope in your shader,",
      "and YOUR module-scope names must not repeat its. Each piece's module-scope names, complete,",
      "read from the kit's own text when these docs are generated:",
      "",
      ...KIT_PIECES.map(
        (piece) =>
          `- \`${piece}\`${piece === "light" ? " (also named `lamp`, `gobo`, `night`, `noise`)" : ""} — ${kitPieceDeclarations(
            piece,
          )
            .map((d) => `\`${d}\``)
            .join(", ")}`,
      ),
      "",
      "The VIEW BLOCK every kind binds — `@group(0) @binding(0) var<uniform> u: MatUniforms;`,",
      "written by the desk once a frame per slot, bound by a kind and never written. The fields",
      "a kind reads (its others are the mat's own — reach them only through the `light` piece):",
      "",
      table(
        ["field", "holds"],
        viewBlockFields().map(([field, holds]) => [`\`u.${field}\``, holds]),
      ),
      "",
      "The conventions the scaffold's shader keeps: world units, y DOWN (the screen's own axes);",
      "a kind's rect CENTRED (`cx, cy, w, h`); CSS px = (world − `u.cam.xy`) × `mat_zoom(u)`;",
      "clip space = CSS px ÷ `u.view.xy` × 2 − 1, y flipped; in a fragment `in.clip.xy` is",
      "DEVICE px, so world = `in.clip.xy` ÷ (`mat_zoom(u)` × `mat_dpr(u)`) + `u.cam.xy`. The colour",
      "a fragment returns is PREMULTIPLIED, times `u.view.w` × `portal_cover(in.clip.xy / mat_dpr(u),",
      "u.portals, u.clips, mat_dpr(u))` — so inside a mini mat's face it fades with no code of yours.",
      "",
      "A record's GPU struct is `defineStruct(name, fields)` — its WGSL generated from the one",
      "declaration, so the CPU and the GPU cannot drift; `kitWgsl(…, { structs: [It] })` puts it in",
      "scope. Its field types, laid out by WGSL's own alignment rules (`defineStruct` pads as WGSL",
      "does) — a `vec2f` first, scalars filling to 16 bytes, then each `vec4f`, as the scaffold's",
      "record does, wastes nothing:",
      "",
      fence("ts", quotedDeclaration("desk/src/engine/struct.d.ts", "FieldType")),
      "",
      "BY NIGHT: a kind that writes its colours straight out draws at daytime brightness on the",
      "night desk (the scaffold's disc does). Two ways to follow the night: pick your colours per",
      "theme in `theme(palette, name)` — the `look` your record reads, `name` one of",
      "",
      fence("ts", quotedDeclaration("desk/src/theme.d.ts", "ThemeName")),
      "",
      "— or LIGHT your albedo as the mat lights itself, as the worked example does: the `light`",
      "piece's `shade_mat` by day, `night_mat` by night, mixed by `u.night.x` (the gobo and noise",
      "it passes are the mat's own plates, which its pass binds beside the view block):",
      "",
      fence("wgsl", quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/clock.wgsl`, "colour")),
      "",
    ]),
    section("Shapes the desk takes — ICE's own declarations", [
      "These types are ICE's, re-exported by `@vibefield/plugin-sdk/desk`, quoted from the",
      "installed ICE's own declarations — doc comments and all — when these docs are generated.",
      "",
      "**`open` — what picking it up means, and its held bar's tools.** A tool with no `kind` is",
      "DECLARED ONLY — the bar shows it dim and never runs it: `check` refuses an op without one",
      "(`object-tool-inert`), and a tool ICE would refuse at definition (`object-tool-invalid`).",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/kinds/world.d.ts", "OpenBinding"),
          quotedDeclaration("core/src/widget/held-tools.d.ts", "HeldToolDef"),
          quotedDeclaration("core/src/widget/held-tools.d.ts", "HeldGlyph"),
        ].join("\n"),
      ),
      "",
      "**`chip` — its far impostor inside a container's face** (with `desk.containable`):",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/kit/inside.d.ts", "ChildShape"),
          quotedDeclaration("desk/src/kit/inside.d.ts", "PAPER_FINISH"),
          quotedDeclaration("desk/src/kit/inside.d.ts", "VINYL_FINISH"),
        ].join("\n"),
      ),
      "",
      "**`frame` — the silhouette the desk's marks go round** (absent: the rect):",
      "",
      fence("ts", quotedDeclaration("desk/src/marks/layout.d.ts", "MarkFrame")),
      "",
      "**`ctx.flux` — how it is held, hovered and present this frame:**",
      "",
      fence("ts", quotedDeclaration("desk/src/kinds/world.d.ts", "ObjectFlux")),
      "",
      "**`create(device, format, mat)` — the mat a pass is made on** (its view block, and the plates a",
      "kind lit as the mat is samples: the gobo `silhouette` and the blue `noiseTexture`), **and the",
      "record store a pass keeps** (`createRecordStore`: a record is packed into its slot only when it",
      "changed — `pack` writes its fields and returns the block records it used, 0 without blocks):",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/kit/view.d.ts", "MatPass"),
          quotedDeclaration("desk/src/engine/records.d.ts", "RecordPacker"),
          quotedDeclaration("desk/src/engine/records.d.ts", "RecordStoreOptions"),
        ].join("\n"),
      ),
      "",
      "**`ctx.lamp` — the desk's one light; and the palette `theme(palette, name)` is handed** (the",
      "desk's own roles; a host may hand more — VibeField's adds its pens, papers and inks):",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/mat/lamp.d.ts", "Lamp"),
          quotedDeclaration("desk/src/theme.d.ts", "Palette"),
        ].join("\n"),
      ),
      "",
      "**`tray.hang` — how its specimen hangs on the pegboard:**",
      "",
      fence("ts", quotedDeclaration("kernel/src/tray.d.ts", "TrayHang")),
      "",
      "**`card` — a card material: an option ON TOP of the kind's own pass, never instead of one.** A",
      "kind that declares one has its objects drawn by the desk's ONE flat-card pipeline, with its own",
      "WGSL functions over its own records, so objects of every card kind interleaved in paint order are",
      "one draw (without one, a run of one kind ends at the next object of another). It is not a way to",
      "draw a card without a pass: the kind still makes its pass — `prepare` uploads the records,",
      "`cardResources()` hands the card its bindings (a material whose pass hands none throws), and",
      "`cardSlot(i)` hands the card each record it may draw, by its slot in the kind's records (−1, or no",
      "`cardSlot` at all: the pass draws that record itself — so without it the card draws nothing of",
      "the kind). The kind draws every object itself whenever ICE leaves it out of the card: when it is",
      "`composite`, when its material names no fragment (`frag` or `fragInline`), when its bindings",
      "would pass the device's limits, when a binding or card-function name is already another kind's",
      "or a struct or module names like another's with different text (the kind registered first keeps",
      "it, and a plugin registers after the built-ins — prefix every name with your own; the card's own",
      "`u`, `gobo_tex`, `noise_tex` and `cards` are never a material's), or when its material does not",
      "compile — that one alone said on the console. The door exports `KindProgram`, whose `card` is",
      "typed by these two:",
      "",
      fence(
        "ts",
        [
          quotedDeclaration("desk/src/kind.d.ts", "CardMaterial"),
          quotedDeclaration("desk/src/kind.d.ts", "CardBinding"),
        ].join("\n"),
      ),
      "",
    ]),
    section("Where logic goes", [
      "Three places, each for its own kind of state (the desk's law: facts in the world,",
      "flux outside it):",
      "",
      "1. **desk state** — `kind.local(host)` → `KindLocal` (`tick`, `due`, `landed`,",
      "   `forget`): what you DRAW from flux and WHEN the desk must wake for it. Per desk,",
      "   never in the document, never polled. A clock is this alone: its hands read the",
      "   host's clock, `due` is the next second a drawn clock needs.",
      "2. **drivers** — `binding.drivers` → a `KindDriver` per desk, ticked before the",
      "   kinds' clocks: what FOLLOWS INPUT on one desk (a pen, a carry, a leaf, a typing",
      "   session) — the hand onto your flux, writing facts only through `docs` at the",
      "   gesture's end. Per view: two desks on one document have two pens.",
      "3. **behaviors** — `contributes.behaviors` + `ctx.canvas.behaviors.bind`, attached",
      "   through the object's `behaviors` riders (`contributions.md`): logic whose STATE",
      "   IS A FACT the world must sync, undo or keep across views (`durable` data riding",
      "   the object, `runtime` state every peer projects). Not for typing: a session's",
      "   live text is flux committed whole at its end.",
      "",
      "In short: drawn from time or a device → `local` with `due`; worked by hand →",
      "`drivers`; durable or peer-shared logic → `behaviors`.",
      "",
    ]),
    section("Wakes — a desk at rest takes no step", [
      "The loop sleeps unless something is due, and a kind that does not say when it is",
      "due pays the whole desk's idle. `KindLocal.due(now)` is asked after each tick:",
      "answer `now` while a motion runs, a later time for a blink or a layer let go,",
      "`Infinity` until a fact, an input or a wake moves it. **Absent while `tick` is",
      "declared, the kind is due EVERY frame and the desk never sleeps** — the host says",
      "so once on the console, naming the kind. Something that lands outside a frame (a",
      "picture decoded, a tile printed, a detail fetched) calls `KindHost.wake()`; a kind",
      "never polls for what an arrival can tell it.",
      "",
    ]),
    section("Checking it", [
      "One harness judges a kind everywhere: the SDK's kind-conformance harness",
      "(`@vibefield/plugin-sdk/testing` — `runKindConformance`), with no device and no DOM.",
      "`vibefield-plugin check` runs the manifest, wall, schema, artifact and activation rows",
      "as for any plugin, and holds each object row to the BUILT module with the harness's",
      "declaration and program checks: `binding.kind` names a real export",
      "(`object-export-missing`) holding a desk kind (`object-kind-invalid`) whose registry name",
      "is the row's type (`object-kind-misnamed`), hanging by a tray entry that says how",
      "(`object-tray-hang-missing`, `object-tray-category-invalid`), providing `desk.object`",
      "(`object-provides-no-desk-object`), its held tools ones ICE takes and runs",
      "(`object-tool-invalid`, `object-tool-inert`); every name the built module imports from the",
      "door one the door exports (`import-name-unknown`); its `create`, run on a RECORDING device that answers",
      "every call as WebGPU does short of compiling, names only the kit's pieces",
      "(`object-kit-piece-unknown`), asks for its shader as WGSL TEXT (`object-wgsl-not-text`)",
      "that READS — entry points its pipelines name (`object-wgsl-unread`), bindings each stage",
      "uses laid in its layout (`object-wgsl-binding-unlaid`), bind groups that fill their",
      "layouts (`object-bind-group-mismatch`). NOTHING COMPILES IT: a shader naming what nothing",
      "declares passes, and every kind with shaders carries the note `object-wgsl-not-compiled`",
      "(`try`, below, is what compiles it). `plugin-playground <dir>` (`pnpm playground` in a checkout) runs the",
      "same harness over every DECLARED STATE — each fixture in `playground/states.ts` (its props",
      "validated first, `state-invalid`) × idle, selected, held, open (when the kind opens),",
      "contained (when it provides `desk.containable`) × every zoom the desk's LOD names, and each",
      "fixture once more at rest by night — through",
      "resolve, record, hit (`state-hit-missed`: it must hit its own box), frame, chip, the",
      "opening, prepare and drawRange (`state-spawn-failed`, `state-render-failed`,",
      "`state-draw-ill-formed`), then dispose. A unit test calls it the same way. `inspect` lists",
      "each kind with its tray chip, its hang, what it provides, its export, the states it is",
      "driven through and, with `--json`, a `null` refusal.",
      "",
      "SEEING IT DRAWN: neither compiles your WGSL. `vibefield-plugin try <dir>` does — the app",
      "makes the kind on its own device and draws it on a fresh board: a WGSL error comes back as",
      "the compiler's own line at YOUR file's line and column (`try-kind-refused`), a kind laid but",
      "drawn nowhere as `try-not-picked`, and a kind drawn as `ok … DRAWN`, with stills (`cli.md`).",
      "",
      "A STILL WITHOUT THE APP: `plugin-playground <dir> --still` draws each declared state on",
      "DAWN — Node's WebGPU, the playground's own devDependency — through ICE's `createStill`:",
      "one object of your kind on a bare mat, by day and by night, built as the host builds it,",
      "its WGSL COMPILED (an error is the compiler's own line at your file's line and column,",
      "`still-failed`), and judged: drawn (`still-blank` — it compiled and drew nothing), inside",
      "its reach (`still-past-reach` — the desk culls and pads it by `reach`), steady",
      "(`still-unsteady` — drawn twice, other bytes), and held to YOUR golden,",
      "`test/still.golden.json`: each still's size and the sha-256 of its pixels, blessed ONCE",
      "by the named flag, `--still --bless` (`still-unblessed` until then, `still-golden-mismatch`",
      "after; `--bless --state <type>:<name>` mends one state). A GOLDEN IS HOST-SPECIFIC —",
      "Dawn's bytes on the machine that blessed it (its GPU, driver and OS, and the playground's",
      "Dawn), which the file records: another machine re-blesses locally and never commits over",
      "it. A still hands your kind no `local` and lends it no host service (no text raster), so",
      "what those draw is not in it. Under strata's DEV build (vitest, `node",
      '--conditions=development`) every still prints strata\'s access warning about `"Tray"`',
      "(`trayInput`, `trayLay`): ICE CORE'S, said at every engine a still makes and named as",
      "core's on the still's row — never yours.",
      "",
      "WHERE IT RUNS: `check` runs the harness in plain Node — no `document`, no",
      "`OffscreenCanvas`; the playground runs it in happy-dom — a `document`, still no",
      "`OffscreenCanvas` or `createImageBitmap`; your own unit test runs in whatever",
      "environment its vitest file declares. A `create` that reaches for a browser global its",
      "environment lacks gets the note `object-create-not-run-here` (its states are still",
      "driven, without its pass), so the two can say different notes for one kind — a kind",
      "that needs a browser global says which in its README.",
      "",
    ]),
    section("At run time — enable, disable, update", [
      "A desk's kinds are the set it was MOUNTED with: nothing registers a kind on a live",
      "desk, and nothing refuses an update. What the host does instead:",
      "",
      "- **Enabled** — the desk REMOUNTS with your kind: on the same engine when this window",
      "  had registered it before (you were turned off), on a new engine when it is new to",
      "  the window — the same board reopens on it behind the veil, nothing lost.",
      "- **Disabled, or removed** — the desk remounts WITHOUT it: your objects stay on the",
      "  board, data and all, and wear the desk's MISSING face (a faint hatched card the size",
      "  of the object, picked by its box); the selection bar names each one where its acts",
      "  would stand — `Clock · plugin off` (disabled), `Clock · plugin gone` (removed) — and",
      "  the status line says it once. Enabled again, they draw; until the desk has remounted",
      "  with you, `remount to draw it`.",
      "- **Updated** — your new artifact's kinds are compiled in a NEW renderer: the window",
      "  saves its board, replaces its renderer and reopens the board with them. A",
      "  `schemaVersion` bump runs your binding's `migrate` chain on the board's objects as",
      "  it reopens; a `schemaVersion` that goes DOWN is refused by fieldd —",
      "  `regresses schemaVersion` — and the live version stays. A type a board met before",
      "  your plugin was here (a stub kept its data) is redefined the same way.",
      "- **Its pack** — placing your kind needs its pack on the board, stamped when the board",
      "  opens and when you are enabled. While ANOTHER desktop holds the board open the stamp",
      "  waits — it would hold that desktop read-only — and lands at the board's next open;",
      "  this desktop draws your objects meanwhile. A desktop handed a pack it lacks reopens",
      "  on a stub for it and stays writable.",
      "- **When it breaks** — a kind whose WGSL does not compile is refused at create; one",
      "  whose world half throws is struck, and quarantined at the third strike. The rest of",
      "  the desk draws on, your objects wear the missing face, `status().faults` names your",
      "  kind once, and the bar and the status line say `can't draw`.",
      "",
    ]),
  ]);
}

// --- context ----------------------------------------------------------------------

function contextDoc(): string {
  return document("activate(ctx)", [
    "A plugin module has exactly one entry point. Module top-level code MUST NOT do",
    "product work — no registration, no I/O, no timers — because the host imports the",
    "module before it decides whether to activate it. Everything starts in `activate`.",
    "",
    fence(
      "ts",
      [
        'import { defineRendererPlugin } from "@vibefield/plugin-sdk";',
        "",
        "// an object's code half is a static export the manifest names — never registered here",
        'export { clock } from "./object";',
        "",
        "export default defineRendererPlugin({",
        "  activate(ctx) {",
        '    const timer = setInterval(() => ctx.logger.debug("tick"), 1000);',
        "    return { dispose() { clearInterval(timer); } };   // deactivation",
        "  },",
        "});",
      ].join("\n"),
    ),
    "",
    "`activate` may be async, and may return a `Disposable` (or nothing). In either entry kind,",
    "every host-created lifetime, whatever `activate` returns, and everything passed to",
    "`ctx.track(...)` is owned by the activation. Cleanup is awaited in reverse acquisition order",
    "on reload, disable, or a failed activation half-way through. Use",
    "`ctx.track(label, resource)` when a diagnostic name is useful; tracking the same exact handle",
    "twice is safe and deduplicated.",
    "",
    section("Deadlines", [
      table(
        ["phase", "deadline"],
        [
          ["renderer `activate`", `${PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS} ms`],
          ["service `activate`", `${PLUGIN_LIMITS.SERVICE_ACTIVATE_DEADLINE_MS} ms`],
          ["deactivate", `${PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS} ms`],
        ],
      ),
      "",
      "Miss one and the activation fails; the host disposes whatever was already",
      "registered rather than leaving it half-bound.",
      "",
    ]),
    section("The renderer context", [
      "Faces are present when the manifest earns them. An absent face is not a stub and",
      "not an error object — it is simply not there, so `ctx.settings?.get(…)` is how",
      "you ask for something optional.",
      "",
      ctxTable(RENDERER_CTX_FACES),
      "",
      "Use `ctx.effect(label, acquire)` for optional or replaceable setup. `acquire` receives a",
      "child-bound context; registrations made through that context roll back together if setup",
      "fails, while registrations deliberately made through the outer `ctx` keep root lifetime.",
      "",
      fence(
        "ts",
        [
          'await ctx.effect("optional-index", async (fx) => {',
          '  fx.commands?.register("com.example.notes.reindex", reindex);',
          '  fx.track("index-listener", listenForIndexChanges());',
          "});",
        ].join("\n"),
      ),
      "",
    ]),
    section("The service context", [
      "A service entry gets a different context: no canvas, no commands or surfaces, and",
      "the provider API instead.",
      "",
      ctxTable(SERVICE_CTX_FACES),
      "",
      "`ctx.plugin`, `ctx.signal`, `ctx.logger`, `ctx.client`, `ctx.settings`, and",
      "`ctx.storage` share the renderer shapes. Provider publications, client/settings",
      "subscriptions, processes, and endpoints are owned automatically. Labeled `ctx.track` and",
      "child-bound `ctx.effect` use the same rollback and exact-handle rules as renderer entries.",
      "",
      fence(
        "ts",
        [
          'await ctx.effect("optional-provider", async (fx) => {',
          "  fx.services.provide({ namespace, methods });",
          '  fx.track("provider-cache", openProviderCache());',
          "});",
        ].join("\n"),
      ),
      "",
    ]),
    section("Commands and surfaces", [
      fence(
        "ts",
        [
          'ctx.commands?.register("com.example.tools.tidy", (args, invocation) => {',
          "  // invocation: { source, windowId, selection, userGesture } — spine truth,",
          "  // never claimable by the handler",
          "});",
          "",
          'ctx.surfaces?.register("com.example.tools.panel", ToolsPanel);',
          "// ToolsPanel receives { slot, windowId } — and requestClose() on a side panel",
        ].join("\n"),
      ),
      "",
      "Both refuse an id the manifest does not declare, and both refuse a double-bind.",
      "",
    ]),
    section("Talking to the product", [
      "`ctx.client` is this plugin's own connection: calls arrive at the daemon",
      "attributed to the plugin, with the plugin's granted scopes — never the window's.",
      "",
      fence(
        "ts",
        [
          'const docs = await ctx.client.request("docs.list", {});',
          "const sub = await ctx.client.subscribe(",
          '  "plugins.subscribe",',
          "  {},",
          '  (event) => ctx.logger.info("registry moved", { event }),',
          ");",
          "ctx.track({ dispose: sub.unsubscribe }); // safe even when a host adapter auto-owns it",
        ].join("\n"),
      ),
      "",
      "A method the plugin lacks the capability for is refused by the daemon, not by a",
      "check in the SDK: the SDK surfaces are a veneer, and the caller matrix is the",
      "enforcement.",
      "",
    ]),
    section("The import wall", [
      "What plugin runtime code may import, and nothing else:",
      "",
      ...R10_ALLOWED_DOOR.map((mod) => `- \`${mod}\``),
      "",
      "These are refused — `check` reports `wall-violation` with the file and line:",
      "",
      ...R10_FORBIDDEN_MODULES.map((mod) => `- \`${mod}\``),
      "",
      "Node builtins (`node:*`) are refused too — a renderer plugin has no filesystem,",
      "and a service plugin asks the host through `ctx`. ICE is refused by EVERY name it",
      "answers to: `@vibecook/ice` and each of its entries — `/desk/objects`, the",
      "built-ins' entry, first of all (a kind never imports another kind) — and the",
      "workspace-internal `@ice/*` names ICE's own packages build with; a kind reaches",
      "ICE through `@vibefield/plugin-sdk/desk` alone. `scripts/` and `test/` are",
      "authoring-time subtrees and are exempt.",
      "",
      "Separately, these are the specifiers the host's import map RESOLVES at load",
      "time, so a bundle may leave them as bare imports instead of bundling a second",
      "copy:",
      "",
      ...HOST_SINGLETON_MODULE_SPECIFIERS.map((mod) => `- \`${mod}\``),
      "",
      "The two lists overlap on purpose and do not contradict each other: the canvas",
      "engine is resolvable at runtime because the SDK's own re-exports need it, while",
      "a plugin that imports `@vibecook/ice` directly is still refused. Reach the canvas",
      "through `@vibefield/plugin-sdk/canvas` or the React-free `/behavior` door. You",
      "never configure bundler externals by",
      "hand either way — `plugin-build` owns that list.",
      "",
    ]),
  ]);
}

// --- cli --------------------------------------------------------------------------

function cliDoc(): string {
  return document("The authoring loop", [
    "Every command is non-interactive, prints one line per row, and exits `0` (all",
    "rows passed), `1` (at least one refusal) or `2` (the kit itself failed). With",
    "`--json` each line is one verdict object:",
    "",
    fence(
      "json",
      jsonBlock({
        level: "refuse",
        check: "manifest",
        code: "manifest-invalid",
        pointer: "/contributes/objects",
        expected: "an object type this plugin owns: com.example.notes or com.example.notes.<name>",
        detail: "object type other.card must be com.example.notes or com.example.notes.<name>",
      }),
    ),
    "",
    "`level` is `pass`, `note` (an honest absence — a row that could not run and says",
    "why) or `refuse`. Only `refuse` affects the exit code.",
    "",
    section("The kit's commands", [
      "Three executables, each run from anywhere, each needing NOTHING installed beside the",
      "plugin — they bind the SDK to the copy they run from, as the app's import map does:",
      "",
      table(
        ["command", "what it is", "in a checkout of VibeField"],
        [
          [
            "`vibefield-plugin <command> <dir>`",
            "this page's commands, below",
            "`pnpm plugin <command> <dir>`",
          ],
          [
            "`plugin-build [<dir>]`",
            "the build (default: the current directory): `dist/renderer.js` with each `.wgsl` inlined as its text, the service bundle, the artifact checks — it READS the manifest and never writes it (`--help`)",
            "`pnpm --filter <package> build`",
          ],
          [
            "`plugin-playground <dir> [--json] [--state <type>[:<name>]] [--still [--bless]]`",
            "the kind-conformance harness over every declared state; `--still` draws each on Dawn, compiled, held to the plugin's golden (`--bless` writes it once; `objects.md`, Checking it)",
            "`pnpm playground <dir>`",
          ],
        ],
      ),
      "",
      "`create-plugin --id <vendor.name> --title <title> --dir <dir>` scaffolds a plugin and prints",
      "these commands, in order, for where it landed.",
      "",
    ]),
    section("Commands", [
      table(
        ["command", "what it does"],
        [
          ["`check <dir>`", "the whole suite: manifest, wall, schemas, binding, artifacts"],
          [
            "`emit-manifest <dir>`",
            "write `vibefield.plugin.json` from `src/manifest.ts` — the plugin's `gen:manifest`, with nothing installed",
          ],
          [
            "`try <dir> [--shots <dir>]`",
            "put its kinds ON THE DESK in the app and say whether each one is DRAWN — stills by day and night",
          ],
          ["`inspect <dir>`", "resolved contributions, grants, hashes, entries, state count"],
          ["`pack <dir>`", "the deterministic `.vfplugin` + its sha256"],
          ["`dev-link <dir>`", "put the plugin where a developer-mode session finds it"],
          ["`submit <dir>`", "the registry index row for an artifact, and the human step"],
          [
            "`release lookup <id> --index <path> --key <public key file>`",
            "read a signed index, refuse a bad signature",
          ],
          ["`index sign <index> --key <secret key file>`", "sign an index (maintainers)"],
          ["`docs --out <dir>`", "regenerate these files"],
        ],
      ),
      "",
    ]),
    section("check", [
      "The rows, in order:",
      "",
      table(
        ["row", "what it proves"],
        [
          ["`manifest`", "validates as `PluginManifestV1`, and the committed bytes are canonical"],
          ["`wall`", "plugin sources import only through the SDK door (R10)"],
          ["`schema`", "every declared JSON Schema compiles, as the daemon compiles it"],
          [
            "`activation`",
            "declarations and bindings match exactly — each object row's export a desk kind named by its type, its WGSL arriving as text — and deactivation leaks nothing",
          ],
          ["`artifact`", "declared entries exist and import only mappable specifiers"],
        ],
      ),
      "",
      "`check` never requires a build. With no `dist/` the artifact and activation rows",
      "emit notes instead of refusals, and the command can still pass. With one, the",
      "activation rows import the BUILT module as the app would — the host's specifiers bound",
      "to the kit's own copies, so a plugin outside any workspace is judged whole — and a name",
      "it imports that the door does not export is refused (`import-name-unknown`).",
      "",
    ]),
    section("emit-manifest", [
      "`emit-manifest` imports `src/manifest.ts` (TypeScript, its types stripped — keep it a plain",
      "module that exports `manifest`) and writes the canonical `vibefield.plugin.json` through",
      "the same `emitManifest` the scaffold's `gen:manifest` script calls: validated, defaulted,",
      "keys sorted. Re-run it after every edit of `manifest.ts`; a manifest that fails the",
      "contract is refused with its issue, and nothing is written.",
      "",
    ]),
    section("try", [
      "`try` puts your kinds ON THE DESK — in the app itself — and says whether each one is",
      "DRAWN:",
      "",
      "1. it copies the plugin's installed bundle (`vibefield.plugin.json`, `dist/`, `assets/`)",
      "   into a TEMPORARY dev root of its own, as `dev-link` copies (your dev root is never",
      "   touched — `dev-link` is for a person's session);",
      "2. it runs the app from the checkout the kit is installed in (`pnpm smoke:plugin`) on a",
      "   FRESH profile with that root alone (`FIELDD_PLUGIN_DEV_ROOTS`), whose first board lays",
      "   ONE object of each kind the manifest declares — and nothing else;",
      "3. for each kind it reads the desk: laid on the board; its kind made on the host's device",
      "   — its WGSL COMPILED, the one place the kit compiles it; picked where it lies on the",
      "   drawn frame.",
      "",
      "It takes well under a minute while the app's build is cached, longer the first time after",
      "the app changed (it builds it); it shows the app's window while it runs, and needs the",
      "machine's GPU. Your plugin is the ONLY dev plugin staged (the app's own bundled plugins",
      "load as always), and the board holds only your kinds. Build first — `try` stages what",
      '`plugin-build` wrote. A kind that draws ("picked across W × H" is the box of the points,',
      "scanned every 6 CSS px, where the desk's pick found it — a little inside its drawing):",
      "",
      fence(
        "text",
        [
          "ok     try   acme.card staged alone in a dev root of its own (a copy of its bundle) and the app run on a fresh profile — its log: <dir>/.vibefield-try/try.log",
          "ok     try   acme.card is on the desk, DRAWN: laid on a fresh board, its kind made on the host's device (its WGSL compiled), picked across 240 × 144 CSS px — stills: <dir>/.vibefield-try/try-acme.card-light.png · <dir>/.vibefield-try/try-acme.card-dark.png",
        ].join("\n"),
      ),
      "",
      "A refusal says what the desk said: `try-kind-refused` quotes the desk's own reason —",
      "for a WGSL error the compiler's first line at YOUR file's line and column, e.g.",
      "`refused at create — WGSL acme.card/shaders.wgsl: acme.card/shaders.wgsl:73:47 unresolved",
      "value 'ink'`; `try-not-laid` says whether the kind was not registered (the host refused",
      "its row — the log says why) or not placed (the row must provide `desk.object`);",
      "`try-not-picked` means nothing of it was drawn where it lies, or its `hit` misses what its",
      "pass draws — look at the still. The stills (the board, and each object, by day and by",
      "night) and the app's whole log (`try.log`) land in `<dir>/.vibefield-try/` (`--shots` for",
      "elsewhere). The note `try-desk-awake` says the desk never came to rest with your kind on",
      "it (`objects.md`, Wakes).",
      "",
    ]),
    section("pack", [
      "`pack` walks the installed bundle — `vibefield.plugin.json`, `dist/**`,",
      "`assets/**`, and any declared entry module — and nothing else. `test/`,",
      "`scripts/` and `playground/` are authoring-time and never travel in an artifact.",
      "",
      "The zip is deterministic: STORE-only, a fixed timestamp, bytewise-sorted names.",
      "The same tree packs to the same bytes on any machine, which is what lets a",
      "registry pin its sha256 and a reviewer diff it.",
      "",
    ]),
    section("dev-link", [
      "`dev-link` copies the installed bundle into the dev-linked plugin root, where a",
      "person's developer-mode session discovers it. It is a COPY, not a symlink, and that is",
      "forced by two host rules: discovery keeps only real directories, and the module",
      "authority refuses an artifact whose realpath escapes its plugin root.",
      "",
      "So the loop is: build, link, reload.",
      "",
      fence(
        "sh",
        [
          "plugin-build .                     # produce dist/",
          "vibefield-plugin dev-link .        # copy into the dev root, print where",
          "# then a person's dev session (pnpm dev in a checkout, FIELDD_PLUGIN_DEV_ROOTS",
          "# naming the root) reads it at boot, and the app's plugins.reload re-reads it —",
          "# to see your kinds drawn without a person, use try",
          "",
          "vibefield-plugin dev-link . --remove   # undo",
        ].join("\n"),
      ),
      "",
      "The root is `--root` if given, else the first entry of `FIELDD_PLUGIN_DEV_ROOTS`,",
      "else the repository's development root. The command always prints which it used.",
      "",
    ]),
    section("Publishing", [
      "`submit` computes the artifact's sha256 and prints the exact index row a",
      "registry entry is made of. It builds nothing and uploads nothing — the artifact",
      "url is a placeholder you replace with the release asset's, and adding the row to",
      "the index repository is a pull request a human opens.",
      "",
      "`release lookup` verifies the index's detached signature BEFORE reading a row",
      "out of it, and `index sign` produces that signature. Neither touches the",
      "network: pass a local path or a `file://` url.",
      "",
    ]),
  ]);
}

// --- refusals -----------------------------------------------------------------------

function refusalsDoc(): string {
  const rows = catalogRows();
  const refusals = rows.filter((r) => r.level === "refuse");
  const notes = rows.filter((r) => r.level === "note");
  const stateCodes = (Object.keys(KIND_EXPECTED) as (keyof typeof KIND_EXPECTED)[])
    .filter((code) => code.startsWith("state-"))
    .sort();
  return document("Refusal codes", [
    "Every code `vibefield-plugin` can emit — `check`, `inspect`, `emit-manifest`, `try`,",
    "`dev-link`, `pack` and the registry commands — then the kind harness's state codes and",
    "the playground's own. `code` is stable — branch on it. `expected` in the verdict is the",
    "concrete fix for that instance; the guidance column is the general one. `create-plugin`",
    "and `plugin-build` answer in their own words (`--help`).",
    "",
    section("Refusals (exit 1)", [
      table(
        ["code", "row", "meaning", "fix"],
        refusals.map((r) => [`\`${r.code}\``, r.check, r.meaning, r.guidance]),
      ),
      "",
    ]),
    section("Notes (exit 0)", [
      "A note is a row that could not run, or a fact worth saying. It never fails a",
      "command — honest absence beats a blank.",
      "",
      table(
        ["code", "row", "meaning", "what it suggests"],
        notes.map((r) => [`\`${r.code}\``, r.check, r.meaning, r.guidance]),
      ),
      "",
    ]),
    section("The kind harness's state codes", [
      "The kind-conformance harness drives a kind through its declared states in the playground",
      "and in your own unit test (`check` runs its declaration and program rows, above). Each",
      "state code, and what passes:",
      "",
      table(
        ["code", "what passes"],
        stateCodes.map((code) => [`\`${code}\``, KIND_EXPECTED[code]]),
      ),
      "",
    ]),
    section("The playground's own codes", [
      "What `plugin-playground` says before a kind's states are driven, and with `--still` of each",
      "state's still (quoted from its source):",
      "",
      fence("ts", quotedRegion("apps/plugin-playground/src/verdict.ts", "playground-codes")),
      "",
    ]),
  ]);
}

// --- the emission -----------------------------------------------------------------

export const DOC_FILES = [
  "README.md",
  "manifest.md",
  "contributions.md",
  "objects.md",
  "context.md",
  "cli.md",
  "refusals.md",
] as const;

/** filename → content, deterministic in both. */
export function generateDocs(): Map<string, string> {
  return new Map<string, string>([
    ["README.md", readme()],
    ["manifest.md", manifestDoc()],
    ["contributions.md", contributionsDoc()],
    ["objects.md", objectsDoc()],
    ["context.md", contextDoc()],
    ["cli.md", cliDoc()],
    ["refusals.md", refusalsDoc()],
  ]);
}
