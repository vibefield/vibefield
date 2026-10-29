import {
  ArtifactPanelPreview,
  type ArtifactPanelPreviewState,
} from "@vibefield/plugin-browser/design-system";
import type { ReactElement } from "react";
import { EdgeTrayView } from "../hud/edge-tray/EdgeTrayView";
import { GodviewPreview } from "./GodviewPreview";
import { HistoryPreview } from "./HistoryPreview";

// The edge's fixture ADAPTER (One Frame FR-4; docs/UI_SYSTEM.md): the shipping
// edge tray — `EdgeTrayView`, on the right edge — one plate per state the
// page's edges plates draw: the notch whole on Canvas, resting as its sliver
// over Godview, the notch a sliver grows into on approach (over History), and
// Artifacts' drawer open with the Artifact Hub in it (the plugin's own fixture
// door). What it replaces is only what a host supplies: the owner's open
// drawer, the view. The markup and the CSS are the product's. (The left edge's
// clipboard retired into the hand, track HN — its plates are `CardsPreview`.)

/** The page's edges plates, in its order. */
export const EDGE_STATES = ["canvas", "godview", "approach", "artifacts"] as const;
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
      label="Artifacts"
      open={open}
      pinned={false}
      content={open ? <ArtifactPanelPreview state={state} /> : null}
      hint="Artifacts"
      onNubClick={nothing}
      onPointerEnter={nothing}
      onPointerLeave={nothing}
    />
  );
}

/** The right edge as the window shows it in one state, over the canvas or a
 * covered view. */
export function EdgesPlate({ state, dark }: { state: EdgeState; dark: boolean }): ReactElement {
  const covered = state === "godview" || state === "approach";
  // Over a covered view the notch at rest is a sliver — but for the notch a
  // sliver grows into on approach.
  const resting = covered && state !== "approach";
  const ground =
    state === "approach" ? (
      <HistoryPreview />
    ) : covered ? (
      <GodviewPreview theme={dark ? "dark" : "light"} />
    ) : null;
  return (
    <div className="vf-ds-edges-plate" data-state={state} data-covered={covered ? "" : undefined}>
      {ground !== null && <div className="vf-ds-edges-ground">{ground}</div>}
      {state === "artifacts" ? (
        <ArtifactsDrawer />
      ) : (
        <EdgeTrayView
          label="Artifacts"
          open={false}
          pinned={false}
          sliver={resting}
          content={null}
          hint="Artifacts"
          onNubClick={nothing}
          onPointerEnter={nothing}
          onPointerLeave={nothing}
        />
      )}
    </div>
  );
}
