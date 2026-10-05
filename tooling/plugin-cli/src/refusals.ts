// THE CATALOG. Every code any command can emit is declared here once, with the
// guidance that goes in the verdict's `expected` field when the emitter has
// nothing more specific to say. Two consumers read it and cannot drift: the
// emitters (a code that is not in this table is a type error) and the generated
// refusal reference in `docs/plugin-authoring/refusals.md`.
//
// Codes are kebab-case and STABLE: an agent branches on them, so renaming one
// is a breaking change to the kit's interface, not a wording fix.

import { OBJECTS_NEED_DESK } from "@vibefield/contracts";

export interface RefusalClass {
  /** the row that emits it */
  readonly check: string;
  /** `refuse` fails the command (exit 1); `note` is an honest absence */
  readonly level: "refuse" | "note";
  /** what the code means, one line */
  readonly meaning: string;
  /** what to make true — the default `expected` when a call site has no better */
  readonly guidance: string;
}

export const REFUSAL_CATALOG = {
  // --- manifest ---------------------------------------------------------------
  "manifest-missing": {
    check: "manifest",
    level: "refuse",
    meaning: "the plugin directory has no vibefield.plugin.json",
    guidance: "run `pnpm gen:manifest` in the plugin (the manifest is emitted from manifest.ts)",
  },
  "manifest-unreadable": {
    check: "manifest",
    level: "refuse",
    meaning: "vibefield.plugin.json is not parseable JSON, or exceeds the manifest byte limit",
    guidance: "emit it with plugin-build's emitManifest rather than hand-editing",
  },
  "manifest-invalid": {
    check: "manifest",
    level: "refuse",
    meaning: "the manifest fails PluginManifestV1 — one verdict per zod issue",
    guidance: "the verdict's pointer names the failing field; expected states the passing shape",
  },
  "behavior-store-unsupported": {
    check: "manifest",
    level: "refuse",
    meaning: "a legacy host release does not admit this behavior store",
    guidance:
      "upgrade the host; current releases admit bounded ephemeral behaviors and no longer emit this code",
  },
  "behavior-presence-budget-exceeded": {
    check: "manifest",
    level: "refuse",
    meaning: "the plugin's charged ephemeral facets exceed one renderer presence window",
    guidance:
      "reduce maxFacetBytes claims or remove optional presence producers; the whole plugin set must fit 48 KiB including per-facet envelopes",
  },
  "systems-contribution-superseded": {
    check: "manifest",
    level: "refuse",
    meaning: "the retired contributes.systems shape cannot express an ICE behavior descriptor",
    guidance:
      "define through @vibefield/plugin-sdk/behavior and declare under contributes.behaviors",
  },
  "widgets-contribution-retired": {
    check: "manifest",
    level: "refuse",
    meaning:
      "the retired contributes.widgets — a face on the desk is an object kind the desk draws (DK-8)",
    guidance:
      "declare it under contributes.objects: its durable half (size, props, groups, interaction) and binding.kind, the renderer export that holds its kind (objects.md)",
  },
  "manifest-stale": {
    check: "manifest",
    level: "refuse",
    meaning: "the committed vibefield.plugin.json is not the canonical emission of itself",
    guidance: "re-emit with `pnpm gen:manifest`; never hand-edit the canonical artifact",
  },
  "manifest-unknown-key": {
    check: "manifest",
    level: "note",
    meaning: "a top-level or contributes key the schema does not know (preserved, ungranted)",
    guidance: "remove it, or land the contribution kind in @vibefield/contracts first",
  },
  "manifest-dev-alias-id": {
    check: "manifest",
    level: "note",
    meaning: "a single-segment dev-era id — valid locally, refused by distribution (§6.1)",
    guidance: "use a dotted, distributable id (`vendor.plugin`) before publishing",
  },

  // --- import wall (R10) -------------------------------------------------------
  "wall-violation": {
    check: "wall",
    level: "refuse",
    meaning: "plugin runtime code imports something outside the SDK door (§11.3, wall R10)",
    guidance:
      "import @vibefield/plugin-sdk (+ /ui, /canvas, /behavior, /desk), @vibefield/contracts types, or react",
  },

  // --- declared schemas --------------------------------------------------------
  "schema-invalid": {
    check: "schema",
    level: "refuse",
    meaning: "a declared settings or service JSON Schema does not compile",
    guidance:
      "the schema must compile under ajv (draft-07 style, `strict: false`) as the daemon compiles it",
  },

  // --- declaration <-> binding -------------------------------------------------
  "module-unloadable": {
    check: "activation",
    level: "refuse",
    meaning: "the built renderer entry exists but throws while being imported",
    guidance: "module top-level must not perform product work (§10.1) — do it in activate(ctx)",
  },
  "module-shape-invalid": {
    check: "activation",
    level: "refuse",
    meaning: "the renderer entry's default export has no activate(ctx) function",
    guidance: "export default defineRendererPlugin({ activate(ctx) { … } })",
  },
  "activation-failed": {
    check: "activation",
    level: "refuse",
    meaning: "activate(ctx) threw or rejected",
    guidance: "activate must complete within its deadline and register only declared ids",
  },
  "binding-undeclared": {
    check: "activation",
    level: "refuse",
    meaning:
      "activate registered a widget type, command, surface or behavior the manifest does not declare (§12.1)",
    guidance: "declare it in the manifest first, or stop registering it",
  },
  "binding-missing": {
    check: "activation",
    level: "refuse",
    meaning:
      "the manifest declares a command, surface or behavior that activate never bound (§12.1); a widget row needs none on the desk build — the host compiles it faceless (DK-2), and an object's binding is its module's export (the object-* codes)",
    guidance: "bind every declared command, surface and behavior during activate(ctx)",
  },
  // --- the object rows (DK-6; DK-7: the SDK's kind-conformance harness — its declaration and its
  // program, `@vibefield/plugin-sdk/testing` — the same verdicts the playground says) ---
  "object-export-missing": {
    check: "activation",
    level: "refuse",
    meaning:
      "an objects row's binding.kind names no ObjectBinding the built renderer module exports (§12.8)",
    guidance:
      "export the binding under that name: `export const <name>: ObjectBinding = { kind }` (@vibefield/plugin-sdk/desk)",
  },
  "object-kind-invalid": {
    check: "activation",
    level: "refuse",
    meaning:
      "the named export's kind is not a desk kind (ICE isObjectKind: name · stratum · create · resolve · record · hit · reach), or lies in no stratum the ground draws (pads, sheets, things)",
    guidance:
      "type it `ObjectKind` from @vibefield/plugin-sdk/desk and give it every required member",
  },
  "object-kind-misnamed": {
    check: "activation",
    level: "refuse",
    meaning:
      "the kind's registry name is not the row's type — the host refuses it (one id, no second namespace)",
    guidance: "name the kind exactly as the row's type",
  },
  "object-tray-hang-missing": {
    check: "activation",
    level: "refuse",
    meaning:
      "the row's tray entry does not say how its specimen hangs: no size, no accessory the pegboard has, or no pegs",
    guidance:
      "`tray.hang` with w and h (> 0, CSS px), an accessory (hook, shelf, clip, rail) and 1–8 pegs",
  },
  "object-tray-category-invalid": {
    check: "activation",
    level: "refuse",
    meaning: "the row's tray category is empty or longer than the pegboard's 64 characters",
    guidance: "a tray category of 1–64 characters — the pegboard's chip",
  },
  "object-provides-no-desk-object": {
    check: "activation",
    level: "refuse",
    meaning:
      "the row does not provide `desk.object` — the desk places by what a row provides, never by its type",
    guidance: "provide `desk.object` (DESK_OBJECT) beside the row's own keys",
  },
  "object-create-failed": {
    check: "activation",
    level: "refuse",
    meaning:
      "the kind's create threw, or resolved no KindPass, on a recording device that answers every call as WebGPU does short of compiling",
    guidance:
      "a create that resolves a KindPass (spawn · prepare · drawRange · dispose) from the device, format and mat it is handed",
  },
  "object-kit-piece-unknown": {
    check: "activation",
    level: "refuse",
    meaning: "the kind's program names a piece the render kit does not carry (`kitWgsl`)",
    guidance:
      "name only the kit's pieces in kitWgsl: view, portal, sdf, light (lamp, gobo, night, noise), ruler, book",
  },
  "object-wgsl-not-text": {
    check: "activation",
    level: "refuse",
    meaning:
      "the kind's create asked for a shader module whose code is not WGSL text — the shader did not arrive inlined",
    guidance:
      "import the kind's .wgsl files (plugin-build inlines each as its text) and compose them with kitWgsl",
  },
  "object-wgsl-unread": {
    check: "activation",
    level: "refuse",
    meaning:
      "a pipeline names an entry point its WGSL does not declare for that stage, or overrides a constant it never declares — read from the text, no compiler",
    guidance:
      "name the entry points the WGSL declares (`@vertex fn vs`, `@fragment fn fs` by default) and override only what it declares",
  },
  "object-wgsl-binding-unlaid": {
    check: "activation",
    level: "refuse",
    meaning:
      "a binding a pipeline's stage statically uses is not in that pipeline's layout, or is laid as another kind of resource",
    guidance:
      "carry every binding the WGSL's entry points use in the pipeline's layout, at its @group/@binding, as the same kind of resource",
  },
  "object-bind-group-mismatch": {
    check: "activation",
    level: "refuse",
    meaning:
      "a bind group does not fill its layout exactly — a binding left empty, filled twice, not in the layout, or given the wrong resource",
    guidance:
      "fill every binding of the layout exactly once, each with the resource it asks for (a buffer made for that use, a texture view, a sampler)",
  },
  "object-dispose-failed": {
    check: "activation",
    level: "refuse",
    meaning: "the kind's pass threw when it was disposed",
    guidance: "a dispose that lets go of what the pass made, and never throws",
  },
  "object-wgsl-not-compiled": {
    check: "activation",
    level: "note",
    meaning:
      "the kind's WGSL was READ — its entry points and bindings — never compiled: an unresolved name or a type error passes this row (the honest gap, not a refusal)",
    guidance:
      "nothing to do here: the still that compiles and draws a kind waits on a host-less desk ICE does not publish (VibeField's ask I30)",
  },
  "object-create-not-run-here": {
    check: "activation",
    level: "note",
    meaning:
      "the kind's create did not finish on the recording device (it ran past its budget, or reached for a browser global Node does not define) — the harness's ceiling, not a refusal",
    guidance:
      "nothing to do here: the product makes the pass on a real device; the playground drives its states without it",
  },
  "activation-leak": {
    check: "activation",
    level: "refuse",
    meaning: "deactivation left a timer or handle running (§24.2 leak row)",
    guidance: "clear every timer/listener in the disposable activate returns (or ctx.track it)",
  },
  "objects-need-desk": {
    check: "activation",
    level: "refuse",
    meaning: `the manifest declares object kinds (contributes.objects) — ${OBJECTS_NEED_DESK.message} (§12.8); said only by the ICE 0.11 build — the desk build (DK-2) activates object kinds and no door says it`,
    guidance:
      "kept for the record: on the desk build an object kind activates like any plugin; a host that still says this code predates the desk — run the desk build",
  },
  "activation-unbuilt": {
    check: "activation",
    level: "note",
    meaning: "no built renderer entry on disk, so binding and leak rows could not run",
    guidance: "run `plugin-build` first if you want these rows; `check` never requires a build",
  },
  "activation-not-loadable-here": {
    check: "activation",
    level: "note",
    meaning: "the bundle needs a browser graph (JSX/CSS/ICE) that plain Node cannot import",
    guidance: "the playground runs these rows against a real engine; the CLI reports honestly",
  },

  // --- artifacts (only when dist/ exists) --------------------------------------
  "artifact-missing": {
    check: "artifact",
    level: "refuse",
    meaning: "the manifest declares an entry module that is not on disk",
    guidance: "run `plugin-build`, or fix entries.<renderer|service> to name what it builds",
  },
  "artifact-absent": {
    check: "artifact",
    level: "note",
    meaning: "no dist/ — artifact rows were skipped, which is not a failure",
    guidance: "run `plugin-build` to produce dist/ before packing or publishing",
  },
  "artifact-singleton-build-time": {
    check: "artifact",
    level: "note",
    meaning:
      "duplicate-singleton detection (PA-29) needs the bundler's module list, so it runs in plugin-build, not here",
    guidance: "run `plugin-build`; it refuses a bundle that swallowed a host singleton",
  },
  "artifact-unmappable-specifier": {
    check: "artifact",
    level: "refuse",
    meaning: "the bundle imports a bare specifier the host import map cannot bind (§11.6)",
    guidance: "import only HOST_SINGLETON_MODULE_SPECIFIERS, or let the plugin bundle it in",
  },

  // --- pack --------------------------------------------------------------------
  "pack-refused": {
    check: "pack",
    level: "refuse",
    meaning: "the .vfplugin bundle could not be produced (unsafe entry name, missing entry)",
    guidance: "pack walks vibefield.plugin.json + dist/** + assets/** — keep entries inside them",
  },

  // --- registry ----------------------------------------------------------------
  "index-unreadable": {
    check: "registry",
    level: "refuse",
    meaning: "the registry index could not be read from the given path or url",
    guidance: "pass --index <path to index.json>; its detached signature must sit beside it",
  },
  "index-invalid": {
    check: "registry",
    level: "refuse",
    meaning: "the index bytes are not a RegistryIndex",
    guidance: "generate it with the kit; the shape is RegistryIndex in @vibefield/contracts",
  },
  "signature-missing": {
    check: "registry",
    level: "refuse",
    meaning: "no detached index.json.sig beside the index",
    guidance: "sign the index with `vibefield-plugin index sign <index> --key <secret>`",
  },
  "signature-invalid": {
    check: "registry",
    level: "refuse",
    meaning: "the detached signature does not verify against the index bytes",
    guidance: "re-sign the EXACT bytes on disk; verification never re-canonicalizes",
  },
  "release-not-found": {
    check: "registry",
    level: "refuse",
    meaning: "the index carries no entry for the requested plugin id",
    guidance: "check the id, or submit the plugin to the index first",
  },
  "submit-artifact-url-placeholder": {
    check: "registry",
    level: "note",
    meaning: "the emitted index row's artifactUrl is a placeholder, not a real location",
    guidance: "replace it with the release asset's url before opening the index PR",
  },
  "submit-index-repo-absent": {
    check: "registry",
    level: "note",
    meaning: "the index repository does not exist yet, so submitting is a human step",
    guidance: "keep the row; add it to registry/index.json and sign it when the repo exists",
  },
  "artifact-hash-mismatch": {
    check: "registry",
    level: "refuse",
    meaning: "the artifact's sha256 is not what the index pins (PLUGIN_ARTIFACT_MISMATCH)",
    guidance: "re-pack and re-pin: the index pins the bytes, and a mismatch is never installed",
  },
  "key-unreadable": {
    check: "registry",
    level: "refuse",
    meaning: "the signing key file could not be read, or is not a base64 DER Ed25519 secret key",
    guidance: "generate one with generateRegistryKeypair(); the file holds the base64 secretKey",
  },

  // --- dev-link ----------------------------------------------------------------
  "dev-root-unknown": {
    check: "dev-link",
    level: "refuse",
    meaning: "no dev-linked plugin root could be resolved for this machine",
    guidance:
      "pass --root <dir>, or run inside the repo whose dev session watches examples/plugins",
  },
  "link-exists": {
    check: "dev-link",
    level: "refuse",
    meaning: "the target link name is taken by something this command did not create",
    guidance: "remove it first, or re-run with --remove to unlink what the kit linked",
  },
  "link-missing": {
    check: "dev-link",
    level: "note",
    meaning: "--remove found nothing to unlink",
    guidance: "nothing to do — the plugin is not dev-linked under this root",
  },
  "dev-root-chosen": {
    check: "dev-link",
    level: "note",
    meaning: "which dev-linked root the command used, and why that one",
    guidance: "pass --root to choose a different one; the order is flag, env, repo default",
  },
  "dev-link-next-steps": {
    check: "dev-link",
    level: "note",
    meaning: "what closes the loop after linking — developer mode, then plugins.reload",
    guidance: "the copy is what the daemon re-reads, so re-run dev-link after each build",
  },

  // --- docs ---------------------------------------------------------------------
  "docs-stale": {
    check: "docs",
    level: "refuse",
    meaning: "the committed docs are not what the current schemas generate",
    guidance: "regenerate with `pnpm gen:docs` and commit the result",
  },

  // --- the harness itself --------------------------------------------------------
  "plugin-dir-invalid": {
    check: "input",
    level: "refuse",
    meaning: "the path given is not a directory holding a plugin",
    guidance: "pass the directory that holds vibefield.plugin.json",
  },
  usage: {
    check: "input",
    level: "refuse",
    meaning: "the command line could not be understood",
    guidance: "run `vibefield-plugin --help`; every command is non-interactive",
  },
  "harness-error": {
    check: "harness",
    level: "refuse",
    meaning: "the kit itself failed — a bug here, not in the plugin (exit 2)",
    guidance: "report it with the detail line; the plugin is not implicated",
  },
} as const satisfies Record<string, RefusalClass>;

export type RefusalCode = keyof typeof REFUSAL_CATALOG;

export function guidanceFor(code: RefusalCode): string {
  return REFUSAL_CATALOG[code].guidance;
}

/** The catalog as sorted rows — the docs generator's input, and the shape a
 * test walks when it proves every emitted code is declared here. */
export function catalogRows(): Array<RefusalClass & { code: RefusalCode }> {
  return (Object.keys(REFUSAL_CATALOG) as RefusalCode[])
    .sort()
    .map((code) => ({ code, ...REFUSAL_CATALOG[code] }));
}
