// THE RUN — one plugin directory in, a verdict per declared widget state out.
//
// The order below is the order the product uses, and the refusal classes fall
// out of it: manifest → renderer module → activation → prefab build → engine →
// spawn → mount. Each stage can only fail in its own way, which is what lets a
// caller act on `code` without reading `detail`.
//
// Source, not artifact. The runner loads `src/renderer.tsx` rather than
// `dist/renderer.js` for two reasons that both matter: an author (or an agent)
// iterating on a widget should get a verdict without a build step in the way,
// and `pnpm test` must never depend on `pnpm build`. The staged-artifact path is
// already witnessed by smoke:canvas (P8-D2); this is the authoring path.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PluginManifestV1, type WidgetContribution } from "@vibefield/contracts";
import { buildWidgetType, createFieldEngine } from "@vibefield/field-app/host-kit";
import { RENDERER_SOURCES } from "@vibefield/plugin-build/build";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { mountState } from "./render";
import {
  DEFAULT_STATE,
  readStatesModule,
  STATES_RELATIVE_PATH,
  type StatesFile,
  synthesizeDefaultState,
  validateState,
} from "./states";
import {
  messageOf,
  pointer,
  type RunResult,
  type RunSummary,
  type StateVerdict,
  type Verdict,
} from "./verdict";

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

function summarize(plugin: string, widgets: number, verdicts: readonly Verdict[]): RunSummary {
  let passed = 0;
  let skipped = 0;
  let refused = 0;
  let states = 0;
  for (const v of verdicts) {
    if (v.kind === "summary") continue;
    if (v.kind === "state") {
      states += 1;
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
    widgets,
    states,
    passed,
    skipped,
    refused,
    exit: refused > 0 ? 1 : 0,
  };
}

function stopAt(plugin: string, verdict: Verdict, widgets = 0): RunResult {
  const verdicts = [verdict];
  return { verdicts, summary: summarize(plugin, widgets, verdicts) };
}

/** `--state <type>[:<state>]`. */
function matches(only: string | undefined, type: string, state: string): boolean {
  if (only === undefined) return true;
  const [wantType, wantState] = only.includes(":") ? only.split(":", 2) : [only, undefined];
  if (wantType !== type) return false;
  return wantState === undefined || wantState === state;
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
  const contributions: readonly WidgetContribution[] = manifest.contributes?.widgets ?? [];

  // --- the renderer module --------------------------------------------------
  const source = RENDERER_SOURCES.map((s) => join(root, s)).find((p) => existsSync(p));
  if (source === undefined) {
    if (contributions.length === 0) {
      // A plugin with no canvas widgets is a complete, correct plugin (services,
      // surfaces, commands). Zero states is the honest answer, and saying it out
      // loud beats an empty table that reads like a failure.
      return {
        verdicts: [],
        summary: summarize(manifest.id, 0, []),
      };
    }
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "renderer-entry-missing",
      detail: `${manifest.id} declares ${contributions.length} widget(s) but has no renderer source`,
      expected: `one of ${RENDERER_SOURCES.join(", ")} under ${root}`,
    });
  }

  let mod: { activate?: unknown };
  try {
    const loaded = await options.loader.load(source);
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
  // for the first.
  let bindings: ReadonlyMap<string, { component: unknown }>;
  try {
    const activation = await activateWithMockHost(mod as never, {
      id: manifest.id,
      version: manifest.version,
      declaredWidgets: contributions.map((w) => w.type),
      declaredCommands: manifest.contributes?.commands?.map((c) => c.id) ?? [],
      declaredSurfaces: manifest.contributes?.surfaces?.map((s) => s.id) ?? [],
    });
    bindings = activation.bindings;
  } catch (error) {
    return stopAt(manifest.id, {
      kind: "plugin",
      plugin: manifest.id,
      status: "refused",
      code: "activation-failed",
      detail: messageOf(error),
      expected: "activate() binds each declared widget exactly once and returns without throwing",
    });
  }

  const verdicts: Verdict[] = [];

  // --- the prefab build (§12.2) --------------------------------------------
  // Every declared type must produce a WidgetType before the engine exists,
  // because the engine is constructed from the catalogue. A type that cannot be
  // built loses its state rows and nothing else (§11.4 containment): it still
  // gets a placeholder entry so the registry's declared⇄provided law holds for
  // its healthy peers, and that placeholder is never mounted — its refusal is
  // recorded here and its states are skipped below.
  const unusable = new Set<string>();
  const owner = { pluginId: manifest.id, pluginTitle: manifest.title };
  const Unmountable = (): null => null;
  const widgets: Record<string, unknown> = {};
  for (const decl of contributions) {
    const binding = bindings.get(decl.type);
    if (binding === undefined) {
      unusable.add(decl.type);
      verdicts.push({
        kind: "widget",
        plugin: manifest.id,
        type: decl.type,
        status: "refused",
        code: "widget-unbound",
        pointer: pointer("contributes", "widgets", decl.type),
        detail: `${decl.type} is declared by the manifest but activate() never registered it`,
        expected: `ctx.widgets.register({ type: "${decl.type}", binding: { component } })`,
      });
    }
    try {
      widgets[decl.type] = buildWidgetType(
        decl,
        (binding ?? { component: Unmountable }) as never,
        owner,
      );
    } catch (error) {
      unusable.add(decl.type);
      verdicts.push({
        kind: "widget",
        plugin: manifest.id,
        type: decl.type,
        status: "refused",
        code: "widget-unbuildable",
        pointer: pointer("contributes", "widgets", decl.type),
        detail: `the host could not build ${decl.type} from its declaration: ${messageOf(error)}`,
        expected: "a widget declaration the host can project into a prefab (§12.2)",
      });
    }
  }

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
        contributions.length,
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
        contributions.length,
      );
    }
    authored = read.states;
    const declaredTypes = new Set(contributions.map((w) => w.type));
    for (const type of Object.keys(authored)) {
      if (declaredTypes.has(type)) continue;
      verdicts.push({
        kind: "widget",
        plugin: manifest.id,
        type,
        status: "refused",
        code: "states-unknown-type",
        pointer: pointer(type),
        detail: `${STATES_RELATIVE_PATH} declares states for ${type}, which this manifest does not contribute`,
        expected:
          declaredTypes.size > 0
            ? `one of ${[...declaredTypes].join(", ")}`
            : "this plugin contributes no widgets",
      });
    }
  }

  // --- the engine -----------------------------------------------------------
  // The real one, with the product's own canvas settings: `createFieldEngine`
  // through field-app's declared host-kit door, not a second construction of it.
  const registry = new PluginRegistry<unknown>();
  let engine: { world: unknown; ops: never; docs: { create(): unknown } };
  try {
    registry.registerV1(manifest, widgets);
    engine = createFieldEngine(registry as never) as never;
    engine.docs.create();
  } catch (error) {
    return stopAt(
      manifest.id,
      {
        kind: "plugin",
        plugin: manifest.id,
        status: "refused",
        code: "widget-unbuildable",
        detail: `the canvas engine could not be built for ${manifest.id}: ${messageOf(error)}`,
        expected: "a widget catalogue the engine accepts",
      },
      contributions.length,
    );
  }

  // --- the states -----------------------------------------------------------
  for (const decl of contributions) {
    if (unusable.has(decl.type)) continue;
    const declared = authored[decl.type];
    if (declared !== undefined && Object.keys(declared).length === 0) {
      verdicts.push({
        kind: "widget",
        plugin: manifest.id,
        type: decl.type,
        status: "refused",
        code: "states-empty",
        pointer: pointer(decl.type),
        detail: `${STATES_RELATIVE_PATH} declares ${decl.type} with no states`,
        expected: "at least one named state, or no entry at all (which synthesizes `default`)",
      });
      continue;
    }
    const states = declared ?? { [DEFAULT_STATE]: synthesizeDefaultState(decl) };
    for (const [state, props] of Object.entries(states)) {
      if (!matches(options.only, decl.type, state)) continue;
      const invalid = validateState(decl, state, props);
      if (invalid !== null) {
        const row: StateVerdict = {
          kind: "state",
          plugin: manifest.id,
          type: decl.type,
          state,
          status: "refused",
          code: invalid.code,
          ...(invalid.pointer !== undefined ? { pointer: invalid.pointer } : {}),
          ...(invalid.expected !== undefined ? { expected: invalid.expected } : {}),
          detail: invalid.detail,
        };
        verdicts.push(row);
        continue;
      }
      if (decl.surface === "gl") {
        // Honest, and deliberately NOT a pass: a GL widget renders inside an
        // island backed by a real WebGL context, which a DOM-only harness does
        // not have. Mounting it anyway throws at the first island hook — an
        // answer about this runner, not about the widget. Counted apart, and
        // exit stays 0 because nothing was refused.
        verdicts.push({
          kind: "state",
          plugin: manifest.id,
          type: decl.type,
          state,
          status: "note",
          code: "skipped-gl",
          detail: "gl surface — no GL island in a headless DOM harness, so no verdict is possible",
          expected: 'a GL-capable harness (not this one) to answer for surface: "gl" widgets',
        });
        continue;
      }
      verdicts.push(
        await mountState({
          plugin: manifest.id,
          decl,
          state,
          props,
          component: (widgets[decl.type] as { component: unknown }).component,
          engine: engine as never,
        }),
      );
    }
  }

  return { verdicts, summary: summarize(manifest.id, contributions.length, verdicts) };
}
