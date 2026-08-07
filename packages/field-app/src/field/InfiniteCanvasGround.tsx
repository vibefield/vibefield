import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas, type InfiniteCanvasProps } from "@vibecook/ice/react";
import { type ReactElement, useMemo } from "react";

export type InfiniteCanvasGroundProps = Omit<InfiniteCanvasProps, "ground">;

/**
 * The field's canonical P0 composition: ICE's adaptive dot grid, wires, and
 * snap guides in one GPU canvas. Product and design-bench specimens mount this
 * same component so the catalog cannot drift into a CSS approximation.
 */
export function InfiniteCanvasGround(props: InfiniteCanvasGroundProps): ReactElement {
  // A ground factory owns one mount's renderer state. Keep it stable for the
  // component lifetime; InfiniteCanvas disposes the resulting layer on unmount.
  const groundFactory = useMemo(() => ground(), []);
  return <InfiniteCanvas {...props} ground={groundFactory} />;
}
