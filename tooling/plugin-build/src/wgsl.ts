// WGSL AS TEXT (DK-6). A desk kind ships its shaders as `.wgsl` files beside its pass, and its
// renderer imports each one as the file's TEXT — `import CLOCK_WGSL from "./clock.wgsl"` is a string,
// byte for byte the file on disk. ICE carries its own desk's WGSL the same way (`shaders.gen.ts`: each
// `.wgsl` file's text as a string value, one text for every host — the browser's bundle and the Node
// oracle), so a plugin kind composes its text with the kit's pieces exactly as a built-in does
// (`kitWgsl(names, { modules: [{ label, text }] })`).
//
// INLINED, never a second file: fieldd serves a plugin's entry `.js` (and its sibling `.css`) and
// nothing else — the plugin scheme refuses path segments — so a shader that travelled as its own
// asset or URL would never reach the renderer. `assets/` is unchanged (it holds the manifest's
// icon and preview); a `.wgsl` file under `src/` is source, and `pack` never ships `src/`.
//
// Structural on purpose — no `vite` import — so the module loads anywhere a plugin's tooling does:
// plugin-build's renderer stage wires it, and a plugin's own `vitest.config.ts` adds it the same way
// (`plugins: [wgsl()]`), so its units import the same text the bundle carries. A query (`?raw`,
// `?url`) is left to Vite's own handling.

import { readFile } from "node:fs/promises";

/** The extension this plugin owns. */
export const WGSL_EXTENSION = ".wgsl";

/** The module a `.wgsl` file becomes: its text as the default export. */
export function wgslModule(text: string): string {
  return `export default ${JSON.stringify(text)};\n`;
}

/** The Vite/Rollup plugin: a `.wgsl` import loads as its text. */
export function wgsl(): {
  readonly name: string;
  readonly enforce: "pre";
  load(id: string): Promise<{ code: string; map: null } | null>;
} {
  return {
    // (never the app's IPC channel prefix, which wall R6 reserves for packages/contracts)
    name: "plugin-build:wgsl",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(WGSL_EXTENSION)) return null;
      return { code: wgslModule(await readFile(id, "utf8")), map: null };
    },
  };
}
