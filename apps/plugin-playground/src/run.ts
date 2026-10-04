// THE RUN — one plugin directory in, a row per declared object kind (and the kind
// harness's verdicts beneath it) out.
//
// The order below is the order the product uses, and the refusal classes fall
// out of it: manifest → renderer module → activation → prefab build → states.
// Each stage can only fail in its own way, which is what lets a caller act on
// `code` without reading `detail`.
//
// DK-5 (desk/landing): NOTHING MOUNTS. The verdict for a widget state was "its
// React face mounts in happy-dom", and the desk draws object KINDS. DK-8: the
// widget rows RETIRED with `contributes.widgets` itself (the manifest refuses it by
// name, pointing at `objects`) — their prefab build (`widget-unbuildable`) and
// their props-only state rows with them; every state judged is a kind's.
//
// DK-7 (the playground v2): an OBJECT kind is JUDGED by the kind-conformance
// harness (`@vibefield/plugin-sdk/testing`) — its code half, the export its
// binding names (read off the module's namespace as the host reads it), against
// its durable half, the manifest row, with NO device and NO DOM: its declaration,
// its program on a recording device (its WGSL READ — never compiled), every
// declared state (each fixture × every mode × every zoom the desk's LOD names)
// through resolve/record/hit/frame/chip/the opening/prepare/drawRange, and its
// dispose. Its row carries the count of states DRIVEN and its first refusal; the
// harness's verdicts follow as `kind` rows.
//
// Source, not artifact. The runner loads `src/renderer.tsx` rather than
// `dist/renderer.js` for two reasons that both matter: an author (or an agent)
// iterating on a plugin should get a verdict without a build step in the way,
// and `pnpm test` must never depend on `pnpm build`. The staged-artifact path is
// already witnessed by smoke:canvas (P8-D2); this is the authoring path.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ObjectContribution, PluginManifestV1 } from "@vibefield/contracts";
import { RENDERER_SOURCES } from "@vibefield/plugin-build/build";
import {
  activateWithMockHost,
  type KindRefusalCode,
  productPalette,
  runKindConformance,
} from "@vibefield/plugin-sdk/testing";
import { readStatesModule, STATES_RELATIVE_PATH, type StatesFile } from "./states";
import { messageOf, pointer, type RunResult, type RunSummary, type Verdict } from "./verdict";

/** What `boot` hands the CLI: a module loader over the real transform pipeline. */
export interface Loader {
  load(absolutePath: string): Promise<Record<string, unknown>>;
}

export interface RunOptions {
  readonly pluginDir: string;
  readonly loader: Loader;
  /** `<type>:<state>` — run one row. A missing state name runs every state of
   * that type. */
  readonly only?: string | undefined;
}

function summarize(plugin: string, objects: number, verdicts: readonly Verdict[]): RunSummary {
  let passed = 0;
  let skipped = 0;
  let refused = 0;
  let states = 0;
  for (const v of verdicts) {
    if (v.kind === "summary") continue;
    if (v.kind === "object") {
      // the kind's own row SUMMARIZES its harness rows (counted below): it adds the states driven
      states += v.states;
    } else if (v.kind === "kind") {
      if (v.status === "pass") passed += 1;
      else if (v.status === "note") skipped += 1;
      else refused += 1;
    } else {
      refused += 1;
    }
  }
  return {
    kind: "summary",
    plugin,
    objects,
    states,
    passed,
    skipped,
    refused,
    exit: refused > 0 ? 1 : 0,
  };
}

function stopAt(plugin: string, verdict: Verdict, objects = 0): RunResult {
  const verdicts = [verdict];
  return { verdicts, summary: summarize(plugin, objects, verdicts) };
}

/** `--state <type>[:<state>]`, split. */
function onlyOf(only: string | undefined): { type?: string; state?: string } {
  if (only === undefined) return {};
  const [type, state] = only.includes(":") ? only.split(":", 2) : [only, undefined];
  return { ...(type !== undefined ? { type } : {}), ...(state !== undefined ? { state } : {}) };
}

export async function runPlayground(options: RunOptions): Promise<RunResult> {
  const root = resolve(options.pluginDir);
  const manifestPath = join(root, "vibefield.plugin.json");

  // --- the manifest ---------------------------------------------------------
  if (!existsSync(manifestPath)) {
    return stopAt("(unknown)", {
      kind: "plugin",
      plugin: "(unknown)",
      status: "refused",
      code: "manifest-missing",
      detail: `no vibefield.plugin.json in ${root}`,
      expected:
        "a plugin directory holding vibefield.plugin.json (run `pnpm gen:manifest` in the plugin — the manifest is emitted, not hand-written)",
    });
  }
  const parsed = PluginManifestV1.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return stopAt("(unknown)", {
      kind: "plugin",
      plugin: "(unknown)",
      status: "refused",
      code: "manifest-invalid",
      // The zod issue path IS the pointer — P8-D8's "the zod layer already has
      // this information and currently throws it away at the boundary".
      ...(issue !== undefined && issue.path.length > 0
        ? { pointer: pointer(...issue.path.map(String)) }
        : {}),
      detail: `${manifestPath}: ${issue?.message ?? "failed PluginManifestV1"}`,
      expected: "a manifest that parses as PluginManifestV1 (@vibefield/contracts)",
    });
  }
  const manifest = parsed.data;
  const objects: readonly ObjectContribution[] = manifest.contributes?.objects ?? [];

  // --- the renderer module --------------------------------------------------
  const source = RENDERER_SOURCES.map((s) => join(root, s)).find((p) => existsSync(p));
  if (source === undefined) {
    if (objects.length === 0) {
      // A plugin with no object kinds is a complete, correct plugin (services,
      // surfaces, commands). Zero states is the honest answer, and saying it out
      // loud beats an empty table that reads like a failure.
      return { verdicts: [], summary: summarize(manifest.id, 0, []) };
    }
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "renderer-entry-missing",
      detail: `${manifest.id} declares ${objects.length} object kind(s) but has no renderer source`,
      expected: `one of ${RENDERER_SOURCES.join(", ")} under ${root}`,
    });
  }

  let mod: { activate?: unknown };
  // the module's NAMESPACE: an object row's code half is its export there (`binding.kind`)
  let namespace: Record<string, unknown>;
  try {
    const loaded = await options.loader.load(source);
    namespace = loaded;
    mod = (loaded.default ?? loaded) as { activate?: unknown };
  } catch (error) {
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "renderer-import-failed",
      detail: `${source}: ${messageOf(error)}`,
      expected: "a renderer module that imports cleanly and default-exports { activate }",
    });
  }
  if (typeof mod.activate !== "function") {
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "renderer-import-failed",
      detail: `${source} default export has no activate function`,
      expected: "export default defineRendererPlugin({ activate(ctx) { … } })",
    });
  }

  // --- activation -----------------------------------------------------------
  // The SDK's own mock host (§5.4 item 4, whose header names this runner as its
  // consumer): the author-facing contract, and — unlike the product harness —
  // carrying no process-global activation memo, so a second run never answers
  // for the first. An object kind is never registered from `activate` — it is the
  // export its binding names, read below.
  try {
    await activateWithMockHost(mod as never, {
      id: manifest.id,
      version: manifest.version,
      declaredBehaviors: manifest.contributes?.behaviors ?? [],
      declaredCommands: manifest.contributes?.commands?.map((c) => c.id) ?? [],
      declaredSurfaces: manifest.contributes?.surfaces?.map((s) => s.id) ?? [],
    });
  } catch (error) {
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "activation-failed",
      detail: messageOf(error),
      expected: "activate() returns without throwing and binds only what the manifest declares",
    });
  }

  const verdicts: Verdict[] = [];

  // --- the states file ------------------------------------------------------
  const statesPath = join(root, STATES_RELATIVE_PATH);
  let authored: StatesFile = {};
  if (existsSync(statesPath)) {
    let statesModule: Record<string, unknown>;
    try {
      statesModule = await options.loader.load(statesPath);
    } catch (error) {
      return stopAt(
        manifest.id,
        {
          kind: "plugin",
          plugin: manifest.id,
          status: "refused",
          code: "states-invalid",
          detail: `${statesPath}: ${messageOf(error)}`,
          expected: "a module that imports cleanly and default-exports the states record",
        },
        objects.length,
      );
    }
    const read = readStatesModule(statesModule);
    if (!read.ok) {
      return stopAt(
        manifest.id,
        {
          kind: "plugin",
          plugin: manifest.id,
          status: "refused",
          code: "states-invalid",
          ...(read.pointer !== undefined ? { pointer: read.pointer } : {}),
          ...(read.expected !== undefined ? { expected: read.expected } : {}),
          detail: `${STATES_RELATIVE_PATH}: ${read.detail}`,
        },
        objects.length,
      );
    }
    authored = read.states;
    const declaredTypes = new Set(objects.map((o) => o.type));
    for (const type of Object.keys(authored)) {
      if (declaredTypes.has(type)) continue;
      verdicts.push({
        kind: "type",
        plugin: manifest.id,
        type,
        status: "refused",
        code: "states-unknown-type",
        pointer: pointer(type),
        detail: `${STATES_RELATIVE_PATH} declares states for ${type}, which this manifest does not contribute`,
        expected:
          declaredTypes.size > 0
            ? `one of ${[...declaredTypes].join(", ")}`
            : "this plugin contributes no object kinds",
      });
    }
  }

  // --- the object kinds: the kind-conformance harness (DK-7) ---------------
  // Each row's code half is the module's export its binding names — read off the
  // namespace as the host reads it (`objectBindingsFrom`) — judged against the row
  // with no device and no DOM. Its fixtures are its states-file entry (absent: one
  // `default` from the declared defaults); each is validated against the row's
  // props first (`state-invalid`), then driven over every declared mode and zoom.
  const only = onlyOf(options.only);
  for (const [index, object] of objects.entries()) {
    if (only.type !== undefined && only.type !== object.type) continue;
    const declared = authored[object.type];
    if (declared !== undefined && Object.keys(declared).length === 0) {
      verdicts.push({
        kind: "type",
        plugin: manifest.id,
        type: object.type,
        status: "refused",
        code: "states-empty",
        pointer: pointer(object.type),
        detail: `${STATES_RELATIVE_PATH} declares ${object.type} with no states`,
        expected: "at least one named state, or no entry at all (which synthesizes `default`)",
      });
      continue;
    }
    // judged as the PRODUCT draws it: under the palette VibeField mounts its desk with (DK-8 — a kind that
    // reads a host role, the comment pad's pens, is refused under the harness's two-role default)
    const report = await runKindConformance({
      binding: namespace[object.binding.kind],
      row: object,
      at: pointer("contributes", "objects", String(index)),
      states: declared,
      only: only.state,
      palette: productPalette,
    });
    const first = report.verdicts.find((v) => v.status === "refused");
    verdicts.push({
      kind: "object",
      plugin: manifest.id,
      type: object.type,
      binding: object.binding.kind,
      states: report.states,
      refusal: first === undefined ? null : (first.code as KindRefusalCode),
    });
    for (const v of report.verdicts)
      verdicts.push({
        kind: "kind",
        plugin: manifest.id,
        type: object.type,
        subject: v.subject,
        status: v.status,
        code: v.code,
        ...(v.pointer !== undefined ? { pointer: v.pointer } : {}),
        ...(v.expected !== undefined && v.status !== "pass" ? { expected: v.expected } : {}),
        detail: v.detail,
      });
  }

  return { verdicts, summary: summarize(manifest.id, objects.length, verdicts) };
}
