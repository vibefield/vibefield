import type { PoleSource } from "@vibecook/ice/ground";
import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas, type InfiniteCanvasProps } from "@vibecook/ice/react";
import { type ReactElement, useMemo } from "react";
import { haloPoles } from "../cursor/halo-poles";

export interface InfiniteCanvasGroundProps extends Omit<InfiniteCanvasProps, "ground"> {
  /** Extra app-owned field sources, used by isolated real-ground specimens. */
  additionalPoleSources?: readonly PoleSource[];
}

const NO_ADDITIONAL_POLES: readonly PoleSource[] = [];

/**
 * The field's canonical P0 composition: ICE's build-selected magnet grid,
 * wires, and snap guides in one GPU canvas. Product and design-bench specimens
 * mount this same component so the catalog cannot drift into an approximation.
 *
 * The cursor halo is wired as the magnet grid's pole source (ICE design-010;
 * cursor/halo-poles.ts). ICE 0.11 has no runtime classic/magnet switch: the
 * selected pass owns this subscription for the ground's lifetime and its
 * runIf-gated Cur producer settles back to zero idle frames.
 */
export function InfiniteCanvasGround(props: InfiniteCanvasGroundProps): ReactElement {
  const { additionalPoleSources = NO_ADDITIONAL_POLES, ...canvasProps } = props;
  // A ground factory owns one mount's renderer state. Keep it stable for the
  // component lifetime; InfiniteCanvas disposes the resulting layer on unmount.
  const groundFactory = useMemo(
    () => ground({ poles: [haloPoles(), ...additionalPoleSources] }),
    [additionalPoleSources],
  );
  return <InfiniteCanvas {...canvasProps} ground={groundFactory} />;
}
