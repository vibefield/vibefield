import { createCanvasEngine, type GridConfig } from "@vibecook/ice";
import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import { InfiniteCanvasGround } from "../field/InfiniteCanvasGround";

export interface InfiniteCanvasGroundPreviewProps {
  grid: Partial<GridConfig>;
  background: string;
  className?: string;
  interactive?: boolean;
  label?: string;
}

/**
 * A controller-free mount of the production ground. The bench supplies only a
 * disposable empty engine; ICE still owns camera gestures and GPU rendering.
 */
export function InfiniteCanvasGroundPreview({
  grid,
  background,
  className = "",
  interactive = true,
  label = "Interactive infinite-canvas ground",
}: InfiniteCanvasGroundPreviewProps): ReactElement {
  const supported = supportsGroundRenderer();
  return (
    <section
      className={`vf-ds-ground-preview ${className}`.trim()}
      data-ground-renderer={supported ? "ice" : "unavailable"}
      aria-label={label}
      style={{ background }}
    >
      {supported ? (
        <LiveGround grid={grid} interactive={interactive} />
      ) : (
        <div className="vf-ds-ground-preview__unavailable">
          <strong>GPU ground unavailable</strong>
          <span>The live ICE layer requires WebGPU or WebGL2.</span>
        </div>
      )}
    </section>
  );
}

function LiveGround({
  grid,
  interactive,
}: {
  grid: Partial<GridConfig>;
  interactive: boolean;
}): ReactElement {
  const [engine] = useState(() =>
    createCanvasEngine({
      widgets: [],
      settings: { zoom: { min: 0.25, max: 3 } },
    }),
  );

  useEffect(() => () => engine.dispose(), [engine]);

  const style: CSSProperties = interactive ? {} : { pointerEvents: "none" };
  return (
    <InfiniteCanvasGround
      engine={engine}
      grid={grid}
      className="vf-ds-ground-preview__canvas"
      style={style}
    />
  );
}

function supportsGroundRenderer(): boolean {
  if (typeof navigator === "undefined") return false;
  return "gpu" in navigator || typeof WebGL2RenderingContext !== "undefined";
}
