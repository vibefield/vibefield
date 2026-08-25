import { createRequire } from "node:module";
import type { Plugin } from "vite";
// Reached by PATH rather than by package specifier, and both halves of that are
// forced. Vite loads this config through Node's ESM loader with bare specifiers
// left external, and `@vibefield/contracts` exports TypeScript source whose
// internal imports are extensionless — Node refuses them. A relative import is
// bundled into the config instead, and `registries.ts` imports nothing at all,
// so what gets bundled is exactly that file. The LIST still has one home
// (contracts §11.6); this is only how a config-time reader reaches it.
import { HOST_SINGLETON_MODULE_SPECIFIERS } from "../../../contracts/src/registries";
import { APP_ORIGIN } from "../main/app-origin";

// THE HOST SINGLETON CHUNKS AND THE IMPORT MAP (plugin spec §11.6, PA-29; the
// build half of P8b-3).
//
// A staged plugin's artifact leaves react, three, R3F, ICE, Loro and the SDK
// BARE — `tooling/plugin-build` externalizes exactly the specifiers contracts
// lists, and pack time refuses an artifact that emits any other bare one. Those
// bare specifiers have to resolve to something at import time, and §11.6's
// answer is an import map the host injects: one entry per specifier, pointing at
// a chunk of the host's own build. That is what makes them SINGLETONS — the
// plugin gets the renderer's React, not a second one.
//
// Two decisions worth stating, because both were measured rather than assumed
// (probe 2026-08-13, thinking-p8 §4):
//
// 1. THE CHUNKS LIVE ON THE APP ORIGIN. §11.6 reads as though the host should
//    serve its singletons from the plugin origin, and P8-D9 proposed exactly
//    that. The probe refuted it: an import map binds bare specifiers for the
//    DOCUMENT, so a plugin-origin module importing "react" resolves through the
//    document's map to `vibefield-app://shell/assets/…` and fetches it
//    same-origin. No second scheme, no derived token class, no CORS question.
//
// 2. THE ADDRESSES ARE UNHASHED, and that is what lets the map be static text.
//    A hashed name would change on every build, which is fine for a browser
//    cache and fatal for a map that has to be byte-predictable — main admits the
//    inline map by CSP hash, computed from the built HTML itself. These bytes
//    are served by a local privileged scheme with no cache to bust, so the only
//    thing a content hash would buy here is a moving target.

/** Where a bare specifier is resolved FROM. Anchoring at the renderer product
 * rather than at this package is deliberate: field-app is what declares the
 * singleton libraries, so the host's copy is by construction the same copy the
 * app itself uses. Resolving from electron-shell would either fail (it declares
 * almost none of them) or, worse, pull a second one down beside the app's. */
const ANCHOR = "@vibefield/field-app";

/** Input ids look like `vf-singleton:react`; rollup sees them resolved with the
 * usual virtual-module NUL prefix so nothing on disk can collide. */
const VIRTUAL_PREFIX = "vf-singleton:";
const RESOLVED_PREFIX = `\0${VIRTUAL_PREFIX}`;

/** Rolldown warns `IMPORT_IS_UNDEFINED` for the `default` read in a singleton
 * whose target has no default export — react/jsx-runtime, ICE, Loro and both
 * SDK subpaths, five expected warnings per build. The read is deliberate (see
 * `singletonSource`), so this drops exactly that code for exactly these virtual
 * modules and lets every other warning through, including the same code from
 * any real file. */
export function isExpectedSingletonWarning(warning: {
  code?: string;
  id?: string;
  loc?: { file?: string };
  message?: string;
}): boolean {
  if (warning.code !== "IMPORT_IS_UNDEFINED") return false;
  const where = `${warning.id ?? ""} ${warning.loc?.file ?? ""} ${warning.message ?? ""}`;
  return where.includes(VIRTUAL_PREFIX);
}

/** A specifier's file-name form: `@` dropped, `/` folded to `-`. Deterministic
 * and injective over the declared set (a test pins the uniqueness — two
 * specifiers colliding here would silently serve one plugin another's library). */
export function singletonSlug(specifier: string): string {
  return specifier.replace(/^@/, "").replaceAll("/", "-");
}

/** What marks a chunk as one of these, for the unhashed-name rule in the vite
 * config. Nothing else in the renderer output may start with it. */
export const SINGLETON_CHUNK_PREFIX = "singleton-";

/** The chunk name, which is also the file name: `assets/<chunkName>.js`. */
export function singletonChunkName(specifier: string): string {
  return `${SINGLETON_CHUNK_PREFIX}${singletonSlug(specifier)}`;
}

/** The rollup inputs — one entry chunk per declared specifier. Rollup routes
 * the app's OWN copy of each library through the same chunk (it is reachable
 * from two entries), so this adds addresses, not copies. */
export function singletonInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const specifier of HOST_SINGLETON_MODULE_SPECIFIERS) {
    inputs[singletonChunkName(specifier)] = `${VIRTUAL_PREFIX}${specifier}`;
  }
  return inputs;
}

/** The map, as the exact bytes that go into the document.
 *
 * Sorted and re-serialized from a plain object rather than emitted in
 * declaration order: main hashes these bytes for the CSP, so "the same map"
 * has to mean the same bytes on every machine and every build. Reordering the
 * contracts list must not move the hash. */
export function importMapJson(): string {
  const imports: Record<string, string> = {};
  for (const specifier of [...HOST_SINGLETON_MODULE_SPECIFIERS].sort()) {
    imports[specifier] = `${APP_ORIGIN}/assets/${singletonChunkName(specifier)}.js`;
  }
  return JSON.stringify({ imports });
}

/** The dev-server address of one singleton's virtual module: vite's `/@id/`
 * escape hatch, with the resolved NUL prefix spelled `__x00__` the way vite
 * itself spells it in URLs. Requesting this walks the same plugin hooks the
 * build walks — resolveId hands back the virtual id, load emits
 * `singletonSource`, and vite's import analysis then rewrites the inner bare
 * import to its own serving of the library (the optimized dep for a package,
 * transformed workspace source for the SDK). That last step is the point:
 * the plugin gets the copy the dev document itself runs. */
export function devSingletonUrl(specifier: string): string {
  return `/@id/__x00__${VIRTUAL_PREFIX}${specifier}`;
}

/** The serve-mode map. Same shape and sort discipline as `importMapJson` even
 * though nothing hashes it (the dev CSP is null) — one less way for the two
 * documents to drift apart. */
export function devImportMapJson(): string {
  const imports: Record<string, string> = {};
  for (const specifier of [...HOST_SINGLETON_MODULE_SPECIFIERS].sort()) {
    imports[specifier] = devSingletonUrl(specifier);
  }
  return JSON.stringify({ imports });
}

/** The virtual module's source.
 *
 * `export *` re-exports the named bindings; `default` is handled separately
 * because `export *` deliberately excludes it. Reading it off the namespace
 * makes a MISSING default `undefined` rather than a build error — several of
 * these specifiers (react/jsx-runtime, the SDK subpaths) have no default export
 * and must still be bindable by a plugin that imports one namespace-style. */
function singletonSource(specifier: string): string {
  const quoted = JSON.stringify(specifier);
  return [
    `import * as singleton from ${quoted};`,
    `export * from ${quoted};`,
    `export default singleton["default"];`,
    "",
  ].join("\n");
}

/** The DEV spelling of the same module, and why it must differ (measured
 * 2026-08-24 against the live dev server): vite's optimized dep for a CJS
 * package exports ONLY `default` (`export default require_react()`), so
 * `export *` re-exports nothing there and `import { useState } from "react"`
 * through the dev map would arrive undefined — exactly what vite's "Unable to
 * interop `export *`" warning means. The namespace import is interop'd
 * PROPERLY (vite spreads the CJS exports into it), so the names exist at
 * runtime; they just need static `export` statements to be importable. This
 * runs in the dev server's node process, so it can simply ASK the package:
 * `require` it from the anchor and spell one `export const` per key. Where
 * require cannot answer — the SDK's TS source, an ESM-only package with
 * top-level await — the module is real ESM through vite and the build shape's
 * `export *` genuinely carries its names, so that is the fallback. */
function devSingletonSource(
  specifier: string,
  requireFromAnchor: ReturnType<typeof createRequire>,
): string {
  let names: string[] | null = null;
  try {
    const mod: unknown = requireFromAnchor(specifier);
    if (typeof mod === "object" && mod !== null) {
      names = Object.keys(mod).filter(
        (name) =>
          name !== "default" && name !== "__esModule" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
      );
    }
  } catch {
    /* not requireable from node — real ESM through vite; export * suffices */
  }
  if (names === null || names.length === 0) return singletonSource(specifier);
  const quoted = JSON.stringify(specifier);
  return [
    `import * as singleton from ${quoted};`,
    `export * from ${quoted};`,
    ...names.map((name) => `export const ${name} = singleton[${JSON.stringify(name)}];`),
    `export default singleton["default"];`,
    "",
  ].join("\n");
}

/**
 * The plugin, in BOTH commands — only the UI Bench goes without it (the config
 * excludes this plugin for `design`/`live-surfaces-lab`, which build no plugin
 * host).
 *
 * This used to be `apply: "build"` under the claim "the dev server needs no
 * map (dev plugins are bundled)" — **falsified 2026-08-24**: the boot law is
 * staged-first (field-engine.ts), a dev fieldd approves any discovered plugin
 * whose artifacts exist, and those artifacts carry the same bare specifiers
 * the built renderer resolves through this map. A `pnpm dev` on a tree whose
 * plugin dists the gate had just rebuilt imported them into a map-less
 * document, and every widget face read "Failed to resolve module specifier
 * '@vibefield/plugin-sdk'" — the dev-bundled fallback never engages there,
 * because staged approvals are exactly what suppress it. Serve now injects
 * the same map with dev targets (`devImportMapJson`); the old warning's
 * "chunks vite never built" applied to the BUILD-shaped map, not to `/@id/`
 * URLs, which vite serves on demand.
 */
export function hostSingletons(): Plugin {
  const require = createRequire(import.meta.url);
  const anchor = require.resolve(ANCHOR);
  // Anchored AT field-app, not here: electron-shell declares almost none of the
  // singleton libraries, and the whole point is enumerating the copy vite's
  // own anchored resolution will serve.
  const anchorRequire = createRequire(anchor);
  let command: "build" | "serve" = "build";
  return {
    // Wall R6 reserves the app-prefixed colon literal for IPC channel names in
    // contracts; a vite plugin name is cosmetic, so it wears vf- instead.
    name: "vf-host-singletons",
    configResolved(config) {
      command = config.command;
    },
    resolveId: {
      // Runs before vite's own resolver so the virtual ids never reach it.
      order: "pre",
      async handler(source, importer) {
        if (source.startsWith(VIRTUAL_PREFIX)) {
          return `${RESOLVED_PREFIX}${source.slice(VIRTUAL_PREFIX.length)}`;
        }
        // Serve reaches a virtual module through its `/@id/__x00__…` URL, so
        // the id arrives ALREADY wearing the resolved NUL prefix — answer it
        // as itself rather than letting vite's own resolver refuse the NUL.
        if (source.startsWith(RESOLVED_PREFIX)) return source;
        // A virtual module has no directory, so a bare specifier imported by one
        // has nowhere to resolve from. Hand it the anchor's location instead —
        // this is the whole reason the singletons are the app's own copies.
        if (importer?.startsWith(RESOLVED_PREFIX)) {
          return await this.resolve(source, anchor, { skipSelf: true });
        }
        return null;
      },
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const specifier = id.slice(RESOLVED_PREFIX.length);
      return command === "serve"
        ? devSingletonSource(specifier, anchorRequire)
        : singletonSource(specifier);
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [
          {
            tag: "script",
            // EXACTLY these attributes, in this shape: main's CSP hasher matches
            // `<script type="importmap">` and nothing else, so an extra
            // attribute here would leave the map unhashed and refused. The dev
            // document is never hashed (dev CSP is null) but wears the same
            // shape — one tag, two target sets.
            attrs: { type: "importmap" },
            children: command === "serve" ? devImportMapJson() : importMapJson(),
            // Before every module script — a map must precede the first import
            // it is supposed to resolve, or the document has already failed.
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}
