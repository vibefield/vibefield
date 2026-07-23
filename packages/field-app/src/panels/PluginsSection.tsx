import type { PluginRecord } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { borderCls, labelCls, sectionCls } from "./SettingsPanel";

// Plugins — a Settings SECTION, sibling to System/Mesh (PLUG-P2 UI: the
// fieldd plugin registry rendered honestly, EL5). Enable/disable toggles call
// plugins.enable/disable and never write local "enabled" state — the row
// reflects whatever plugins.subscribe reports next (plugin-registry-store's
// own law), same as System/Mesh's health rows above it.

/** DESIGN.md §2.5 hue mapping for PluginRecordState — invalid/incompatible
 * are errors; disabled carries no hue (a choice, not a failure). */
function Dot({ state }: { state: string }): ReactElement {
  const color =
    state === "enabled"
      ? "var(--vf-green)"
      : state === "invalid" || state === "incompatible"
        ? "var(--vf-red)"
        : "rgba(128, 128, 128, 0.45)"; // disabled
  return (
    <span
      className="inline-block h-1.5 w-1.5 flex-none rounded-full"
      style={{ background: color }}
    />
  );
}

function PluginRow({ plugin }: { plugin: PluginRecord }): ReactElement {
  const client = useFielddClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleable = plugin.state === "enabled" || plugin.state === "disabled";
  const widgetCount = plugin.contributions.widgets.length;

  const toggle = async () => {
    setPending(true);
    setError(null);
    try {
      await client.request(plugin.enabled ? "plugins.disable" : "plugins.enable", {
        id: plugin.id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="pl-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Dot state={plugin.state} />
          <span className="min-w-0 truncate">{plugin.title}</span>
        </span>
        <span className="flex flex-none items-center gap-1.5">
          <span className={labelCls}>{plugin.state}</span>
          {toggleable && (
            <input type="checkbox" checked={plugin.enabled} disabled={pending} onChange={toggle} />
          )}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 pl-2">
        <span className={`min-w-0 truncate ${labelCls}`} title={plugin.id}>
          {plugin.id}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          <span className={labelCls}>{plugin.source}</span>
          <span className={labelCls}>v{plugin.version}</span>
          <span className={labelCls}>
            {widgetCount} widget{widgetCount === 1 ? "" : "s"}
          </span>
        </span>
      </div>
      {/* the registry's own lastError and a live toggle error share one voice
          (DESIGN.md §9: say what happened) — a fresh toggle error wins. */}
      {error !== null ? (
        <div className={`truncate pl-2 text-right ${labelCls}`} title={error}>
          {error}
        </div>
      ) : (
        plugin.lastError !== undefined && (
          <div className={`truncate pl-2 text-right ${labelCls}`} title={plugin.lastError.message}>
            {plugin.lastError.message}
          </div>
        )
      )}
    </div>
  );
}

export function PluginsSection(): ReactElement {
  const snapshot = usePluginRegistrySnapshot();
  return (
    <div className={borderCls}>
      <div className={sectionCls}>Plugins</div>
      <div className="space-y-1">
        {snapshot === null ? (
          <div className={labelCls}>registry unavailable (daemon offline or still connecting)</div>
        ) : (
          <>
            {snapshot.plugins.length === 0 && <div className={labelCls}>no plugins</div>}
            {snapshot.plugins.map((p) => (
              <PluginRow key={p.id} plugin={p} />
            ))}
            {snapshot.problems.map((prob) => (
              <div key={prob.root} className="flex items-center justify-between gap-2 pl-2">
                <span className={labelCls}>{prob.root}</span>
                <span className={`min-w-0 truncate ${labelCls}`} title={prob.error.message}>
                  {prob.error.message}
                </span>
              </div>
            ))}
            {/* P3c truth: faces + tray follow the toggle LIVE; boards stay
                writable — a disabled plugin's widgets become preserving
                placeholders (never lossy) and return on re-enable. */}
            <div className={labelCls}>
              takes effect immediately · a disabled plugin's widgets show as placeholders and return
              on re-enable
            </div>
          </>
        )}
      </div>
    </div>
  );
}
