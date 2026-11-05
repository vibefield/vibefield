import type { IndexApp } from "@vibefield/contracts";
import type { ReactElement } from "react";
import type { MadeAppState } from "./made-apps";

// A MADE TILE (DESIGN.md §8 "Artifacts — the Artifacts shelf's contents", as amended 2026-11-05): the
// Hub's tile form, kept — its 16:10 well (corners 10, the hairline ring) holding the app's preview,
// AH-4's still, or until it has one the fallback squircle (§2.9's one exception) centred in the
// well at 60; under the well its name, the fact line (`Claude Code · vibe-field`), and its desktop
// with its state: the status dot (§2.5) beside the desktop's name, and the state's word when it is
// not serving ("mini · asleep"). Its menu (•••, on a chip over the well) holds Keep (or Stop
// keeping), Versions, Open in ‹host› (only with a hosted link) and Hide from Apps.
// RED SKELETON (MA-4a): it draws an empty tile.

export interface MadeAppTileProps {
  readonly app: IndexApp;
  /** the fact line, `‹agent› · ‹project›` (`madeAppFacts`) */
  readonly facts: string;
  /** its desktop's name (`madeAppDesktop`) */
  readonly desktop: string;
  readonly state: MadeAppState;
  /** the preview image's address (`madeAppImageUrl`), absent before a preview */
  readonly imageUrl: string | undefined;
  /** kept, by the door's row or this window's last mark */
  readonly kept: boolean;
  /** an act of the group is under way: the tile's acts wait */
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onKeep: () => void;
  readonly onHide: () => void;
  readonly onVersions: () => void;
}

export function MadeAppTile(_props: MadeAppTileProps): ReactElement {
  return <li className="vf-apps-tile" />;
}

/** The tile's well: the preview with its two retries, then — or before a preview — the fallback. */
export function MadeAppWell(_props: {
  readonly app: IndexApp;
  readonly imageUrl: string | undefined;
}): ReactElement {
  return <span className="vf-apps-well" />;
}

/** The fallback squircle (§2.9's exception): by day the project's ink behind the initial in white,
 * by night the dark tile with the initial in the ink; with no project, the theme's fill and the
 * primary ink. The ink rides one custom property, `--vf-apps-ink` (`projectInk(ink)`). */
export function MadeAppFallbackIcon(_props: {
  readonly initial: string;
  readonly ink: number | undefined;
}): ReactElement {
  return <span className="vf-apps-icon" />;
}
