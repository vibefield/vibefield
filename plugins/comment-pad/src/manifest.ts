import type { PluginManifestV1 } from "@vibefield/contracts";
import { COMMENT_PAD_CATEGORY, COMMENT_PAD_TYPE, PAD_ACCENTS, PAD_PENS, PAD_SIZE } from "./ids";

/**
 * THE COMMENT PAD (DK-8, DK-D14) — VibeField's first own object kind, built as a plugin kind exactly as a third
 * party builds one (the example clock's shape, the template's): a durable pad of comments on the desk — the
 * comments SEAM, not a comments system (design-005 §9's fence stands: no threads, no authors, no resolution;
 * a pad holds lines of text, written in the desk's hand).
 *
 * This manifest is the pad's DURABLE half: its writing in ONE conflict group, `ink` — `text` (its lines, the
 * comments) and `seeds` (each glyph's own hand, so a reload re-draws the same hand) — one cell written in one
 * transaction, so a text never pairs with another writer's seeds; its pen (the host's ink, by name), its accent
 * (DESIGN.md §2.6 — the binding strip and the rules' tint) and its `seed` (the hand of a glyph with no stored
 * seed); its size; its interaction (movable, selectable, snapping both ways, never resized); what it PROVIDES —
 * it lies on the desk (`desk.object`) and goes into a mini mat (`desk.containable`, where its chip is its paper
 * with its writing greeked); and its tray entry — a pad on a hook under its OWN category, `comments`, its
 * specimen written in the hand. The code half is the export `binding.kind` names (object.ts). Emitted to
 * `vibefield.plugin.json` by `pnpm gen:manifest`; the imports here stay pure (ids only) so emitting needs no bundle.
 */
export const commentPadManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: COMMENT_PAD_TYPE,
  version: "0.1.0",
  title: "Comment pad",
  description:
    "A pad of comments lying on the desk — tap it and write in the desk's hand; its lines are the document's, undoable, shared with every peer",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onWidget:${COMMENT_PAD_TYPE}`],
  capabilities: [], // a kind draws what it is handed and writes its own cell through the desk's gate; it asks for nothing
  contributes: {
    objects: [
      {
        type: COMMENT_PAD_TYPE,
        title: "Comment pad",
        description:
          "A pad of comments: tap it and write — each line a comment, kept with the board, undone a session at a time",
        schemaVersion: 1,
        size: { w: PAD_SIZE.w, h: PAD_SIZE.h },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        // the SDK's DESK_OBJECT and CONTAINABLE (test/manifest.test.ts holds them equal): it lies on the desk and
        // goes into a mini mat by what it provides, never by a list that names it (K8a)
        provides: [COMMENT_PAD_TYPE, "desk.object", "desk.containable"],
        props: {
          text: { kind: "string", default: "", maxLength: 20000 },
          seeds: { kind: "string", default: "", maxLength: 200000 },
          pen: { kind: "enum", options: [...PAD_PENS], default: "ball" },
          accent: { kind: "enum", options: [...PAD_ACCENTS], default: "indigo" },
          seed: { kind: "number", default: 0 },
        },
        groups: { ink: ["text", "seeds"] },
        // on the pegboard (ICE design-017 §8): a pad on a hook under its own category, hung at its own aspect (half
        // its size), its specimen written in the hand with the kind's desk state; one taken off is blank
        tray: {
          category: COMMENT_PAD_CATEGORY,
          label: "Comment pad",
          order: 0,
          hang: { w: PAD_SIZE.w / 2, h: PAD_SIZE.h / 2, accessory: "hook", pegs: [[0, -0.5]] },
          props: { text: "a comment" },
          local: true,
        },
        binding: { kind: "commentPad" },
      },
    ],
  },
};
