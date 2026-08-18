import {
  type PluginRecord,
  PluginRuntimeDiagnosticsSnapshot,
  type PluginRuntimePluginDiagnostic,
  type PluginSource,
  type SettingsContribution,
} from "@vibefield/contracts";
import { StatusDot } from "@vibefield/design-kit";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { PluginCapabilities } from "./PluginCapabilities";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { PluginUpdates } from "./PluginUpdates";
import { buttonCls, labelCls, SettingsPill, SettingsSection, SettingsSwitch } from "./settings-ui";

function Dot({ state }: { state: string }): ReactElement {
  const tone =
    state === "enabled"
      ? "healthy"
      : state === "invalid" || state === "incompatible"
        ? "error"
        : "muted";
  return <StatusDot tone={tone} className="is-large" />;
}

const SOURCE_LABEL: Record<PluginSource, string> = {
  bundled: "Built in",
  "dev-linked": "Development",
  registry: "Registry",
  sideload: "Sideloaded",
};

function SourceBadge({ plugin }: { plugin: PluginRecord }): ReactElement {
  const publisher = plugin.source === "registry" ? plugin.registry?.publisher : undefined;
  return (
    <SettingsPill>
      {SOURCE_LABEL[plugin.source]}
      {publisher !== undefined && ` · ${publisher}`}
    </SettingsPill>
  );
}

function PluginUninstall({ plugin }: { plugin: PluginRecord }): ReactElement {
  const client = useFielddClient();
  const [confirm, setConfirm] = useState<null | "keep" | "data">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (removeData: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await client.request(
        "plugins.uninstall",
        removeData ? { id: plugin.id, removeData: true } : { id: plugin.id },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-[14px] border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {confirm === null && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonCls} onClick={() => setConfirm("keep")}>
            Uninstall
          </button>
          <button
            type="button"
            className={`${buttonCls} vf-ui-tone-danger bg-transparent`}
            onClick={() => setConfirm("data")}
          >
            Remove plugin and data
          </button>
        </div>
      )}
      {confirm !== null && (
        <div>
          <p className="text-[13px] font-medium text-black/80 dark:text-white/80">
            {confirm === "keep"
              ? `Uninstall ${plugin.title}?`
              : `Remove ${plugin.title} and its data?`}
          </p>
          <p className={`mt-1 ${labelCls}`}>
            {confirm === "keep"
              ? "Plugin data is preserved, so reinstalling can restore its settings."
              : "Plugin settings and stored data are deleted. Canvas cards it created remain."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className={`${buttonCls}${confirm === "data" ? " vf-ui-tone-danger" : ""}`}
              onClick={() => void run(confirm === "data")}
            >
              {busy ? "Working…" : confirm === "data" ? "Remove data" : "Uninstall"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonCls}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">{error}</p>
      )}
    </div>
  );
}

function shortRevision(value: string | undefined): string {
  if (value === undefined) return "none";
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}

function ControllerSummary({
  title,
  controller,
  connected,
}: {
  title: string;
  controller: PluginRuntimePluginDiagnostic["serviceController"];
  connected?: boolean;
}): ReactElement {
  const scope = controller?.scope;
  return (
    <div className="rounded-[12px] border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-black/75 dark:text-white/75">{title}</span>
        <SettingsPill>
          {connected === false ? "disconnected · " : ""}
          {controller?.state ?? "not started"}
        </SettingsPill>
      </div>
      {controller !== null && (
        <div className={`mt-1 ${labelCls}`}>
          committed {shortRevision(controller.committed?.artifact.installRevision)} · desired{" "}
          {shortRevision(controller.desired?.artifact.installRevision)}
          {scope != null && (
            <>
              {" "}
              · {scope.liveCount} live · {scope.pendingSetups} pending · {scope.lateCleanups} late
            </>
          )}
          {controller.lastClose !== null && (
            <>
              {" "}
              · last close {controller.lastClose.reason?.kind ?? "unknown"} (
              {controller.lastClose.quiescent ? "quiescent" : "not quiescent"})
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BehaviorSummary({
  behavior,
}: {
  behavior: NonNullable<PluginRuntimePluginDiagnostic["renderers"][number]["behaviorGeneration"]>;
}): ReactElement {
  return (
    <div className="rounded-[12px] border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-black/75 dark:text-white/75">
          Behaviors · {behavior.target.documentId}
        </span>
        <SettingsPill>{behavior.state}</SettingsPill>
      </div>
      <div className={`mt-1 ${labelCls}`}>
        generation {behavior.target.runtimeGeneration} · {behavior.installedCount}/
        {behavior.desiredCount} installed · {behavior.blockedCount} blocked ·{" "}
        {behavior.suspendedCount} suspended · {behavior.failedCount} failed
        {behavior.closeReason === undefined ? "" : ` · close ${behavior.closeReason}`}
      </div>
      {behavior.declarations.length > 0 && (
        <div className={`mt-2 space-y-1 ${labelCls}`}>
          {behavior.declarations.map((declaration) => (
            <div key={`${declaration.declarationId}:${declaration.rendererTarget}`}>
              {declaration.declarationId} · {declaration.status} · target{" "}
              {behavior.rendererTargets[declaration.rendererTarget]?.artifact.installRevision ??
                "unknown"}
              {declaration.blockedReason === undefined ? "" : ` · ${declaration.blockedReason}`}
              {declaration.breaker === null
                ? ""
                : ` · ${declaration.breaker.strikes} strike${declaration.breaker.strikes === 1 ? "" : "s"}${declaration.breaker.suspended ? " · breaker suspended" : ""}`}
              {declaration.error === undefined ? "" : ` · ${declaration.error.message}`}
            </div>
          ))}
        </div>
      )}
      {behavior.omittedDeclarations > 0 && (
        <p className={`mt-1 ${labelCls}`}>
          {behavior.omittedDeclarations} behavior declaration row
          {behavior.omittedDeclarations === 1 ? "" : "s"} omitted.
        </p>
      )}
    </div>
  );
}

function PluginRuntimeDetails({
  runtime,
}: {
  runtime: PluginRuntimePluginDiagnostic;
}): ReactElement {
  return (
    <div className="mt-3 space-y-2 border-t border-black/5 pt-3 dark:border-white/10">
      <div className={`flex flex-wrap gap-x-3 gap-y-1 ${labelCls}`}>
        <span>commit epoch {runtime.commitEpoch ?? "unavailable"}</span>
        <span>update {runtime.update?.state ?? "idle"}</span>
        <span>
          {runtime.renderers.filter((renderer) => renderer.connected).length} connected ·{" "}
          {runtime.renderers.length} renderer report{runtime.renderers.length === 1 ? "" : "s"}
        </span>
      </div>
      <ControllerSummary title="Service" controller={runtime.serviceController} />
      {runtime.renderers.map((renderer) => (
        <div key={`${renderer.participantId}:${renderer.incarnation}`} className="space-y-2">
          <ControllerSummary
            title={`Renderer · ${renderer.participantId}`}
            controller={renderer.controller}
            connected={renderer.connected}
          />
          {renderer.behaviorGeneration !== null && (
            <BehaviorSummary behavior={renderer.behaviorGeneration} />
          )}
        </div>
      ))}
      {(runtime.serviceControllerOmitted || runtime.omittedRenderers > 0) && (
        <p className={labelCls}>
          Some controller detail was omitted by the bounded diagnostics budget
          {runtime.omittedRenderers > 0 ? ` (${runtime.omittedRenderers} renderers)` : ""}.
        </p>
      )}
      {runtime.issues.length > 0 && (
        <div className="space-y-1">
          {runtime.issues.map((issue, index) => (
            <p
              key={`${issue.code}:${issue.participantId ?? issue.face}:${index}`}
              className={
                issue.severity === "error"
                  ? "text-[12px] text-red-600 dark:text-red-400"
                  : "text-[12px] text-amber-600 dark:text-amber-400"
              }
            >
              {issue.message}
            </p>
          ))}
          {runtime.omittedIssues > 0 && (
            <p className={labelCls}>{runtime.omittedIssues} additional Doctor issues omitted.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  plugins,
  settingsRevision,
  onSettingsChanged,
  runtime,
}: {
  plugin: PluginRecord;
  plugins: readonly PluginRecord[];
  settingsRevision: number;
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
  runtime?: PluginRuntimePluginDiagnostic | undefined;
}): ReactElement {
  const client = useFielddClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const toggleable = plugin.state === "enabled" || plugin.state === "disabled";
  const uninstallable = plugin.source === "registry" || plugin.source === "sideload";
  const widgetCount = plugin.contributions.widgets.length;
  const settingsProperties = (plugin.contributions as { settings?: SettingsContribution }).settings
    ?.properties;
  const hasSettings =
    settingsProperties !== undefined && Object.keys(settingsProperties).length > 0;
  const hasCapabilities = plugin.grantedCapabilities.length + plugin.deniedCapabilities.length > 0;

  const toggle = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await client.request(plugin.enabled ? "plugins.disable" : "plugins.enable", {
        id: plugin.id,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="rounded-[16px] border border-black/5 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Dot state={plugin.state} />
            <h3 className="text-[13px] font-semibold text-black/85 dark:text-white/85">
              {plugin.title}
            </h3>
            <SourceBadge plugin={plugin} />
            <SettingsPill>v{plugin.version}</SettingsPill>
          </div>
          <p className={`mt-1 truncate ${labelCls}`} title={plugin.id}>
            {plugin.id} · {widgetCount} widget{widgetCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={labelCls}>{plugin.state}</span>
          {toggleable && (
            <SettingsSwitch
              label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.title}`}
              checked={plugin.enabled}
              disabled={pending}
              onChange={() => void toggle()}
            />
          )}
        </div>
      </div>

      {(hasSettings || hasCapabilities || uninstallable || runtime !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/10">
          {hasSettings && (
            <button
              type="button"
              className={buttonCls}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              Settings {settingsOpen ? "−" : "+"}
            </button>
          )}
          {hasCapabilities && (
            <button
              type="button"
              className={buttonCls}
              aria-expanded={capsOpen}
              onClick={() => setCapsOpen((open) => !open)}
            >
              Capabilities {capsOpen ? "−" : "+"}
            </button>
          )}
          {runtime !== undefined && (
            <button
              type="button"
              className={buttonCls}
              aria-expanded={runtimeOpen}
              onClick={() => setRuntimeOpen((open) => !open)}
            >
              Runtime {runtime.issues.length > 0 ? `· ${runtime.issues.length}` : ""}{" "}
              {runtimeOpen ? "−" : "+"}
            </button>
          )}
          {uninstallable && (
            <button
              type="button"
              className={buttonCls}
              aria-label="uninstall options"
              aria-expanded={overflowOpen}
              onClick={() => setOverflowOpen((open) => !open)}
            >
              More {overflowOpen ? "−" : "+"}
            </button>
          )}
        </div>
      )}

      {error !== null ? (
        <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">{error}</p>
      ) : (
        plugin.lastError !== undefined && (
          <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">
            {plugin.lastError.message}
          </p>
        )
      )}
      {hasCapabilities && capsOpen && <PluginCapabilities plugin={plugin} plugins={plugins} />}
      {hasSettings && settingsOpen && settingsProperties !== undefined && (
        <PluginSettingsForm
          pluginId={plugin.id}
          properties={settingsProperties}
          externalReload={settingsRevision}
          onSettingsChanged={onSettingsChanged}
        />
      )}
      {runtime !== undefined && runtimeOpen && <PluginRuntimeDetails runtime={runtime} />}
      {uninstallable && overflowOpen && <PluginUninstall plugin={plugin} />}
    </article>
  );
}

export function PluginsSection({
  settingsRevision = 0,
  onSettingsChanged,
}: {
  settingsRevision?: number;
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const snapshot = usePluginRegistrySnapshot();
  const runtimeSubscription = useSubscription<unknown>("plugins.runtime.subscribe", {});
  const runtimeSnapshot = PluginRuntimeDiagnosticsSnapshot.safeParse(runtimeSubscription.data);
  const runtimeByPlugin = new Map(
    runtimeSnapshot.success
      ? runtimeSnapshot.data.plugins.map((runtime) => [runtime.pluginId, runtime] as const)
      : [],
  );
  return (
    <SettingsSection
      title="Installed plugins"
      description="Plugins add cards, commands, and services to your field. Changes take effect immediately."
    >
      <div className="mb-3">
        <PluginUpdates />
      </div>
      {snapshot === null ? (
        <div className={labelCls}>Plugin registry unavailable while the daemon connects.</div>
      ) : (
        <div className="space-y-3">
          {snapshot.plugins.length === 0 && (
            <div className={labelCls}>No plugins are installed.</div>
          )}
          {snapshot.plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              plugins={snapshot.plugins}
              settingsRevision={settingsRevision}
              onSettingsChanged={onSettingsChanged}
              runtime={runtimeByPlugin.get(plugin.id)}
            />
          ))}
          {snapshot.problems.map((problem) => (
            <div
              key={problem.root}
              className="rounded-[14px] border border-black/5 p-3 dark:border-white/10"
            >
              <div className="text-[12px] font-medium text-black/70 dark:text-white/70">
                {problem.root}
              </div>
              <div className={labelCls}>{problem.error.message}</div>
            </div>
          ))}
          <p className={labelCls}>
            Disabled plugin cards remain on the canvas as placeholders and return when the plugin is
            enabled again.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
