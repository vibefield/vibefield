// The build stages (plugin-architecture spec §5.4 item 1, stages "renderer
// bundle", "service bundle", "artifact checks"). `"build": "plugin-build"` is
// the whole script a plugin declares; everything below is derived from the
// manifest already on disk plus ONE convention about where source lives.
//
// Why the manifest is an INPUT here rather than an output: `vibefield.plugin.json`
// is emitted by each plugin's `gen:manifest` and freshness-pinned the way
// `gen:check` pins contracts.rs (C1d). Folding emit into `build` would give the
// canonical artifact two producers and put a generated file behind a cached Nx
// target — so build READS the manifest and refuses if it is missing, naming the
// command that writes it. Recorded delta from §5.4's four-stages-one-command.
//
// The PA-29 externals list is imported, never restated (@vibefield/contracts is
// its one home; externals.ts is this package's door onto it). A bundle that
// carries a second copy of a host singleton is refused HERE, at pack time in
// spec terms — the load-time half (§11.6's import map) and activation refusal
// are the later lines of the same defence. Its mirror image is refused here too:
// a bundle that emits a specifier the import map has no entry for.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, relative, resolve } from "node:path";
import {
  HOST_SINGLETON_EXTERNALS,
  HOST_SINGLETON_MODULE_SPECIFIERS,
  type HostSingletonExternal,
} from "./externals";

/** Where a plugin's entry sources live, by convention. The manifest names the
 * built ARTIFACT (`./dist/renderer.js`); these are what produce it.
 *
 * Exported because the convention now has a SECOND reader: the playground
 * (§5.4 item 5) renders widget states from source, so that a state verdict never
 * depends on a build having run. Two readers means one declaration — a copy in
 * the playground would be the same second-source-of-truth the import wall's own
 * R5 note was written about. */
export const RENDERER_SOURCES = ["src/renderer.tsx", "src/renderer.ts"] as const;
const SERVICE_SOURCES = ["src/service.ts", "src/service.tsx", "src/service.js"] as const;

/** Utilities and theme WITHOUT preflight: a plugin's stylesheet loads into a
 * page the host already reset, and shipping preflight again would restyle the
 * host's own DOM from inside a plugin. `@source` points the v4 scanner at the
 * plugin's sources rather than trusting auto-detection from a cwd we do not own. */
const TAILWIND_ENTRY = `@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@source "../../src";
`;

export type BuildStageName = "manifest" | "renderer bundle" | "service bundle" | "artifact checks";

export interface BuildStage {
  readonly stage: BuildStageName;
  readonly ok: boolean;
  /** One line, human-first. Failures say what to do, never just what happened. */
  readonly detail: string;
}

export interface BuildReport {
  readonly pluginId: string;
  readonly stages: readonly BuildStage[];
  readonly ok: boolean;
}

export class PluginBuildError extends Error {
  // An explicit field, not a parameter property: the bin imports this module
  // through Node's strip-only type removal, which refuses `constructor(readonly
  // x)` outright (the same erasable-syntax law that took param properties out
  // of fieldd-client at P5).
  readonly stage: BuildStageName;

  constructor(message: string, stage: BuildStageName) {
    super(message);
    this.name = "PluginBuildError";
    this.stage = stage;
  }
}

/** Does this import specifier resolve to a host-provided singleton (PA-29)?
 * Exact match OR a subpath of one — `@vibecook/ice/react` and
 * `@vibefield/plugin-sdk/ui` are the same singleton as their roots, and
 * externalizing the root while bundling a subpath is precisely how a second
 * copy gets in. */
export function isHostSingletonSpecifier(id: string): boolean {
  return HOST_SINGLETON_EXTERNALS.some((ext) => id === ext || id.startsWith(`${ext}/`));
}

/** The path markers that prove a module BELONGS to a singleton. Workspace
 * singletons resolve to their source tree rather than `node_modules`, so the
 * SDK needs its own marker — checking only `node_modules/` would let the one
 * singleton every plugin imports slip through. */
function markersFor(name: HostSingletonExternal): string[] {
  const markers = [`node_modules/${name}/`];
  if (name === "@vibefield/plugin-sdk") markers.push("/packages/plugin-sdk/");
  if (name === "@vibecook/ice") markers.push("/packages/ice/");
  return markers;
}

/**
 * THE ARTIFACT CHECK: which host singletons did this bundle swallow?
 *
 * Evidence comes from the bundler's own module list (rollup's `chunk.modules`,
 * esbuild's `metafile.inputs`) rather than a text scan of the output, so the
 * answer is what was actually linked in, not what a minifier happened to leave
 * recognisable. Pure and exported so it is testable without running a build.
 */
export function findBundledSingletons(modulePaths: Iterable<string>): HostSingletonExternal[] {
  const paths = [...modulePaths].map((p) => p.replaceAll("\\", "/"));
  return HOST_SINGLETON_EXTERNALS.filter((name) =>
    markersFor(name).some((marker) => paths.some((p) => p.includes(marker))),
  );
}

const NODE_BUILTINS = new Set(builtinModules);

/**
 * THE OTHER ARTIFACT CHECK: which of this bundle's bare imports can the host's
 * import map not bind?
 *
 * The externals matcher works by PREFIX — every subpath of a singleton stays
 * bare — while §11.6's import map is an exact enumeration, because
 * PLUGIN_MODULE_SCHEME refuses the URL path segment a trailing-slash mapping
 * needs. So the bundler will happily externalize `@vibecook/ice/react` and hand
 * the renderer a specifier nothing resolves. Catching that here turns an import
 * that dies inside a loading plugin into a build that never emits it.
 *
 * Relative and absolute ids are the bundle's own business. Node builtins are
 * skipped: they are never the import map's business, and a renderer artifact
 * reaching for one is broken in a way this check would only mislabel.
 *
 * Pure and exported so it is testable without running a build.
 */
export function findUnmappableSpecifiers(specifiers: Iterable<string>): string[] {
  const mappable = new Set<string>(HOST_SINGLETON_MODULE_SPECIFIERS);
  const unmappable = new Set<string>();
  for (const id of specifiers) {
    if (id.startsWith(".") || id.startsWith("/")) continue;
    if (id.startsWith("node:") || NODE_BUILTINS.has(id)) continue;
    if (!mappable.has(id)) unmappable.add(id);
  }
  return [...unmappable].sort();
}

function firstExisting(root: string, candidates: readonly string[]): string | undefined {
  return candidates.map((c) => join(root, c)).find((p) => existsSync(p));
}

interface ManifestShape {
  id: string;
  entries?: { renderer?: string; service?: string };
}

async function readManifest(root: string): Promise<ManifestShape> {
  const path = join(root, "vibefield.plugin.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new PluginBuildError(
      `no vibefield.plugin.json in ${root} — run \`pnpm gen:manifest\` in this plugin first (the manifest is emitted, not built)`,
      "manifest",
    );
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
    throw new PluginBuildError(`${path} is not a plugin manifest`, "manifest");
  }
  return parsed as ManifestShape;
}

/** Resolve a manifest's `./`-relative entry to an absolute path under root. */
function entryPath(root: string, declared: string): string {
  return resolve(root, declared);
}

async function bundleRenderer(
  root: string,
  declared: string,
): Promise<{ detail: string; modules: string[]; specifiers: string[] }> {
  const source = firstExisting(root, RENDERER_SOURCES);
  if (source === undefined) {
    throw new PluginBuildError(
      `manifest declares entries.renderer (${declared}) but no renderer source exists — expected one of ${RENDERER_SOURCES.join(", ")}`,
      "renderer bundle",
    );
  }
  const out = entryPath(root, declared);
  const outDir = resolve(out, "..");
  const workDir = join(outDir, ".build");
  mkdirSync(workDir, { recursive: true });
  // A generated entry, so the plugin's own source never carries build scaffolding:
  // it pulls in the compiled stylesheet and re-exports the module verbatim (the
  // default export IS the plugin; `export *` keeps any named surface the host
  // normalizer reads).
  const rel = relative(workDir, source).replaceAll("\\", "/");
  writeFileSync(join(workDir, "styles.css"), TAILWIND_ENTRY);
  writeFileSync(
    join(workDir, "entry.ts"),
    `import "./styles.css";\nexport * from ${JSON.stringify(rel)};\nexport { default } from ${JSON.stringify(rel)};\n`,
  );

  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const tailwindcss = (await import("@tailwindcss/vite")).default;

  const result = await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    build: {
      outDir,
      emptyOutDir: false,
      // Unminified on purpose: a distributable plugin is REVIEWED (§20.5 rung
      // R1), and the reviewer reads these bytes. Determinism is what pack's
      // sha256 needs, and that holds either way.
      minify: false,
      sourcemap: false,
      lib: {
        entry: join(workDir, "entry.ts"),
        formats: ["es"],
        fileName: () => "renderer.js",
        cssFileName: "renderer",
      },
      rollupOptions: { external: (id: string) => isHostSingletonSpecifier(id) },
    },
  });

  rmSync(workDir, { recursive: true, force: true });
  const outputs = Array.isArray(result) ? result : [result];
  const modules: string[] = [];
  // What the artifact actually asks the host for, taken from rollup's own
  // record of each chunk's imports rather than a text scan — same reason
  // findBundledSingletons reads the module list. A code-split plugin's chunks
  // import each OTHER by emitted file name, which is not a bare specifier and
  // must not be mistaken for one; the emitted names are known here, so subtract
  // them rather than guess from the shape of the string.
  const imported: string[] = [];
  const emittedFiles = new Set<string>();
  for (const bundle of outputs) {
    for (const chunk of "output" in bundle ? bundle.output : []) {
      emittedFiles.add(chunk.fileName);
      if (chunk.type === "chunk") {
        modules.push(...Object.keys(chunk.modules));
        imported.push(...chunk.imports, ...chunk.dynamicImports);
      }
    }
  }
  if (!existsSync(out)) {
    throw new PluginBuildError(`renderer bundle did not produce ${declared}`, "renderer bundle");
  }
  const css = join(outDir, "renderer.css");
  return {
    detail: `${declared}${existsSync(css) ? " + renderer.css" : " (no stylesheet)"}`,
    modules,
    specifiers: imported.filter((id) => !emittedFiles.has(id)),
  };
}

async function bundleService(
  root: string,
  declared: string,
): Promise<{ detail: string; modules: string[] }> {
  const source = firstExisting(root, SERVICE_SOURCES);
  const out = entryPath(root, declared);
  if (source === undefined) {
    // A hand-written service entry that already sits where the manifest points
    // is a complete plugin (kv-service ships one). Nothing to bundle; the
    // artifact check below still proves the file is there.
    if (existsSync(out)) return { detail: `${declared} (prebuilt, not bundled)`, modules: [] };
    throw new PluginBuildError(
      `manifest declares entries.service (${declared}) but neither a source (${SERVICE_SOURCES.join(", ")}) nor the file itself exists`,
      "service bundle",
    );
  }
  const esbuild = await import("esbuild");
  // Self-contained bytes: everything bundled in EXCEPT the SDK runtime, which
  // the worker harness's resolve hook binds at load (§11.6). No node_modules
  // tree travels with a service artifact.
  const result = await esbuild.build({
    entryPoints: [source],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    metafile: true,
    logLevel: "warning",
    external: ["@vibefield/plugin-sdk"],
  });
  return { detail: declared, modules: Object.keys(result.metafile?.inputs ?? {}) };
}

export interface BuildPluginOptions {
  /** The plugin's own directory (the one holding vibefield.plugin.json). */
  readonly root: string;
}

/**
 * Build one plugin: read its manifest, produce the artifacts its entries name,
 * then refuse the result if it swallowed a host singleton — or if it asks the
 * host for one the host never offered.
 *
 * Throws `PluginBuildError` on the first failing stage — a partially built
 * artifact is never reported as a success.
 */
export async function buildPlugin(options: BuildPluginOptions): Promise<BuildReport> {
  const root = resolve(options.root);
  const manifest = await readManifest(root);
  const stages: BuildStage[] = [
    { stage: "manifest", ok: true, detail: `${manifest.id} (read; emitted by gen:manifest)` },
  ];
  const linked: string[] = [];
  const emitted: string[] = [];

  const rendererEntry = manifest.entries?.renderer;
  if (rendererEntry !== undefined) {
    const { detail, modules, specifiers } = await bundleRenderer(root, rendererEntry);
    linked.push(...modules);
    emitted.push(...specifiers);
    stages.push({ stage: "renderer bundle", ok: true, detail });
  }

  const serviceEntry = manifest.entries?.service;
  if (serviceEntry !== undefined) {
    const { detail, modules } = await bundleService(root, serviceEntry);
    linked.push(...modules);
    stages.push({ stage: "service bundle", ok: true, detail });
  }

  // Artifact checks — layout first (does what the manifest promises exist?),
  // then PA-29.
  for (const declared of [rendererEntry, serviceEntry]) {
    if (declared !== undefined && !existsSync(entryPath(root, declared))) {
      throw new PluginBuildError(
        `manifest declares ${declared} but no such file was produced`,
        "artifact checks",
      );
    }
  }
  const bundled = findBundledSingletons(linked);
  if (bundled.length > 0) {
    throw new PluginBuildError(
      `bundle carries host singletons that must stay external (PA-29): ${bundled.join(", ")} — the externals list is HOST_SINGLETON_EXTERNALS in @vibefield/contracts (src/registries.ts) and no plugin configures its own`,
      "artifact checks",
    );
  }
  const unmappable = findUnmappableSpecifiers(emitted);
  if (unmappable.length > 0) {
    throw new PluginBuildError(
      `renderer bundle imports specifiers the host cannot resolve (§11.6): ${unmappable.join(", ")} — the import map binds exactly HOST_SINGLETON_MODULE_SPECIFIERS in @vibefield/contracts (src/registries.ts), so either add the specifier there and to the host that serves it, or let the plugin bundle the module in`,
      "artifact checks",
    );
  }
  stages.push({
    stage: "artifact checks",
    ok: true,
    detail: `entries present; no bundled singletons across ${linked.length} linked modules; ${emitted.length} emitted specifiers all mappable`,
  });

  return { pluginId: manifest.id, stages, ok: true };
}
