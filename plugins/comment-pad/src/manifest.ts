import { INK_TOOLS, type PluginManifestV1 } from "@vibefield/contracts";
import { COMMENT_PAD_TYPE, PAD_ACCENTS, PAD_PENS, PAD_SIZE } from "./ids";
import { COMMENT_PAD_PALETTE } from "./theme";

/**
 * THE COMMENT PAD (DK-8, DK-D14) — VibeField's first own object kind, built as a plugin kind exactly as a third
 * party builds one (the example clock's shape, the template's): a durable pad of comments on the desk — the
 * comments SEAM, not a comments system (design-005 §9's fence stands: no threads, no authors, no resolution;
 * a pad holds lines of text, written in the desk's hand).
 *
 * This manifest is the pad's DURABLE half: its writing in ONE conflict group, `ink` — `text` (its lines, the
 * comments), `seeds` (each glyph's own hand, so a reload re-draws the same hand) and `marks` (each glyph's pen,
 * highlighter, strike and underline — IK, 2026-11-25) — one cell written in one transaction, so a text never pairs
 * with another writer's seeds or marks; its pen (the host's ink, by name), its accent
 * (DESIGN.md §2.6 — the binding strip and the rules' tint) and its `seed` (the hand of a glyph with no stored
 * seed); its size; its interaction (movable, selectable, snapping both ways, never resized); what it PROVIDES —
 * it lies on the desk (`desk.object`) and goes into a mini mat (`desk.containable`, where its chip is its paper
 * with its writing greeked). It has no tray entry since the first launch's lineup (James, 2026-11-09): the selection
 * bar's Comment is its door. The code half is the export `binding.kind` names (object.ts). Emitted to
 * `vibefield.plugin.json` by `pnpm gen:manifest`; the imports here stay pure (ids only) so emitting needs no bundle.
 */
export const commentPadManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: COMMENT_PAD_TYPE,
  version: "0.2.0",
  title: "Comment pad",
  description:
    "A pad of comments lying on the desk — tap it and write in the desk's hand; its lines are the document's, undoable, shared with every peer",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onObject:${COMMENT_PAD_TYPE}`],
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
          // IK, 2026-11-25: each glyph's MARK (its pen, a highlighter under it, a line through it, one under it — the kit's ink
          // value, its runs `count:mark` in base 36 with the unmarked tail dropped): "" is unmarked, so a pad stored before
          // the marks reads unmarked, its cell filled with the default as it projects (no migration: the field is additive)
          marks: { kind: "string", default: "", maxLength: 200000 },
          pen: { kind: "enum", options: [...PAD_PENS], default: "ball" },
          accent: { kind: "enum", options: [...PAD_ACCENTS], default: "indigo" },
          seed: { kind: "number", default: 0 },
        },
        groups: { ink: ["text", "seeds", "marks"] },
        // what an agent can do with a pad (OB-2): one of this kind's two witnesses for a plugin's agent half
        agent: {
          summary: "A pad of comments, one to a line.",
          concurrency: "many",
          faces: [
            { type: "ref", id: "live", label: "Live" },
            { type: "text", id: "words", label: "Its words", format: "plain" },
          ],
          guide: "./assets/agent/guide.md",
          tools: [
            {
              name: "read_text",
              readOnly: true,
              description: "Read every comment on this pad, one to a line.",
              input: { type: "object", properties: {}, additionalProperties: false },
              output: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
            {
              name: "add_comment",
              readOnly: false,
              description:
                "Add one comment at the foot of this pad, on a line of its own. The user can undo it.",
              input: {
                type: "object",
                properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
                required: ["text"],
                additionalProperties: false,
              },
              output: {
                type: "object",
                properties: { comments: { type: "integer", minimum: 1 } },
                required: ["comments"],
              },
            },
            // IK (2026-11-25): the three every written kind shares (contracts' ink-tools.ts)
            ...INK_TOOLS,
          ],
        },
        // OB-D16 (2026-11-25): the likeness Godview's pane wears while an agent holds one, in its accent (its art ships in assets/)
        sticker: {
          art: "./assets/sticker.svg",
          radius: 3,
          paint: [
            {
              prop: "accent",
              slot: "--accent",
              values: Object.fromEntries(
                Object.entries(COMMENT_PAD_PALETTE.accents).map(([name, token]) => [
                  name,
                  token.css,
                ]),
              ),
              fallback: COMMENT_PAD_PALETTE.accents.indigo.css,
            },
          ],
        },
        binding: { kind: "commentPad" },
      },
    ],
  },
};
