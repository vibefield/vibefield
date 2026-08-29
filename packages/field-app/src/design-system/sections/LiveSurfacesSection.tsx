import type { LiveSurfaceDemandV1 } from "@vibefield/contracts";
import { UnavailableState } from "@vibefield/design-kit";
import { BrowserPagePreview } from "@vibefield/plugin-browser/design-system";
import { type ComponentProps, type ReactElement, useEffect, useState } from "react";
import {
  createFixtureSurfaceHost,
  fixtureSurfacesSupported,
} from "../../surfaces/fixture/fixture-surface-host";
import type { ProductSurfaceFrame, SurfaceHandle } from "../../surfaces/pool";
import { LiveSurfaceView } from "../../surfaces/view/LiveSurfaceView";
import { Section, Specimen } from "../catalog-ui";

// DT-2b-2 — the catalog's live-surface entry, and a fixture ADAPTER in the
// strict sense docs/UI_SYSTEM.md means: there is no markup here that belongs to
// `LiveSurfaceView`, no second canvas, and no drawing. The section supplies what
// a HOST supplies — a transport, a pool, a ticket and frames — and lets the
// shipping view render itself.
//
// What is real: the transport, the attachment, the pool's mint-once/refcount/
// grace bookkeeping, the demand fold the view derives from its own element
// facts, the presentation's lease discipline, and every pixel path from
// `VideoFrame` to `drawImage`. What is invented: the SOURCE. The real producers
// live in Electron main and capture a browser view or a simulator; a browser
// catalog has neither, so the frames are painted here and the card says so.

export function LiveSurfacesSection(): ReactElement {
  const supported = fixtureSurfacesSupported();
  return (
    <Section
      id="live-surfaces"
      index="09"
      eyebrow="Live surfaces"
      title="A surface is a claim, not a picture"
      description="Every live surface is one refcounted attachment behind a key. Holders declare demand and the pool folds it into the single wire answer; when the attachment goes, the last frame stays and the face says so rather than blanking."
    >
      {supported ? (
        <>
          <div className="vf-ds-grid vf-ds-grid-2">
            <Specimen title="Live attachment" source="surfaces/view/LiveSurfaceView.tsx">
              <FixtureSurfaceStage grant />
            </Specimen>
            <Specimen title="Lost attachment" source="surfaces/pool/surface-pool.ts">
              <FixtureSurfaceStage grant={false} />
            </Specimen>
          </div>
          <Specimen title="Browser card (DT-3)" source="plugins/browser/src/BrowserPageView.tsx">
            <BrowserCardStage />
          </Specimen>
          <p className="vf-ds-surface-caption">
            These are FIXTURE frames, painted in this tab. The real producers live in Electron main
            — the catalog has no privileged process to capture from, so it supplies the transport
            and invents only the source. The browser card is the SHIPPING widget face over those
            same frames: its chrome states come from the plugin&apos;s own preview fixture, the
            pixels from this section&apos;s pool — double-click engages, esc leaves.
          </p>
        </>
      ) : (
        <UnavailableState
          title="Live surfaces need WebCodecs"
          description="This browser has no VideoFrame or OffscreenCanvas, so the fixture cannot carry the product's frame type. The pool and view are unchanged; only this specimen is unavailable here."
        />
      )}
    </Section>
  );
}

/**
 * The DT-3 browser card, composed the only way the walls allow: the plugin's
 * design-system entry exports the SHIPPING `BrowserPageView` behind a preview
 * that takes `SurfaceView` as a prop (R10 — a plugin cannot reach the host's
 * presentation), and THIS side injects it. The adapter deliberately ignores the
 * preview's own fixture handle for pixels: chrome states are the plugin
 * fixture's business, the moving frames are this section's real pool — so
 * engagement, the §10.2 input mapping, and the demand fold all run live here.
 */
/** The preview's own view contract, read through the design-system door — the
 * walls allow no plugin-sdk import here, and none is needed: the door already
 * states what it takes. */
type PreviewSurfaceView = ComponentProps<typeof BrowserPagePreview>["SurfaceView"];
type PreviewSurfaceViewProps = ComponentProps<PreviewSurfaceView>;

function BrowserCardStage(): ReactElement {
  const [view, setView] = useState<PreviewSurfaceView | null>(null);

  useEffect(() => {
    const host = createFixtureSurfaceHost({});
    const claim = host.pool.acquire("catalog:browser-card", {
      tickets: host.tickets,
      initialDemand: { mode: "live", targetFps: 15, priority: 50, interactive: false },
    });
    function FixtureSurfaceView(props: PreviewSurfaceViewProps): ReactElement {
      return (
        <LiveSurfaceView
          handle={claim}
          {...(props.interactive === undefined ? {} : { interactive: props.interactive })}
          {...(props.className === undefined ? {} : { className: props.className })}
        />
      );
    }
    setView(() => FixtureSurfaceView);
    return () => {
      setView(null);
      claim.release();
      host.dispose();
    };
  }, []);

  return (
    <div className="vf-ds-surface-stage">
      {view === null ? null : <BrowserPagePreview SurfaceView={view} state="live" />}
    </div>
  );
}

/**
 * One fixture host, one pool, one handle, and the shipping view over it.
 *
 * `grant` decides whether the scripted host answers the attach or refuses it,
 * which is how the catalog reaches the `lost` face and its retry route without
 * waiting for something to actually break. Retry re-mints against the same
 * refusing host, so the button is live and its answer is honest.
 */
function FixtureSurfaceStage({ grant }: { grant: boolean }): ReactElement {
  const [handle, setHandle] = useState<SurfaceHandle<ProductSurfaceFrame> | null>(null);
  const [demand, setDemand] = useState<LiveSurfaceDemandV1 | null>(null);

  useEffect(() => {
    const host = createFixtureSurfaceHost({ grant });
    const claim = host.pool.acquire("catalog:live-surface", {
      tickets: host.tickets,
      // A guess the view immediately corrects: `LiveSurfaceView` measures its
      // own element and re-declares demand on mount (DT-D5).
      initialDemand: { mode: "live", targetFps: 15, priority: 50, interactive: false },
    });
    const offDemand = host.onDemand(setDemand);
    setHandle(claim);
    return () => {
      offDemand();
      setHandle(null);
      setDemand(null);
      // The ACQUIRER releases (03·A C-3) — the view never does. Disposing the
      // host then stops the producer and closes the ports, so no timer and no
      // VideoFrame outlives this section.
      claim.release();
      host.dispose();
    };
  }, [grant]);

  return (
    <div className="vf-ds-surface-stage">
      <div className="vf-ds-surface-box">
        {handle === null ? null : <LiveSurfaceView handle={handle} />}
      </div>
      <dl className="vf-ds-surface-readout">
        <div>
          <dt>Wire demand</dt>
          <dd>
            {demand === null
              ? "none yet"
              : `${demand.mode} · ${demand.targetFps}fps · rev ${demand.revision}`}
          </dd>
        </div>
        <div>
          <dt>Raster</dt>
          <dd>
            {demand?.targetRasterSize === undefined
              ? "unsized"
              : `${demand.targetRasterSize.width}×${demand.targetRasterSize.height}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
