import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas, type InfiniteCanvasProps } from "@vibecook/ice/react";
import { type ReactElement, useMemo } from "react";
import { haloPoles } from "../cursor/halo-poles";

export type InfiniteCanvasGroundProps = Omit<InfiniteCanvasProps, "ground">;

/**
 * The field's canonical P0 composition: ICE's adaptive dot grid, wires, and
 * snap guides in one GPU canvas. Product and design-bench specimens mount this
 * same component so the catalog cannot drift into a CSS approximation.
 *
 * The cursor halo is wired as the magnet grid's pole source (ICE design-010;
 * cursor/halo-poles.ts). INERT while `grid.magnet` is off/absent — the pass
 * gates the subscription — so this costs nothing until the appearance enables
 * the magnet mode (canvas-appearance.ts carries the enabling caveats).
 */
export function InfiniteCanvasGround(props: InfiniteCanvasGroundProps): ReactElement {
  // A ground factory owns one mount's renderer state. Keep it stable for the
  // component lifetime; InfiniteCanvas disposes the resulting layer on unmount.
  const groundFactory = useMemo(() => ground({ poles: haloPoles() }), []);
  return <InfiniteCanvas {...props} ground={groundFactory} />;
}
