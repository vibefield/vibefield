import { Component, type ReactElement, type ReactNode, useSyncExternalStore } from "react";
import { getRendererLogger } from "../logging";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import {
  getSurfacesSnapshot,
  type LiveSurfaceSlot,
  type SurfaceEntry,
  subscribeSurfaces,
} from "../plugin-host/surface-registry";

// The spine's fixed surface slots (P6, spec §8.4/§13.2): ChromeLayer mounts one
// PluginSurfaceHost per LIVE slot. The spine owns layout, focus, visibility, and
// the error boundary — a plugin only supplied a component. DESIGN.md §8: a
// throwing surface renders a dashed placeholder face (§12.4 idiom), never
// taking chrome down; an empty slot renders nothing (no attention = nothing to
// show, DESIGN.md §8 empty-states — a HUD slot is not a content area to fill).

// The surface's own boundary (§11.4 idiom, mirrored from faces.tsx's
// WidgetFaceBoundary): a thrown surface render is contained to that surface.
class SurfaceErrorBoundary extends Component<
  { surfaceId: string; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    getRendererLogger()
      .child({ component: "plugin.host" })
      .error("renderer.surfaces.render_failed", "A plugin surface threw during render", error, {
        surfaceId: this.props.surfaceId,
      });
  }
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    // DESIGN.md §2.3/§8: dashed hairline, text-secondary ramp — honest, quiet.
    return (
      <div
        style={{
          borderRadius: "var(--vf-radius-card)",
          border: "1px dashed rgba(128, 128, 128, 0.35)",
          background: "rgba(128, 128, 128, 0.06)",
          color: "var(--vf-text-secondary, rgba(128,128,128,0.8))",
          padding: "10px 12px",
          fontSize: 11,
          lineHeight: 1.35,
          userSelect: "none",
        }}
      >
        surface failed: {this.state.error}
      </div>
    );
  }
}

/** The enabled subset is shared by ordinary fixed hosts and the side-panel
 * controller, whose toggle must disappear on disable/unbind in the same
 * render as its content. */
export function useVisiblePluginSurfaces(slot: LiveSurfaceSlot): readonly SurfaceEntry[] {
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
  requestClose,
  surfaceId,
}: {
  slot: LiveSurfaceSlot;
  windowId: string;
  requestClose?: () => void;
  surfaceId?: string;
}): ReactElement | null {
  const visible = useVisiblePluginSurfaces(slot);
  const shown =
    surfaceId === undefined
      ? visible
      : visible.filter((surface) => surface.surfaceId === surfaceId);
  if (shown.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto" }}>
      {shown.map((s) => {
        const Surface = s.component;
        const props =
          slot === "hud.side-panel"
            ? ({
                slot,
                windowId,
                requestClose: requestClose ?? (() => undefined),
              } as const)
            : ({ slot, windowId } as const);
        return (
          <SurfaceErrorBoundary key={s.seq} surfaceId={s.surfaceId}>
            <Surface {...props} />
          </SurfaceErrorBoundary>
        );
      })}
    </div>
  );
}
