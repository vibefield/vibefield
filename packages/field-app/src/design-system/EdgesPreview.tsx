import {
  ArtifactPanelPreview,
  type ArtifactPanelPreviewState,
} from "@vibefield/plugin-browser/design-system";
import type { ReactElement } from "react";
import { HistoryPlaceholderView } from "../frame/ViewCover";
import { type EdgeTrayTile, EdgeTrayView } from "../hud/edge-tray/EdgeTrayView";
import { GodviewPreview } from "./GodviewPreview";

// The edges' fixture ADAPTER (One Frame FR-4; docs/UI_SYSTEM.md): the shipping
// edge trays — `EdgeTrayView`, both sides — over fixture tiles, one plate per
// state the page's edges-and-corner plates draw: both notches whole on Canvas,
// both resting as slivers over Godview, the notch a sliver grows into on
// approach (over History), the clipboard's drawer open over Godview, and
// Artifacts' drawer open with the Artifact Hub in it (the plugin's own fixture
// door). What it replaces is only what a host supplies: the stills, the
// owner's open drawer, the view. The markup and the CSS are the product's.

/** A fixture still: an SVG the catalog draws itself, so a tile shows a real
 * image without a screenshot on disk (the product's stills come through the
 * shell's `vibefield-still://` scheme, which the catalog does not have). */
function fixtureStill(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 62%)'/><stop offset='1' stop-color='hsl(${hue + 30} 70% 40%)'/></linearGradient></defs>` +
    `<rect width='256' height='256' fill='url(#g)'/>` +
    `<rect x='28' y='40' width='200' height='120' rx='14' fill='rgba(255,255,255,0.22)'/>` +
    `<text x='40' y='190' font-family='ui-sans-serif' font-size='18' fill='rgba(255,255,255,0.9)'>${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const TRAY_TILES: readonly EdgeTrayTile[] = [
  {
    id: "t1",
    kind: "capture",
    label: "Screenshot · 1440 × 900",
    imageUrl: fixtureStill("Godview · swarm", 214),
    time: "15:04",
    day: "today",
    meta: "Screen · on the clipboard",
  },
  {
    id: "t2",
    kind: "capture",
    label: "Screenshot · 820 × 512",
    imageUrl: fixtureStill("Terminal", 28),
    time: "14:38",
    day: "today",
    meta: "Screen · on the clipboard",
  },
  {
    id: "t3",
    kind: "capture",
    label: "Screenshot · 1200 × 750",
    imageUrl: null,
    time: "22:12",
    day: "yesterday",
    meta: "the still is gone from disk",
  },
  {
    id: "t4",
    kind: "capture",
    label: "Screenshot · 640 × 400",
    imageUrl: fixtureStill("Settings", 150),
    time: "Tue",
    day: "earlier",
    meta: "Screen · on the clipboard",
  },
];

/** The page's edges-and-corner plates, in its order. */
export const EDGE_STATES = ["canvas", "godview", "approach", "clipboard", "artifacts"] as const;
export type EdgeState = (typeof EDGE_STATES)[number];

const nothing = (): void => undefined;

/** Artifacts' drawer, open, holding the Hub in one of its states — the
 * contents the 26rem side panel held, in the drawer's 152 column. */
export function ArtifactsDrawer({
  state = "populated",
  open = true,
}: {
  state?: ArtifactPanelPreviewState;
  open?: boolean;
}): ReactElement {
  return (
    <EdgeTrayView
      side="right"
      label="Artifacts"
      open={open}
      pinned={false}
      count={null}
      content={open ? <ArtifactPanelPreview state={state} /> : null}
      items={[]}
      filter=""
      snap={null}
      bumped={false}
      hint="Artifacts"
      emptyWord=""
      onNubClick={nothing}
      onPointerEnter={nothing}
      onPointerLeave={nothing}
    />
  );
}

/** Both edges as the window shows them in one state: the left's clipboard
 * and the right's Artifacts, over the canvas or a covered view. */
export function EdgesPlate({ state, dark }: { state: EdgeState; dark: boolean }): ReactElement {
  const covered = state === "godview" || state === "approach" || state === "clipboard";
  // Over a covered view a notch at rest is a sliver — every notch but the one
  // a sliver grows into on approach, and a drawer that is open.
  const resting = covered && state !== "approach";
  const ground =
    state === "approach" ? (
      <HistoryPlaceholderView />
    ) : covered ? (
      <GodviewPreview theme={dark ? "dark" : "light"} />
    ) : null;
  return (
    <div className="vf-ds-edges-plate" data-state={state} data-covered={covered ? "" : undefined}>
      {ground !== null && <div className="vf-ds-edges-ground">{ground}</div>}
      <EdgeTrayView
        side="left"
        label="Clipboard"
        open={state === "clipboard"}
        pinned={false}
        count={TRAY_TILES.length}
        sliver={resting}
        items={TRAY_TILES}
        filter=""
        snap={{ state: "ready", word: "snap" }}
        bumped={false}
        hint="Clipboard  ⇧⌘V"
        emptyWord="nothing here yet — take a screenshot and it lands here"
        onNubClick={nothing}
        onPointerEnter={nothing}
        onPointerLeave={nothing}
      />
      {state === "artifacts" ? (
        <ArtifactsDrawer />
      ) : (
        <EdgeTrayView
          side="right"
          label="Artifacts"
          open={false}
          pinned={false}
          count={null}
          sliver={resting}
          content={null}
          items={[]}
          filter=""
          snap={null}
          bumped={false}
          hint="Artifacts"
          emptyWord=""
          onNubClick={nothing}
          onPointerEnter={nothing}
          onPointerLeave={nothing}
        />
      )}
    </div>
  );
}
