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

/**
 * The plugin. PRODUCTION RENDERER ONLY — the UI Bench builds no plugin host and
 * the dev server needs no map (dev plugins are bundled, and a map in the dev
 * document would bind the same specifiers to chunks vite never built).
 */
export function hostSingletons(): Plugin {
  const require = createRequire(import.meta.url);
  const anchor = require.resolve(ANCHOR);
  return {
    // Wall R6 reserves the app-prefixed colon literal for IPC channel names in
    // contracts; a vite plugin name is cosmetic, so it wears vf- instead.
    name: "vf-host-singletons",
    apply: "build",
    resolveId: {
      // Runs before vite's own resolver so the virtual ids never reach it.
      order: "pre",
      async handler(source, importer) {
        if (source.startsWith(VIRTUAL_PREFIX)) {
          return `${RESOLVED_PREFIX}${source.slice(VIRTUAL_PREFIX.length)}`;
        }
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
      return singletonSource(id.slice(RESOLVED_PREFIX.length));
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [
          {
            tag: "script",
            // EXACTLY these attributes, in this shape: main's CSP hasher matches
            // `<script type="importmap">` and nothing else, so an extra
            // attribute here would leave the map unhashed and refused.
            attrs: { type: "importmap" },
            children: importMapJson(),
            // Before every module script — a map must precede the first import
            // it is supposed to resolve, or the document has already failed.
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}
