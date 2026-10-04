// THE PRODUCT'S PALETTE, for a kind's tests (DK-8; DK-7's note, ruled: "a VibeField kind that reads the host's
// palette roles is driven by the harness WITH the product's palette — through the harness's `palette` input,
// never a kind-side fallback to the harness's default").
//
// VibeField mounts its desk with ICE's shipped palette (field-app `field/desk/desk-layer.ts` `deskLook` —
// `deskPalette(name)` from `@vibecook/ice/desk/objects`: the canvas and selection tokens, the note's papers and
// the hand's pens, the vinyls, the board's, the notebooks' and the calendars' materials). A plugin's kind
// cannot import that entry (wall R10 — the built-ins' entry, K-L4), so the SDK's TESTING door hands it the
// palette as DATA: `runKindConformance({ …, palette: productPalette })` judges the kind under the roles the
// product will hand it. field-app's `desk-layer.test.ts` holds this equal to what the product mounts, so the
// two cannot drift. The harness's own default stays the two roles every kind may assume (`canvasBg`,
// `select`): a kind that reads more says so in its test.
//
// Authoring-time only: `@vibefield/plugin-sdk/testing` is never a runtime door (R10's door excludes it).

import type { Palette, ThemeName } from "@vibecook/ice/desk";
import { deskPalette } from "@vibecook/ice/desk/objects";

/** The palette the product mounts its desk with, per theme — a kind's test passes it as the harness's `palette`. */
export const productPalette: Readonly<Record<ThemeName, Palette>> = {
  light: deskPalette("light"),
  dark: deskPalette("dark"),
};
