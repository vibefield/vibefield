// Build-tool ambience without a build-tool dependency: the bundler (vite, in
// electron-shell) handles CSS imports; TypeScript just needs to not object.
declare module "*.css" {}
