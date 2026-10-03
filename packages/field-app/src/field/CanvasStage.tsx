import type { CanvasEngine } from "@vibecook/ice";
import type { DevtoolsHandle } from "@vibecook/ice/devtools";
import type { KeymapEntry } from "@vibecook/ice/react";
import type { MutableRefObject, ReactElement } from "react";
import type { GridConfig } from "./canvas-appearance";
import { InfiniteCanvasGround } from "./InfiniteCanvasGround";

// CanvasStage (§5.4.3): renderer-local canvas composition and frame-coupled
// state, mounted INSIDE the generation-keyed recede wrapper, so one stage
// lifetime = one engine generation. Owns NO document or chrome state.
//
// DK-3 STUB (desk/landing, DK-2). Until ICE 0.14.0 this composed
// `<InfiniteCanvas>` with the GL bridge, the GL pointer router, the P2 plane, the
// R3F `<Canvas>` portal running `<GLViews>` under a three PMREM environment, the
// GL profiling lanes and the cursor halo — every one of which ICE's `/r3f` entry,
// ICE's `/ground` entry and the removed `<InfiniteCanvas>` provided. They are
// GONE (the desk is one WebGPU renderer; `three` is forbidden anywhere in the
// renderer by `bundle:assert`), so the stage renders the DK-3 ground stub — a
// plain container, nothing drawn, no host loop — and wires nothing into
// `disposeRef`/`devtoolsRef`. The props stay so `field.tsx` is untouched; DK-3
// replaces this with `<Desk layer={deskLayer(…)}>` and the desk keymap.
export function CanvasStage({
  ce,
  grid,
  keymapOverrides,
}: {
  ce: CanvasEngine;
  grid: Partial<GridConfig>;
  /** FieldView's stable override entries (I1, ice 0.4.0 — field-keymap.ts). */
  keymapOverrides: readonly KeymapEntry[];
  /** GL frame profiling wired only while the ECS panel was open (nothing to profile until DK-3). */
  ecsOpen: boolean;
  /** ChromeLayer's live devtools handle (the GL lanes it fed are gone with the islands). */
  devtoolsRef: MutableRefObject<DevtoolsHandle | null>;
  /** The session's engine-disposal cleanup calls this BEFORE ce.dispose(); the stub publishes nothing. */
  disposeRef: MutableRefObject<(() => void) | null>;
}): ReactElement {
  return (
    <InfiniteCanvasGround
      engine={ce}
      grid={grid}
      keymapOverrides={keymapOverrides}
      className="field-canvas"
    />
  );
}
