import { type ReactElement, type RefObject, useEffect, useState } from "react";
import { roundButtonCls } from "../field/theme-constants";
import type { SurfaceEntry } from "../plugin-host/surface-registry";
import { PluginSurfaceHost } from "./PluginSurfaceSlot";
import "./SidePanelStage.css";

const EXIT_MS = 600;

export function SidePanelToggle({
  entry,
  active,
  buttonRef,
  onToggle,
}: {
  entry: SurfaceEntry;
  active: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}): ReactElement {
  const label = active ? `Close ${entry.title}` : `Open ${entry.title}`;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={roundButtonCls(active)}
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-controls="vf-plugin-side-panel"
    >
      {/* A quiet stack/window glyph. A future packaged-asset resolver may use
          entry.icon; the neutral fallback is deliberately host-owned. */}
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="M14 5v14M8 9h2M8 12h2M8 15h2" />
      </svg>
    </button>
  );
}

/** One physical non-modal panel. Content stays mounted through the travel-out
 * transition so close never becomes a blank shell crossfade. */
export function SidePanelStage({
  entry,
  windowId,
  onClose,
}: {
  entry: SurfaceEntry | null;
  windowId: string;
  onClose: () => void;
}): ReactElement {
  const [rendered, setRendered] = useState<SurfaceEntry | null>(entry);

  useEffect(() => {
    if (entry !== null) {
      setRendered(entry);
      return;
    }
    const timer = window.setTimeout(() => setRendered(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [entry]);

  const displayed = entry ?? rendered;

  return (
    <aside
      id="vf-plugin-side-panel"
      className="vf-side-panel no-drag"
      data-open={entry !== null ? "true" : "false"}
      aria-hidden={entry === null}
      aria-label={displayed?.title ?? "Side panel"}
      inert={entry === null}
    >
      <div className="vf-side-panel__scroll">
        {displayed !== null && (
          <PluginSurfaceHost
            slot="hud.side-panel"
            windowId={windowId}
            requestClose={onClose}
            surfaceId={displayed.surfaceId}
          />
        )}
      </div>
    </aside>
  );
}
