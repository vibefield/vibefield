import type { PluginRecord, PluginSource, SettingsContribution } from "@vibefield/contracts";
import { StatusDot } from "@vibefield/design-kit";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { controlsHere, stoppedAfterCrashes } from "../frame/plugins/plugins-model";
import { INSTALLED_LINE, READING_YOURS, SWITCH_WORDS } from "../frame/plugins/plugins-words";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { PluginCapabilities } from "./PluginCapabilities";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { buttonCls, labelCls, SettingsPill, SettingsSection, SettingsSwitch } from "./settings-ui";

// SETTINGS → PLUGINS, UNTIL PLUGINS… HOLDS EVERY SWITCH (MK-5; DESIGN.md §8 "Settings → Plugins,
// until Plugins… holds every switch"). MK-D10 has this page leave Settings for the Plugins popup;
// VF-PM's ruling of 2026-11-14 04:33Z (the inventory's A2) keeps it, narrowed, until the popup
// carries what it still holds. What the popup already holds left it.
// - A plugin from the plugin list, or a Sideloaded one, keeps its row whole: its switch, its
//   powers and its settings with Reset, while the popup gives it none (`controlsHere`, which this
//   page asks too, so a row leaves here the day that function widens to it).
// - A Built in or Development plugin is not here: its switch, its powers, its settings and their
//   way back are on its page in Plugins… (MK-4c2c; James's click on the PM board, 2026-11-14
//   08:19:36Z, "Yes, add them to the plugin's page", which superseded his MK-O24 pick A, "No Reset
//   here: a default is set back in Settings → Plugins").
// What left: those plugins whole (their pages'), the Runtime disclosure
// (Settings → Diagnostics' Plugins section), the updates disclosure (the popup's Updates), More +
// with Uninstall (Remove… on a plugin's page) and the folders that are not plugins (Diagnostics).
// It never says fieldd's own text (VF-PM 2026-11-14 06:56Z, C22): a refusal on a kept row is one
// plain line chosen by its kind, in §9's words — a switch's or a power's by the way it was being
// turned, a setting's by whether it was read or kept — and a plugin with a last error says
// "‹plugin› isn't working right now", its details in Diagnostics' Plugins section. No row offers
// Uninstall: fieldd uninstalls a plugin from the plugin list alone (`plugin-install.ts`), whose
// Remove… stands on its page in Plugins…, and never a Sideloaded one.

/** The page's words (DESIGN.md §9 "Settings and Diagnostics"): MK's, ‹draft›, for James's eye.
 * Before the window holds its plugins it says IS-282-2's "Reading your plugins…", as Installed
 * does. */
export const SETTINGS_PLUGINS_WORDS = {
  line: "Your plugins are in Plugins… in the Me menu. A setting goes back to its default here.",
  kept: "Plugins… can't turn these on or off yet, so they keep their switches here.",
  /** a kept row's state while fieldd has stopped its service after it kept crashing */
  stopped: "stopped",
} as const;

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

/** The settings a plugin declares; undefined when it declares none. */
function declaredSettings(plugin: PluginRecord): SettingsContribution["properties"] | undefined {
  const properties = plugin.contributions.settings?.properties;
  return properties !== undefined && Object.keys(properties).length > 0 ? properties : undefined;
}

const ROW =
  "rounded-[16px] border border-black/5 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.025]";
const ACTS =
  "mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/10";
/** A kept row's one line of trouble, in the ink it wore. */
const TROUBLE = "mt-2 text-[12px] text-amber-600 dark:text-amber-400";

/** A plugin from the plugin list, or a Sideloaded one: its row whole, as it stood. */
function PluginRow({
  plugin,
  plugins,
  settingsRevision,
  onSettingsChanged,
}: {
  plugin: PluginRecord;
  plugins: readonly PluginRecord[];
  settingsRevision: number;
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const [pending, setPending] = useState(false);
  // the way its switch was being turned when fieldd refused it (C22: its kind, never its text)
  const [refused, setRefused] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const toggleable = plugin.state === "enabled" || plugin.state === "disabled";
  // MK-5 (N21): a plugin fieldd stopped after it kept crashing reads off, as Plugins… says it, and
  // turning it on (plugins.enable) starts it again
  const stopped = stoppedAfterCrashes(plugin);
  const on = plugin.enabled && !stopped;
  // DK-8: a plugin's canvas contributions are its OBJECT kinds (`contributes.widgets` retired)
  const objectCount = plugin.contributions.objects?.length ?? 0;
  const settingsProperties = declaredSettings(plugin);
  const hasCapabilities = plugin.grantedCapabilities.length + plugin.deniedCapabilities.length > 0;

  const toggle = async (): Promise<void> => {
    const turningOn = !on;
    setPending(true);
    setRefused(null);
    try {
      await client.request(turningOn ? "plugins.enable" : "plugins.disable", { id: plugin.id });
    } catch {
      setRefused(turningOn);
    } finally {
      setPending(false);
    }
  };

  return (
    <article className={ROW}>
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
            {plugin.id} · {objectCount} object{objectCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={labelCls}>
            {stopped ? SETTINGS_PLUGINS_WORDS.stopped : plugin.state}
          </span>
          {toggleable && (
            <SettingsSwitch
              label={`${on ? "Disable" : "Enable"} ${plugin.title}`}
              checked={on}
              disabled={pending}
              onChange={() => void toggle()}
            />
          )}
        </div>
      </div>

      {(settingsProperties !== undefined || hasCapabilities) && (
        <div className={ACTS}>
          {settingsProperties !== undefined && (
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
        </div>
      )}

      {/* C22: a refused switch by the way it was being turned (§9 MK-4c2a's words); a last
          error, whatever its kind, as §9's "isn't working" line, its text in Diagnostics alone */}
      {refused !== null ? (
        <p className={TROUBLE}>{SWITCH_WORDS.refused(refused)}</p>
      ) : (
        plugin.lastError !== undefined && (
          <p className={TROUBLE}>{INSTALLED_LINE.broken(plugin.title)}</p>
        )
      )}
      {hasCapabilities && capsOpen && <PluginCapabilities plugin={plugin} plugins={plugins} />}
      {settingsProperties !== undefined && settingsOpen && (
        <PluginSettingsForm
          pluginId={plugin.id}
          properties={settingsProperties}
          externalReload={settingsRevision}
          onSettingsChanged={onSettingsChanged}
        />
      )}
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
  const plugins = snapshot?.plugins ?? [];
  // a plugin from the plugin list or a Sideloaded one, whole, until Plugins… carries its switches;
  // a Built in or Development plugin is not here (MK-4c2c: its page has its way back)
  const kept = plugins.filter((plugin) => !controlsHere(plugin));
  return (
    <SettingsSection title="Installed plugins" description={SETTINGS_PLUGINS_WORDS.line}>
      {snapshot === null ? (
        <div className={labelCls}>{READING_YOURS}</div>
      ) : (
        <div className="space-y-3">
          {kept.length > 0 && <p className={labelCls}>{SETTINGS_PLUGINS_WORDS.kept}</p>}
          {kept.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              plugins={plugins}
              settingsRevision={settingsRevision}
              onSettingsChanged={onSettingsChanged}
            />
          ))}
          {kept.length > 0 && (
            <p className={labelCls}>
              Disabled plugin cards remain on the canvas as placeholders and return when the plugin
              is enabled again.
            </p>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
