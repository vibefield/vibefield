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
