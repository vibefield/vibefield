import type { CanvasEngine } from "@vibecook/ice";
import type { KeymapEntry } from "@vibecook/ice/react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { GridConfig } from "./canvas-appearance";

// DK-3 STUB (desk/landing, DK-2). This was the field's canonical P0 composition —
// ICE's `<InfiniteCanvas ground={ground({ poles })}>`: the build-selected magnet
// grid, wires and snap guides in one GPU canvas, with the cursor halo as a pole
// source. ICE 0.14.0 deleted every piece of it (ICE's `/ground` entry, the R3F
// islands, `<InfiniteCanvas>` itself — its successor is `<Desk engine
// layer={deskLayer(…)}>`), so on this branch the mount is a PLAIN CONTAINER: no
// engine host, no rAF loop, no pointer adapter, no keymap, nothing drawn. The
// engine is created (field-engine.ts, the desk preset) and its documents open and
// persist; nothing mounts it. DK-3 replaces this file and `CanvasStage` with the
// desk's own mount and deletes the stub.

export interface InfiniteCanvasGroundProps {
  engine: CanvasEngine;
  grid?: Partial<GridConfig>;
  keymapOverrides?: readonly KeymapEntry[];
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function InfiniteCanvasGround({
  className,
  style,
  children,
}: InfiniteCanvasGroundProps): ReactElement {
  return (
    <div className={className} style={style} data-canvas-mount="dk-3-pending">
      {children}
    </div>
  );
}
