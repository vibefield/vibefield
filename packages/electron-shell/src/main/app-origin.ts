// The application origin, alone in a module with no Electron import.
//
// `app-protocol.ts` owns everything that SERVES this origin and re-exports these
// three names, so main still reads them from where they have always lived. They
// sit here because P8b-3's renderer build needs the same strings — the import
// map's targets are absolute `vibefield-app://shell/...` URLs — and a vite
// config cannot import a module that imports `electron`. One spelling, two
// planes: the alternative is a build that string-builds an origin, which is
// app-protocol's own stated failure mode ("a typo'd origin at one call site is
// a silently different security origin").

export const APP_SCHEME = "vibefield-app";

/** The ONLY host this scheme serves. A standard scheme has real origins, so a
 * second host would be a second origin — and `'self'` would stop being a single
 * statement about a single directory. */
export const APP_HOST = "shell";

/** What CSP `'self'` resolves to for the packaged renderer. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
