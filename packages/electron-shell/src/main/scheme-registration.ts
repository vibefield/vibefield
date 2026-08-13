import { protocol } from "electron";
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from "./app-protocol";
import { PLUGIN_SCHEME, PLUGIN_SCHEME_PRIVILEGES } from "./plugin-protocol";

// The ONE `registerSchemesAsPrivileged` call in the process — and the reason
// this file exists is the P8b-2 regression it retires (probe, 2026-08-13):
//
// Electron documents the API as callable once, before ready. What two calls
// actually do in this Electron is the trap the docs undersell: the second call
// REPLACES the secure-scheme registration while `standard` SURVIVES for the
// first call's schemes. So after P8b-2 added a second call for
// `vibefield-plugin://`, the app origin kept loading — origin semantics,
// module graph, CSP 'self' all intact — and silently stopped being a SECURE
// CONTEXT: `crypto.randomUUID` (and every other secure-context API) vanished,
// and ICE died at first board build. `smoke:canvas` was red for two days with
// no line pointing here. Partial survival is what made it invisible: a full
// clobber would have blanked the window at boot.
//
// The law this file enforces: schemes are REGISTERED TOGETHER or not at all.
// A future scheme joins `shellSchemeRegistrations()`; nothing else in the
// process may call `protocol.registerSchemesAsPrivileged`.

/** PURE — the complete privileged-scheme table, exported so the suite can
 * assert both rows and their exact privilege sets without Electron. */
export function shellSchemeRegistrations(): Electron.CustomScheme[] {
  return [
    { scheme: APP_SCHEME, privileges: { ...APP_SCHEME_PRIVILEGES } },
    { scheme: PLUGIN_SCHEME, privileges: { ...PLUGIN_SCHEME_PRIVILEGES } },
  ];
}

/** Must be called before `app.whenReady()` (ESP §6.1 step 2), exactly once. */
export function registerShellSchemes(): void {
  protocol.registerSchemesAsPrivileged(shellSchemeRegistrations());
}
