import type { PluginManifestV1 } from "@vibefield/contracts";

export const ARTIFACT_SURFACE = "vibefield.browser.artifacts";

/** The canvas browser card (DT-3). DURABLE — it lives in boards (plugin spec
 * §21.2), so the name is settled here and never again. */
export const BROWSER_PAGE_TYPE = "vibefield.browser.page";

/** The blank page a freshly inserted card carries. `about:blank` is a real
 * destination, not a placeholder for one: main's browser policy admits exactly
 * http/https/about:blank, so this is the one address the card can hold before
 * the user has chosen anything. */
export const BLANK_PAGE = "about:blank";

/** Artifact Hub is a built-in actor on a spine-owned stage. Its manifest is
 * deliberately the whole authority request: catalog read, local publication,
 * native folder selection, and validated external open.
 *
 * DT-3 adds a second, unrelated face to the same plugin (DT-D1 chose the pack
 * shape: the browser widget joins `vibefield.browser` rather than opening a new
 * pack). The two contributions share nothing but the manifest — the panel is a
 * side-panel surface over the artifact catalog, the widget is a canvas card
 * over a live surface — and the capability list is now the union of both
 * requests: `surface.attach` mints the attachment, `surface.browser` is what
 * makes the minted surface a BROWSER one (DT-D3's three-scope split; both are
 * renderer-eligible since DT-2b-3). */
export const browserManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "vibefield.browser",
  version: "0.1.0",
  title: "Browser",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onSurface:${ARTIFACT_SURFACE}`, `onWidget:${BROWSER_PAGE_TYPE}`],
  capabilities: [
    "artifact.publish",
    "workspace.read",
    "shell.dialog",
    "shell.open",
    "surface.attach",
    "surface.browser",
  ],
  contributes: {
    surfaces: [
      {
        id: ARTIFACT_SURFACE,
        title: "Artifacts",
        slot: "hud.side-panel",
        order: 100,
      },
    ],
    widgets: [
      {
        type: BROWSER_PAGE_TYPE,
        title: "Browser",
        description: "A live web page on the canvas — navigate it where it sits",
        category: "Tools",
        // The tray silhouette. A literal because the manifest vocabulary is
        // DATA (SafePreview takes a hex or a gradient, never a token name); the
        // live card paints itself from tokens in `browser-page.css`, which is
        // where DESIGN.md §10's no-hex rule applies.
        preview: { kind: "color", value: "#1c1f26" },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 520, h: 380 },
        minSize: { w: 280, h: 200 },
        // `keyboard: "exclusive"` is DT-D6 verbatim: while a node inside this
        // card holds focus the engine keymap and Space-pan stand down, so keys
        // reach the page instead of the canvas. It is the opposite call from
        // the terminal mirror's — that card must never take focus, this one
        // exists to be typed into. `keyboardEscape: "release"` keeps the way
        // out cheap: Escape blurs back to the canvas rather than being swallowed
        // by the page, which is the only reason an exclusive claim is safe to
        // hand a widget the user reaches by accident.
        interaction: {
          selectable: true,
          movable: true,
          resizable: true,
          snap: "target",
          keyboard: "exclusive",
          keyboardEscape: "release",
        },
        provides: ["widget"],
        // DT-D7 (EL4): intent persists, runtime identity never. `url` is the
        // user's NAVIGATION INTENT — the last top-level URL a gesture in this
        // widget committed — not a mirror of the page's history. `title` is
        // remembered so a card whose page is gone can still say what it was.
        // `surfaceId`/`attachmentId`/`producerEpoch`/`geometryRevision` are
        // runtime-only (LSF §5) and appear nowhere in this table.
        props: {
          url: { kind: "string", default: BLANK_PAGE },
          title: { kind: "string", default: "" },
          showChrome: { kind: "boolean", default: true },
        },
        // DT-D7's conflict-group discipline: `title` is split from the
        // address so a rename never conflicts with a re-bind, and the chrome
        // toggle is split from both so hiding the nav row never conflicts with
        // either. Group names are DURABLE component suffixes (`${type}:${name}`).
        groups: { address: ["url"], title: ["title"], chrome: ["showChrome"] },
      },
    ],
  },
};
