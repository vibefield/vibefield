import { createCanvasEngine } from "@vibecook/ice";
import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import type { GridConfig } from "../field/canvas-appearance";
import { InfiniteCanvasGround } from "../field/InfiniteCanvasGround";

export interface InfiniteCanvasGroundPreviewProps {
  grid: Partial<GridConfig>;
  background: string;
  className?: string;
  interactive?: boolean;
  label?: string;
}

/**
 * A controller-free mount of the production ground. The catalog supplies only a
 * disposable empty engine; ICE still owns camera gestures and GPU rendering.
 *
 * DK-2 (desk/landing, ICE 0.14.0): the ground it mounted is the DK-3 stub (a plain
 * container — ICE's `/ground` entry and its local-pointer poles are gone), so this
 * specimen shows an empty frame until DK-3 mounts the desk; the retire table's
 * first row takes it at DK-17.
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
