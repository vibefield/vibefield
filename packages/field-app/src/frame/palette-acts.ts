import type { FrameView } from "@vibefield/contracts";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import { createActOf } from "./line-model";
import { FRAME_VIEWS, type ViewKeys, viewKeyLabel } from "./views";
import { ZOOM_ACTS, type ZoomAct, zoomKeyLabel } from "./zoom";

// THE FRAME'S ACTS, AS THE PALETTE LISTS THEM (One Frame §7, FR-5; DESIGN.md
// §8 "The head"): every act with its key at the row's end — the palette is
// where keys are said. Pure: the controller runs them, the view draws them.
// Built from the tables that already own each act (the views track's, the
// line's create, the zoom's), so a key changed there changes here. Godview's
// System control is the one act with no table and no key: it was the
// instrument bar's last tool, and the palette is where it went (GV-D1).
// History's chosen session — Resume, or Jump to — is the other with no key: it
// was the line's create until HN-7, and the palette's History row since.

export type FrameActRun =
  | { readonly kind: "view"; readonly view: FrameView }
  | { readonly kind: "create" }
  | { readonly kind: "chosen-session" }
  | { readonly kind: "zoom"; readonly act: ZoomAct }
  | { readonly kind: "system-control" }
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

/** History's chosen session's act, as the palette's row names and marks it. */
export interface ChosenSessionAct {
  readonly glyph: "resume" | "jump";
  readonly name: string;
}

/** History's chosen session's act (AR-8c, P3; DESIGN.md §8 "History"): Jump to
 * while it runs here, else Resume. The line's create until HN-7; the palette's
 * History row since — each session row's and ④'s head's say the same. */
export function chosenSessionAct(live: boolean): ChosenSessionAct {
  return live
    ? { glyph: "jump", name: "Jump to this session" }
    : { glyph: "resume", name: "Resume this session" };
}

/** The groups in the palette's order: Views · On this view · App.
 * `historyWaits` is why History's chosen session's act waits — the reading of
 * what History lends the frame (`chosenSessionWaits`, AR-8c); absent, it waits
 * for a session to be chosen. `historyLive`: the chosen session runs here, so
 * its act is Jump to (P3) — the same door's word. `systemControlWaits` is why
 * Godview's System control cannot run — its door (`system-control-door.ts`) is
 * not there yet — or null when it can. */
export function frameActGroups(
  view: FrameView,
  keys: ViewKeys,
  historyWaits: string | null = "choose a session first",
  historyLive = false,
  systemControlWaits: string | null = null,
): FrameActGroup[] {
  const views: FrameAct[] = FRAME_VIEWS.map((cell) => ({
    id: `view-${cell.view}`,
    name: cell.name,
    glyph: cell.glyph,
    key: viewKeyLabel(cell, keys),
    waits: null,
    run: { kind: "view", view: cell.view },
  }));
  // The line's create, as the line names and keys it in this view (FC-D3) —
  // New terminal ⌘T in Godview and in History (HN-7) — no row where the view
  // has no act on the line (Chat's, until its New spark comes with SP-1c).
  const create = createActOf(view, keys);
  const onView: FrameAct[] =
    create === null
      ? []
      : [
          {
            id: "create",
            name: create.name,
            glyph: create.glyph,
            key: create.key,
            waits: null,
            run: { kind: "create" },
          },
        ];
  // History's chosen session, after the create (DESIGN.md §8 the palette):
  // Resume, waiting until a session is chosen — Jump to while it runs here —
  // by the reading the line's create kept until HN-7.
  if (view === "history") {
    const session = chosenSessionAct(historyLive);
    onView.push({
      id: "chosen-session",
      name: session.name,
      glyph: session.glyph,
      key: null,
      waits: historyWaits,
      run: { kind: "chosen-session" },
    });
  }
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
  // System control is Godview's (GV-D1): §1.1's temporary panel, toggled from
  // here since the instrument bar left. No key, and no glyph: `sliders` is
  // General settings, and a glyph is one drawing per meaning (§13).
  if (view === "godview") {
    onView.push({
      id: "system-control",
      name: "System control",
      glyph: null,
      key: null,
      waits: systemControlWaits,
      run: { kind: "system-control" },
    });
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
