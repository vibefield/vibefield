// Build-tool ambience without a build-tool dependency: the bundler (vite, in
// electron-shell) handles CSS imports; TypeScript just needs to not object.
declare module "*.css" {}

// Vite's worker-constructor import. The `?worker` form is what reaches a worker
// that ships inside a dependency: the bare-specifier `new URL(…, import.meta.url)`
// pattern only resolves relative paths.
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// Vite's asset queries (DK-3, the desk's assets — field/desk/desk-assets.ts): `?url` is a file's
// served URL (the pen faces, loaded by `FontFace(url)`); `?raw` is a text file's contents as a string
// (the plates' and the seed print's base64 — bundled modules, never a request).
declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?raw" {
  const text: string;
  export default text;
}

/** The renderer is built by Vite, but field-app deliberately has no build-tool dependency. */
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
