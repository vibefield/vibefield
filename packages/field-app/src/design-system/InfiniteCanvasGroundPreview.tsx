import { type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import type { DeskLayerHandle, ThemeName } from "@vibecook/ice/desk";
import { DESK_ENGINE } from "@vibecook/ice/desk/objects";
import { Desk, type LayerFactory } from "@vibecook/ice/react";
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { feedDesk } from "../field/desk/desk-feed";
import { deskLook, fieldDeskLayer } from "../field/desk/desk-layer";

export interface InfiniteCanvasGroundPreviewProps {
  /** The catalog page's theme: the desk is dressed in it, as the field's stage is in the app's. */
  dark: boolean;
  background: string;
  className?: string;
  interactive?: boolean;
  label?: string;
}

/**
 * A controller-free mount of the production GROUND — since DK-3 the desk itself: the field's own
 * layer (`fieldDeskLayer` — the mat, its rulers at 60, the plates, the hand) on a disposable engine
 * of the desk's preset with an empty board. ICE owns the camera and the drawing; the catalog supplies
 * only the engine and the page's theme. Where the page has no WebGPU (a test's DOM) the specimen says
 * so instead of mounting a desk that cannot draw.
 */
export function InfiniteCanvasGroundPreview({
  dark,
  background,
  className = "",
  interactive = true,
  label = "Interactive infinite-canvas ground",
}: InfiniteCanvasGroundPreviewProps): ReactElement {
  const supported = supportsDesk();
  return (
    <section
      className={`vf-ds-ground-preview ${className}`.trim()}
      data-ground-renderer={supported ? "ice" : "unavailable"}
      aria-label={label}
      style={{ background }}
    >
      {supported ? (
        <LiveDesk dark={dark} interactive={interactive} />
      ) : (
        <div className="vf-ds-ground-preview__unavailable">
          <strong>Desk unavailable</strong>
          <span>The desk draws with WebGPU, which this page doesn't offer.</span>
        </div>
      )}
    </section>
  );
}

function LiveDesk({ dark, interactive }: { dark: boolean; interactive: boolean }): ReactElement {
  const [engine] = useState<CanvasEngine>(() => {
    const ce = createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_ENGINE.widgets] });
    ce.docs.create();
    return ce;
  });
  useEffect(() => () => engine.dispose(), [engine]);

  const theme: ThemeName = dark ? "dark" : "light";
  const themeRef = useRef(theme);
  const handleRef = useRef<DeskLayerHandle | null>(null);
  const layer = useMemo<LayerFactory>(() => {
    const factory = fieldDeskLayer({ engine, theme: themeRef.current });
    return (ctx) => {
      const handle = factory(ctx);
      handleRef.current = handle;
      return handle;
    };
  }, [engine]);
  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    const look = deskLook(theme);
    handleRef.current?.setTheme(look.theme, look.palette);
  }, [theme]);

  const style: CSSProperties = interactive ? {} : { pointerEvents: "none" };
  return (
    <Desk
      engine={engine}
      layer={layer}
      className="vf-ds-ground-preview__canvas"
      style={style}
      onReady={() => {
        const handle = handleRef.current;
        if (handle === null) return;
        const feed = feedDesk(handle, engine);
        return () => feed.dispose();
      }}
    />
  );
}

function supportsDesk(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
