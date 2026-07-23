import { CARD_RADIUS } from "@vibefield/shell-ui";
import {
  Component,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import { getRendererLogger } from "../logging";
import { getPluginRegistrySnapshot, subscribePluginRegistry } from "./plugin-registry-store";

// The spine-owned non-normal faces (spec §12.4) + the per-widget failure
// boundary (§11.4), P3c. ONE wrapper owns face selection so ICE's
// process-global widget catalog never needs re-registration to change what a
// widget SHOWS: the real schema registers once (boards stay writable — the
// engine's pack-marker gate is satisfied), and the FACE follows the live
// registry snapshot. Disable → preserving placeholder immediately; re-enable →
// the real face returns; a thrown render never takes the canvas or a peer
// widget down. GL surfaces render null on non-normal states (an R3F subtree
// cannot host the DOM placeholder; the DESIGN.md GL placeholder is a recorded
// follow-up in thinking-p3).

const faceShell: CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: CARD_RADIUS,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: 12,
  boxSizing: "border-box",
  background: "var(--vf-surface, rgba(128, 128, 128, 0.08))",
  border: "1px dashed rgba(128, 128, 128, 0.35)",
  color: "var(--vf-text-secondary, rgba(128, 128, 128, 0.8))",
  textAlign: "center",
  fontSize: 12,
  lineHeight: 1.35,
  userSelect: "none",
};

function FaceCard({ title, note }: { title: string; note: string }): ReactElement {
  return (
    <div style={faceShell}>
      <div style={{ fontWeight: 600, opacity: 0.9 }}>{title}</div>
      <div style={{ opacity: 0.7 }}>{note}</div>
    </div>
  );
}

/** §12.4 row 2 — the preserving placeholder: entity, props, and z-order stay;
 * only the face is absent while the plugin is. */
export function MissingPluginFace({
  pluginTitle,
  reason,
}: {
  pluginTitle: string;
  reason: "disabled" | "absent";
}): ReactElement {
  return (
    <FaceCard
      title={pluginTitle}
      note={
        reason === "disabled"
          ? "plugin disabled — content preserved"
          : "plugin not installed — content preserved"
      }
    />
  );
}

/** §11.4 / §12.4 row 3 — activation failed: provenance + the retry route. */
export function FailedPluginFace({
  pluginTitle,
  error,
}: {
  pluginTitle: string;
  error: string;
}): ReactElement {
  return (
    <FaceCard title={pluginTitle} note={`renderer failed: ${error} — reopen the board to retry`} />
  );
}

interface BoundaryProps {
  type: string;
  surface: "dom" | "gl";
  children: ReactNode;
}

/** §11.4: a thrown widget render is contained to that widget. */
class WidgetFaceBoundary extends Component<BoundaryProps, { error: string | null }> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    getRendererLogger()
      .child({ component: "plugin.host" })
      .error(
        "renderer.plugins.widget_render_failed",
        "A plugin widget face threw during render",
        error,
        { widgetType: this.props.type },
      );
  }
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    if (this.props.surface === "gl") return null; // no DOM inside the GL graph
    return <FaceCard title={this.props.type} note={`render failed: ${this.state.error}`} />;
  }
}

function usePluginEnabled(pluginId: string): boolean | "absent-snapshot" {
  const snapshot = useSyncExternalStore(subscribePluginRegistry, getPluginRegistrySnapshot);
  if (snapshot === null) return "absent-snapshot"; // daemon away — show real faces (honest default)
  const record = snapshot.plugins.find((p) => p.id === pluginId);
  if (record === undefined) return "absent-snapshot"; // registry doesn't know it (dev drift) — real face
  return record.enabled;
}

/** A face-only component for a plugin whose activation failed (§11.4): the
 * manifest's REAL schema registers (docs stay writable), the face says why. */
export function failedFaceComponent(
  pluginTitle: string,
  error: string,
  surface: "dom" | "gl",
): ComponentType<Record<string, unknown>> {
  if (surface === "gl") {
    const GlFailed = (): null => null;
    GlFailed.displayName = `FailedFace(gl:${pluginTitle})`;
    return GlFailed;
  }
  const Failed = (): ReactElement => <FailedPluginFace pluginTitle={pluginTitle} error={error} />;
  Failed.displayName = `FailedFace(${pluginTitle})`;
  return Failed;
}

/** A face-only component for a type NO installed plugin declares (§12.4 row 2,
 * absent case — envelope-header ghost stubs register it at the doc's version
 * so the board opens writable and the content is preserved). */
export function ghostFaceComponent(type: string): ComponentType<Record<string, unknown>> {
  const Ghost = (): ReactElement => <MissingPluginFace pluginTitle={type} reason="absent" />;
  Ghost.displayName = `GhostFace(${type})`;
  return Ghost;
}

/** Bake the face policy around a real widget component. The wrapper is
 * stateless per-render, so ICE's build-once widget cache stays truthful. */
export function withPluginFace(opts: {
  pluginId: string;
  pluginTitle: string;
  type: string;
  surface: "dom" | "gl";
  component: ComponentType<Record<string, unknown>>;
}): ComponentType<Record<string, unknown>> {
  const { pluginId, pluginTitle, type, surface, component: Real } = opts;
  function PluginFace(props: Record<string, unknown>): ReactElement | null {
    const enabled = usePluginEnabled(pluginId);
    if (enabled === false)
      return surface === "gl" ? null : (
        <MissingPluginFace pluginTitle={pluginTitle} reason="disabled" />
      );
    return (
      <WidgetFaceBoundary type={type} surface={surface}>
        <Real {...props} />
      </WidgetFaceBoundary>
    );
  }
  PluginFace.displayName = `PluginFace(${type})`;
  return PluginFace;
}
