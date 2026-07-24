import type { PluginRecord, PluginSource, SettingsContribution } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { PluginCapabilities } from "./PluginCapabilities";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { PluginUpdates } from "./PluginUpdates";
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

/** §20.5 — the UI labels source and rung on every row; "reviewed" names who
 * reviewed. These are FACTS in the muted text ramp, never warnings — no hue
 * (DESIGN.md §2.5: color belongs to honest STATE only, and a source is a fact,
 * not a state of concern; §9 voice). The registry publisher IS the reviewer. */
const SOURCE_LABEL: Record<PluginSource, string> = {
  bundled: "built-in",
  "dev-linked": "dev",
  registry: "registry · reviewed",
  sideload: "sideload",
};

function SourceBadge({ plugin }: { plugin: PluginRecord }): ReactElement {
  const publisher = plugin.source === "registry" ? plugin.registry?.publisher : undefined;
  return (
    <span className={`flex-none rounded px-1 ${labelCls}`} title={plugin.source}>
      {SOURCE_LABEL[plugin.source]}
      {publisher !== undefined && ` · ${publisher}`}
    </span>
  );
}

/** §16.5 uninstall — data is PRESERVED by default; "remove data too" is the
 * separate, explicit destructive act (DESIGN.md §2.5 red). Two-step confirm on
 * each so a narrow-panel click is never irreversible. No optimistic state — the
 * row leaves when plugins.subscribe re-snapshots (the P5 law). */
function PluginUninstall({ plugin }: { plugin: PluginRecord }): ReactElement {
  const client = useFielddClient();
  const [confirm, setConfirm] = useState<null | "keep" | "data">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (removeData: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await client.request(
        "plugins.uninstall",
        removeData ? { id: plugin.id, removeData: true } : { id: plugin.id },
      );
      // on success the row unmounts with the next snapshot; nothing to flip here.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 space-y-1 border-l border-neutral-100 pl-2 dark:border-neutral-700">
      {confirm === null && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirm("keep")}
            className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
          >
            uninstall
          </button>
          {/* destructive variant — §2.5 red, visually distinct before the confirm */}
          <button
            type="button"
            onClick={() => setConfirm("data")}
            className="flex-none hover:opacity-80"
            style={{ color: "var(--vf-red)" }}
          >
            remove data too
          </button>
        </div>
      )}
      {confirm === "keep" && (
        <div className="space-y-1">
          <div className={labelCls}>uninstall {plugin.title}? keeps its data</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(false)}
              className="flex-none hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              {busy ? "uninstalling…" : "uninstall"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(null)}
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              cancel
            </button>
          </div>
        </div>
      )}
      {confirm === "data" && (
        <div className="space-y-1">
          <div style={{ color: "var(--vf-red)" }}>remove {plugin.title} and its data?</div>
          <div className={labelCls}>
            deletes its settings and stored data — canvas cards it made are kept (§16.5)
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
              className="flex-none hover:opacity-80"
              style={{ color: "var(--vf-red)" }}
            >
              {busy ? "removing…" : "remove data"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(null)}
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              cancel
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <div className={`truncate text-right ${labelCls}`} title={error}>
          {error}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  plugins,
}: {
  plugin: PluginRecord;
  plugins: readonly PluginRecord[];
}): ReactElement {
  const client = useFielddClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const toggleable = plugin.state === "enabled" || plugin.state === "disabled";
  // §5.3 mutability — only registry and sideload code is uninstallable; bundled
  // ships with the app and dev-linked is managed through its link.
  const uninstallable = plugin.source === "registry" || plugin.source === "sideload";
  const widgetCount = plugin.contributions.widgets.length;
  // contributions.settings (§8.5) lands in parallel; read it through a typed
  // view so this file compiles before the SanitizedContributions field does.
  const settingsProps = (plugin.contributions as { settings?: SettingsContribution }).settings
    ?.properties;
  const hasSettings = settingsProps !== undefined && Object.keys(settingsProps).length > 0;
  // P6 — the grants pane shows one row per REQUESTED capability, i.e. the union
  // of the record's granted + denied lists (§15.2). No requests ⇒ no disclosure.
  const hasCapabilities = plugin.grantedCapabilities.length + plugin.deniedCapabilities.length > 0;

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
          <SourceBadge plugin={plugin} />
          <span className={labelCls}>v{plugin.version}</span>
          <span className={labelCls}>
            {widgetCount} widget{widgetCount === 1 ? "" : "s"}
          </span>
          {uninstallable && (
            <button
              type="button"
              onClick={() => setOverflowOpen((v) => !v)}
              aria-expanded={overflowOpen}
              aria-label="uninstall options"
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              {overflowOpen ? "···▾" : "···"}
            </button>
          )}
          {hasCapabilities && (
            <button
              type="button"
              onClick={() => setCapsOpen((v) => !v)}
              aria-expanded={capsOpen}
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              capabilities {capsOpen ? "▾" : "▸"}
            </button>
          )}
          {hasSettings && (
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              settings {settingsOpen ? "▾" : "▸"}
            </button>
          )}
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
      {hasCapabilities && capsOpen && <PluginCapabilities plugin={plugin} plugins={plugins} />}
      {hasSettings && settingsOpen && settingsProps !== undefined && (
        <PluginSettingsForm pluginId={plugin.id} properties={settingsProps} />
      )}
      {uninstallable && overflowOpen && <PluginUninstall plugin={plugin} />}
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
            {/* §5.3.1 — the user-initiated updates flow sits at the section top;
                it never checks on its own (no push feed, no polling). */}
            <PluginUpdates />
            {snapshot.plugins.length === 0 && <div className={labelCls}>no plugins</div>}
            {snapshot.plugins.map((p) => (
              <PluginRow key={p.id} plugin={p} plugins={snapshot.plugins} />
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
