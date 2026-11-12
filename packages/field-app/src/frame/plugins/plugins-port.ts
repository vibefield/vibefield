import { PluginsCatalog, SettingsGetResult } from "@vibefield/contracts";

// THE PLUGINS POPUP'S PORT (MK-4a; DESIGN.md §8 "Plugins — the frame's second
// popup", "The read on open"): the questions the popup asks, over this
// window's fieldd client — the list fieldd holds, at once
// (`plugins.catalog.get`), and the fresh read, once per opening
// (`plugins.catalog.refresh`, MK-D5: the person's act, on no timer). Every
// answer the popup shows is parsed, never cast. MK-4c2a adds a plugin's
// switches (§8 "Its switches"): its one switch (`plugins.enable` /
// `plugins.disable`) and a power's (`plugins.grants.set`), the requests
// Settings → Plugins sends today, with the same parameters. Their answers are
// not read: the registry snapshot fieldd pushes next is the one truth the
// switches show (the P5 law), so a switch never moves on an answer. MK-4c2b
// adds a plugin's settings (§8 "Its settings"): a setting's value
// (`storage.settings.get`, a secret's never sent to a window) and its new value
// (`storage.settings.set`), the requests Settings → Plugins sends today, with
// the same parameters. The port never has a reset (MK-4c2's C2), an undo or a
// redo (James's MK-O6 pick, 2026-11-11: no Undo on a plugin's page until there
// is one per plugin): going back stays in Settings. The catalog hands the
// controller a fixture port instead; nothing here installs or removes a plugin.

export interface PluginsPort {
  /** The list fieldd holds, its state and its time. */
  catalog(): Promise<PluginsCatalog>;
  /** The fresh read: answers once the read has ended. */
  refresh(): Promise<PluginsCatalog>;
  /** Turn a plugin on (`plugins.enable`): settles when fieldd has answered. */
  enable(id: string): Promise<void>;
  /** Turn a plugin off (`plugins.disable`). */
  disable(id: string): Promise<void>;
  /** Give a plugin a power it asked for, or take it back (`plugins.grants.set`). */
  grant(id: string, capability: string, granted: boolean): Promise<void>;
  /** A setting's value as fieldd keeps it, or its default, unset; a secret's says only whether one is kept. */
  settingsGet(id: string, key: string): Promise<SettingsGetResult>;
  /** Keep a setting's new value: settles when fieldd has answered. */
  settingsSet(id: string, key: string, value: unknown): Promise<void>;
}

/** What the port asks of a fieldd client: one request door. */
export interface PluginsDoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function pluginsPortOver(client: PluginsDoorClient): PluginsPort {
  return {
    async catalog() {
      return PluginsCatalog.parse(await client.request("plugins.catalog.get", {}));
    },
    async refresh() {
      return PluginsCatalog.parse(await client.request("plugins.catalog.refresh", {}));
    },
    async enable(id) {
      await client.request("plugins.enable", { id });
    },
    async disable(id) {
      await client.request("plugins.disable", { id });
    },
    async grant(id, capability, granted) {
      await client.request("plugins.grants.set", { id, capability, granted });
    },
    async settingsGet(id, key) {
      return SettingsGetResult.parse(
        await client.request("storage.settings.get", { pluginId: id, key }),
      );
    },
    async settingsSet(id, key, value) {
      await client.request("storage.settings.set", { pluginId: id, key, value });
    },
  };
}
