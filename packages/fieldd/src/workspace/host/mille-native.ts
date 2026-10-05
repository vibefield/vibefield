import { milleNativePath } from "./native-path";

/** mille's package version, written into the bundle by its build
 * (`scripts/files-host-build.mjs` defines it from the installed package). */
declare const __MILLE_PACKAGE_VERSION__: string | undefined;

// FS-1a (L1) — mille's native addon, loaded from the EXPLICIT path fieldd
// handed this worker. The files-host bundle (scripts/files-host-build.mjs)
// resolves `@vibecook/mille`'s own `./native.js` to THIS module, so the
// package's per-platform search — its `import.meta.url`, its `require` of an
// optional dependency, its local-build fallback — never runs in the worker:
// a packaged fieldd is a single-executable application with no node_modules to
// search, and a development one loads exactly the file fieldd staged.
//
// The shape is mille 0.3.4's `native.js` export surface: `native` (the
// binding) and `nativeLoadInfo` (its provenance, read by `buildIdentity`).
// A pin move re-checks it (EL8): the bundle's own test loads the engine.

const resolvedPath = milleNativePath();
const loaded = { exports: {} as Record<string, unknown> };
process.dlopen(loaded, resolvedPath);

export const native = loaded.exports;

export const nativeLoadInfo = Object.freeze({
  source: "explicit" as const,
  resolvedPath,
  packageVersion:
    typeof __MILLE_PACKAGE_VERSION__ === "string" ? __MILLE_PACKAGE_VERSION__ : "unknown",
});
