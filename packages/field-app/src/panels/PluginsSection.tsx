import type { ReactElement } from "react";
import { labelCls, SettingsSection } from "./settings-ui";

// SETTINGS → PLUGINS, NOW THAT PLUGINS… HOLDS EVERY SWITCH (MK-5, N18; DESIGN.md §8 "Settings →
// Plugins, until Plugins… holds every switch"). MK-D10 has this page leave Settings for the Plugins
// popup. VF-PM's ruling of 2026-11-14 04:33Z (the MK inventory's A2) kept it, narrowed, until the
// popup carried what it still held: the rows of a plugin from the plugin list and of a Sideloaded
// one, whole. N18 widened the popup's `controlsHere` to them (`frame/plugins/plugins-model.ts`), so
// each plugin's switch, its powers, its settings and their way back (MK-4c2c) are on its page in
// Plugins…, and those rows left with their words. A plugin held while community plugins are off has
// no controls anywhere until community plugins are on: fieldd keeps it held whatever a switch sends
// (O3-C). So the page lists no plugin, reads nothing and sends nothing: it says where your plugins
// are. It stays in Settings as this pointer for now (ruled at its lean, 2026-11-17); its leaving
// whole (its row in the Workspace group, `SettingsDialog.tsx`) is a cut of its own.

/** The page's words (DESIGN.md §9 "Settings and Diagnostics"): MK's, ‹draft›, for James's eye. */
export const SETTINGS_PLUGINS_WORDS = {
  line: "Your plugins are in Plugins… in the Me menu.",
  page: "Each plugin's switches and settings are on its page there.",
} as const;

export function PluginsSection(): ReactElement {
  return (
    <SettingsSection title="Installed plugins">
      <p className={labelCls}>
        {SETTINGS_PLUGINS_WORDS.line} {SETTINGS_PLUGINS_WORDS.page}
      </p>
    </SettingsSection>
  );
}
