import { type FrameView, frameViewBuilt } from "@vibefield/contracts";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import { createActOf } from "./draft";
import { FRAME_VIEWS, type ViewKeys, viewKeyLabel } from "./views";
import { ZOOM_ACTS, type ZoomAct, zoomKeyLabel } from "./zoom";

// THE FRAME'S ACTS, AS THE PALETTE LISTS THEM (One Frame §7, FR-5; DESIGN.md
// §8 "The head"): every act with its key at the row's end — the palette is
// where keys are said. Pure: the controller runs them, the view draws them.
// Built from the tables that already own each act (the views track's, the
// line's create, the zoom's), so a key changed there changes here.

export type FrameActRun =
  | { readonly kind: "view"; readonly view: FrameView }
  | { readonly kind: "create" }
  | { readonly kind: "zoom"; readonly act: ZoomAct }
  | { readonly kind: "settings" };

export interface FrameAct {
  readonly id: string;
  readonly name: string;
  /** The row's mark; null where the act has none (the zoom's). */
  readonly glyph: GlyphName | null;
  /** The key, as said; null where it has none. */
  readonly key: string | null;
  /** Why it cannot run yet, said under its name; null when it can. */
  readonly waits: string | null;
  /** More words it answers to when typed ("zoom" for Actual size). */
  readonly terms?: string;
  readonly run: FrameActRun;
}

export interface FrameActGroup {
  readonly id: "views" | "view" | "app";
  readonly eyebrow: string;
  readonly acts: readonly FrameAct[];
}

/** The groups in the palette's order: Views · On this view · App.
 * `historyWaits` is why History's create (Resume) waits — the line's own
 * reading of what History lends it (`historyCreateWaits`, AR-8c); absent,
 * History's create waits for a session to be chosen. `historyLive`: the chosen
 * session runs here, so the create is Jump to (P3) — the same door's word. */
export function frameActGroups(
  view: FrameView,
  keys: ViewKeys,
  historyWaits: string | null = "choose a session first",
  historyLive = false,
): FrameActGroup[] {
  const views: FrameAct[] = FRAME_VIEWS.map((cell) => ({
    id: `view-${cell.view}`,
    name: cell.name,
    glyph: cell.glyph,
    key: viewKeyLabel(cell, keys),
    waits: frameViewBuilt(cell.view) ? null : "not built yet",
    run: { kind: "view", view: cell.view },
  }));
  // The line's create, as the line names and keys it in this view (FC-D3).
  const create = createActOf(view, keys, view === "history" && historyLive);
  const onView: FrameAct[] = [
    {
      id: "create",
      name: create.name,
      glyph: create.glyph,
      key: create.key,
      waits: view === "history" ? historyWaits : null,
      run: { kind: "create" },
    },
  ];
  // The zoom is Canvas's instrument (FC-D8): its acts are on Canvas only.
  if (view === "canvas") {
    for (const entry of ZOOM_ACTS) {
      onView.push({
        id: `zoom-${entry.act}`,
        name: entry.name,
        glyph: null,
        key: zoomKeyLabel(entry.act, keys),
        waits: null,
        terms: "zoom",
        run: { kind: "zoom", act: entry.act },
      });
    }
  }
  const app: FrameAct[] = [
    {
      id: "settings",
      name: "Settings…",
      glyph: "gear",
      key: keys === "mac" ? "⌘," : "Ctrl+,",
      waits: null,
      run: { kind: "settings" },
    },
  ];
  return [
    { id: "views", eyebrow: "Views", acts: views },
    { id: "view", eyebrow: "On this view", acts: onView },
    { id: "app", eyebrow: "App", acts: app },
  ];
}
