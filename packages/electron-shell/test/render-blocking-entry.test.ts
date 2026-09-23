import { describe, expect, it } from "vitest";
import { renderBlockingEntry, withRenderBlockingEntry } from "../src/vite/render-blocking-entry";

// DESIGN.md §8 "The switch": a packaged reload paints the new page's bare
// ground ahead of its entry unless the entry is render-blocking, and a Vite
// build drops the attribute the source document carries. These rows pin the
// build's half: the one entry gets it back, and a document the plugin cannot
// read is a build failure, never a silent flash.

const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <script type="importmap">{"imports":{}}</script>
    <script type="module" crossorigin src="./assets/main-DsVyZUK2.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/react-BPAnBefd.js">
    <link rel="stylesheet" crossorigin href="./assets/main-BkH1g531.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

type Handler = (html: string, context: { filename: string }) => string;

function handler(): Handler {
  const hook = renderBlockingEntry().transformIndexHtml as unknown as {
    order: string;
    handler: Handler;
  };
  expect(hook.order).toBe("post"); // after Vite has emitted the bundled entry
  return hook.handler;
}

describe("the render-blocking product entry", () => {
  it("puts `blocking` back on the bundled entry, and touches nothing else", () => {
    const html = withRenderBlockingEntry(BUILT);
    expect(html).toContain(
      '<script type="module" blocking="render" crossorigin src="./assets/main-DsVyZUK2.js"></script>',
    );
    expect(html.replace(' blocking="render"', "")).toBe(BUILT);
    // The import map is inline and CSP-hashed by main: its bytes stay exactly.
    expect(html).toContain('<script type="importmap">{"imports":{}}</script>');
  });

  it("refuses a document whose entry it cannot find, or cannot tell apart", () => {
    expect(() =>
      withRenderBlockingEntry(BUILT.replace(/<script type="module"[^\n]*\n/, "")),
    ).toThrow("expected one module script in index.html, found 0");
    const two = BUILT.replace(
      "</head>",
      '<script type="module" src="./assets/extra.js"></script></head>',
    );
    expect(() => withRenderBlockingEntry(two)).toThrow("found 2");
  });

  it("runs on the product document only, and only when building", () => {
    const transform = handler();
    expect(transform(BUILT, { filename: "/repo/src/renderer-host/index.html" })).toContain(
      'blocking="render"',
    );
    // The catalog and Studio documents are not reloaded by a switch.
    expect(transform(BUILT, { filename: "/repo/src/renderer-host/design-system.html" })).toBe(
      BUILT,
    );
    expect(renderBlockingEntry().apply).toBe("build"); // dev keeps the source's own attribute
  });
});
