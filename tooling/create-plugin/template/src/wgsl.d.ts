// A `.wgsl` module is its file's TEXT: plugin-build inlines each one into the renderer bundle as a
// string (`@vibefield/plugin-build`'s `wgsl()`), and vitest.config.ts loads them the same way.
declare module "*.wgsl" {
  const text: string;
  export default text;
}
