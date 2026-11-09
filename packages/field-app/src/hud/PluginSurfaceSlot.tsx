import { UnavailableState } from "@vibefield/design-kit";
import { Component, type ReactElement, type ReactNode, useSyncExternalStore } from "react";
import { getRendererLogger } from "../logging";
import { PluginStyleBoundary } from "../plugin-host/PluginStyleBoundary";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import {
  getSurfacesSnapshot,
  type LiveSurfaceSlot,
  type SurfaceEntry,
  subscribeSurfaces,
} from "../plugin-host/surface-registry";
import "./PluginSurfaceSlot.css";

// The spine's fixed surface slots (P6, spec §8.4/§13.2): ChromeLayer mounts one
// PluginSurfaceHost per LIVE slot. The spine owns layout, focus, visibility, and
// the error boundary — a plugin only supplied a component. DESIGN.md §8: a
// throwing surface renders a dashed placeholder face (§12.4 idiom), never
// taking chrome down; an empty slot renders nothing (no attention = nothing to
// show, DESIGN.md §8 empty-states — a HUD slot is not a content area to fill).

// The surface's own boundary (§11.4 idiom — the widget faces' boundary it was
// mirrored from retired with them at DK-8): a thrown surface render is
// contained to that surface.
export class SurfaceErrorBoundary extends Component<
  { surfaceId: string; title?: string; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    getRendererLogger()
      .child({ component: "plugin.host" })
      .error("renderer.surfaces.render_failed", "A surface threw during render", error, {
        surfaceId: this.props.surfaceId,
      });
  }
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    // DESIGN.md §2.3/§8: dashed hairline, text-secondary ramp — honest, quiet.
    return (
      <UnavailableState
        compact
        title={this.props.title ?? "Surface unavailable"}
        description={`Renderer failed: ${this.state.error}`}
      />
    );
  }
}

/** The surfaces of `slot` whose plugins are on. */
function useVisiblePluginSurfaces(slot: LiveSurfaceSlot): readonly SurfaceEntry[] {
  const surfaces = useSyncExternalStore(subscribeSurfaces, getSurfacesSnapshot);
  const snapshot = usePluginRegistrySnapshot();
  const disabled =
    snapshot === null ? null : new Set(snapshot.plugins.filter((p) => !p.enabled).map((p) => p.id));
  return surfaces.filter(
    (surface) => surface.slot === slot && (disabled === null || !disabled.has(surface.pluginId)),
  );
}

export function PluginSurfaceHost({
  slot,
  windowId,
}: {
  slot: LiveSurfaceSlot;
  windowId: string;
}): ReactElement | null {
  const shown = useVisiblePluginSurfaces(slot);
  if (shown.length === 0) return null;

  return (
    <div className="vf-plugin-surface-stack">
      {shown.map((s) => {
        const Surface = s.component;
        return (
          <SurfaceErrorBoundary key={s.seq} surfaceId={s.surfaceId}>
            <PluginStyleBoundary pluginId={s.pluginId}>
              <Surface slot={slot} windowId={windowId} />
            </PluginStyleBoundary>
          </SurfaceErrorBoundary>
        );
      })}
    </div>
  );
}
