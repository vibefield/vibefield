import type { ReactElement } from "react";
import "./browser-page.css";

// The tray preview (ICE tier 3: an author-owned static picture). The DEFAULT
// tier sandbox-mounts the REAL component — which for this widget acquires a
// live browser runtime through ctx.pool, so a closed tray was quietly holding
// a producer at about:blank (found live by the DT-3e validation smoke). A
// preview is a picture of a page, never a page: no pool, no handle, no ops.
export function BrowserPagePreviewTile(): ReactElement {
  return (
    <div className="vf-browser-page" data-preview="true">
      <div className="vf-browser-page__bar">
        <span className="vf-browser-page__address">vibefield.dev</span>
      </div>
      <div className="vf-browser-page__page vf-browser-page__page--preview" />
      <div className="vf-browser-page__foot">
        <span className="vf-browser-page__label">a page on your canvas</span>
        <span className="vf-browser-page__stage">double-click to use</span>
      </div>
    </div>
  );
}
