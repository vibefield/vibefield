// The repo's shared happy-dom shim (DK-5; tooling/test-env): the environment's
// MutationObserver survives a garbage collection — its witness runs there, once.
import "@vibefield/test-env/happy-dom/setup";
import { holdLocalStorage } from "@vibefield/test-env/local-storage";
import { loadDevBundledPlugins } from "../src/field-engine";

// The Node-26 localStorage shim, shared (DK-7; tooling/test-env says why): Node's
// undefined-valued `localStorage` keeps happy-dom's real Storage out, and App.tsx's
// dark-mode init (`localStorage.getItem`) explodes at mount without one.
holdLocalStorage();

/**
 * P8b-3: load the dev-bundled plugin set once, for the whole file.
 *
 * The four built-in plugins stopped being static imports of `field-engine` —
 * production stages them from their own artifacts, and the bundled list is now a
 * DEV fallback behind a dynamic import (P8-D2). The headless suites have no
 * daemon to approve modules and no boot phase to await one, so this awaits the
 * fallback here, where a setup file may use top-level await; `buildRegistry()`
 * with no argument then finds it already loaded and stays synchronous, which is
 * what lets those suites go on calling it from ordinary sync helpers.
 */
await loadDevBundledPlugins();
