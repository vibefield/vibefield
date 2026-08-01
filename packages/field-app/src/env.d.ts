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
