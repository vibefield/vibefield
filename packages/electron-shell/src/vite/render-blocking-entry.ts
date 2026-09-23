import { basename } from "node:path";
import type { Plugin } from "vite";

// The product entry is render-blocking (DESIGN.md §8 "The switch").
//
// A user switch reloads the window, and the window being left converges on
// exactly the frame the next one paints first — the boot splash wearing the
// face of the user arriving. Measured 2026-09-22 (Electron 43): Chromium holds
// the old frame through a reload until the new page paints content when the
// page is `http:` (the dev server), but NOT when it is `vibefield-app:` (the
// packaged app) — there the new page's bare ground shows for as long as the
// boot script runs. `blocking="render"` on the entry script holds the first
// frame until the entry has run, and the entry paints synchronously
// (mount.tsx), so that first frame IS the splash.
//
// The source `index.html` carries the attribute and the dev server keeps it,
// but a build re-emits the bundled entry's tag and drops attributes it does
// not know — `blocking` among them. This puts it back, and refuses to build a
// product document whose entry it cannot find, rather than ship one that
// silently flashes.

const ENTRY_DOCUMENT = "index.html";
const MODULE_SCRIPT = /<script type="module"( crossorigin)? src="([^"]+)"><\/script>/g;

/** The product document with its one entry script made render-blocking.
 * Throws when the document does not hold exactly one module script. */
export function withRenderBlockingEntry(html: string): string {
  const entries = [...html.matchAll(MODULE_SCRIPT)];
  if (entries.length !== 1) {
    throw new Error(
      `render-blocking entry: expected one module script in ${ENTRY_DOCUMENT}, found ${entries.length}`,
    );
  }
  return html.replace(
    MODULE_SCRIPT,
    (_tag, crossorigin: string | undefined, src: string) =>
      `<script type="module" blocking="render"${crossorigin ?? ""} src="${src}"></script>`,
  );
}

export function renderBlockingEntry(): Plugin {
  return {
    name: "vf-render-blocking-entry",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        return basename(context.filename) === ENTRY_DOCUMENT ? withRenderBlockingEntry(html) : html;
      },
    },
  };
}
