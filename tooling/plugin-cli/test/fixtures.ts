// Plugin trees built on disk, because that is what the kit reads. Every fixture
// manifest goes out through `emitManifest`, so a fixture is canonical by
// construction and the freshness row passes for the right reason — a fixture
// that faked the bytes would make `manifest-stale` untestable.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emitManifest } from "@vibefield/plugin-build";

export const FIXTURE_ID = "com.example.fixture";

export interface FixtureOptions {
  /** merged over the base manifest before emit */
  readonly manifest?: Record<string, unknown>;
  /** relative path → contents, written verbatim */
  readonly files?: Record<string, string>;
  /** write the manifest bytes RAW instead of emitting them (stale fixtures) */
  readonly rawManifest?: string;
}

export function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: FIXTURE_ID,
    version: "0.1.0",
    title: "Fixture",
    engines: { app: "^0.1.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: [`onWidget:${FIXTURE_ID}.card`],
    capabilities: [],
    contributes: {
      widgets: [
        {
          type: `${FIXTURE_ID}.card`,
          title: "Card",
          schemaVersion: 1,
          surface: "dom",
          sizeMode: "fixed",
          defaultSize: { w: 200, h: 120 },
        },
      ],
    },
    ...overrides,
  };
}

/** A renderer module that runs in plain Node: no imports at all, so the module
 * graph is the fixture's own behaviour and nothing else. */
export function rendererModule(body: {
  binds?: string[];
  /** leave an interval running that dispose() does NOT clear */
  leak?: boolean;
  /** throw from activate */
  throws?: boolean;
  /** export something that is not a plugin module */
  wrongShape?: boolean;
}): string {
  if (body.wrongShape === true) return "export default { notActivate() {} };\n";
  const binds = (body.binds ?? [`${FIXTURE_ID}.card`])
    .map((type) => `    ctx.widgets.register({ type: ${JSON.stringify(type)}, binding: {} });`)
    .join("\n");
  return [
    "export default {",
    "  activate(ctx) {",
    ...(body.throws === true ? ['    throw new Error("fixture activate refused");'] : []),
    binds,
    "    const timer = setInterval(() => {}, 60_000);",
    body.leak === true
      ? "    return { dispose() { /* leaks the interval on purpose */ } };"
      : "    return { dispose() { clearInterval(timer); } };",
    "  },",
    "};",
    "",
  ].join("\n");
}

/** A WGSL text with both entry points, as a kind's create would ask for it. */
export const FIXTURE_WGSL =
  "@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0.0); }\n" +
  "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }\n";

/** DK-6 — a renderer module exporting an OBJECT binding (and an activate that binds nothing), in
 * plain Node: the export the host reads by `binding.kind`, its kind's shape as asked. */
export function objectRendererModule(
  body: {
    /** the export's name (default `clock`) */
    exportName?: string;
    /** the kind's registry name (default the fixture's clock type) */
    kindName?: string;
    /** the kind's create, as source (default: a pass that draws nothing, no shader) */
    create?: string;
    /** export `{ kind: { name } }` — a binding whose kind is no desk kind */
    notAKind?: boolean;
    /** the kind OPENS (picked up into the hand) — DK-7's harness drives it `open` too */
    opens?: boolean;
    /** widget types its activate registers (default none) */
    binds?: string[];
  } = {},
): string {
  const name = JSON.stringify(body.kindName ?? `${FIXTURE_ID}.clock`);
  const create =
    body.create ??
    "async () => ({ spawn() { return this; }, prepare: () => 0, drawRange() {}, dispose() {} })";
  const kind =
    body.notAKind === true
      ? `{ name: ${name} }`
      : `{ name: ${name}, stratum: "things", reach: 0, create: ${create}, resolve: () => ({}), record: () => ({}), hit: () => "content"${body.opens === true ? ", open: { extent: ({ rect }) => rect }" : ""} }`;
  return `export const ${body.exportName ?? "clock"} = { kind: ${kind} };\n${rendererModule({ binds: body.binds ?? [] })}`;
}

export function makePlugin(opts: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "vf-plugin-cli-"));
  if (opts.rawManifest !== undefined)
    writeFileSync(join(root, "vibefield.plugin.json"), opts.rawManifest);
  else emitManifest(baseManifest(opts.manifest), join(root, "vibefield.plugin.json"));

  for (const [rel, contents] of Object.entries(opts.files ?? {})) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

export function freshDir(prefix = "vf-plugin-cli-out-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** The codes present in a verdict list, for terse assertions. */
export function codes(verdicts: ReadonlyArray<{ code: string; level: string }>): string[] {
  return verdicts.map((v) => v.code);
}

export function refusalCodes(verdicts: ReadonlyArray<{ code: string; level: string }>): string[] {
  return verdicts.filter((v) => v.level === "refuse").map((v) => v.code);
}
