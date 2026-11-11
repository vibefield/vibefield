import { PluginsCatalog } from "@vibefield/contracts";

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
// switches show (the P5 law), so a switch never moves on an answer. The port
// has no settings request and never a reset. The catalog hands the controller
// a fixture port instead; nothing here installs or removes a plugin.

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
  };
}
